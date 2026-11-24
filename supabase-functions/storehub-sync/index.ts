// =============================================================================
// storehub-sync — StoreHub POS (F&B outlets) → Supabase. See
// supabase-functions/booking-v89-storehub-pos.sql.
//
// Called with header x-webhook-secret (= cb_webhook_secret(), like
// cloudbeds-sync) and a JSON body { action, ... }:
//   test      check the API credentials: lists the StoreHub stores (names only).
//   pull      every 15 min (pg_cron 'storehub-pull'): stores, products (every 6 h)
//             and transactions from 2 days before the last pull up to now — the
//             overlap picks up late cancellations and returns.
//   backfill  { from: "YYYY-MM-DD", to?: "YYYY-MM-DD" } one-off history load, in
//             7-day chunks, until ~100 s have passed; answers { next_from } when
//             there is more to do (call again with that from).
//
// StoreHub API: https://api.storehubhq.com, HTTP Basic auth
//   username = STOREHUB_ACCOUNT (the backoffice subdomain, e.g. "ntq")
//   password = STOREHUB_API_KEY (Backoffice → Settings → API / from StoreHub)
// Both are Edge Function secrets the owner adds. Max 3 calls per second;
// /transactions?from&to (UTC ISO instants) returns at most 5,000 rows, so a full
// window is split in two and asked again.
// "Verify JWT" OFF (webhook-secret pattern, like cloudbeds-sync).
// =============================================================================

// deno-lint-ignore-file no-explicit-any
type Any = any;

const env = (k: string, d = "") => (globalThis as Any).Deno?.env.get(k) ?? d;
const SH = "https://api.storehubhq.com";
const SB_URL = () => env("SUPABASE_URL");
const SR = () => env("SUPABASE_SERVICE_ROLE_KEY");
const OVERLAP_MS = 2 * 864e5;
const PAGE_CAP = 5000;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Supabase
export async function rpc(name: string, args: Record<string, unknown> = {}): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SR(), Authorization: `Bearer ${SR()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

let secretCache: string | null = null;
async function secret(): Promise<string | null> {
  if (!secretCache) secretCache = await rpc("cb_webhook_secret");
  return secretCache;
}

async function stateGet(key: string): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/cb_sync_state?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: { apikey: SR(), Authorization: `Bearer ${SR()}` },
  });
  if (!res.ok) return null;
  return (await res.json())?.[0]?.value ?? null;
}
const stateSet = (key: string, value: unknown) => rpc("cb_state_set", { p_key: key, p_value: value }).catch(() => null);

// ---------------------------------------------------------------- StoreHub
let lastCall = 0;
export async function sh(path: string, query: Record<string, string> = {}): Promise<Any> {
  const account = env("STOREHUB_ACCOUNT"), key = env("STOREHUB_API_KEY");
  if (!account || !key) throw new Error("not_configured: add STOREHUB_ACCOUNT and STOREHUB_API_KEY in Edge Functions → Secrets");
  const wait = 400 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  const url = new URL(path, SH);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    lastCall = Date.now();
    const res = await fetch(url.toString(), {
      headers: { Authorization: "Basic " + btoa(`${account}:${key}`), Accept: "application/json" },
    });
    if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`StoreHub ${path}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : [];
  }
  throw new Error(`StoreHub ${path}: rate limited`);
}
const arr = (x: Any): Any[] => (Array.isArray(x) ? x : Array.isArray(x?.data) ? x.data : []);

// All transactions created in [from, to), splitting windows that hit the 5,000 cap.
export async function transactions(from: Date, to: Date): Promise<Any[]> {
  const out = new Map<string, Any>();
  const pending: [number, number][] = [[from.getTime(), to.getTime()]];
  let calls = 0;
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (++calls > 200) throw new Error("too many StoreHub calls for one window");
    const rows = arr(await sh("/transactions", {
      from: new Date(a).toISOString(), to: new Date(b - 1).toISOString(),
    }));
    if (rows.length >= PAGE_CAP && b - a > 1000) {
      const m = a + Math.floor((b - a) / 2);
      pending.push([a, m], [m, b]);
      continue;
    }
    for (const r of rows) if (r?.refId) out.set(String(r.refId), r);
  }
  return [...out.values()];
}

async function store(p: { stores?: Any[]; products?: Any[]; transactions?: Any[] }) {
  const tot = { stores: 0, products: 0, transactions: 0 };
  const add = (r: Any) => { tot.stores += r?.stores || 0; tot.products += r?.products || 0; tot.transactions += r?.transactions || 0; };
  if (p.stores?.length || p.products?.length) {
    const prods = p.products || [];
    add(await rpc("sh_upsert", { p: { stores: p.stores || [], products: prods.slice(0, 2000) } }));
    for (let i = 2000; i < prods.length; i += 2000) add(await rpc("sh_upsert", { p: { products: prods.slice(i, i + 2000) } }));
  }
  const tx = p.transactions || [];
  for (let i = 0; i < tx.length; i += 500) add(await rpc("sh_upsert", { p: { transactions: tx.slice(i, i + 500) } }));
  return tot;
}

// ---------------------------------------------------------------- actions
async function test() {
  const stores = arr(await sh("/stores"));
  return { ok: true, stores: stores.map((s) => s?.name || s?.id) };
}

async function pull() {
  const now = new Date();
  const last = await stateGet("storehub_last_pull");
  const since = last?.to ? new Date(new Date(last.to).getTime() - OVERLAP_MS) : new Date(now.getTime() - 3 * 864e5);
  const prodState = await stateGet("storehub_products_at");
  const needProducts = !prodState?.at || now.getTime() - new Date(prodState.at).getTime() > 6 * 3600e3;

  const stores = arr(await sh("/stores"));
  const products = needProducts ? arr(await sh("/products")) : [];
  const tx = await transactions(since, now);
  const saved = await store({ stores, products, transactions: tx });
  if (needProducts) await stateSet("storehub_products_at", { at: now.toISOString(), count: products.length });
  const out = { from: since.toISOString(), to: now.toISOString(), fetched: tx.length, saved, at: now.toISOString() };
  await stateSet("storehub_last_pull", out);
  return out;
}

async function backfill(body: Any) {
  const t0 = Date.now();
  const okDate = (s: Any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!okDate(body?.from)) return { error: "from must be YYYY-MM-DD" };
  // Manila midnight = 16:00 UTC the day before
  const manila = (d: string) => new Date(`${d}T00:00:00+08:00`);
  const end = okDate(body?.to) ? new Date(manila(body.to).getTime() + 864e5) : new Date();
  let cur = manila(body.from);
  const stores = arr(await sh("/stores"));
  const products = arr(await sh("/products"));
  const tot = await store({ stores, products });
  let fetched = 0;
  while (cur < end && Date.now() - t0 < 100e3) {
    const nxt = new Date(Math.min(end.getTime(), cur.getTime() + 7 * 864e5));
    const tx = await transactions(cur, nxt);
    fetched += tx.length;
    const s = await store({ transactions: tx });
    tot.transactions += s.transactions;
    cur = nxt;
  }
  const more = cur < end;
  const next_from = more ? new Date(cur.getTime() + 8 * 3600e3).toISOString().slice(0, 10) : null;
  const out = { from: body.from, reached: cur.toISOString(), fetched, saved: tot, done: !more, next_from };
  await stateSet("storehub_last_backfill", out);
  return out;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const given = req.headers.get("x-webhook-secret") || "";
  const s = await secret().catch(() => null);
  if (!s || given !== s) return new Response("Unauthorized", { status: 401 });

  let body: Any = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    switch (body.action) {
      case "test": return json(await test());
      case "pull": return json(await pull());
      case "backfill": return json(await backfill(body));
      default: return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error("storehub-sync", body?.action, msg);
    await stateSet("storehub_last_error", { action: body?.action, error: msg.slice(0, 500), at: new Date().toISOString() });
    return json({ error: msg.slice(0, 500) }, msg.startsWith("not_configured") ? 503 : 500);
  }
}

if ((globalThis as Any).Deno?.serve) (globalThis as Any).Deno.serve(handle);
