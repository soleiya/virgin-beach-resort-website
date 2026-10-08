// Supabase Edge Function: send-booking-email
// ---------------------------------------------------------------------------
// Sends every Day Trip booking email straight from the Google Workspace
// mailbox reservations@virginbeachresort.com (Gmail SMTP), so every message,
// every guest reply and every follow-up lives in that one inbox.
//
// What it sends, and when (fired by the database trigger in
// supabase-functions/booking-email-trigger.sql):
//
//   New website booking (INSERT)
//     → GUEST:  quotation + bank details + next steps, with the
//               Reservations Agreement PDF attached  (kind: guest_quote)
//     → STAFF:  "New web booking" alert with the full transaction, contact
//               links, flags and a follow-up checklist  (kind: staff_new)
//
//   Guest uploads a payment screenshot on /pay (payment_uploaded_at changes)
//     → STAFF:  "Payment proof — please verify", screenshot attached
//     → GUEST:  "We received your proof of payment, verifying now"
//
//   Staff set the booking to Confirmed in the dashboard
//     → GUEST:  "Your Day Trip is confirmed" + arrival guide
//
//   Still unpaid 24 hours after booking (process_booking_deadlines cron job)
//     (no reminder email any more — booking-v7.sql)
//     After 24 hours (or 8:00 AM on the trip date, whichever is first) the
//     booking is set to Expired and its cabanas are released.
//
//   Staff edit a booking in the dashboard (✎) and leave "Email the guest"
//   ticked — sent via notify_booking_change(), see booking-change-email.sql
//     → GUEST:  "Changes to your reservation" — each changed detail shown as
//               before → now, plus the full updated reservation  (kind: guest_changed:<id>)
//     Sent for any source, as long as the booking has a valid guest email.
//
// Guest emails all share one subject line so Gmail keeps them in ONE thread
// (the guest's replies land in that same thread in reservations@). Staff
// alerts likewise share their own internal thread per Order ID.
//
// Every send is recorded in booking_email_log, which also stops the same
// email from ever going out twice.
//
// Secrets to set (Supabase → Edge Functions → Secrets):
//   SMTP_PASSWORD   16-character Google App Password for reservations@
//   WEBHOOK_SECRET  same random string stored in Vault (see the SQL file)
// Optional:
//   TEST_MODE=true          "[TEST]" subjects + orange banner
//   SITE_URL                defaults to the GitHub Pages address
//   STAFF_EMAILS            comma-separated, defaults to reservations@
//   PAYMENT_DEADLINE_HOURS  defaults to 24 (what staff give guests today)
//   PROOF_CC_EMAILS         e.g. accounting.ar@… — copied on payment-proof alerts
//   POOL_NOTICE             auto (Jun–Nov) | on | off — rainy-season pool note
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Deploy with JWT verification OFF — the function checks WEBHOOK_SECRET.
// Full walkthrough: SETUP-BOOKING.md, section 7.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Any = any;

// ---------- configuration ----------------------------------------------------

function env(key: string, fallback = ""): string {
  // deno-lint-ignore no-explicit-any
  const g: Any = globalThis as Any;
  const v = g.Deno ? g.Deno.env.get(key) : g.process?.env?.[key];
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

const MAILBOX = "reservations@virginbeachresort.com";
const FROM = `Virgin Beach Resort Reservations <${MAILBOX}>`;
const EVENTS_EMAIL = "events@virginbeachresort.com";
const MSGID_DOMAIN = "virginbeachresort.com";

function cfg() {
  const site = env("SITE_URL", "https://soleiya.github.io/virgin-beach-resort-website").replace(/\/+$/, "");
  return {
    site,
    testMode: env("TEST_MODE") === "true",
    staffEmails: env("STAFF_EMAILS", MAILBOX).split(",").map((s) => s.trim()).filter(Boolean),
    deadlineHours: Number(env("PAYMENT_DEADLINE_HOURS", "24")) || 24,
    proofCc: env("PROOF_CC_EMAILS").split(",").map((s) => s.trim()).filter(Boolean),
    // "auto" = show the seawater-pool notice June–November (rainy season).
    poolNotice: env("POOL_NOTICE", "auto"),
    autoSources: env("AUTO_EMAIL_SOURCES", "website").split(",").map((s) => s.trim()),
    supabaseUrl: env("SUPABASE_URL"),
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    smtpPassword: env("SMTP_PASSWORD"),
    webhookSecret: env("WEBHOOK_SECRET"),
    agreementUrl: `${site}/assets/docs/VBR-Reservations-Agreement.pdf`,
    logoUrl: `${site}/assets/brand/logo-full.png`,
  };
}

// Bank accounts — exactly as printed on the Reservations Agreement.
export const BANKS = [
  { bank: "UnionBank", number: "002170016412", branch: "Makati Ave." },
  { bank: "BDO (Banco de Oro)", number: "005388015894", branch: "Neptune – Makati Ave." },
  { bank: "Metrobank", number: "3097309004473", branch: "Kalayaan Bel-Air" },
];
export const ACCOUNT_NAME = "NTQ Hospitality and Resort Management Inc.";

// Rates — keep in sync with PRICING / PACKAGE_PRICING in assets/js/booking.js
// (2026 Rate Sheet). Cabana prices for full-day come from the cabanas table.
const SENIOR_DISCOUNT_RATE = 0.2;
const PRICING: Record<string, Any> = {
  day_trip: { adult: 1250, child612: 825, child05: 0, pet: 750, dining: 1500, lounge: 2000 },
  half_day: { adult: 800, child612: 550, child05: 0, pet: 375, dining: 750, lounge: 1000 },
};
const PACKAGE_PRICING: Record<string, Any> = {
  all_inclusive_family: { base: 5000, includedPax: 4, includedCabanas: 1, addlAdult: 1250, addlPet: 750, addlCabana: 1000 },
  all_inclusive_barkada: { base: 10000, includedPax: 10, includedCabanas: 1, addlAdult: 1250, addlPet: 750, addlCabana: 1000 },
};

const TYPE_NAMES: Record<string, string> = {
  day_trip: "Day Trip (Full Day)",
  half_day: "Half-Day Trip",
  all_inclusive_family: "All Inclusive — Family Package",
  all_inclusive_barkada: "All Inclusive — Barkada Package",
  corporate: "Corporate Outing",
  overnight: "Overnight Stay",
};

const LABELS: Record<string, string> = {
  facebook: "Facebook / Instagram", google: "Google Search", referral: "Friend / Family Referral",
  repeat_guest: "Stayed before", travel_agent: "Travel Agent", other: "Other",
  birthday: "Birthday", anniversary: "Anniversary", team_building: "Team Building / Company Outing", reunion: "Reunion",
  honeymoon: "Honeymoon",
};
const label = (v: unknown) => (v ? LABELS[String(v)] || String(v) : "—");

// Check-in / check-out per the Reservations Agreement.
const TIMES: Record<string, { in: string; out: string }> = {
  day_trip: { in: "8:00 AM", out: "5:00 PM" },
  all_inclusive_family: { in: "8:00 AM", out: "5:00 PM" },
  all_inclusive_barkada: { in: "8:00 AM", out: "5:00 PM" },
  half_day: { in: "1:00 PM", out: "5:00 PM" },
  corporate: { in: "8:00 AM", out: "5:00 PM" },
  overnight: { in: "2:00 PM", out: "11:30 AM" },
};

export const isOvernight = (r: Any) => r?.stay_type === "overnight";

// ---------- helpers ----------------------------------------------------------

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function peso(n: number | null | undefined): string {
  const v = Number(n || 0);
  return (v < 0 ? "−₱" : "₱") + Math.abs(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(n: unknown): string {
  return Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function int(v: unknown): number {
  const n = parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function plural(n: number, one: string, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

// Dates: check_in is a plain YYYY-MM-DD; everything is shown in Manila time.
export function fmtDate(d: string | null | undefined, style: "long" | "short" = "long"): string {
  if (!d) return "Date to be confirmed";
  const dt = new Date(d.length <= 10 ? d + "T00:00:00+08:00" : d);
  return dt.toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function daysUntil(checkIn: string | null, now: Date): number | null {
  if (!checkIn) return null;
  const trip = new Date(checkIn + "T00:00:00+08:00").getTime();
  const today = new Date(now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) + "T00:00:00+08:00").getTime();
  return Math.round((trip - today) / 86400000);
}

// Payment deadline — must match booking_deadlines() in booking-v7.sql:
//   booked + 24h — the booking expires then if still unpaid — but never
//   later than 8:00 AM on the trip date. Bookings made on/after 8:00 AM of the trip date
//   (same-day walk-ins) are paid on arrival.
function trip8(checkIn: string | null): Date | null {
  return checkIn ? new Date(checkIn + "T08:00:00+08:00") : null;
}
export function paymentDeadline(record: Any, hours = 24): { date: Date | null; label: string } {
  const created = new Date(record.created_at || Date.now());
  const t8 = trip8(record.check_in);
  if (t8 && t8.getTime() <= created.getTime()) return { date: null, label: "upon arrival at the resort" };
  let deadline = new Date(created.getTime() + hours * 3600_000);
  if (t8 && t8 < deadline) deadline = t8;
  return { date: deadline, label: fmtDateTime(deadline) };
}
export function finalDeadline(record: Any): { date: Date | null; label: string; isTripMorning: boolean } {
  const created = new Date(record.created_at || Date.now());
  const t8 = trip8(record.check_in);
  if (t8 && t8.getTime() <= created.getTime()) return { date: null, label: "upon arrival at the resort", isTripMorning: false };
  let d = new Date(created.getTime() + 24 * 3600_000);
  let isTripMorning = false;
  if (t8 && t8 < d) { d = t8; isTripMorning = true; }
  return { date: d, label: fmtDateTime(d), isTripMorning };
}

// ---------- quotation --------------------------------------------------------

export type QuoteLine = { desc: string; rate: number; qty: number; amount: number; vatExempt?: boolean };
export type Quote = {
  heading: string;
  lines: QuoteLine[];
  subtotal: number;
  total: number;
  vatExemptSales: number;
  vatableSales: number;
  vat: number;
  serviceCharge: number;
  websiteTotal: number | null;
  mismatch: boolean;
  // Overnight website bookings: price when paying by card / e-wallet instead
  // of bank transfer (i.e. without the 3% book-direct discount).
  cardTotal?: number;
  onlineDiscount?: number;
};

function cabanaKind(c: Any): "lounge" | "dining" {
  return String(c.cabana_type || "").startsWith("lounge") ? "lounge" : "dining";
}
function shortLabel(c: Any) {
  return c.section && c.number ? `Sec. ${c.section} #${c.number}` : String(c.label || "Cabana");
}
function cabanaName(kind: "lounge" | "dining", capacity?: number) {
  return kind === "lounge"
    ? `Lounge Cabana (capacity of ${capacity || 4})`
    : `Dining Cabana (capacity of ${capacity || 10})`;
}

export const isStaffMade = (r: Any) => String(r.source || "website") !== "website";

// What the guest still has to upload on /pay (Senior/PWD IDs, pet cards).
export function docsNeeded(r: Any) {
  const seniors = int(r.senior_count) > 0 && !(Array.isArray(r.senior_id_paths) && r.senior_id_paths.length);
  const pets = int(r.pet_count) > 0 && !(Array.isArray(r.pet_vaccination_paths) && r.pet_vaccination_paths.length);
  return { seniors, pets, any: seniors || pets };
}
const uploadUrl = (r: Any, c: ReturnType<typeof cfg>) =>
  `${c.site}/pay/index.html?order=${encodeURIComponent(r.order_code || "")}&email=${encodeURIComponent(r.guest_email || "")}`;

// Rebuilds the bill server-side from the booking row, so what the guest is
// asked to pay never depends on numbers the browser sent.
export function buildQuote(record: Any, cabanas: Any[]): Quote | null {
  const type = record.stay_type;
  if (type === "corporate") return null;

  const adults = int(record.adults);
  const kids612 = int(record.children_6_12);
  const kids05 = int(record.children_0_5);
  const seniors = Math.min(int(record.senior_count), adults);
  const pets = int(record.pet_count);
  const regular = adults - seniors;
  const lines: QuoteLine[] = [];
  const add = (desc: string, rate: number, qty: number, vatExempt = false) => {
    if (qty > 0) lines.push({ desc, rate, qty, amount: r2(rate * qty), vatExempt });
  };
  let heading = TYPE_NAMES[type] || record.stay_type_label || "Day Trip";

  const pkg = PACKAGE_PRICING[type];
  if (pkg) {
    const guests = adults + kids612 + kids05;
    const extraPax = Math.max(0, guests - pkg.includedPax);
    const extraCab = Math.max(0, cabanas.length - pkg.includedCabanas);
    const incl = cabanas.slice(0, pkg.includedCabanas).map(shortLabel).join(", ");
    add(`${heading} — up to ${pkg.includedPax} guests & ${pkg.includedCabanas} cabana${incl ? " (" + incl + ")" : ""}`, pkg.base, 1);
    add("Additional guest", pkg.addlAdult, extraPax);
    add("Pet fee", pkg.addlPet, pets);
    add(`Additional cabana (${cabanas.slice(pkg.includedCabanas).map(shortLabel).join(", ")})`, pkg.addlCabana, extraCab);
    heading = heading + " — Inclusive of entrance fee and lunch";
  } else {
    const rate = PRICING[type] || PRICING.day_trip;
    add("Adult (13 y.o. +)", rate.adult, regular);
    add("Senior Citizen / PWD (20% discount)", r2(rate.adult * (1 - SENIOR_DISCOUNT_RATE)), seniors, true);
    add("Child (6–12 y.o.)", rate.child612, kids612);
    add("Child (0–5 y.o.)", 0, kids05);
    add("Pet fee", rate.pet, pets);
    for (const kind of ["dining", "lounge"] as const) {
      const group = cabanas.filter((c) => cabanaKind(c) === kind);
      if (!group.length) continue;
      // Half-day has its own cabana rates; full day uses the cabanas table.
      const price = type === "half_day" ? rate[kind] : Number(group[0].price) || rate[kind];
      add(`${cabanaName(kind, group[0].capacity)} — ${group.map(shortLabel).join(", ")}`, price, group.length);
    }
    heading = type === "half_day"
      ? "HALF-DAY TRIP AREA"
      : "DAY TRIP AREA — Inclusive of entrance fee and lunch";
  }

  let total = r2(lines.reduce((s, l) => s + l.amount, 0));
  const websiteTotal = record.total_amount === null || record.total_amount === undefined ? null : Number(record.total_amount);
  // Staff discount (percent or amount, set in the dashboard) — same rule as
  // assets/js/pricing.js: taken off the rate-sheet total, never below zero.
  const rated = !!PRICING[type] || !!PACKAGE_PRICING[type];
  const disc = Number(record.discount_amount) || 0;
  if (rated && disc > 0) {
    const d = r2(Math.min(disc, total));
    const pct = record.discount_type === "percent" && record.discount_value ? ` (${Number(record.discount_value)}%)` : "";
    const why = record.discount_reason ? ` — ${String(record.discount_reason).slice(0, 80)}` : "";
    lines.push({ desc: `Discount${pct}${why}`, rate: -d, qty: 1, amount: -d, vatExempt: false });
    total = r2(total - d);
  }
  // Staff-made bookings of a type with no rate sheet (Flash Sale, Other): the
  // Total typed in by the team is the agreed price — show the difference.
  if (!rated && isStaffMade(record) && websiteTotal !== null && Math.abs(websiteTotal - total) > 0.5) {
    const diff = r2(websiteTotal - total);
    lines.push({
      desc: diff < 0 ? "Special rate (as agreed with our reservations team)" : "Adjustment (as agreed with our reservations team)",
      rate: diff, qty: 1, amount: diff, vatExempt: false,
    });
    total = r2(websiteTotal);
  }
  const vatExemptSales = r2(lines.filter((l) => l.vatExempt).reduce((s, l) => s + l.amount, 0));
  // Same presentation as the printed quotation: prices are inclusive of 12%
  // VAT and a 5% (zero-rated) service charge, both computed on the net amount.
  const gross = Math.max(0, r2(total - vatExemptSales));
  const vatableSales = r2(gross / 1.17);
  const vat = r2(vatableSales * 0.12);
  const serviceCharge = r2(gross - vatableSales - vat);
  return {
    heading, lines, subtotal: total, total, vatExemptSales, vatableSales, vat, serviceCharge,
    websiteTotal, mismatch: websiteTotal !== null && Math.abs(websiteTotal - total) > 0.5,
  };
}

// ---------- shared HTML pieces ----------------------------------------------

const C = {
  ink: "#23241f", soft: "#6b6559", line: "#ddd2ba", sand: "#f6f1e6", surface: "#fffdf8",
  lagoon: "#1f7a72", deep: "#14524c", tint: "#e4f1ee", warn: "#8a4a1d", warnBg: "#fde3d0",
  red: "#9b2c2c", redBg: "#fbe4e4",
};
const FONT = "font-family:Helvetica,Arial,sans-serif;";

function shell(opts: { preheader: string; body: string; c: ReturnType<typeof cfg>; internal?: boolean }) {
  const { c } = opts;
  const test = c.testMode
    ? `<tr><td style="padding:12px 28px 0;"><div style="background:${C.warnBg};color:${C.warn};border-radius:8px;padding:10px 14px;font-weight:bold;${FONT}font-size:13px;">TEST EMAIL — not a real guest booking.</div></td></tr>`
    : "";
  const header = opts.internal
    ? `<tr><td style="background:${C.deep};padding:14px 28px;color:#fff;${FONT}font-size:13px;letter-spacing:.08em;text-transform:uppercase;">VBR Reservations · Internal</td></tr>`
    : `<tr><td style="padding:24px 28px 8px;text-align:center;"><img src="${esc(c.logoUrl)}" alt="Virgin Beach Resort" width="180" style="max-width:180px;height:auto;border:0;"></td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${C.sand};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sand};"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:${C.surface};border:1px solid ${C.line};border-radius:12px;overflow:hidden;">
${header}${test}
<tr><td style="padding:12px 28px 28px;color:${C.ink};${FONT}font-size:15px;line-height:1.55;">${opts.body}</td></tr>
</table></td></tr></table></body></html>`;
}

const h2 = (t: string) =>
  `<h2 style="margin:28px 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:normal;color:${C.deep};">${t}</h2>`;
const p = (t: string, style = "") => `<p style="margin:0 0 12px;${style}">${t}</p>`;

function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${C.lagoon};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px;${FONT}font-size:14px;margin:4px 6px 4px 0;">${esc(label)}</a>`;
}

function kv(rows: [string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${rows
    .map(([k, v]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:${C.soft};vertical-align:top;width:38%;border-bottom:1px solid ${C.line};">${k}</td><td style="padding:6px 0;vertical-align:top;border-bottom:1px solid ${C.line};">${v}</td></tr>`
    ).join("")}</table>`;
}

function quoteTable(q: Quote) {
  const td = "padding:7px 6px;border-bottom:1px solid " + C.line + ";";
  const rows = q.lines.map((l) =>
    `<tr><td style="${td}">${esc(l.desc)}</td><td style="${td}text-align:right;white-space:nowrap;">${l.rate ? num(l.rate) : "Free"}</td><td style="${td}text-align:center;">${l.qty}</td><td style="${td}text-align:right;white-space:nowrap;">${num(l.amount)}</td></tr>`
  ).join("");
  const sum = (label: string, val: string, bold = false) =>
    `<tr><td colspan="3" style="padding:4px 6px;text-align:right;color:${bold ? C.ink : C.soft};${bold ? "font-weight:bold;" : ""}">${label}</td><td style="padding:4px 6px;text-align:right;white-space:nowrap;${bold ? "font-weight:bold;" : ""}">${val}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13.5px;">
<tr><td colspan="4" style="padding:8px 6px;background:${C.tint};color:${C.deep};font-weight:bold;font-size:12.5px;letter-spacing:.03em;">${esc(q.heading)}</td></tr>
<tr style="color:${C.soft};font-size:12px;"><td style="padding:6px;">Description</td><td style="padding:6px;text-align:right;">Rate (₱)</td><td style="padding:6px;text-align:center;">Qty</td><td style="padding:6px;text-align:right;">Amount (₱)</td></tr>
${rows}
${sum("Sub Total", num(q.subtotal))}
${sum("VAT-Exempt Sales", num(q.vatExemptSales))}
${sum("Vatable Sales", num(q.vatableSales))}
${sum("VAT (12%)", num(q.vat))}
${sum("5% Service Charge (Zero-Rated)", num(q.serviceCharge))}
<tr><td colspan="3" style="padding:10px 6px;text-align:right;font-weight:bold;border-top:2px solid ${C.deep};font-size:15px;">TOTAL AMOUNT DUE</td><td style="padding:10px 6px;text-align:right;font-weight:bold;border-top:2px solid ${C.deep};font-size:15px;white-space:nowrap;">${peso(q.total)}</td></tr>
</table>
<p style="margin:6px 0 0;color:${C.soft};font-size:12px;">All prices are inclusive of 12% VAT and 5% service charge.</p>`;
}

function bankTable() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;border:1px solid ${C.line};border-radius:8px;">
<tr><td colspan="3" style="padding:10px 12px;background:${C.tint};"><span style="color:${C.soft};font-size:12px;">Account Name</span><br><strong>${esc(ACCOUNT_NAME)}</strong></td></tr>
${BANKS.map((b) =>
    `<tr><td style="padding:9px 12px;border-top:1px solid ${C.line};font-weight:bold;">${esc(b.bank)}</td><td style="padding:9px 12px;border-top:1px solid ${C.line};font-family:'Courier New',monospace;font-size:15px;letter-spacing:.04em;white-space:nowrap;">${esc(b.number)}</td><td style="padding:9px 12px;border-top:1px solid ${C.line};color:${C.soft};font-size:12.5px;">${esc(b.branch)}</td></tr>`
  ).join("")}
</table>`;
}

function partyText(r: Any) {
  const bits = [plural(int(r.adults), "adult")];
  if (int(r.senior_count)) bits.push(`incl. ${plural(int(r.senior_count), "senior citizen/PWD", "senior citizens/PWDs")}`);
  if (int(r.children_6_12)) bits.push(plural(int(r.children_6_12), "child", "children") + " (6–12)");
  if (int(r.children_0_5)) bits.push(plural(int(r.children_0_5), "child", "children") + " (0–5)");
  if (int(r.pet_count)) bits.push(plural(int(r.pet_count), "pet"));
  return bits.join(", ");
}

function reservationRows(r: Any, cabanas: Any[]): [string, string][] {
  if (isOvernight(r)) return overnightRows(r, cabanas);
  const t = TIMES[r.stay_type] || TIMES.day_trip;
  const rows: [string, string][] = [
    ["Order ID", `<strong>${esc(r.order_code || "—")}</strong>`],
    ["Booking", esc(r.stay_type_label || TYPE_NAMES[r.stay_type] || r.stay_type)],
    ["Date", `<strong>${esc(fmtDate(r.check_in))}</strong>`],
    ["Check-in / out", `${t.in} – ${t.out}`],
    ["Guests", esc(partyText(r))],
  ];
  if (cabanas.length) rows.push(["Cabana(s)", esc(cabanas.map((c) => c.label).join(", "))]);
  if (r.guest_names) rows.push(["Names in your party", esc(r.guest_names)]);
  if (r.notes) rows.push(["Your notes", esc(r.notes)]);
  return rows;
}

export const PREFERRED_CABANA_NOTE =
  "Cabana numbers are preferred cabanas. To make sure every group has its own space, the resort may move your party to a comparable cabana if a large group books in — we'll always let you know.";
function cabanaNote(cabanas: Any[]) {
  if (cabanas.length && cabanas[0].unit_label) return p(esc(PREFERRED_VILLA_NOTE), `font-size:12.5px;color:${C.soft};margin-top:8px;`);
  return cabanas.length ? p(esc(PREFERRED_CABANA_NOTE), `font-size:12.5px;color:${C.soft};margin-top:8px;`) : "";
}

// Rebooking: unpaid bookings simply expire after 24 hours; paid guests reply
// to change their date. (The cancellation & postponement table applies to
// overnight casitas, not Day Trips, so it's no longer in these emails.)
function rebookNote(paid = false) {
  return p("<strong>Need to change your date?</strong> Just reply to this email and we'll help you rebook." +
    (paid ? "" : " Haven't paid yet? You can simply ignore this booking — unpaid bookings expire automatically after 24 hours — and make a new one."),
    `font-size:13.5px;color:${C.soft};margin-top:14px;`);
}

function goodToKnow() {
  const li = (t: string) => `<li style="margin:0 0 6px;">${t}</li>`;
  return `${h2("Good to know before your visit")}
<ul style="margin:0;padding-left:20px;font-size:14px;">
${li("<strong>Tourism Ecological Fee:</strong> ₱50.00 per visitor, collected by the Municipality of San Juan at its ticketing booth at Km 3, Buhay na Sapa, San Juan. Missed the booth? Settle it at our Front Office and we'll issue the ticket.")}
${li("<strong>Lunch</strong> is served from 12:00 NN to 2:00 PM only.")}
${li("<strong>Valid government ID</strong> for the primary guest and every companion at check-in.")}
${li("<strong>Resort attire:</strong> no swimming in jersey shirts/shorts, denim or similar clothing.")}
${li("<strong>Outside food &amp; drinks</strong> are not allowed, except chips, biscuits and bottled water. Corkage applies to specific beverages.")}
${li("<strong>Arrivals from 1:00 PM onward</strong> are charged half-day rates.")}
</ul>`;
}

function poolNotice(c: ReturnType<typeof cfg>, checkIn: string | null) {
  const month = checkIn ? Number(checkIn.slice(5, 7)) : new Date().getMonth() + 1;
  const show = c.poolNotice === "on" || (c.poolNotice === "auto" && month >= 6 && month <= 11);
  return show
    ? p("As we are currently in the rainy season, please be advised that our Intex in-ground pool is subject to availability and weather conditions on your date of visit, as the pool uses seawater.", `font-size:13.5px;color:${C.soft};`)
    : "";
}

function signature(c: ReturnType<typeof cfg>) {
  return `<div style="margin-top:28px;padding-top:16px;border-top:1px solid ${C.line};font-size:13px;color:${C.soft};">
<p style="margin:0 0 10px;color:${C.ink};"><strong>Reservations Team</strong><br>Virgin Beach Resort</p>
<p style="margin:0 0 10px;font-style:italic;">Since we are experiencing a large volume of inquiries, we kindly request that you reply to this same email thread, so we can easily monitor your responses.</p>
<p style="margin:0 0 4px;"><strong>Office Hours:</strong> Monday–Friday | 9:00 AM–4:00 PM</p>
<p style="margin:0 0 4px;"><strong>Booking &amp; Inquiries:</strong> <a href="mailto:${MAILBOX}" style="color:${C.deep};">${MAILBOX}</a></p>
<p style="margin:0 0 4px;"><strong>Corporate &amp; Events:</strong> <a href="mailto:${EVENTS_EMAIL}" style="color:${C.deep};">${EVENTS_EMAIL}</a></p>
<p style="margin:0 0 4px;"><strong>Reservations:</strong> +63 917 792 0712 (Globe) · +63 929 430 9109 (Smart)</p>
<p style="margin:0 0 4px;"><strong>Corporate:</strong> +63 929 270 9724</p>
<p style="margin:0 0 4px;"><strong>Front Office (walk-ins):</strong> +63 969 623 4728 · Km 23 Laiya, San Juan, Batangas</p>
<p style="margin:0;"><strong>Website:</strong> <a href="${esc(c.site)}" style="color:${C.deep};">${esc(c.site.replace(/^https?:\/\//, ""))}</a></p>
</div>`;
}

function statusBox(rows: [string, string][], tone: "info" | "ok" = "info") {
  const bg = tone === "ok" ? "#dff3e4" : C.tint;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:10px;margin:16px 0;"><tr>${rows
    .map(([k, v]) => `<td style="padding:14px 14px;vertical-align:top;"><div style="color:${C.soft};font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;">${k}</div><div style="font-size:16px;font-weight:bold;color:${C.deep};margin-top:2px;">${v}</div></td>`)
    .join("")}</tr></table>`;
}

// ---------- subjects (shared so Gmail threads each booking) ------------------

export function guestSubject(r: Any, c: ReturnType<typeof cfg>) {
  // Overnight: arrival date only, so a date change email (built from the
  // original arrival) still lands in the same Gmail thread.
  if (isOvernight(r)) return `${c.testMode ? "[TEST] " : ""}Virgin Beach Resort Overnight Stay — ${r.order_code || "Booking"} (Arrival ${fmtDate(r.check_in, "short").replace(/^\w+, /, "")})`;
  const type = r.stay_type === "corporate" ? "Corporate Outing" : r.stay_type === "half_day" ? "Half-Day Trip" : "Day Trip";
  return `${c.testMode ? "[TEST] " : ""}Virgin Beach Resort ${type} — ${r.order_code || "Booking"} (${fmtDate(r.check_in, "short").replace(/^\w+, /, "")})`;
}
export function staffSubject(r: Any, c: ReturnType<typeof cfg>) {
  const kind = r.stay_type === "corporate" ? "Corporate Inquiry" : isOvernight(r) ? "Overnight Booking" : "Day Trip Booking";
  return `${c.testMode ? "[TEST] " : ""}New ${kind} from ${r.guest_name || "Guest"} — ${r.order_code || ""} (${fmtDate(r.check_in, "short").replace(/^\w+, /, "")})`;
}
const msgId = (r: Any, who: "guest" | "staff") =>
  `<${String(r.order_code || r.id).toLowerCase()}.${who}@${MSGID_DOMAIN}>`;

// ---------- templates --------------------------------------------------------

export function guestQuoteEmail(r: Any, cabanas: Any[], q: Quote | null, c: ReturnType<typeof cfg>) {
  if (isOvernight(r)) return guestQuoteEmailOvernight(r, cabanas, q, c);
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const dl = paymentDeadline(r, c.deadlineHours);
  const payUrl = uploadUrl(r, c);
  const need = docsNeeded(r);
  const staffMade = isStaffMade(r);

  if (!q) {
    // Corporate: tailored quote comes from the team, no bank details yet.
    const body = `${p(`Hi ${first},`)}
${p(`Thank you for considering Virgin Beach Resort for your company outing. We've received your request for <strong>${esc(fmtDate(r.check_in))}</strong> — your reference number is <strong>${esc(r.order_code)}</strong>.`)}
${p("Our events team will prepare a tailored quotation for your group and send it to you in this same email thread, usually within one business day.")}
${h2("Your request")}${kv(reservationRows(r, cabanas))}
${signature(c)}`;
    return {
      subject: guestSubject(r, c),
      html: shell({ preheader: `Request ${r.order_code} received — quotation to follow.`, body, c }),
    };
  }

  const body = `${p(`Hi ${first},`)}
${p(staffMade
    ? `Thank you for choosing Virgin Beach Resort! As discussed with our reservations team, here is the quotation for your <strong>${esc(r.stay_type_label || TYPE_NAMES[r.stay_type])}</strong> on <strong>${esc(fmtDate(r.check_in))}</strong>${cabanas.length ? ` — we're holding ${cabanas.length === 1 ? "your cabana" : "your cabanas"} for you` : ""}.`
    : `Thank you for choosing Virgin Beach Resort! We've received your <strong>${esc(r.stay_type_label || TYPE_NAMES[r.stay_type])}</strong> request for <strong>${esc(fmtDate(r.check_in))}</strong>${cabanas.length ? ` and are holding ${cabanas.length === 1 ? "your cabana" : "your cabanas"} for you` : ""}.`)}
${p(dl.date
    ? `<strong>Full payment is required by ${esc(dl.label)}</strong> to secure the reservation. Unpaid bookings are automatically canceled and the cabana(s) released.`
    : `<strong>Payment is settled upon arrival at the resort.</strong>`)}
${poolNotice(c, r.check_in)}
${statusBox([
    ["Order ID", esc(r.order_code || "—")],
    ["Amount due", esc(peso(q.total))],
    ["Please pay by", esc(dl.label)],
  ])}
${h2("Your reservation")}${kv(reservationRows(r, cabanas))}${cabanaNote(cabanas)}
${h2("Quotation")}${quoteTable(q)}
${h2("How to pay")}
${p(`<strong>Option 1 — Bank deposit or online transfer</strong> (InstaPay / PESONet) to any of these accounts. Please put <strong>${esc(r.order_code)}</strong> and your name in the reference / remarks.`)}
${bankTable()}
${p(`<strong>Option 2 — Credit/debit card or e-wallet.</strong> Reply to this email and we'll send you a secure Xendit payment link for ${esc(peso(q.total))}.`, "margin-top:14px;")}
${h2("After you pay")}
<ol style="margin:0 0 12px;padding-left:20px;font-size:14px;">
<li style="margin:0 0 8px;"><strong>Send us your proof of payment</strong> — upload the screenshot or transaction slip using the button below, or simply reply to this email with it attached.</li>
${need.seniors ? `<li style="margin:0 0 8px;"><strong>Upload the Senior Citizen / PWD ID${int(r.senior_count) > 1 ? "s" : ""}</strong> on the same page — the 20% discount applies only with a valid ID. Please bring ${int(r.senior_count) > 1 ? "them" : "it"} on the day too.</li>` : ""}
${need.pets ? `<li style="margin:0 0 8px;"><strong>Upload your pet${int(r.pet_count) > 1 ? "s'" : "'s"} vaccination card${int(r.pet_count) > 1 ? "s" : ""}</strong> and agree to the Pet Policy on the same page. The card should show the pet's details and a current anti-rabies vaccination. Please bring it on the day too, with a leash and food and water bowls.</li>` : ""}
${int(r.pet_count) && !need.pets ? `<li style="margin:0 0 8px;"><strong>Bringing your pet${int(r.pet_count) > 1 ? "s" : ""}:</strong> please bring the vaccination card${int(r.pet_count) > 1 ? "s" : ""} you uploaded (we'll check ${int(r.pet_count) > 1 ? "them" : "it"} at check-in), a leash, food and water bowls. The Pet Policy you agreed to applies during your visit.</li>` : ""}
<li style="margin:0 0 8px;"><strong>Reply with the signed Reservations Agreement</strong> (attached as a PDF — a photo of the signed last page is fine) and a photo of <strong>one (1) valid ID</strong>${int(r.senior_count) && !need.seniors ? " (we already have the Senior Citizen/PWD ID you uploaded)" : ""}.</li>
<li style="margin:0 0 8px;"><strong>We'll email your confirmation</strong> as soon as the payment is verified (during office hours, 9:00 AM–4:00 PM, Monday–Friday).</li>
</ol>
${button(payUrl, need.any ? "Upload payment & documents" : "Upload proof of payment")}
<p style="margin:14px 0 0;padding:12px 14px;background:${C.sand};border-radius:8px;font-size:13px;color:${C.soft};">This is a quotation, not yet a confirmed booking. Reservations are on a first-come, first-served basis and are confirmed only once payment is received. In the absence of a signed agreement, guests are not relieved of the resort rules, regulations and conditions.</p>
${goodToKnow()}
${rebookNote()}
${signature(c)}`;

  return {
    subject: guestSubject(r, c),
    html: shell({ preheader: `${r.order_code} · ${peso(q.total)} due · Bank details inside`, body, c }),
  };
}

export function staffNewEmail(r: Any, cabanas: Any[], q: Quote | null, c: ReturnType<typeof cfg>, guestSent: { ok: boolean; error?: string }, now = new Date()) {
  if (isOvernight(r)) return staffNewEmailOvernight(r, cabanas, q, c, guestSent, now);
  const d = daysUntil(r.check_in, now);
  const dl = paymentDeadline(r, c.deadlineHours);
  const flags: string[] = [];
  const flag = (t: string, tone: "warn" | "red" = "warn") =>
    flags.push(`<li style="margin:0 0 6px;color:${tone === "red" ? C.red : C.warn};">${t}</li>`);

  if (!guestSent.ok) flag(`<strong>Guest email FAILED to send</strong> (${esc(guestSent.error || "unknown error")}). Send the quotation manually.`, "red");
  const needDocs = docsNeeded(r);
  if (needDocs.any) flag(`Guest still has to upload ${[needDocs.seniors ? "Senior/PWD ID(s)" : "", needDocs.pets ? "pet vaccination card(s)" : ""].filter(Boolean).join(" and ")} — the quotation email links to the upload page.`);
  if (q?.mismatch) flag(`${isStaffMade(r) ? "The dashboard saved" : "Website showed the guest"} <strong>${peso(q.websiteTotal)}</strong>, but the rate sheet${Number(r.discount_amount) > 0 ? " (less the discount)" : ""} gives <strong>${peso(q.total)}</strong> (the amount emailed). Double-check before accepting payment.`, "red");
  if (d !== null && d <= 1) flag(`Trip is <strong>${d <= 0 ? "today" : "tomorrow"}</strong> — past the usual payment cut-off. Call the guest now: either accept with a same-day payment deadline, or send the walk-in reply.`, "red");
  else if (d !== null && d <= 7) flag(`Trip is <strong>${d <= 0 ? "today or past" : `in ${plural(d, "day")}`}</strong> — inside the 7-day non-refundable window. Follow up by phone.`, "red");
  else if (d !== null && d <= 14) flag(`Trip is in ${plural(d, "day")} — inside the 14-day (50% forfeit) window.`);
  if (int(r.senior_count)) flag(`${plural(int(r.senior_count), "senior citizen/PWD", "senior citizens/PWDs")} — ${Array.isArray(r.senior_id_paths) ? plural(r.senior_id_paths.length, "ID photo") : "no ID photo"} uploaded. Verify in the dashboard and at check-in.`);
  if (int(r.pet_count)) {
    const cards = Array.isArray(r.pet_vaccination_paths) ? r.pet_vaccination_paths.length : 0;
    flag(`${plural(int(r.pet_count), "pet")} — ${cards ? plural(cards, "vaccination card") + " uploaded" : "NO vaccination card uploaded"}${r.pet_policy_agreed_at ? ", Pet Policy agreed online" : ""}. Check the card(s) in the dashboard and at check-in.`);
  }
  const cap = cabanas.reduce((s, x) => s + (Number(x.capacity) || 0), 0);
  const party = int(r.adults) + int(r.children_6_12) + int(r.children_0_5);
  if (cabanas.length && cap < party) flag(`Party of ${party} but cabana capacity is ${cap}.`);
  if (!cabanas.length && r.stay_type !== "corporate") flag("No cabana selected — assign one in the dashboard.");
  if (r.stay_type === "corporate") flag("Corporate request — no automatic quote was sent. Prepare a tailored quotation.");

  const tel = String(r.guest_phone || "").replace(/[^\d+]/g, "");
  const dash = `${c.site}/staff/index.html?q=${encodeURIComponent(r.order_code || "")}`;
  const gmail = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(MAILBOX)}#search/${encodeURIComponent('"' + (r.order_code || "") + '"')}`;

  const body = `${statusBox([
    ["Order", esc(r.order_code || "—")],
    ["Amount due", q ? esc(peso(q.total)) : "Quote needed"],
    ["Status", "Unpaid"],
  ])}
${isStaffMade(r) ? p(`Added in the staff dashboard${r.booked_by ? ` by <strong>${esc(r.booked_by)}</strong>` : ""} (${esc(label(r.source))}) and sent to the guest as a quotation.`) : ""}
${p(guestSent.ok
    ? `Quotation${q ? " + bank details" : ""} sent to <strong>${esc(r.guest_email)}</strong> at ${esc(fmtDateTime(now))}. It's in the <strong>Sent</strong> folder — the guest's replies will land in that same thread.${q ? ` Pay-by date given: <strong>${esc(dl.label)}</strong>.` : ""}`
    : `<strong style="color:${C.red};">The guest has NOT received an email.</strong>`)}
${flags.length ? `${h2("Needs attention")}<ul style="margin:0;padding-left:20px;font-size:14px;">${flags.join("")}</ul>` : ""}
${h2("Guest")}
${kv([
    ["Name", `<strong>${esc(r.guest_name)}</strong>`],
    ["Mobile", `<a href="tel:${esc(tel)}" style="color:${C.deep};">${esc(r.guest_phone)}</a>`],
    ["Email", `<a href="mailto:${esc(r.guest_email)}" style="color:${C.deep};">${esc(r.guest_email)}</a>`],
    ["Country", esc(r.country || "—")],
    ["Heard about us", esc(label(r.how_heard))],
    ["Occasion", esc(label(r.occasion))],
    ["Promos opt-in", r.marketing_opt_in ? "Yes" : "No"],
    ["Submitted", esc(fmtDateTime(new Date(r.created_at || now)))],
  ])}
${h2("Booking")}${kv(reservationRows(r, cabanas).slice(1))}
${q ? h2("Quotation sent") + quoteTable(q) : ""}
${h2("Follow-up checklist")}
<ol style="margin:0 0 14px;padding-left:20px;font-size:14px;">
<li>Watch the guest thread (search the Order ID) for proof of payment, the signed agreement and one valid ID. Website uploads also alert this inbox.</li>
<li>Guest asks for card / e-wallet? Create a Xendit invoice for <strong>${q ? esc(peso(q.total)) : "the quoted amount"}</strong> with description <strong>Booking# ${esc(r.order_code)}</strong>, and reply in the guest's thread with the link and the same pay-by time.</li>
<li>Verify the deposit against the bank statement, then set the booking to <strong>Confirmed</strong> in the dashboard — the guest gets the confirmation email automatically.</li>
<li>No payment by ${esc(dl.label)}? The booking automatically turns <strong>Expired</strong> and the cabana(s) are released. Nothing to do unless the guest calls.</li>
</ol>
${button(dash, "Open in staff dashboard")}${button(gmail, "Find guest thread in Gmail")}`;

  return {
    subject: staffSubject(r, c),
    html: shell({ preheader: `${r.guest_name} · ${fmtDate(r.check_in, "short")} · ${q ? peso(q.total) : "quote needed"}`, body, c, internal: true }),
  };
}

export function staffProofEmail(r: Any, q: Quote | null, c: ReturnType<typeof cfg>, hasAttachment: boolean, now = new Date()) {
  const d = daysUntil(r.check_in, now);
  const urgent = d !== null && d <= 2
    ? `<p style="margin:0 0 12px;padding:10px 14px;background:${C.redBg};color:${C.red};border-radius:8px;font-weight:bold;">${isOvernight(r) ? "Arrival" : "Trip"} is ${d <= 0 ? "TODAY" : d === 1 ? "TOMORROW" : "in 2 days"} — please validate and confirm right away.</p>`
    : "";
  const dash = `${c.site}/staff/index.html?q=${encodeURIComponent(r.order_code || "")}`;
  const body = `${statusBox([
    ["Order", esc(r.order_code || "—")],
    ["Expected", q ? esc(peso(q.total)) : "—"],
    ["Status", "Proof received"],
  ])}
${urgent}${p(`<strong>${esc(r.guest_name)}</strong> uploaded a payment screenshot on the website${r.payment_uploaded_at ? ` (${esc(fmtDateTime(new Date(r.payment_uploaded_at)))})` : ""}.${hasAttachment ? " It's attached to this email." : " Open it from the dashboard."}`)}
${p(`Please check it against the bank statement for <strong>${q ? esc(peso(q.total)) : "the quoted amount"}</strong>, confirm the signed Reservations Agreement is in the guest thread, then set the booking to <strong>Confirmed</strong>. The guest has been told we're verifying it.`)}
${kv([
    [isOvernight(r) ? "Stay" : "Trip date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in))], ["Mobile", esc(r.guest_phone)], ["Email", esc(r.guest_email)],
    ...(int(r.senior_count) ? [["Senior/PWD IDs", Array.isArray(r.senior_id_paths) && r.senior_id_paths.length ? plural(r.senior_id_paths.length, "photo") + " on file" : "<strong>None uploaded yet</strong>"] as [string, string]] : []),
    ...(int(r.pet_count) ? [["Pet vaccination cards", Array.isArray(r.pet_vaccination_paths) && r.pet_vaccination_paths.length ? plural(r.pet_vaccination_paths.length, "card") + " on file" : "<strong>None uploaded yet</strong>"] as [string, string]] : []),
  ])}
<p style="margin-top:16px;">${button(dash, "Open in staff dashboard")}</p>`;
  return {
    subject: "Re: " + staffSubject(r, c),
    html: shell({ preheader: `Payment proof for ${r.order_code} — please verify`, body, c, internal: true }),
  };
}

export function guestProofEmail(r: Any, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const body = `${p(`Hi ${first},`)}
${p(`We are pleased to acknowledge receipt of your payment transaction slip for <strong>${esc(r.order_code)}</strong>. Our Accounting Team will validate it, and your confirmation letter will be sent in this same email thread. If you don't see it, kindly check your Spam or Junk folder.`)}
${p("To finalize your booking, please reply with the signed Reservations Agreement and a photo of one (1) valid ID, if you haven't yet.")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Proof of payment received for ${r.order_code}`, body, c }),
  };
}

export function guestConfirmedEmail(r: Any, cabanas: Any[], q: Quote | null, c: ReturnType<typeof cfg>) {
  if (isOvernight(r)) return guestConfirmedEmailOvernight(r, cabanas, q, c);
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const t = TIMES[r.stay_type] || TIMES.day_trip;
  const map = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Virgin Beach Resort, Laiya, San Juan, Batangas");
  const body = `${p(`Hi ${first},`)}
${p(`We are delighted to confirm your reservation for a <strong>${esc(r.stay_type === "half_day" ? "Half-Day Trip" : "Day Trip")}</strong> on <strong>${esc(fmtDate(r.check_in))}</strong>.`)}
${statusBox([
    ["Order ID", esc(r.order_code || "—")],
    ["Date", esc(fmtDate(r.check_in, "short"))],
    ["Status", "Confirmed"],
  ], "ok")}
${h2("Your reservation")}${kv([
    ...reservationRows(r, cabanas).slice(1),
    ...(q ? [["Amount paid", `<strong>${esc(peso(q.total))}</strong>`] as [string, string]] : []),
  ])}${cabanaNote(cabanas)}
${p(`Kindly present this confirmation, your proof of payment, and one (1) valid ID upon check-in at the Resort. Check-in is from <strong>${t.in}</strong>; check-out is at <strong>${t.out}</strong>. Lunch is served from 12:00 NN to 2:00 PM only.`, "margin-top:14px;")}
${p("If you haven't sent it yet, please reply with a signed copy of the Reservations Agreement. Once you receive this email, we'd appreciate a quick reply to acknowledge it.", `font-size:13.5px;color:${C.soft};`)}
${button(map, "Directions to the resort")}
${goodToKnow()}
${rebookNote(true)}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Confirmed: ${fmtDate(r.check_in, "short")} · ${r.order_code}`, body, c }),
  };
}

export function guestReminderEmail(r: Any, cabanas: Any[], q: Quote | null, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const fin = finalDeadline(r);
  const payUrl = uploadUrl(r, c);
  const need = docsNeeded(r);
  const body = `${p(`Hi ${first},`)}
${p(`We haven't received payment yet for your reservation <strong>${esc(r.order_code || "")}</strong> on <strong>${esc(fmtDate(r.check_in))}</strong>, and the 24-hour payment window has passed.`)}
${p(fin.isTripMorning
    ? `We're holding your booking${cabanas.length ? " and cabana(s)" : ""} until <strong>${esc(fin.label)}</strong> — the morning of your visit. If payment isn't settled by then, the booking will be canceled and the cabana(s) released to other guests.`
    : `As a courtesy, we've <strong>extended your hold by 12 hours, until ${esc(fin.label)}</strong>. If payment isn't settled by then, the booking will be canceled and the cabana(s) released to other guests.`)}
${statusBox([
    ["Order ID", esc(r.order_code || "—")],
    ["Amount due", q ? esc(peso(q.total)) : "See quotation"],
    ["Final deadline", esc(fin.label)],
  ])}
${p("Already paid? Just upload your proof of payment (or reply to this email with it) and we'll take it from here.")}
${need.any ? p(`On the same page, please also upload ${[need.seniors ? "the Senior Citizen / PWD ID(s)" : "", need.pets ? "your pet's vaccination card(s)" : ""].filter(Boolean).join(" and ")}.`) : ""}
${button(payUrl, need.any ? "Upload payment & documents" : "Upload proof of payment")}
${h2("Bank details")}${bankTable()}
${p(`Please put <strong>${esc(r.order_code)}</strong> and your name in the reference / remarks. Prefer card or e-wallet? Reply to this email and we'll send a secure Xendit link.`, "margin-top:12px;")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Payment reminder — ${r.order_code} held until ${fin.label}`, body, c }),
  };
}

export type Change = { label: string; before: string; after: string };

export function guestChangedEmail(r: Any, cabanas: Any[], changes: Change[], c: ReturnType<typeof cfg>, threadRecord: Any) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const td = `padding:8px 8px;border-bottom:1px solid ${C.line};font-size:13.5px;vertical-align:top;`;
  const rows = changes.map((ch) =>
    `<tr><td style="${td}color:${C.soft};width:28%;">${esc(ch.label)}</td><td style="${td}color:${C.soft};text-decoration:line-through;">${esc(ch.before || "—")}</td><td style="${td}font-weight:bold;color:${C.deep};">${esc(ch.after || "—")}</td></tr>`
  ).join("");
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr style="color:${C.soft};font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;"><td style="padding:6px 8px;">Detail</td><td style="padding:6px 8px;">Original</td><td style="padding:6px 8px;">Updated</td></tr>
${rows}</table>`;
  const body = `${p(`Hi ${first},`)}
${p(`We've made the following ${changes.length === 1 ? "change" : "changes"} to your reservation <strong>${esc(r.order_code || "")}</strong>:`)}
${table}
${h2("Your updated reservation")}${kv([
    ...reservationRows(r, cabanas),
    ...(r.total_amount !== null && r.total_amount !== undefined ? [["Total", `<strong>${esc(peso(Number(r.total_amount)))}</strong>`] as [string, string]] : []),
  ])}
${p("If anything here doesn't look right, or you didn't ask for this change, simply reply to this email and we'll sort it out.", "margin-top:16px;")}
${signature(c)}`;
  return {
    // Same subject as the guest's existing thread (built from the ORIGINAL
    // date if the date itself changed), so it lands in that conversation.
    subject: "Re: " + guestSubject(threadRecord, c),
    html: shell({ preheader: `Updated: ${changes.map((ch) => ch.label).join(", ")} · ${r.order_code}`, body, c }),
  };
}

// ---------- overnight stays (casitas) ----------------------------------------
// Same look, threading and flow as the Day Trip emails. The bill comes from
// quote_overnight() in the database (booking-v8-villas.sql) — the very same
// calculation the website showed the guest and the dashboard uses.

// Display names for add-on slugs in reservation summaries (the price lines in
// the quotation come from the add_ons table via quote_overnight()).
const ADD_ON_NAMES: Record<string, string> = {
  massage_60: "Massage (60 min)", massage_90: "Massage (90 min)", atv_1: "ATV ride (40 min, 1 rider)", atv_2: "ATV ride (40 min, 2 riders)",
};

export const PREFERRED_VILLA_NOTE =
  "Casita numbers are a preference. The resort may move your party to an identical casita if operations require it — we'll always let you know beforehand.";

const AGE_LABELS: Record<string, string> = {
  adult: "Adult", senior: "Senior Citizen / PWD", child_6_12: "Child (6–12)", child_0_5: "Child (0–5)",
};

export function stayRange(r: Any) {
  const n = nightsOf(r);
  return `${fmtDate(r.check_in, "short")} → ${fmtDate(r.check_out, "short")}${n ? ` (${plural(n, "night")})` : ""}`;
}
function nightsOf(r: Any) {
  if (!r.check_in || !r.check_out) return 0;
  return Math.round((new Date(r.check_out + "T00:00:00Z").getTime() - new Date(r.check_in + "T00:00:00Z").getTime()) / 86400000);
}
function villaText(villas: Any[]) {
  return villas.map((v) => `${v.room_type_name} (${v.unit_label})`).join(", ");
}

// Everyone on the booking: the primary guest + the companion list.
export function guestRoster(r: Any): { name: string; group: string }[] {
  const list = [{ name: String(r.guest_name || "Primary guest"), group: r.primary_is_senior ? "Senior Citizen / PWD" : "Adult" }];
  if (Array.isArray(r.companions)) {
    for (const c of r.companions) list.push({ name: String(c?.name || "—"), group: AGE_LABELS[c?.age_group] || "—" });
  }
  return list;
}
function rosterComplete(r: Any) {
  const party = int(r.adults) + int(r.children_6_12) + int(r.children_0_5);
  return Array.isArray(r.companions) && r.companions.length + 1 === party;
}
function rosterTable(r: Any) {
  const td = `padding:6px 8px;border-bottom:1px solid ${C.line};font-size:13.5px;`;
  const rows = guestRoster(r).map((g, i) =>
    `<tr><td style="${td}color:${C.soft};width:28px;">${i + 1}</td><td style="${td}">${esc(g.name)}${i === 0 ? ` <span style="color:${C.soft};font-size:12px;">(primary guest)</span>` : ""}</td><td style="${td}color:${C.soft};white-space:nowrap;">${esc(g.group)}</td></tr>`
  ).join("");
  const missing = rosterComplete(r) ? "" :
    p(`<em>Guest list incomplete — ${plural(int(r.adults) + int(r.children_6_12) + int(r.children_0_5), "guest")} booked. Please reply with the full name and age of each guest.</em>`, `font-size:13px;color:${C.warn};margin-top:8px;`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>${missing}`;
}

function overnightRows(r: Any, villas: Any[]): [string, string][] {
  const t = TIMES.overnight;
  const rows: [string, string][] = [
    ["Order ID", `<strong>${esc(r.order_code || "—")}</strong>`],
    ["Booking", "Overnight Stay"],
    ["Check-in", `<strong>${esc(fmtDate(r.check_in))}</strong> · from ${t.in}`],
    ["Check-out", `<strong>${esc(fmtDate(r.check_out))}</strong> · by ${t.out}`],
    ["Nights", String(nightsOf(r) || "—")],
    ["Casita(s)", villas.length ? `<strong>${esc(villaText(villas))}</strong>` : esc(r.room_name || "To be assigned")],
    ["Guests", esc(partyText(r)) + (int(r.extra_beds) ? ` · ${plural(int(r.extra_beds), "extra floor mattress", "extra floor mattresses")}` : "")],
  ];
  if (Array.isArray(r.add_ons) && r.add_ons.length) rows.push(["Add-ons", esc(r.add_ons.map((a: Any) => `${int(a.qty)} × ${ADD_ON_NAMES[a.slug] || a.slug}`).join(", "))]);
  if (r.occasion) rows.push(["Occasion", esc(label(r.occasion))]);
  if (r.notes) rows.push(["Special requests", esc(r.notes)]);
  return rows;
}

function overnightGoodToKnow() {
  const li = (t: string) => `<li style="margin:0 0 6px;">${t}</li>`;
  return `${h2("Good to know before your stay")}
<ul style="margin:0;padding-left:20px;font-size:14px;">
${li("<strong>Check-in</strong> is from 2:00 PM and <strong>check-out</strong> is at 11:30 AM. Early check-in (from 10:00 AM) and late check-out (until 3:00 PM) are subject to availability at ₱750 per hour.")}
${li("<strong>Full-board meals</strong> are included for every guest each night — lunch on arrival, dinner, and breakfast the next morning. Breakfast 7:00–10:00 AM · Lunch 12:00 NN–2:00 PM · Dinner 7:00–9:00 PM.")}
${li("<strong>Fewer guests?</strong> Please tell us at least 7 days before arrival. Unused meal packages convert to dining credits at the Pavilion.")}
${li("<strong>Every guest</strong> must be present at check-in with a valid government-issued ID. Unregistered guests may be refused entry.")}
${li("<strong>Tourism Ecological Fee:</strong> ₱50.00 per visitor, collected by the Municipality of San Juan at its booth at Km 3, Buhay na Sapa, San Juan (or at our Front Office).")}
${li("<strong>Outside food &amp; drinks</strong> are not allowed, except chips, biscuits and bottled water. Corkage applies to specific beverages.")}
${li("<strong>Drivers, nannies &amp; bodyguards:</strong> ₱1,000 per night for quarters plus ₱750 per night for meals — please let us know in advance.")}
</ul>`;
}

function cancellationTable() {
  const td = `padding:7px 8px;border-bottom:1px solid ${C.line};font-size:13px;`;
  const row = (a: string, b: string) => `<tr><td style="${td}">${a}</td><td style="${td}text-align:right;">${b}</td></tr>`;
  return `${h2("Cancellation &amp; rebooking")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${row("15 days or more before arrival", "Free of charge")}
${row("14 days or less before arrival", "50% of booking value forfeited")}
${row("7 days or less before arrival / no-show", "100% of booking value forfeited")}
</table>
${p("One-time rescheduling within one (1) month of the original dates is possible for medical emergencies or a death in the immediate family (with documents); 20% is forfeited for other rebookings made 14+ days before arrival. Promotional bookings are non-refundable. Inclement weather: free rebooking at Signal No. 2 in San Juan, Batangas.", `font-size:12.5px;color:${C.soft};margin-top:8px;`)}`;
}

export function guestQuoteEmailOvernight(r: Any, villas: Any[], q: Quote | null, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const dl = paymentDeadline(r, c.deadlineHours);
  const payUrl = uploadUrl(r, c);
  const need = docsNeeded(r);
  const staffMade = isStaffMade(r);
  const casitaWord = villas.length === 1 ? "your casita" : "your casitas";
  const body = `${p(`Hi ${first},`)}
${p(staffMade
    ? `Thank you for choosing Virgin Beach Resort! As discussed with our reservations team, here is the quotation for your <strong>overnight stay</strong> from <strong>${esc(fmtDate(r.check_in))}</strong> to <strong>${esc(fmtDate(r.check_out))}</strong> — we're holding ${casitaWord} for you.`
    : `Thank you for choosing Virgin Beach Resort! We've received your request for an <strong>overnight stay</strong> from <strong>${esc(fmtDate(r.check_in))}</strong> to <strong>${esc(fmtDate(r.check_out))}</strong> and are holding ${casitaWord} for you.`)}
${p(dl.date
    ? `<strong>Full payment is required by ${esc(dl.label)}</strong> to secure the reservation. Unpaid bookings are automatically canceled and the casita${villas.length === 1 ? "" : "s"} released.`
    : `<strong>Payment is settled upon arrival at the resort.</strong>`)}
${statusBox([
    ["Order ID", esc(r.order_code || "—")],
    ["Amount due", q ? esc(peso(q.total)) : "To follow"],
    ["Please pay by", esc(dl.label)],
  ])}
${q && q.onlineDiscount ? p(`<strong>Thank you for booking direct!</strong> The amount due already includes your <strong>3% book-direct discount (${esc(peso(q.onlineDiscount))})</strong> for booking on our website and paying by bank transfer.`, `background:${C.tint};border-radius:8px;padding:10px 14px;font-size:14px;`) : ""}
${h2("Your reservation")}${kv(overnightRows(r, villas))}${cabanaNote(villas)}
${h2("Guest list")}${rosterTable(r)}
${q ? h2("Quotation") + quoteTable(q) + p("The full-board meal package (lunch, dinner and breakfast) is mandatory for every guest and is charged per guest, per night. Children 0–5 eat free.", `font-size:12.5px;color:${C.soft};margin-top:8px;`) : ""}
${h2("How to pay")}
${p(`<strong>Option 1 — Bank deposit or online transfer</strong> (InstaPay / PESONet) to any of these accounts. Please put <strong>${esc(r.order_code)}</strong> and your name in the reference / remarks.`)}
${bankTable()}
${p(`<strong>Option 2 — Credit/debit card or e-wallet.</strong> Reply to this email and we'll send you a secure Xendit payment link${q ? ` for ${esc(peso(q.cardTotal ?? q.total))}` : ""}${q && q.onlineDiscount ? " (the 3% discount applies to bank transfers only)" : ""}.`, "margin-top:14px;")}
${h2("After you pay")}
<ol style="margin:0 0 12px;padding-left:20px;font-size:14px;">
<li style="margin:0 0 8px;"><strong>Send us your proof of payment</strong> — upload the screenshot or transaction slip using the button below, or simply reply to this email with it attached.</li>
${need.seniors ? `<li style="margin:0 0 8px;"><strong>Upload the Senior Citizen / PWD ID${int(r.senior_count) > 1 ? "s" : ""}</strong> on the same page — the 20% discount applies only with a valid ID. Please bring ${int(r.senior_count) > 1 ? "them" : "it"} on arrival too.</li>` : ""}
${need.pets ? `<li style="margin:0 0 8px;"><strong>Upload your pet${int(r.pet_count) > 1 ? "s'" : "'s"} vaccination card${int(r.pet_count) > 1 ? "s" : ""}</strong> and agree to the Pet Policy on the same page.</li>` : ""}
${int(r.pet_count) && !need.pets ? `<li style="margin:0 0 8px;"><strong>Bringing your pet${int(r.pet_count) > 1 ? "s" : ""}:</strong> please bring the vaccination card${int(r.pet_count) > 1 ? "s" : ""} you uploaded, a leash, food and water bowls. Pets stay only in the casita they're registered to.</li>` : ""}
<li style="margin:0 0 8px;"><strong>Reply with the signed Reservations Agreement</strong> (attached as a PDF — a photo of the signed last page is fine) and a photo of <strong>one (1) valid ID</strong> of the primary guest.</li>
<li style="margin:0 0 8px;"><strong>We'll email your confirmation</strong> as soon as the payment is verified (office hours, 9:00 AM–4:00 PM, Monday–Friday).</li>
</ol>
${button(payUrl, need.any ? "Upload payment & documents" : "Upload proof of payment")}
<p style="margin:14px 0 0;padding:12px 14px;background:${C.sand};border-radius:8px;font-size:13px;color:${C.soft};">This is a quotation, not yet a confirmed booking. Your casita${villas.length === 1 ? " is" : "s are"} held until the payment deadline above and confirmed only once full payment is received. In the absence of a signed agreement, guests are not relieved of the resort rules, regulations and conditions.</p>
${overnightGoodToKnow()}
${cancellationTable()}
${p("<strong>Need to change your dates or guest list?</strong> Just reply to this email and we'll help.", `font-size:13.5px;color:${C.soft};margin-top:14px;`)}
${signature(c)}`;
  return {
    subject: guestSubject(r, c),
    html: shell({ preheader: `${r.order_code} · ${q ? peso(q.total) + " due · " : ""}${stayRange(r)} · Bank details inside`, body, c }),
  };
}

export function staffNewEmailOvernight(r: Any, villas: Any[], q: Quote | null, c: ReturnType<typeof cfg>, guestSent: { ok: boolean; error?: string }, now = new Date()) {
  const d = daysUntil(r.check_in, now);
  const dl = paymentDeadline(r, c.deadlineHours);
  const flags: string[] = [];
  const flag = (t: string, tone: "warn" | "red" = "warn") =>
    flags.push(`<li style="margin:0 0 6px;color:${tone === "red" ? C.red : C.warn};">${t}</li>`);
  if (!guestSent.ok) flag(`<strong>Guest email FAILED to send</strong> (${esc(guestSent.error || "unknown error")}). Send the quotation manually.`, "red");
  if (q?.mismatch) flag(`${isStaffMade(r) ? "The dashboard saved" : "Website showed the guest"} <strong>${peso(q.websiteTotal)}</strong>, but the rate sheet${Number(r.discount_amount) > 0 ? " (less the discount)" : ""} gives <strong>${peso(q.total)}</strong> (the amount emailed). Double-check before accepting payment.`, "red");
  if (!villas.length) flag("No casita assigned — assign one in the dashboard before taking payment.", "red");
  if (d !== null && d <= 1) flag(`Arrival is <strong>${d <= 0 ? "today" : "tomorrow"}</strong> — call the guest now to arrange payment.`, "red");
  else if (d !== null && d <= 7) flag(`Arrival is in ${plural(d, "day")} — inside the 7-day non-refundable window. Follow up by phone.`, "red");
  else if (d !== null && d <= 14) flag(`Arrival is in ${plural(d, "day")} — inside the 14-day (50% forfeit) window.`);
  if (!rosterComplete(r)) flag("Guest list is incomplete — ask the guest for every companion's full name and age (meals are per person).");
  if (int(r.extra_beds)) flag(`${plural(int(r.extra_beds), "extra floor mattress", "extra floor mattresses")} needed — tell Housekeeping.`);
  const needDocs = docsNeeded(r);
  if (needDocs.any) flag(`Guest still has to upload ${[needDocs.seniors ? "Senior/PWD ID(s)" : "", needDocs.pets ? "pet vaccination card(s)" : ""].filter(Boolean).join(" and ")}.`);
  if (int(r.senior_count)) flag(`${plural(int(r.senior_count), "senior citizen/PWD", "senior citizens/PWDs")} — ${Array.isArray(r.senior_id_paths) && r.senior_id_paths.length ? plural(r.senior_id_paths.length, "ID photo") + " uploaded" : "no ID photo yet"}. Verify at check-in.`);
  if (int(r.pet_count)) flag(`${plural(int(r.pet_count), "pet")} — ${Array.isArray(r.pet_vaccination_paths) && r.pet_vaccination_paths.length ? "vaccination card(s) uploaded" : "NO vaccination card yet"}${r.pet_policy_agreed_at ? ", Pet Policy agreed online" : ""}.`);
  if (r.occasion) flag(`Occasion: <strong>${esc(label(r.occasion))}</strong> — consider a welcome touch.`);

  const tel = String(r.guest_phone || "").replace(/[^\d+]/g, "");
  const dash = `${c.site}/staff/index.html?q=${encodeURIComponent(r.order_code || "")}`;
  const gmail = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(MAILBOX)}#search/${encodeURIComponent('"' + (r.order_code || "") + '"')}`;
  const body = `${statusBox([
    ["Order", esc(r.order_code || "—")],
    ["Amount due", q ? esc(peso(q.total)) : "Quote needed"],
    ["Stay", esc(`${fmtDate(r.check_in, "short").replace(/^\w+, /, "")} · ${plural(nightsOf(r), "night")}`)],
  ])}
${isStaffMade(r) ? p(`Added in the staff dashboard${r.booked_by ? ` by <strong>${esc(r.booked_by)}</strong>` : ""} (${esc(label(r.source))}) and sent to the guest as a quotation.`) : ""}
${p(guestSent.ok
    ? `Quotation + bank details sent to <strong>${esc(r.guest_email)}</strong> at ${esc(fmtDateTime(now))}. It's in the <strong>Sent</strong> folder — the guest's replies will land in that same thread. Pay-by date given: <strong>${esc(dl.label)}</strong>.`
    : `<strong style="color:${C.red};">The guest has NOT received an email.</strong>`)}
${flags.length ? `${h2("Needs attention")}<ul style="margin:0;padding-left:20px;font-size:14px;">${flags.join("")}</ul>` : ""}
${h2("Guest")}
${kv([
    ["Name", `<strong>${esc(r.guest_name)}</strong>`],
    ["Mobile", `<a href="tel:${esc(tel)}" style="color:${C.deep};">${esc(r.guest_phone)}</a>`],
    ["Email", `<a href="mailto:${esc(r.guest_email)}" style="color:${C.deep};">${esc(r.guest_email)}</a>`],
    ["Country", esc(r.country || "—")],
    ["Heard about us", esc(label(r.how_heard))],
    ["Promos opt-in", r.marketing_opt_in ? "Yes" : "No"],
    ["Submitted", esc(fmtDateTime(new Date(r.created_at || now)))],
  ])}
${h2("Stay")}${kv(overnightRows(r, villas).slice(1))}
${h2("Guest list")}${rosterTable(r)}
${q ? h2("Quotation sent") + quoteTable(q) : ""}
${h2("Follow-up checklist")}
<ol style="margin:0 0 14px;padding-left:20px;font-size:14px;">
<li>Watch the guest thread (search the Order ID) for proof of payment, the signed agreement and a valid ID. Website uploads also alert this inbox.</li>
<li>Guest asks for card / e-wallet? Create a Xendit invoice for <strong>${q ? esc(peso(q.cardTotal ?? q.total)) : "the quoted amount"}</strong>${q && q.onlineDiscount ? " (no 3% book-direct discount on card payments)" : ""} with description <strong>Booking# ${esc(r.order_code)}</strong>, and reply in the guest's thread with the link and the same pay-by time.</li>
<li>Verify the deposit against the bank statement, then set the booking to <strong>Confirmed</strong> in the dashboard — the guest gets the confirmation email automatically.</li>
<li>No payment by ${esc(dl.label)}? The booking automatically turns <strong>Expired</strong> and the casita(s) are released.</li>
<li>Share the guest count with the kitchen (full board, ${plural(nightsOf(r), "night")}) and any extra mattress with Housekeeping once confirmed.</li>
</ol>
${button(dash, "Open in staff dashboard")}${button(gmail, "Find guest thread in Gmail")}`;
  return {
    subject: staffSubject(r, c),
    html: shell({ preheader: `${r.guest_name} · ${stayRange(r)} · ${q ? peso(q.total) : "quote needed"}`, body, c, internal: true }),
  };
}

export function guestConfirmedEmailOvernight(r: Any, villas: Any[], q: Quote | null, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const map = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Virgin Beach Resort, Laiya, San Juan, Batangas");
  const body = `${p(`Hi ${first},`)}
${p(`We are delighted to confirm your <strong>overnight stay</strong> at Virgin Beach Resort from <strong>${esc(fmtDate(r.check_in))}</strong> to <strong>${esc(fmtDate(r.check_out))}</strong>. We can't wait to welcome you.`)}
${statusBox([
    ["Order ID", esc(r.order_code || "—")],
    ["Arrival", esc(fmtDate(r.check_in, "short"))],
    ["Status", "Confirmed"],
  ], "ok")}
${h2("Your reservation")}${kv([
    ...overnightRows(r, villas).slice(1),
    ...(q ? [["Amount paid", `<strong>${esc(peso(q.total))}</strong>`] as [string, string]] : []),
  ])}${cabanaNote(villas)}
${h2("Registered guests")}${rosterTable(r)}
${p(`Kindly present this confirmation and your proof of payment at the Front Office. <strong>Every guest</strong> listed above needs a valid government-issued ID at check-in. Check-in is from <strong>2:00 PM</strong>; check-out is at <strong>11:30 AM</strong>.`, "margin-top:14px;")}
${p("If you haven't sent it yet, please reply with a signed copy of the Reservations Agreement. A quick reply to acknowledge this email would be much appreciated.", `font-size:13.5px;color:${C.soft};`)}
${button(map, "Directions to the resort")}
${overnightGoodToKnow()}
${cancellationTable()}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Confirmed: ${stayRange(r)} · ${r.order_code}`, body, c }),
  };
}

// Server-side quote for an overnight booking, from quote_booking_overnight().
export function quoteFromOvernight(record: Any, oq: Any): Quote | null {
  if (!oq || !Array.isArray(oq.lines)) return null;
  const lines: QuoteLine[] = oq.lines.map((l: Any) => ({
    desc: String(l.desc), rate: Number(l.rate) || 0, qty: Number(l.qty) || 0, amount: r2(Number(l.amount) || 0), vatExempt: !!l.vat_exempt,
  }));
  let total = r2(Number(oq.total) || 0);
  const disc = Number(record.discount_amount) || 0;
  if (disc > 0) {
    const d = r2(Math.min(disc, total));
    const pct = record.discount_type === "percent" && record.discount_value ? ` (${Number(record.discount_value)}%)` : "";
    const why = record.discount_reason ? ` — ${String(record.discount_reason).slice(0, 80)}` : "";
    lines.push({ desc: `Discount${pct}${why}`, rate: -d, qty: 1, amount: -d, vatExempt: false });
    total = r2(total - d);
  }
  const websiteTotal = record.total_amount === null || record.total_amount === undefined ? null : Number(record.total_amount);
  const vatExemptSales = r2(lines.filter((l) => l.vatExempt).reduce((s, l) => s + l.amount, 0));
  const gross = Math.max(0, r2(total - vatExemptSales));
  const vatableSales = r2(gross / 1.17);
  const vat = r2(vatableSales * 0.12);
  const serviceCharge = r2(gross - vatableSales - vat);
  const onlineDiscount = r2(Number(oq.online_discount) || 0);
  return {
    cardTotal: onlineDiscount > 0 ? r2(total + onlineDiscount) : total, onlineDiscount,
    heading: `OVERNIGHT STAY — ${plural(Number(oq.nights) || 0, "night")}, casita${(oq.villas || []).length === 1 ? "" : "s"} with full-board meals`,
    lines, subtotal: total, total, vatExemptSales, vatableSales, vat, serviceCharge,
    websiteTotal, mismatch: websiteTotal !== null && Math.abs(websiteTotal - total) > 0.5,
  };
}

// ---------- database (service role, PostgREST) -------------------------------

async function db(path: string, init: RequestInit = {}) {
  const c = cfg();
  const res = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.serviceKey,
      Authorization: `Bearer ${c.serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
}

async function loadBooking(id: string) {
  const res = await db(`booking_requests?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!res.ok) throw new Error(`load booking: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function loadCabanas(r: Any): Promise<Any[]> {
  const res = await db(
    `booking_cabanas?booking_id=eq.${encodeURIComponent(r.id)}&select=cabana_id,cabanas(label,cabana_type,price,capacity,section,number)`
  );
  let list: Any[] = [];
  if (res.ok) list = (await res.json()).map((x: Any) => x.cabanas).filter(Boolean);
  if (!list.length && r.cabana_id) {
    const one = await db(`cabanas?id=eq.${encodeURIComponent(r.cabana_id)}&select=label,cabana_type,price,capacity,section,number`);
    if (one.ok) list = await one.json();
  }
  return list.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
}

async function loadVillas(r: Any): Promise<Any[]> {
  const res = await db(
    `booking_villas?booking_id=eq.${encodeURIComponent(r.id)}&select=villa_id,active,villas(unit_label,room_type,room_type_name,base_occupancy,max_extra,sort)`
  );
  if (!res.ok) return [];
  return (await res.json()).map((x: Any) => x.villas).filter(Boolean)
    .sort((a: Any, b: Any) => (a.sort || 0) - (b.sort || 0));
}

// Cabanas for a Day Trip, casitas for an overnight stay.
async function loadUnits(r: Any): Promise<Any[]> {
  return isOvernight(r) ? await loadVillas(r) : await loadCabanas(r);
}

async function quoteFor(r: Any, units: Any[]): Promise<Quote | null> {
  if (!isOvernight(r)) return buildQuote(r, units);
  const res = await db("rpc/quote_booking_overnight", { method: "POST", body: JSON.stringify({ p_booking_id: r.id }) });
  if (!res.ok) { console.error("quote_booking_overnight", res.status, await res.text()); return null; }
  return quoteFromOvernight(r, await res.json());
}

// Claims a (booking, kind) slot. Returns false if that email already went out
// (or is going out right now) — this is what makes webhook retries harmless.
async function claim(bookingId: string, kind: string, recipient: string, subject: string): Promise<string | null> {
  const res = await db("booking_email_log", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ booking_id: bookingId, kind, recipient, subject, status: "sending" }),
  });
  if (res.status === 409) return null;
  if (!res.ok) throw new Error(`email log: ${res.status} ${await res.text()}`);
  return (await res.json())[0].id;
}
async function finish(logId: string, ok: boolean, messageId: string, error?: string) {
  await db(`booking_email_log?id=eq.${logId}`, {
    method: "PATCH",
    body: JSON.stringify(ok
      ? { status: "sent", sent_at: new Date().toISOString(), message_id: messageId }
      : { status: "failed", error: String(error || "").slice(0, 1000) }),
  });
}

// ---------- sending ----------------------------------------------------------

let transporter: Any = null;
async function smtp() {
  if (transporter) return transporter;
  const nodemailer = (await import("npm:nodemailer@6.9.16")).default;
  // SMTP_DRY_RUN=true builds the full message without sending it (local tests).
  if (env("SMTP_DRY_RUN") === "true") return (transporter = nodemailer.createTransport({ jsonTransport: true }));
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: MAILBOX, pass: cfg().smtpPassword },
  });
  return transporter;
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `${t} (${href})`)
    .replace(/<(br|\/p|\/tr|\/h2|\/li|\/div)[^>]*>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<li[^>]*>/gi, " • ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

async function send(opts: {
  booking: Any; kind: string; to: string | string[]; subject: string; html: string;
  thread: "guest" | "staff"; first?: boolean; replyTo?: string; attachments?: Any[];
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const to = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
  const logId = await claim(opts.booking.id, opts.kind, to, opts.subject);
  if (!logId) return { ok: true, skipped: true };
  const root = msgId(opts.booking, opts.thread);
  const messageId = opts.first ? root : `<${opts.kind.replace(/[^a-z0-9]+/gi, ".")}.${Date.now()}.${root.slice(1)}`;
  try {
    const t = await smtp();
    await t.sendMail({
      from: FROM,
      to,
      replyTo: opts.replyTo || MAILBOX,
      subject: opts.subject,
      html: opts.html,
      text: htmlToText(opts.html),
      messageId,
      ...(opts.first ? {} : { inReplyTo: root, references: [root] }),
      attachments: opts.attachments || [],
      headers: { "X-VBR-Order": opts.booking.order_code || "", "X-VBR-Email-Kind": opts.kind },
    });
    await finish(logId, true, messageId);
    return { ok: true };
  } catch (err) {
    console.error(`send ${opts.kind} failed:`, err);
    await finish(logId, false, messageId, (err as Error)?.message || String(err));
    return { ok: false, error: (err as Error)?.message || String(err) };
  }
}

let agreementCache: Uint8Array | null = null;
async function agreementAttachment() {
  try {
    if (!agreementCache) {
      const res = await fetch(cfg().agreementUrl);
      if (!res.ok) return [];
      agreementCache = new Uint8Array(await res.arrayBuffer());
    }
    return [{ filename: "VBR Reservations Agreement.pdf", content: agreementCache, contentType: "application/pdf" }];
  } catch {
    return [];
  }
}

async function proofAttachment(path: string | null, bucket = "payment-proofs", name = "Payment proof") {
  if (!path) return [];
  const c = cfg();
  try {
    const res = await fetch(`${c.supabaseUrl}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}` },
    });
    if (!res.ok) return [];
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 15 * 1024 * 1024) return [];
    const ext = path.split(".").pop() || "jpg";
    return [{ filename: `${name} ${path.split("/").pop()}`.replace(/\.[^.]+$/, "") + "." + ext, content: buf, contentType: res.headers.get("content-type") || "image/jpeg" }];
  } catch {
    return [];
  }
}

// ---------- handlers ---------------------------------------------------------

async function onInsert(r: Any) {
  const c = cfg();
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  let guest: { ok: boolean; error?: string } = { ok: false, error: "no guest email on booking" };
  if (r.guest_email) {
    const g = guestQuoteEmail(r, cabanas, q, c);
    guest = await send({
      booking: r, kind: "guest_quote", to: r.guest_email, subject: g.subject, html: g.html,
      thread: "guest", first: true, attachments: q ? await agreementAttachment() : [],
    });
  }
  const s = staffNewEmail(r, cabanas, q, c, guest);
  const to = r.stay_type === "corporate" ? [...c.staffEmails, EVENTS_EMAIL] : c.staffEmails;
  const staff = await send({ booking: r, kind: "staff_new", to, subject: s.subject, html: s.html, thread: "staff", first: true });
  return { guest, staff };
}

// Staff-added bookings (phone, Messenger, email, walk-in) are handled by hand
// unless staff ticked "Send this booking to the guest" (email_guest) — then
// they get exactly the same emails as a website booking.
function autoEmail(r: Any, c: ReturnType<typeof cfg>) {
  return c.autoSources.includes(String(r.source || "website")) || r.email_guest === true;
}

async function onProof(r: Any) {
  const c = cfg();
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  if (r.status === "confirmed" || String(r.payment_screenshot_path || "").startsWith("staff/")) {
    return { skipped: "uploaded by staff" };
  }
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  const att = await proofAttachment(r.payment_screenshot_path);
  const s = staffProofEmail(r, q, c, att.length > 0);
  const stamp = String(r.payment_uploaded_at || Date.now());
  const staff = await send({ booking: r, kind: `proof_staff:${stamp}`, to: [...c.staffEmails, ...c.proofCc], subject: s.subject, html: s.html, thread: "staff", attachments: att });
  let guest = null;
  if (r.guest_email) {
    const g = guestProofEmail(r, c);
    guest = await send({ booking: r, kind: "proof_guest", to: r.guest_email, subject: g.subject, html: g.html, thread: "guest" });
  }
  return { staff, guest };
}

export function staffDocsEmail(r: Any, seniorIds: number, petCards: number, c: ReturnType<typeof cfg>, hasAttachment: boolean) {
  const dash = `${c.site}/staff/index.html?q=${encodeURIComponent(r.order_code || "")}`;
  const what = [seniorIds ? plural(seniorIds, "Senior/PWD ID photo") : "", petCards ? plural(petCards, "pet vaccination card") : ""].filter(Boolean).join(" and ");
  const body = `${p(`<strong>${esc(r.guest_name)}</strong> uploaded ${esc(what)} for <strong>${esc(r.order_code)}</strong> (${esc(fmtDate(r.check_in))}) on the website.${hasAttachment ? " They're attached to this email." : ""}`)}
${petCards && r.pet_policy_agreed_at ? p("The guest agreed to the Pet Policy online.") : ""}
${p("Please check them in the dashboard (and again at check-in).")}
${button(dash, "Open in staff dashboard")}`;
  return {
    subject: "Re: " + staffSubject(r, c),
    html: shell({ preheader: `Documents uploaded for ${r.order_code}`, body, c, internal: true }),
  };
}

async function onDocs(r: Any, payload: Any) {
  const c = cfg();
  const nS = Math.min(int(payload.senior_ids), 10), nP = Math.min(int(payload.pet_cards), 6);
  if (!nS && !nP) return { skipped: "nothing uploaded" };
  const sp: string[] = Array.isArray(r.senior_id_paths) ? r.senior_id_paths.slice(-nS || r.senior_id_paths.length) : [];
  const pp: string[] = Array.isArray(r.pet_vaccination_paths) ? r.pet_vaccination_paths.slice(-nP || r.pet_vaccination_paths.length) : [];
  const att = [
    ...(nS ? (await Promise.all(sp.map((x) => proofAttachment(x, "senior-ids", "Senior ID")))).flat() : []),
    ...(nP ? (await Promise.all(pp.map((x) => proofAttachment(x, "pet-vaccinations", "Pet vaccination card")))).flat() : []),
  ];
  const s = staffDocsEmail(r, nS, nP, c, att.length > 0);
  return await send({ booking: r, kind: `docs_staff:${String(payload.upload_id || Date.now())}`, to: c.staffEmails, subject: s.subject, html: s.html, thread: "staff", attachments: att });
}

async function onConfirmed(r: Any) {
  const c = cfg();
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  if (!r.guest_email) return { skipped: "no guest email" };
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  const g = guestConfirmedEmail(r, cabanas, q, c);
  return await send({ booking: r, kind: "guest_confirmed", to: r.guest_email, subject: g.subject, html: g.html, thread: "guest" });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function onReminder(r: Any) {
  const c = cfg();
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  if (!["pending", "pending_payment"].includes(r.status) || r.payment_uploaded_at) return { skipped: "no longer unpaid" };
  if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  const g = guestReminderEmail(r, cabanas, q, c);
  return await send({ booking: r, kind: "payment_reminder", to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
}

async function onChanged(r: Any, payload: Any) {
  const c = cfg();
  if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
  const raw = Array.isArray(payload.changes) ? payload.changes.slice(0, 30) : [];
  const changes: Change[] = raw
    .map((x: Any) => ({ label: String(x?.label ?? "").slice(0, 80), before: String(x?.before ?? "").slice(0, 300), after: String(x?.after ?? "").slice(0, 300) }))
    .filter((x: Change) => x.label);
  if (!changes.length) return { skipped: "no changes" };
  const cabanas = await loadUnits(r);
  const threadRecord = { ...r, check_in: payload.old_check_in || r.check_in };
  const g = guestChangedEmail(r, cabanas, changes, c, threadRecord);
  const kind = `guest_changed:${String(payload.change_id || Date.now())}`;
  return await send({ booking: r, kind, to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
}

export async function handle(req: Request): Promise<Response> {
  const c = cfg();
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!c.webhookSecret || req.headers.get("x-webhook-secret") !== c.webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!c.smtpPassword) return new Response("SMTP_PASSWORD not configured", { status: 500 });

  let payload: Any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const id = payload?.record?.id;
  if (!id) return new Response("No record id", { status: 400 });

  // Never trust the webhook body for content — re-read the row.
  const r = await loadBooking(id);
  if (!r) return new Response("Booking not found", { status: 404 });
  const old = payload.old_record || {};
  const out: Record<string, unknown> = {};

  try {
    if (payload.type === "INSERT") out.insert = await onInsert(r);
    if (payload.type === "CHANGE") out.changed = await onChanged(r, payload);
    if (payload.type === "REMINDER") out.reminder = await onReminder(r);
    if (payload.type === "DOCS") out.docs = await onDocs(r, payload);
    if (payload.type === "UPDATE") {
      // Staff ticked "Send this booking to the guest" — the dashboard flips
      // email_guest after the cabanas are attached, so the quote lists them.
      if (payload.record.email_guest === true && old.email_guest !== true) out.insert = await onInsert(r);
      if (payload.record.payment_uploaded_at && payload.record.payment_uploaded_at !== old.payment_uploaded_at) {
        out.proof = await onProof(r);
      }
      if (payload.record.status === "confirmed" && old.status !== "confirmed") out.confirmed = await onConfirmed(r);
    }
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), { status: 500 });
  }
  return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
if ((globalThis as Any).Deno?.serve) (globalThis as Any).Deno.serve(handle);
