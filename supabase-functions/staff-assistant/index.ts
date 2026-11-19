// =============================================================================
// staff-assistant — "Ask" panel in the staff dashboard (booking-v81).
//
// Staff call (Authorization: Bearer <staff session>; every staff account,
// view-only included):
//   POST { messages: [{ role: "user"|"assistant", content: string }, …] }
//   → { answer, queries: [{ purpose, sql, rows | error }], model }
//
// Claude answers with the live data. It reads the database through
// staff_ai_query(), called WITH THE STAFF MEMBER'S OWN SESSION: it sees only
// what that staff account can read, one SELECT at a time, in a read-only
// transaction — it can never change anything. Nothing is stored.
//
// Secrets (Edge Functions → Secrets): ANTHROPIC_API_KEY (already set for
// Campaigns). Optional: ANTHROPIC_MODEL (default claude-sonnet-5-5).
// "Verify JWT" ON.
// =============================================================================

// deno-lint-ignore-file no-explicit-any
type Any = any;

const env = (k: string, d = "") => (globalThis as Any).Deno?.env.get(k) ?? d;
const SB_URL = () => env("SUPABASE_URL");
const ANON = () => env("SUPABASE_ANON_KEY");
const MODEL = () => env("ANTHROPIC_MODEL", "claude-sonnet-5-5");
const MAX_STEPS = 12;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// the staff member's own session — never the service role
async function rpc(name: string, args: Record<string, unknown>, jwt: string): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ANON(), Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try { msg = JSON.parse(text).message || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

async function staffUser(jwt: string): Promise<Any | null> {
  if (!jwt) return null;
  const u = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: ANON(), Authorization: `Bearer ${jwt}` } });
  if (!u.ok) return null;
  const user = await u.json();
  return user?.id ? user : null;
}

export function manilaNow(d = new Date()): string {
  return d.toLocaleString("en-US", { timeZone: "Asia/Manila", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function systemPrompt(schema: Record<string, string>, staff: string): string {
  return `You are the assistant inside the Virgin Beach Resort staff dashboard (virginbeachresort.com/staff). Staff ask you anything about bookings, guests, revenue, occupancy, payments, cabanas, casitas, campaigns or how the system works, and you answer from the LIVE database.
Now: ${manilaNow()} (Asia/Manila). Asking: ${staff}.

The resort: an exclusive private villa resort on a virgin white sand beach in Laiya, San Juan, Batangas, about 3 hours from Manila. Never call it a "cove". 18 casitas for overnight stays with full-board meals; day trips with Dining / Lounge cabanas (Beach Bar cabanas are staff-only). Money is in Philippine pesos (₱).

How to work:
- Use the run_sql tool to look things up; never guess numbers. Run as many queries as you need (small, focused ones), check surprising results, then answer.
- run_sql takes ONE PostgreSQL SELECT (or WITH … SELECT), no semicolons, up to 500 rows returned. You can't change data — if staff ask you to change something, tell them where in the dashboard to do it.
- Dates are local Manila dates; for "today" use (now() at time zone 'Asia/Manila')::date.
- Answer briefly and plainly for hotel staff: the answer first, then the key figures (a small markdown table if it helps). Say which period and which statuses you counted. Format money like ₱12,345.
- Guest contact details are fine to share with staff when asked. Never reveal passwords, keys or secrets.

Data notes:
- booking_requests: one row per booking. stay_type 'overnight' (casitas) or day trips (others). status: inquiry (request, not a booking), pending (awaiting payment / confirmation), confirmed, completed (stayed), declined (cancelled), expired (unpaid hold lapsed). Real bookings = pending, confirmed, completed. cb_owned = made in Cloudbeds (the PMS; Cloudbeds is the master for casitas), cb_info has Cloudbeds' status, rooms, source, total. source / booked_by say where it came from.
- Money on bookings: total_amount, amount_paid, amount_pending; website bookings also have room_total, meal_total, extra_bed_total, pet_total, add_on_total, discounts. Cloudbeds-made bookings have only total_amount (Cloudbeds' total, usually room charges).
- booking_villas: which casita (villas) each overnight booking holds, check_in → check_out (check_out night not included); rows with booking_id null are blocks (block_reason; cb_avail_hold = held because Cloudbeds shows the casita unavailable).
- villas: the casitas (unit_label, room_type_name, base_occupancy, weekday_rate, weekend_rate). cb_rates: Cloudbeds' price and rooms_available per room type per night.
- booking_cabanas / cabanas / cabana_blocks: day-trip cabanas. booking_payments: payments and proofs. booking_audit_log: who changed what. campaigns: email offers.
- villa_revenue_days(p_from date, p_to date) gives, per night: max_total (every casita sold at its room rate + full-board meals at base occupancy), achieved (confirmed + completed stays), pending, lost_blocked (blocked casitas), casitas, sold, blocked. Use it for revenue-vs-maximum questions, e.g. select * from villa_revenue_days('2026-12-01','2027-01-01').

Tables and columns you can read:
${Object.entries(schema).map(([t, c]) => `- ${t}: ${c}`).join("\n")}`;
}

const TOOLS = [{
  name: "run_sql",
  description: "Run one read-only PostgreSQL SELECT against the live resort database and get the rows back as JSON (max 500 rows).",
  input_schema: {
    type: "object",
    properties: {
      purpose: { type: "string", description: "What this query finds out, in a few words (shown to staff)." },
      sql: { type: "string", description: "One SELECT or WITH … SELECT statement, no semicolon." },
    },
    required: ["purpose", "sql"],
  },
}];

async function claude(system: string, messages: Any[]): Promise<Any> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (Supabase → Edge Functions → Secrets)");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL(), max_tokens: 4000, system, tools: TOOLS, messages }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Claude API: ${j?.error?.message || res.status}`);
  return j;
}

// keep tool results small enough for the model
export function clip(rows: unknown, max = 60000): string {
  const s = JSON.stringify(rows);
  return s.length <= max ? s : s.slice(0, max) + `… [truncated: ${s.length} characters; narrow the query or aggregate]`;
}

export function cleanHistory(raw: unknown): Any[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Any[] = [];
  for (const m of list.slice(-20)) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    const content = String(m?.content ?? "").slice(0, 8000).trim();
    if (!role || !content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += "\n\n" + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function ask(history: Any[], jwt: string, staff: string) {
  const schema = await rpc("staff_ai_schema", {}, jwt);
  const system = systemPrompt(schema || {}, staff);
  const messages: Any[] = history.map((m) => ({ role: m.role, content: m.content }));
  const queries: Any[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await claude(system, messages);
    messages.push({ role: "assistant", content: r.content });
    const calls = (r.content || []).filter((b: Any) => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || !calls.length) {
      const answer = (r.content || []).filter((b: Any) => b.type === "text").map((b: Any) => b.text).join("\n").trim();
      return { answer: answer || "I couldn't find an answer to that.", queries, model: MODEL() };
    }
    const results: Any[] = [];
    for (const c of calls) {
      const sql = String(c.input?.sql || "");
      const q: Any = { purpose: String(c.input?.purpose || ""), sql };
      try {
        const rows = await rpc("staff_ai_query", { p_sql: sql, p_limit: 500 }, jwt);
        q.rows = Array.isArray(rows) ? rows.length : 0;
        results.push({ type: "tool_result", tool_use_id: c.id, content: clip(rows) });
      } catch (e) {
        q.error = String((e as Error).message || e).slice(0, 300);
        results.push({ type: "tool_result", tool_use_id: c.id, content: "ERROR: " + q.error, is_error: true });
      }
      queries.push(q);
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "That needed more lookups than I'm allowed in one go. Try a narrower question (a specific month, guest or booking).", queries, model: MODEL() };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const user = await staffUser(jwt).catch(() => null);
  if (!user) return json({ error: "Please sign in to the staff dashboard." }, 401);
  let body: Any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const history = cleanHistory(body.messages);
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Ask a question first." }, 400);
  try {
    return json(await ask(history, jwt, String(user.email || "staff")));
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
}

if ((globalThis as Any).Deno?.serve) (globalThis as Any).Deno.serve(handle);
