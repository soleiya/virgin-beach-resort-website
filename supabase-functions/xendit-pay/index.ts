// Supabase Edge Function: xendit-pay
// ---------------------------------------------------------------------------
// Online payment for bookings made on the website — villa stays and day trips
// (booking-v31-xendit.sql, booking-v32-daytrip-xendit-atv.sql).
//
//   1. The booking page / Upload page calls it with
//        { action: "create", order_code, email, kind: "deposit" | "full" | "balance" }
//      → the amount is worked out in the database (xendit_invoice_start), a
//        Xendit invoice is created and its checkout URL returned:
//        { url, amount, kind, order_code }. An open invoice for the same amount
//        is reused instead of making a new one.
//   2. Xendit calls it back (Invoices → "Invoice paid" / "Invoice expired"
//      webhook) with header x-callback-token. PAID → a verified payment, the
//      booking is confirmed, the payment goes to the Cloudbeds folio.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   XENDIT_SECRET_KEY      Xendit secret API key (Money-in: Write).
//                          xnd_development_… = test mode, xnd_production_… = live.
//   XENDIT_CALLBACK_TOKEN  Xendit Dashboard → Settings → Webhooks → Verification token
// Optional:
//   XENDIT_FORWARD_URL     the webhook URL that was set in Xendit before this one
//                          (e.g. MECX Tech's) — callbacks for invoices that aren't
//                          ours are passed on to it unchanged
//   SITE_URL               where guests come back to (defaults to the GitHub Pages site)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Deploy with "Verify JWT" OFF (the guest's browser and Xendit call it).
// Webhook URL to enter in Xendit (Invoices paid + expired):
//   https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/xendit-pay
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string, d = "") => {
  const v = (globalThis as Any).Deno?.env.get(k);
  return v === undefined || v === null || v === "" ? d : String(v);
};
const SB_URL = () => env("SUPABASE_URL");
const SR = () => env("SUPABASE_SERVICE_ROLE_KEY");
const SITE = () => env("SITE_URL", "https://soleiya.github.io/virgin-beach-resort-website").replace(/\/+$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function rpc(name: string, args: Record<string, unknown>): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SR(), Authorization: `Bearer ${SR()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---------- helpers -----------------------------------------------------------

export const KIND_LABEL: Record<string, string> = { deposit: "50% down payment", full: "full payment", balance: "remaining balance" };

// "0917 123 4567" / "+63 917…" / "639171234567" → "+639171234567" (Xendit wants E.164)
export function e164(phone: unknown): string | undefined {
  const d = String(phone || "").replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(d)) return d;
  const n = d.replace(/\D/g, "");
  if (/^09\d{9}$/.test(n)) return "+63" + n.slice(1);
  if (/^639\d{9}$/.test(n)) return "+" + n;
  if (/^9\d{9}$/.test(n)) return "+63" + n;
  return undefined;
}

export function splitName(full: unknown): { given: string; surname?: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { given: parts[0] || "Guest" };
  return { given: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] };
}

function fmtDay(d: string) {
  return new Date(d + "T00:00:00+08:00").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

export function invoiceBody(s: Any, site: string) {
  const back = `${site}/pay/index.html?order=${encodeURIComponent(s.order_code)}&email=${encodeURIComponent(s.guest_email)}`;
  const name = splitName(s.guest_name);
  const label = KIND_LABEL[s.kind] || "payment";
  const stay = s.check_in ? `${fmtDay(s.check_in)}${s.check_out ? " – " + fmtDay(s.check_out) : ""}` : "";
  const seconds = Math.max(600, Math.min(31536000, Math.floor((new Date(s.expires_at).getTime() - Date.now()) / 1000)));
  const mobile = e164(s.guest_phone);
  return {
    external_id: `vbr-${s.xid}`,
    amount: Number(s.amount),
    currency: "PHP",
    description: `Virgin Beach Resort · ${s.order_code} · ${label}${stay ? " · " + stay : ""}`,
    invoice_duration: seconds,
    payer_email: s.guest_email,
    customer: {
      given_names: name.given,
      ...(name.surname ? { surname: name.surname } : {}),
      email: s.guest_email,
      ...(mobile ? { mobile_number: mobile } : {}),
    },
    customer_notification_preference: { invoice_paid: ["email"] },
    items: [{ name: `${s.stay_label || "Booking"} ${s.order_code} — ${label}`, quantity: 1, price: Number(s.amount), category: s.stay_type === "overnight" ? "Accommodation" : "Day use" }],
    success_redirect_url: back + "&paid=1",
    failure_redirect_url: back + "&paid=0",
  };
}

// constant-time compare
function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- 1. create -------------------------------------------------------------

async function create(body: Any) {
  const key = env("XENDIT_SECRET_KEY");
  if (!key) return json({ error: "Online payment isn't switched on yet — please contact us." }, 503);
  const kind = ["deposit", "full", "balance"].includes(body.kind) ? body.kind : "full";
  const start = await rpc("xendit_invoice_start", { p_order_code: String(body.order_code || ""), p_guest_email: String(body.email || ""), p_kind: kind });
  if (!start || start.error) return json({ error: start?.error || "Couldn't start the payment." }, 400);
  if (start.reuse) return json({ url: start.invoice_url, amount: start.amount, kind: start.kind, order_code: start.order_code, reused: true });

  const live = key.startsWith("xnd_production");
  try {
    const res = await fetch("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(key + ":"), "Content-Type": "application/json" },
      body: JSON.stringify(invoiceBody(start, SITE())),
    });
    const out: Any = await res.json().catch(() => ({}));
    if (!res.ok || !out.invoice_url) {
      const msg = `${res.status} ${out.error_code || ""} ${out.message || ""}`.trim();
      await rpc("xendit_invoice_created", { p_xid: start.xid, p_invoice_id: null, p_url: null, p_expires: null, p_live: live, p_error: msg }).catch(() => null);
      return json({ error: "The payment page couldn't be opened just now — please try again in a moment." }, 502);
    }
    await rpc("xendit_invoice_created", { p_xid: start.xid, p_invoice_id: out.id, p_url: out.invoice_url, p_expires: out.expiry_date || null, p_live: live, p_error: null });
    return json({ url: out.invoice_url, amount: start.amount, kind: start.kind, order_code: start.order_code, test: !live });
  } catch (e) {
    await rpc("xendit_invoice_created", { p_xid: start.xid, p_invoice_id: null, p_url: null, p_expires: null, p_live: live, p_error: String((e as Error).message) }).catch(() => null);
    return json({ error: "The payment page couldn't be opened just now — please try again in a moment." }, 502);
  }
}

// ---------- 2. Xendit webhook ---------------------------------------------------

async function webhook(req: Request, body: Any) {
  // (trimmed: a value pasted into Supabase Secrets can pick up a line break)
  const token = env("XENDIT_CALLBACK_TOKEN").trim();
  const got = (req.headers.get("x-callback-token") || "").trim();
  if (!token || !same(got, token)) {
    // diagnostic without revealing the token: lengths and last 3 characters only
    console.warn(`xendit-pay: callback token mismatch — received len ${got.length} …${got.slice(-3)}, expected len ${token.length} …${token.slice(-3)}`);
    return json({ error: "unauthorized" }, 401);
  }
  // Xendit's invoice callback (v2): id, external_id, status, paid_amount, payment_method, payment_channel, paid_at
  const d = body?.data && body?.event ? body.data : body;
  if (!d?.external_id && !d?.id) return json({ ignored: "no invoice" });
  if (d.external_id && !String(d.external_id).startsWith("vbr-")) {
    // Not ours (e.g. a MECX Tech / Cloudbeds payment link on the same Xendit
    // account): pass it on unchanged to the URL that used to receive them.
    const fwd = env("XENDIT_FORWARD_URL");
    if (!fwd) return json({ ignored: "not a website invoice" });
    const res = await fetch(fwd, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-callback-token": req.headers.get("x-callback-token") || "" },
      body: JSON.stringify(body),
    });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": res.headers.get("content-type") || "text/plain" } });
  }
  const out = await rpc("xendit_invoice_event", {
    p_external_id: d.external_id || null,
    p_invoice_id: d.id || null,
    p_status: String(d.status || ""),
    p_paid_amount: d.paid_amount ?? d.amount ?? null,
    p_method: d.payment_method || null,
    p_channel: d.payment_channel || d.bank_code || d.ewallet_type || null,
    p_paid_at: d.paid_at || null,
  });
  return json({ ok: true, result: out });
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: Any = {};
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  try {
    if (req.headers.get("x-callback-token") !== null) return await webhook(req, body);
    if (body.action === "create") return await create(body);
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong — please try again, or contact us." }, 500);
  }
}

if ((globalThis as Any).Deno?.serve && import.meta.main) (globalThis as Any).Deno.serve(handle);
