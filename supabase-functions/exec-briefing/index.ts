// =============================================================================
// exec-briefing — data for the executive briefing page (virginbeachresort.com/exec/),
// booking-v87.
//
// The page holds no figures. It calls (Authorization: Bearer <anon key>):
//   POST { pin: "1234", year?: 2026 }
//   → 200 { data: exec_briefing(year) }
//   → 401 { error: "wrong_pin" }        → 429 { error: "locked", retry_in: seconds }
//
// The PIN is checked here against the EXEC_PIN secret (constant-time). Wrong
// PINs are counted per caller (sha-256 of the IP) in exec_pin_attempts:
// 5 wrong → that caller is locked 15 min; 30 wrong in an hour → all callers
// locked 15 min. The figures are read with the service role through
// exec_briefing(), which only the service role can call.
//
// booking-v89: also returns exec_fnb(year) as data.fnb (StoreHub F&B sales).
//
// Secrets (Edge Functions → Secrets): EXEC_PIN (4 digits, set by the owner).
// "Verify JWT" ON (the page sends the public anon key).
// =============================================================================

// deno-lint-ignore-file no-explicit-any
type Any = any;

const env = (k: string, d = "") => (globalThis as Any).Deno?.env.get(k) ?? d;
const SB_URL = () => env("SUPABASE_URL");
const SERVICE = () => env("SUPABASE_SERVICE_ROLE_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function rpc(name: string, args: Record<string, unknown>): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE(), Authorization: `Bearer ${SERVICE()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

export function sameDigits(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a.padEnd(16, "\0")), y = new TextEncoder().encode(b.padEnd(16, "\0"));
  let d = a.length ^ b.length;
  for (let i = 0; i < 16; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

async function callerKey(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("exec:" + ip));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const secret = env("EXEC_PIN");
  if (!/^\d{4,8}$/.test(secret)) return json({ error: "not_configured" }, 503);

  let body: Any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const pin = String(body?.pin ?? "");
  const year = Number.isInteger(body?.year) && body.year >= 2023 && body.year <= 2100
    ? body.year
    : Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", year: "numeric" }));

  try {
    const key = await callerKey(req);
    const gate = await rpc("exec_pin_gate", { p_key: key });
    if (gate?.locked) return json({ error: "locked", retry_in: gate.retry_in }, 429);

    const ok = /^\d{4,8}$/.test(pin) && sameDigits(pin, secret);
    const rec = await rpc("exec_pin_record", { p_key: key, p_ok: ok });
    if (!ok) return json(rec?.locked ? { error: "locked", retry_in: 900 } : { error: "wrong_pin" }, rec?.locked ? 429 : 401);

    // v89: F&B sales from StoreHub ride along as data.fnb; the page still works without them.
    const [data, fnb] = await Promise.all([
      rpc("exec_briefing", { p_year: year }),
      rpc("exec_fnb", { p_year: year }).catch((e) => { console.error("exec_fnb", (e as Error).message); return null; }),
    ]);
    if (data && fnb) data.fnb = fnb;
    return json({ data });
  } catch (e) {
    console.error("exec-briefing", (e as Error).message);
    return json({ error: "unavailable" }, 500);
  }
}

(globalThis as Any).Deno?.serve(handle);
