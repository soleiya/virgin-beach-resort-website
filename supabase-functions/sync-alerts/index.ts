// =============================================================================
// sync-alerts — emails when the website and Cloudbeds fall out of step (v60).
//
// Called every 5 minutes by pg_cron (cb_alerts_call(), job
// "cloudbeds-sync-alerts") with header x-webhook-secret (the same vault secret
// cloudbeds-sync uses) and body { action: "check" }. Runs on its own, so it
// still warns when cloudbeds-sync itself has stopped.
//   check  cb_sync_alerts_collect() → one email listing new problems, problems
//          still open after 2 hours, and problems that have cleared;
//          cb_sync_alerts_sent() records what was emailed.
//   test   { to? } sends a sample alert (nothing is recorded).
//   peek   what would be reported right now (nothing is sent or recorded).
//
// Secrets (Edge Functions → Secrets, shared with send-booking-email):
//   SMTP_PASSWORD  Google App Password for reservations@virginbeachresort.com
//   ALERT_EMAILS   optional, comma-separated (default migquesada@gmail.com)
// "Verify JWT" stays ON: pg_cron sends the public anon key; the vault secret
// (x-webhook-secret) is what actually authorises a call.
// =============================================================================

// deno-lint-ignore-file no-explicit-any
type Any = any;

const env = (k: string, d = "") => (globalThis as Any).Deno?.env.get(k) ?? d;
const MAILBOX = "reservations@virginbeachresort.com";
const SB_URL = () => env("SUPABASE_URL");
const SR = () => env("SUPABASE_SERVICE_ROLE_KEY");
const recipients = () => env("ALERT_EMAILS", "migquesada@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SR(), Authorization: `Bearer ${SR()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

let transporter: Any = null;
async function smtp() {
  if (transporter) return transporter;
  const nodemailer = (await import("npm:nodemailer@6.9.16")).default;
  if (env("SMTP_DRY_RUN") === "true") return (transporter = nodemailer.createTransport({ jsonTransport: true }));
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: MAILBOX, pass: env("SMTP_PASSWORD") },
  });
  return transporter;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const KIND: Record<string, string> = {
  push: "Website booking not in Cloudbeds",
  hold: "Cloudbeds reservation not held on the website",
  avail: "Website shows more free casitas than Cloudbeds",
  sync: "Cloudbeds sync problem",
};
const ORDER = ["sync", "push", "hold", "avail"];
const manilaTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function buildEmail(open: Any[], cleared: Any[]) {
  const fresh = open.filter((a) => !a.reminder);
  const subject = open.length
    ? `⚠ VBR sync: ${open.length} problem${open.length === 1 ? "" : "s"}${fresh.length ? "" : " still open"} — ` +
      [...new Set(open.map((a) => a.kind))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((k) => KIND[k] || k).join(" · ")
    : `✓ VBR sync: ${cleared.length} problem${cleared.length === 1 ? "" : "s"} cleared`;

  const section = (kind: string, items: Any[]) => items.length ? `
    <h3 style="margin:22px 0 6px;font-size:15px;color:#7a2e0e">${esc(KIND[kind] || kind)} (${items.length})</h3>
    <ul style="margin:0;padding-left:18px">${items.map((a) => `
      <li style="margin:0 0 10px">
        <strong>${esc(a.title)}</strong>${a.reminder ? ` <span style="color:#a15c00">— still open since ${esc(manilaTime(a.since))}</span>` : ""}<br>
        <span style="color:#444">${esc(a.detail || "")}</span>
      </li>`).join("")}</ul>` : "";

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#222;max-width:680px">
    <p style="margin:0 0 4px">${open.length
      ? "The website and Cloudbeds are out of step. Until this is fixed, the website could sell a casita that's already taken (or miss one that's booked)."
      : "These sync problems have cleared on their own or were fixed."}</p>
    ${ORDER.map((k) => section(k, open.filter((a) => a.kind === k))).join("")}
    ${cleared.length ? `<h3 style="margin:22px 0 6px;font-size:15px;color:#1d6b35">Cleared (${cleared.length})</h3>
      <ul style="margin:0;padding-left:18px">${cleared.map((a) => `<li style="margin:0 0 6px;color:#555">${esc(a.title)}</li>`).join("")}</ul>` : ""}
    <p style="margin:24px 0 0;font-size:12px;color:#777">
      Cloudbeds: <a href="https://hotels.cloudbeds.com/connect/208402">hotels.cloudbeds.com</a> ·
      Website dashboard: <a href="https://virginbeachresort.com/staff/">virginbeachresort.com/staff</a><br>
      Checked every 5 minutes. An open problem is repeated every 2 hours until it clears.
    </p></div>`;
  const text = html.replace(/<li[^>]*>/g, " • ").replace(/<(br|\/p|\/li|\/h3)[^>]*>/g, "\n").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return { subject, html, text };
}

async function send(to: string[], mail: { subject: string; html: string; text: string }) {
  const t = await smtp();
  await t.sendMail({ from: `VBR · Sync alert <${MAILBOX}>`, to: to.join(", "), subject: mail.subject, html: mail.html, text: mail.text });
}

async function check() {
  const r = await rpc("cb_sync_alerts_collect");
  const open: Any[] = r?.open || [], cleared: Any[] = r?.cleared || [];
  if (!open.length && !cleared.length) return { sent: false, open: 0, cleared: 0 };
  await send(recipients(), buildEmail(open, cleared));
  await rpc("cb_sync_alerts_sent", { p_keys: [...open, ...cleared].map((a) => a.key) });
  return { sent: true, open: open.length, cleared: cleared.length, to: recipients() };
}

let secretCache: string | null = null;
export async function handle(req: Request): Promise<Response> {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!secretCache) secretCache = await rpc("cb_webhook_secret").catch(() => null);
  if (!secretCache || req.headers.get("x-webhook-secret") !== secretCache) return new Response("Unauthorized", { status: 401 });
  let body: Any = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    switch (body.action || "check") {
      case "check": return json(await check());
      case "peek": return json(await rpc("cb_sync_issues"));
      case "test": {
        const to = body.to ? [String(body.to)] : recipients();
        await send(to, buildEmail([{ kind: "push", title: "TEST — VBR-00000 is not in Cloudbeds — Sample Guest, B.Casita 2, Nov 13–16",
          detail: "This is a test of the sync alerts. Nothing needs to be done.", since: new Date().toISOString(), reminder: false }], []));
        return json({ sent: true, to });
      }
      default: return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
}

if ((globalThis as Any).Deno?.serve) (globalThis as Any).Deno.serve(handle);
