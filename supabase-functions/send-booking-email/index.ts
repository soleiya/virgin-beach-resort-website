// Supabase Edge Function: send-booking-email
//
// Triggered by a Database Webhook on INSERT to booking_requests. Sends the
// guest a confirmation email (via Resend) containing their Order ID, which
// they'll need later on pay/index.html to upload a payment screenshot — and
// CCs the shared reservations@virginbeachresort.com inbox on every one, so
// the team sees new requests land in the same place they already check.
//
// Setup (see SETUP-BOOKING.md section 7 for the full walkthrough):
//   1. Create this function in your Supabase project (dashboard Edge
//      Functions editor, or `supabase functions new send-booking-email`
//      then paste this file in).
//   2. Set secrets on the function: RESEND_API_KEY and WEBHOOK_SECRET
//      (any random string you make up — it just has to match what you put
//      in the Database Webhook's custom header in step 4). Optionally also
//      TEST_MODE=true while you're doing test bookings — see below.
//   3. Deploy with JWT verification OFF (dashboard toggle, or
//      `supabase functions deploy send-booking-email --no-verify-jwt`) —
//      this function checks its own shared secret instead.
//   4. Create the Database Webhook (Database → Webhooks) on
//      booking_requests, event: Insert, pointing at this function's URL,
//      with a header  x-webhook-secret: <the same random string>.
//
// Test mode: set the TEST_MODE secret to the exact string "true" and every
// subject line gets a "[TEST] " prefix, so staff can tell real requests
// apart from test bookings at a glance. Remove the secret (or set it to
// anything else) once you're done testing to go back to normal subjects —
// no redeploy needed either way, since it's read fresh on every request.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
const TEST_MODE = Deno.env.get("TEST_MODE") === "true";
const FROM_ADDRESS = "Virgin Beach Resort <reservations@virginbeachresort.com>";
const STAFF_EMAIL = "reservations@virginbeachresort.com";
const SITE_URL = "https://virginbeachresort.com"; // update if you're still on the github.io URL

const TYPE_NAMES: Record<string, string> = {
  day_trip: "Day Trip (Full Day)",
  half_day: "Half-day Tour",
  day_picnic: "Day Picnic",
  corporate: "Corporate Outing",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!RESEND_API_KEY) {
    return new Response("RESEND_API_KEY not configured", { status: 500 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Supabase Database Webhooks send { type, table, record, old_record, schema }
  const record = payload.record;
  if (!record || !record.guest_email) {
    return new Response("No guest_email on record — skipping", { status: 200 });
  }

  const typeLabel = record.stay_type_label || TYPE_NAMES[record.stay_type] || record.stay_type || "your visit";
  const dateStr = record.check_in || "the date you requested";
  const firstName = (record.guest_name || "there").split(" ")[0];

  const testBanner = TEST_MODE
    ? `<p style="background:#fde3d0;color:#8a4a1d;border-radius:8px;padding:10px 16px;font-weight:bold;margin-bottom:16px;">
        TEST EMAIL — this did not come from a real guest booking.
      </p>`
    : "";

  const html = `
    <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#12201d;">
      ${testBanner}
      <h2 style="margin-bottom:4px;">Thank you, ${escapeHtml(firstName)}!</h2>
      <p>We've received your ${escapeHtml(typeLabel)} request for <strong>${escapeHtml(dateStr)}</strong>.</p>
      <p style="background:#e4f1ee;border-radius:8px;padding:16px 20px;font-size:1.05rem;">
        Your Order ID: <strong style="font-size:1.2rem;">${escapeHtml(record.order_code || "—")}</strong>
      </p>
      <p>Our reservations team will follow up within 24 hours to confirm availability and share payment details.</p>
      <p>Already paid? Upload your screenshot any time using your Order ID and this email address:<br>
        <a href="${SITE_URL}/pay/index.html" style="color:#14524c;">${SITE_URL}/pay/index.html</a>
      </p>
      <p style="color:#666;font-size:0.85rem;margin-top:32px;">Virgin Beach Resort &middot; Laiya, San Juan, Batangas</p>
    </div>
  `;

  const subjectPrefix = TEST_MODE ? "[TEST] " : "";
  const subject = `${subjectPrefix}Your booking request — Order ${record.order_code || ""}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [record.guest_email],
      cc: [STAFF_EMAIL],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Resend error:", res.status, text);
    return new Response("Email send failed", { status: 502 });
  }

  return new Response("OK", { status: 200 });
});

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
