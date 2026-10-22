// Supabase Edge Function: send-contact-email
// -----------------------------------------------------------------------------
// Receives the website Contact form (contact/index.html), saves it in
// contact_messages (backup + staff record), and emails it to the team:
//   Weddings / Corporate  → events@virginbeachresort.com
//   everything else       → reservations@virginbeachresort.com
// Reply-To is the guest, so staff can answer straight from Gmail.
//
// Uses the same project secrets as send-booking-email (SMTP_PASSWORD for the
// reservations@ Gmail account; SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase automatically). The browser calls it with the public
// anon key, so "Verify JWT" can stay ON.
// Table: supabase-functions/booking-v27-contact-messages.sql
// -----------------------------------------------------------------------------

type Any = any; // deno-lint-ignore no-explicit-any

function env(key: string, fallback = ""): string {
  const g: Any = globalThis as Any;
  const v = g.Deno ? g.Deno.env.get(key) : g.process?.env?.[key];
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

const MAILBOX = "reservations@virginbeachresort.com";
const EVENTS_EMAIL = "events@virginbeachresort.com";
const FROM = `Virgin Beach Resort Website <${MAILBOX}>`;
const TYPES = ["General Inquiry", "Feedback on your stay", "Weddings", "Corporate"];
const EVENTS_TYPES = ["Weddings", "Corporate"];
const MAX_PER_HOUR_PER_IP = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function esc(s: unknown) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clean(v: unknown, max: number) {
  return String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

// ---------- database (PostgREST with the service role) -----------------------
async function db(path: string, init: RequestInit = {}) {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`db ${path}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

// ---------- email -------------------------------------------------------------
let transporter: Any = null;
async function smtp() {
  if (transporter) return transporter;
  const nodemailer = (await import("npm:nodemailer@6.9.16")).default;
  if (env("SMTP_DRY_RUN") === "true") return (transporter = nodemailer.createTransport({ jsonTransport: true }));
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: MAILBOX, pass: env("SMTP_PASSWORD") },
  });
  return transporter;
}

function row(label: string, value: string) {
  return `<tr><td style="padding:7px 12px 7px 0;color:#6b6559;vertical-align:top;width:30%;border-bottom:1px solid #ddd2ba;">${label}</td>` +
    `<td style="padding:7px 0;vertical-align:top;border-bottom:1px solid #ddd2ba;">${value}</td></tr>`;
}

function staffEmail(m: Any) {
  const name = `${m.first_name} ${m.last_name}`.trim();
  const when = new Date(m.created_at || Date.now()).toLocaleString("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
  });
  const html = `<div style="background:#f6f1e6;padding:20px 10px;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#fffdf8;border:1px solid #ddd2ba;border-radius:12px;">
<tr><td style="padding:22px 28px;color:#23241f;font-size:15px;line-height:1.55;">
<div style="color:#6b6559;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;">Website contact form · ${esc(m.inquiry_type)}</div>
<h1 style="margin:6px 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:normal;color:#14524c;">New message from ${esc(name)}</h1>
<div style="background:#f6f1e6;border-radius:8px;padding:14px 16px;white-space:pre-wrap;">${esc(m.message)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-top:16px;">
${row("Name", esc(name))}
${row("Email", `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>`)}
${row("Contact no.", `<a href="tel:${esc(m.phone.replace(/[^+\d]/g, ""))}">${esc(m.phone)}</a>`)}
${row("Country", esc(m.country))}
${row("Type of inquiry", esc(m.inquiry_type))}
${row("Received", esc(when))}
</table>
<p style="margin:16px 0 0;font-size:13px;color:#6b6559;">Just hit <strong>Reply</strong> — it goes straight to the guest.</p>
</td></tr></table></div>`;
  const text = `New website message (${m.inquiry_type}) from ${name}\n\n${m.message}\n\n` +
    `Email: ${m.email}\nContact no.: ${m.phone}\nCountry: ${m.country}\nReceived: ${when}\n\nReply to this email to answer the guest.`;
  return { subject: `Website inquiry — ${m.inquiry_type} — ${name}`, html, text };
}

// ---------- handler -----------------------------------------------------------
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let b: Any;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  // Honeypot: real people never see or fill this field.
  if (clean(b.website, 200)) return json({ ok: true });

  const m = {
    first_name: clean(b.first_name, 80),
    last_name: clean(b.last_name, 80),
    phone: clean(b.phone, 40),
    email: clean(b.email, 200).toLowerCase(),
    country: clean(b.country, 80),
    inquiry_type: TYPES.includes(clean(b.inquiry_type, 40)) ? clean(b.inquiry_type, 40) : "General Inquiry",
    message: clean(b.message, 5000),
    ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64) || null,
    user_agent: clean(req.headers.get("user-agent"), 300) || null,
    page: clean(b.page, 300) || null,
  };
  if (!m.first_name || !m.last_name || !m.phone || !m.country || m.message.length < 2) {
    return json({ error: "Please fill in every field." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m.email)) return json({ error: "Please check your email address." }, 400);

  if (!env("SMTP_PASSWORD")) return json({ error: "Email is not set up yet." }, 500);

  try {
    if (m.ip) {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const recent = await db(`contact_messages?select=id&ip=eq.${encodeURIComponent(m.ip)}&created_at=gte.${encodeURIComponent(since)}`);
      if ((recent || []).length >= MAX_PER_HOUR_PER_IP) {
        return json({ error: "Too many messages from this connection — please email or call us instead." }, 429);
      }
    }

    const to = EVENTS_TYPES.includes(m.inquiry_type) ? EVENTS_EMAIL : MAILBOX;
    const [saved] = await db("contact_messages", { method: "POST", body: JSON.stringify({ ...m, sent_to: to }) });

    const mail = staffEmail(saved);
    let status = "sent", error: string | null = null, messageId: string | null = null;
    try {
      const t = await smtp();
      const info = await t.sendMail({
        from: FROM,
        to,
        replyTo: `${m.first_name} ${m.last_name} <${m.email}>`,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: { "X-VBR-Email-Kind": "contact_form" },
      });
      messageId = info?.messageId || null;
    } catch (err) {
      status = "failed";
      error = (err as Error)?.message || String(err);
      console.error("contact email failed:", err);
    }
    await db(`contact_messages?id=eq.${saved.id}`, {
      method: "PATCH",
      body: JSON.stringify({ email_status: status, email_error: error, message_id: messageId, emailed_at: status === "sent" ? new Date().toISOString() : null }),
    });
    if (status !== "sent") return json({ error: "We saved your message but couldn't email it just now." }, 502);
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong — please email or call us instead." }, 500);
  }
}

if ((globalThis as Any).Deno?.serve) (globalThis as Any).Deno.serve(handle);
