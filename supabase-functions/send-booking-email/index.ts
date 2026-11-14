// Supabase Edge Function: send-booking-email
// ---------------------------------------------------------------------------
// Sends every Day Trip booking email straight from the Google Workspace
// mailbox reservations@virginbeachresort.com (Gmail SMTP), so every message,
// every guest reply and every follow-up lives in that one inbox.
//
// What it sends, and when (fired by the database triggers in
// supabase-functions/booking-email-trigger.sql and later booking-v*.sql).
// Status names follow ONE vocabulary everywhere (dashboard, emails,
// Cloudbeds) — see statusLabel() below.
//
//   New booking (INSERT, website / auto-email sources), or staff tick "Send
//   this booking to the guest" (UPDATE flips email_guest to true)
//     → GUEST:  quotation + bank details + next steps, with the Reservations
//               Agreement PDF attached  (kind: guest_quote)
//               — if the booking is ALREADY Confirmed / completed (staff took
//               payment before sending), the guest gets the confirmation
//               instead (kind: guest_confirmed); nothing for Cancelled ones
//     → STAFF:  "New booking" alert with the full transaction, contact links,
//               flags and a follow-up checklist  (kind: staff_new)
//
//   Guest uploads a payment screenshot on /pay (payment_uploaded_at changes)
//     → STAFF:  "Payment proof — please verify", screenshot attached  (proof_staff:<ts>)
//     → GUEST:  "We received your proof — Payment Under Review"  (proof_guest:<ts>)
//
//   Guest uploads Senior/PWD IDs or pet vaccination cards (type DOCS)
//     → STAFF:  documents attached  (kind: docs_staff:<upload_id>)
//
//   Staff click Verify on a payment → booking becomes Confirmed (UPDATE)
//     → GUEST:  "Your booking is confirmed" + arrival guide  (kind: guest_confirmed)
//
//   Staff reject a payment proof in the dashboard (type PROOF_REJECTED)
//     → GUEST:  "We couldn't verify your payment" + re-upload link and the
//               new payment deadline  (kind: proof_rejected:<payment_id>)
//
//   Booking set to Cancelled — status 'declined' (UPDATE)
//     → GUEST:  "Your reservation has been cancelled"  (kind: guest_cancelled)
//               — not sent for Cloudbeds No-Shows
//
//   Unpaid at the payment deadline — booked + 24 h, never later than 8:00 AM
//   on the trip date (process_booking_deadlines cron → status 'expired')
//     → GUEST:  "Cancelled · payment not received", hold released  (kind: guest_expired)
//               v45: every guest with an email when "email every guest" is on
//               (staff-entered bookings and villas in Cloudbeds too)
//     → STAFF:  "Auto-cancelled — no payment"  (kind: staff_expired), if on
//   N hours before that deadline (v45, PAY_REMINDER from the cron)
//     → GUEST:  "Please pay by … or the booking is released"  (kind: pay_reminder)
//
//   Balance due 15 days before arrival (types BALANCE_DUE / BALANCE_OVERDUE)
//     → GUEST:  balance reminder  (kind: balance_due / balance_overdue_guest)
//     → STAFF:  overdue alert  (kind: balance_overdue_staff)
//
//   Last payment verified, nothing left to pay (type PAID_IN_FULL)
//     → GUEST:  "Fully paid"  (kind: paid_in_full) — not once Checked Out / Completed
//
//   Staff edit a booking in the dashboard (✎) and leave "Email the guest"
//   ticked, or Cloudbeds staff move the dates / casitas / price of a website
//   booking (type CHANGE, source "cloudbeds") — see booking-change-email.sql
//     → GUEST:  "Changes to your reservation" — each changed detail shown as
//               before → now, plus the full updated reservation  (kind: guest_changed:<id>)
//               v71: still unpaid → also the amount, deadline and Pay now button
//
//   Staff click "Send payment link…" (type RESEND_QUOTE, booking-v71)
//     → GUEST:  the quotation with the Pay now button again, to the email on
//               the booking now  (kind: guest_quote_resend:<id>)
//
// Guest emails are sent only for auto-email sources (or email_guest = true),
// never for bookings made in Cloudbeds (cb_owned — OTA guests), and only to a
// valid guest email address.
//
// Guest emails all share one subject line so Gmail keeps them in ONE thread
// (the guest's replies land in that same thread in reservations@). Staff
// alerts likewise share their own internal thread per Booking ID.
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
// Silent copy (Bcc) of every STAFF email this function sends (new booking
// alert with "Needs attention", proofs, overdue balances…) for monitoring —
// guest emails are not copied. Override with the MONITOR_EMAILS secret (comma-separated;
// set it to "none" to stop).
const monitorEmails = () => {
  const v = env("MONITOR_EMAILS", "migquesada@gmail.com").trim();
  return /^none$/i.test(v) ? [] : v.split(",").map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
};
const MSGID_DOMAIN = "virginbeachresort.com";
// The public website address shown to guests (signature, "book again").
// Working links (upload page, staff dashboard) still use SITE_URL.
const PUBLIC_SITE = "https://virginbeachresort.com/";

// Payment window in hours. MUST match booking_deadlines() in SQL (24 h) — the
// database is what actually expires the booking; this is only the wording.
// Every deadline and every "expires after N hours" line uses this one value.
export const DEFAULT_DEADLINE_HOURS = 24;
function deadlineHours() {
  return Number(env("PAYMENT_DEADLINE_HOURS", String(DEFAULT_DEADLINE_HOURS))) || DEFAULT_DEADLINE_HOURS;
}

function cfg() {
  const site = env("SITE_URL", "https://virginbeachresort.com").replace(/\/+$/, "");
  return {
    site,
    testMode: env("TEST_MODE") === "true",
    staffEmails: env("STAFF_EMAILS", MAILBOX).split(",").map((s) => s.trim()).filter(Boolean),
    deadlineHours: deadlineHours(),
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
// RA 9994 / RA 10754 + RR 7-2010 — must match seniorPrice() in assets/js/pricing.js:
// the senior's own share is VAT-exempt, 20% off the VAT-exclusive price, and the
// 5% service charge (on the net) is kept. Prices include 12% VAT + 5% SC.
// Front Office formula (Nov 2026, booking-v39): ÷ 1.17, 20% off, then + 5% service charge.
function seniorPrice(price: number) {
  return r2(price / 1.17 * (1 - SENIOR_DISCOUNT_RATE) * 1.05);
}
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

// The ONE status vocabulary used by the dashboard, the emails and Cloudbeds.
// Overnight (villa) bookings also follow Cloudbeds' own check-in / no-show.
export function statusLabel(r: Any): string {
  const s = String(r?.status || "");
  const cbs = r?.cb_info?.status;
  if (s === "pending") return isOvernight(r) ? "Confirmation Pending" : "Payment Pending";
  if (s === "pending_payment") return "Payment Under Review";
  if (s === "confirmed") return isOvernight(r) && cbs === "checked_in" ? "Checked In" : "Confirmed";
  if (s === "completed") return isOvernight(r) ? "Checked Out" : "Completed";
  if (s === "declined") return isOvernight(r) && cbs === "no_show" ? "No-Show" : "Cancelled";
  if (s === "expired") return isOvernight(r) ? "Cancelled · payment not received" : "Cancelled · not paid";
  return s || "—";
}

// Short name of the booking type for guest-facing sentences ("your … on …").
const TRIP_LABELS: Record<string, string> = {
  day_trip: "Day Trip", half_day: "Half-Day Trip", flash_sale: "Flash Sale Day Trip",
  all_inclusive_family: "All-Inclusive Family Day Trip", all_inclusive_barkada: "All-Inclusive Barkada Day Trip",
  corporate: "Corporate Outing", overnight: "Overnight Stay", other: "Booking",
};
export const tripLabel = (r: Any) => TRIP_LABELS[String(r?.stay_type || "")] || "Booking";

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

// Payment deadline — must match booking_deadlines() in SQL (booking-v7.sql):
//   booked + 24h (DEFAULT_DEADLINE_HOURS) — the booking expires then if still
//   unpaid — but never later than 8:00 AM on the trip date. Bookings made
//   on/after 8:00 AM of the trip date (same-day walk-ins) are paid on arrival.
function trip8(checkIn: string | null): Date | null {
  return checkIn ? new Date(checkIn + "T08:00:00+08:00") : null;
}
export function paymentDeadline(record: Any, hours = deadlineHours()): { date: Date | null; label: string } {
  // v71: a re-sent payment link states when the booking really closes (booking_auto_cancel)
  if (record?._deadline) { const d = new Date(record._deadline); if (!isNaN(d.getTime())) return { date: d, label: fmtDateTime(d) }; }
  const created = new Date(record.created_at || Date.now());
  const t8 = trip8(record.check_in);
  if (t8 && t8.getTime() <= created.getTime()) return { date: null, label: "upon arrival at the resort" };
  let deadline = new Date(created.getTime() + hours * 3600_000);
  if (t8 && t8 < deadline) deadline = t8;
  return { date: deadline, label: fmtDateTime(deadline) };
}
export function finalDeadline(record: Any, hours = deadlineHours()): { date: Date | null; label: string; isTripMorning: boolean } {
  const created = new Date(record.created_at || Date.now());
  const t8 = trip8(record.check_in);
  if (t8 && t8.getTime() <= created.getTime()) return { date: null, label: "upon arrival at the resort", isTripMorning: false };
  let d = new Date(created.getTime() + hours * 3600_000);
  let isTripMorning = false;
  if (t8 && t8 < d) { d = t8; isTripMorning = true; }
  return { date: d, label: fmtDateTime(d), isTripMorning };
}

// ---------- payment terms (booking-v16) -------------------------------------
// Pay at least 50% (or 100%) by the payment deadline to secure the booking;
// the balance is due 15 days before arrival (the day before the 50%
// cancellation charge starts). Within 14 days of arrival: 100% up front.
export const BALANCE_DAYS = 15;
function addDaysStr(d: string, n: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function manilaToday(now = new Date()) { return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10); }
export function payTerms(r: Any, total: number | null | undefined, now = new Date()) {
  const ci = r?.check_in ? String(r.check_in).slice(0, 10) : null;
  const due = ci ? addDaysStr(ci, -BALANCE_DAYS) : null;
  const t = Number(total) || 0;
  return { half: false /* v66: full payment only */, total: t, deposit: Math.ceil(t / 2), balanceDue: due, balanceDueLabel: due ? fmtDate(due) : "" };
}
export type PaySummary = {
  total: number | null; paid: number; claimed: number; pending: number; balance: number; deposit: number;
  half_allowed: boolean; balance_due: string | null; plan: string | null; fully_paid: boolean;
  last: { kind: string; amount: number; method: string; status: string; at: string } | null;
};
export const KIND_WORDS: Record<string, string> = { deposit: "50% down payment", full: "full payment", balance: "remaining balance", other: "payment" };
// "To secure your reservation, pay at least 50% …" (quotation)
// Bookings made on the website (villas and day trips) are paid online
// through Xendit (booking-v31-xendit.sql, v32 for day trips).
export const paysOnline = (r: Any) => !r?.cb_owned;
const ONLINE_METHODS = "card, GCash, Maya, QR Ph and more";

function securePara(r: Any, total: number, dl: { label: string }, units: string) {
  const t = payTerms(r, total);
  const how = paysOnline(r) ? " online with the <strong>Pay now</strong> button below" : ", and send us your proof of payment";
  return t.half
    ? `<strong>To secure your reservation, pay at least 50% (${esc(peso(t.deposit))}) &mdash; or the full ${esc(peso(t.total))} &mdash; by ${esc(dl.label)}</strong>${how}. The remaining balance is due by <strong>${esc(t.balanceDueLabel)}</strong> (${BALANCE_DAYS} days before arrival). ${releaseLine(r, units)}`
    : `<strong>Full payment of ${esc(peso(t.total))} is required by ${esc(dl.label)}</strong> to secure the reservation. ${releaseLine(r, units)}`;
}
// v47: day trips are kept until the trip day; villas are released after the hold
function releaseLine(r: Any, units: string) {
  return isOvernight(r) ? `Unpaid bookings are automatically cancelled and the ${units} released.`
    : `If the booking is still unpaid on the day and you haven't arrived by 5:00 PM, it is cancelled and the ${units} released.`;
}
function secureRows(r: Any, total: number, dl: { label: string }): [string, string][] {
  const t = payTerms(r, total);
  return t.half
    ? [["To secure (50%)", esc(peso(t.deposit))], ["Please pay by", esc(dl.label)], ["Balance due by", esc(fmtDate(t.balanceDue, "short"))]]
    : [["Amount due", esc(peso(t.total))], ["Please pay by", esc(dl.label)]];
}
// The 5% Convenience Discount (villas): one wording everywhere.
export const CONVENIENCE_RULE = "booked here on our official website and paid by bank or e-wallet transfer";

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
  // v58: what today's rate sheet gives, when it differs from the booked total
  // (the booked total is then what the quote shows — see honorBooked)
  rateSheetTotal?: number;
  // Overnight website bookings: price when paying by card / e-wallet instead
  // of bank transfer (i.e. without the book-direct Convenience Discount).
  cardTotal?: number;
  onlineDiscount?: number;
  onlineDiscountRate?: number; // percent, e.g. 5
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

// v29: day-trip cabanas are booked by count; staff assign numbers later.
export function cabanaCounts(r: Any, cabanas: Any[] = []) {
  const assigned = (k: "dining" | "lounge") => cabanas.filter((c) => !c.unit_label && cabanaKind(c) === k).length;
  return {
    dining: Math.max(int(r.dining_cabanas), int(r.legacy_dining_cabanas), assigned("dining")),
    lounge: Math.max(int(r.lounge_cabanas), int(r.legacy_lounge_cabanas), assigned("lounge")),
  };
}
// v33: day-trip cabana numbers are for internal records; guests see them only
// when the booking has email_cabana_numbers ticked.
export const showCabanaNumbers = (r: Any, cabanas: Any[] = []) =>
  !isOvernight(r) && r?.email_cabana_numbers === true && cabanas.length > 0 && !cabanas[0]?.unit_label;

export function cabanaCountText(r: Any, cabanas: Any[] = []) {
  const n = cabanaCounts(r, cabanas);
  return [n.dining ? plural(n.dining, "Dining Cabana") : "", n.lounge ? plural(n.lounge, "Lounge Cabana") : ""].filter(Boolean).join(", ");
}

// What the guest still has to upload on /pay (Senior/PWD IDs, pet cards).
export function docsNeeded(r: Any) {
  const seniors = int(r.senior_count) + int(r.pwd_kid_count) > 0 && !(Array.isArray(r.senior_id_paths) && r.senior_id_paths.length);
  const pets = int(r.pet_count) > 0 && !(Array.isArray(r.pet_vaccination_paths) && r.pet_vaccination_paths.length);
  return { seniors, pets, any: seniors || pets };
}
const uploadUrl = (r: Any, c: ReturnType<typeof cfg>) =>
  `${c.site}/pay/index.html?order=${encodeURIComponent(r.order_code || "")}&email=${encodeURIComponent(r.guest_email || "")}`;

// Rebuilds the bill server-side from the booking row, so what the guest is
// asked to pay never depends on numbers the browser sent.
export function buildQuote(record: Any, cabanas: Any[]): Quote | null {
  const type = record.stay_type;
  if (type === "corporate") {
    // A corporate outing has a tailored price: no quote until staff enter the
    // total; then one line with that amount (it can be paid online like any booking).
    const t = Number(record.total_amount);
    if (!(t > 0)) return null;
    const guests = int(record.adults) + int(record.children_6_12) + int(record.children_0_5);
    const cab = cabanaCountText(record, cabanas);
    const desc = `Corporate outing package${guests ? ` — ${plural(guests, "guest")}` : ""}${cab ? `, ${cab}` : ""}`;
    return {
      heading: "CORPORATE OUTING — as agreed with our events team",
      lines: [{ desc, rate: r2(t), qty: 1, amount: r2(t), vatExempt: false }],
      subtotal: r2(t), total: r2(t), vatExemptSales: 0, vatableSales: 0, vat: 0, serviceCharge: 0,
      websiteTotal: t, mismatch: false,
    } as Quote;
  }

  const adults = int(record.adults);
  const kids612 = int(record.children_6_12);
  const kids05 = int(record.children_0_5);
  const seniors = Math.min(int(record.senior_count), adults);
  const pwdKids = Math.min(int(record.pwd_kid_count), kids612);
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
    const n = cabanaCounts(record, cabanas);
    const extraCab = Math.max(0, n.dining + n.lounge - pkg.includedCabanas);
    add(`${heading} — up to ${pkg.includedPax} guests & ${pkg.includedCabanas} cabana`, pkg.base, 1);
    add("Additional guest", pkg.addlAdult, extraPax);
    add("Pet fee", pkg.addlPet, pets);
    add("Additional cabana", pkg.addlCabana, extraCab);
    heading = heading + " — Inclusive of entrance fee and lunch";
  } else {
    const rate = PRICING[type] || PRICING.day_trip;
    add("Adult (13 y.o. +)", rate.adult, regular);
    add("Senior Citizen / PWD (20% discount)", seniorPrice(rate.adult), seniors, true);
    add("Child (6–12 y.o.)", rate.child612, kids612 - pwdKids);
    add("PWD child (6–12 y.o., 20% discount)", seniorPrice(rate.child612), pwdKids, true);
    add("Child (0–5 y.o.)", 0, kids05);
    add("Pet fee", rate.pet, pets);
    const n = cabanaCounts(record, cabanas);
    for (const kind of ["dining", "lounge"] as const) {
      if (!n[kind]) continue;
      // Booked by count (v29) at the rate-sheet price; numbers come later.
      const group = cabanas.filter((c) => cabanaKind(c) === kind);
      add(`${cabanaName(kind, group[0]?.capacity)}${showCabanaNumbers(record, cabanas) && group.length ? " — " + group.map(shortLabel).join(", ") : ""}`, rate[kind], n[kind]);
    }
    heading = type === "half_day"
      ? "HALF-DAY TRIP AREA — Inclusive of entrance fee and afternoon snacks"
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
    `<tr><td style="${td}">${esc(String(l.desc).replace(/VAT-exempt,\s*/gi, ""))}</td><td style="${td}text-align:right;white-space:nowrap;">${l.rate ? num(l.rate) : "Free"}</td><td style="${td}text-align:center;">${l.qty}</td><td style="${td}text-align:right;white-space:nowrap;">${num(l.amount)}</td></tr>`
  ).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13.5px;">
<tr><td colspan="4" style="padding:8px 6px;background:${C.tint};color:${C.deep};font-weight:bold;font-size:12.5px;letter-spacing:.03em;">${esc(q.heading)}</td></tr>
<tr style="color:${C.soft};font-size:12px;"><td style="padding:6px;">Description</td><td style="padding:6px;text-align:right;">Rate (₱)</td><td style="padding:6px;text-align:center;">Qty</td><td style="padding:6px;text-align:right;">Amount (₱)</td></tr>
${rows}
<tr><td colspan="3" style="padding:10px 6px;text-align:right;font-weight:bold;border-top:2px solid ${C.deep};font-size:15px;">TOTAL AMOUNT DUE</td><td style="padding:10px 6px;text-align:right;font-weight:bold;border-top:2px solid ${C.deep};font-size:15px;white-space:nowrap;">${peso(q.total)}</td></tr>
</table>`;
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
    ["Booking ID", `<strong>${esc(r.order_code || "—")}</strong>`],
    ["Booking", esc(r.stay_type_label || TYPE_NAMES[r.stay_type] || r.stay_type)],
    ["Date", `<strong>${esc(fmtDate(r.check_in))}</strong>`],
    ["Check-in / out", `${t.in} – ${t.out}`],
    ["Guests", esc(partyText(r))],
  ];
  const cabText = cabanaCountText(r, cabanas);
  if (cabText) {
    rows.push(["Cabana(s)", esc(cabText)]);
    // Cabana numbers are internal; shown only when staff tick "Include cabana
    // numbers in emails to the guest" on the booking (v33).
    if (showCabanaNumbers(r, cabanas)) {
      rows.push(["Cabana no.", `<strong>${esc(cabanas.map((c) => String(c.label).replace(/^Section /, "")).join(", "))}</strong>`]);
    }
  }
  if (r.guest_names) rows.push(["Names in your party", esc(r.guest_names)]);
  if (r.notes) rows.push(["Your notes", esc(r.notes)]);
  return rows;
}

export const PREFERRED_CABANA_NOTE =
  "Our team assigns your cabana number(s) before or on the day of your visit and emails them to you. Cabana numbers are subject to change due to privacy and group concerns — for example, to keep a large group together or give every party its own space. If we move you, it's to a comparable cabana, and we'll email you again.";
function cabanaNote(cabanas: Any[], r: Any = null) {
  if (cabanas.length && cabanas[0].unit_label) return p(esc(PREFERRED_VILLA_NOTE), `font-size:12.5px;color:${C.soft};margin-top:8px;`);
  // Day trips: numbers are internal; the "may change" note only when they're shown.
  return r && showCabanaNumbers(r, cabanas) ? p(esc(CABANA_MOVED_NOTE), `font-size:12.5px;color:${C.soft};margin-top:8px;`) : "";
}

// Rebooking: unpaid bookings simply expire after the payment window
// (deadlineHours, 24 h — same as booking_deadlines() in SQL); paid guests reply
// to change their date. (The cancellation & postponement table applies to
// overnight casitas, not Day Trips, so it's no longer in these emails.)
function rebookNote(paid = false, hours = deadlineHours()) {
  return p("<strong>Need to change your date?</strong> Just reply to this email and we'll help you rebook." +
    (paid ? "" : ` Haven't paid yet and can't make it? Just reply and let us know, and we'll release the cabana.`),
    `font-size:13.5px;color:${C.soft};margin-top:14px;`);
}

const HALF_DAY_SNACKS = "Set A — Penne Salsiccia, Ham &amp; Cheese Sandwich and Mais con Hielo · Set B — Canton Guisado, Tuna Sandwich and Saba con Hielo · Set C — Bihon Guisado, Chicken Sandwich and Halo-Halo";
function mealNote(type?: string) {
  return type === "half_day"
    ? `<strong>Afternoon snacks</strong> are included for every guest — one set each: ${HALF_DAY_SNACKS}.`
    : "<strong>Lunch</strong> is served from 12:00 NN to 2:00 PM only.";
}
function goodToKnow(type?: string) {
  const li = (t: string) => `<li style="margin:0 0 6px;">${t}</li>`;
  return `${h2("Good to know before your visit")}
<ul style="margin:0;padding-left:20px;font-size:14px;">
${li("<strong>Tourism Ecological Fee:</strong> ₱50.00 per visitor, collected by the Municipality of San Juan at its ticketing booth at Km 3, Buhay na Sapa, San Juan. Missed the booth? Settle it at our Front Office and we'll issue the ticket.")}
${li(mealNote(type))}
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
<p style="margin:0;"><strong>Website:</strong> <a href="${PUBLIC_SITE}" style="color:${C.deep};">virginbeachresort.com</a></p>
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
  const own = customOf(r, "quote");
  if (own && String(own.subject || "").trim()) return `${c.testMode ? "[TEST] " : ""}${fillTokens(String(own.subject).trim(), r).slice(0, 180)}`;
  // Overnight: arrival date only, so a date change email (built from the
  // original arrival) still lands in the same Gmail thread.
  if (isOvernight(r)) return `${c.testMode ? "[TEST] " : ""}Virgin Beach Resort Overnight Stay — ${r.order_code || "Booking"} (Arrival ${fmtDate(r.check_in, "short").replace(/^\w+, /, "")})`;
  const type = r.stay_type === "corporate" ? "Corporate Outing" : r.stay_type === "half_day" ? "Half-Day Trip" : "Day Trip";
  return `${c.testMode ? "[TEST] " : ""}Virgin Beach Resort ${type} — ${r.order_code || "Booking"} (${fmtDate(r.check_in, "short").replace(/^\w+, /, "")})`;
}
// "⚠ 2 to check · " in front of the subject, and a one-line summary as the
// inbox preview, whenever a new-booking alert has "Needs attention" items.
const plainFlag = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&mdash;/g, "—").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export function attentionPrefix(flags: string[]) { return flags.length ? "⚠ " : ""; }
export function attentionSummary(flags: string[]) {
  if (!flags.length) return "";
  return "Needs attention: " + flags.map((f) => plainFlag(f).replace(/\.\s.*$/, "").slice(0, 90)).join(" · ");
}
// Staff alerts (v56): facts first, nothing repeated. The sender name says what
// happened (staffSender), the subject says who / when / what (staffSubject),
// the preview says money, status, where from and the phone (staffPreview).
// The subject uses only fields that rarely change, so the follow-up alerts
// ("Re: …") stay in the same Gmail thread.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function ymd(v: unknown) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return { y: +m[1], m: MON[+m[2] - 1], d: +m[3], w: WD[d.getUTCDay()] };
}
export function shortWhen(r: Any, now = new Date()) {
  const a = ymd(r.check_in);
  if (!a) return "no date";
  const thisYear = Number(now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 4));
  const yr = a.y !== thisYear ? ` ${a.y}` : "";
  const b = isOvernight(r) ? ymd(r.check_out) : null;
  if (!b) return `${a.w} ${a.m} ${a.d}${yr}`;
  const n = nightsOf(r);
  return `${a.w} ${a.m} ${a.d}–${b.m === a.m ? "" : b.m + " "}${b.d}${yr}${n ? ` (${n}N)` : ""}`;
}
export function paxOf(r: Any) { return int(r.adults) + int(r.children_6_12) + int(r.children_0_5); }
const SHORT_TYPES: Record<string, string> = {
  day_trip: "Day trip", half_day: "Half-day", all_inclusive_family: "All-in Family", all_inclusive_barkada: "All-in Barkada",
  corporate: "Corporate", flash_sale: "Flash sale",
};
export function staffSubject(r: Any, c: ReturnType<typeof cfg>) {
  const parts: string[] = [r.guest_name || "Guest", shortWhen(r)];
  if (isOvernight(r)) {
    if (r.room_name) parts.push(String(r.room_name).replace(/ Casitas?\b/g, "").replace(/\s*×\s*/g, "× "));
  } else {
    parts.push(SHORT_TYPES[r.stay_type] || r.stay_type_label || "Day trip");
    const n = cabanaCounts(r);
    const cab = [n.dining ? `${n.dining} dining` : "", n.lounge ? `${n.lounge} lounge` : ""].filter(Boolean).join(" + ");
    if (cab) parts.push(cab);
  }
  const pax = paxOf(r);
  if (pax) parts.push(`${pax} pax`);
  if (r.order_code) parts.push(r.order_code);
  return `${c.testMode ? "[TEST] " : ""}${parts.join(" · ")}`;
}
// Sender name on staff alerts = what happened. Same mailbox, so replies and
// filters keep working; Gmail shows it where "Virgin Beach Resort Reservations" was.
export function staffSender(kind: string, r: Any) {
  const k = kind.split(":")[0];
  if (k === "staff_new" || k === "staff_new_monitor") {
    if (r.cb_owned) return "VBR · Cloudbeds booking";
    if (r.stay_type === "corporate") return "VBR · Corporate inquiry";
    return isOvernight(r) ? "VBR · New villa stay" : "VBR · New day trip";
  }
  return ({
    staff_inquiry: "VBR · Booking request", proof_staff: "VBR · Payment proof", docs_staff: "VBR · Docs uploaded",
    balance_overdue_staff: "VBR · Balance overdue", overpaid: "VBR · Overpaid", staff_expired: "VBR · Auto-cancelled",
  } as Record<string, string>)[k] || "VBR · Staff alert";
}
// Links in staff alerts. The dashboard opens straight on the booking. Gmail
// opens the reservations@ mailbox by address (so it works whichever Google
// account is first in the browser) and searches the Booking ID or guest email.
export function staffLinks(r: Any, c: ReturnType<typeof cfg>) {
  const dash = `${c.site}/staff/index.html?q=${encodeURIComponent(r.order_code || "")}`;
  const terms = [r.order_code ? `"${r.order_code}"` : "", r.guest_email ? String(r.guest_email).trim() : ""].filter(Boolean);
  const query = terms.length > 1 ? `{${terms.join(" ")}}` : terms[0] || "";
  const gmail = `https://mail.google.com/mail/u/${MAILBOX}/#search/${encodeURIComponent(query)}`;
  return { dash, gmail };
}
// Preview line of a new-booking alert.
const pesoShort = (n: number) => peso(n).replace(/\.00$/, "");
function shortDue(d: Date) {
  const t = d.toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return t.replace(":00 ", " ");
}
function staffPreview(r: Any, q: Quote | null, flags: string[], c: ReturnType<typeof cfg>) {
  const dl = paymentDeadline(r, c.deadlineHours);
  const bits = [
    q ? `${pesoShort(q.total)}${staffSentMode(r) === "quote" && dl.date ? ` due by ${shortDue(dl.date)}` : ""}` : "Quote needed",
    statusLabel(r),
    r.cb_owned ? `Cloudbeds${r.cb_info?.source ? ` (${r.cb_info.source})` : ""}` : isStaffMade(r) ? `Staff${r.booked_by ? ` (${r.booked_by})` : ""}` : "Website",
    r.guest_phone || r.guest_email || "",
  ].filter(Boolean);
  const notes = flags.map((f) => plainFlag(f).split(/ — |\. /)[0].replace(/\.$/, "").slice(0, 60));
  return bits.join(" · ") + (notes.length ? ` · ⚠ ${notes.join("; ")}` : "");
}
// ---------- staff-edited guest emails ------------------------------------------
// Staff can rewrite the opening message (and the subject of the first email in
// a thread) from the dashboard before a guest email goes out. Saved on the
// booking as email_custom = { quote: {subject, message}, confirmed: {...} };
// change emails pass theirs with the CHANGE webhook. Everything below the
// opening (amounts, bank details, links, policies) is always generated, so it
// can't drift from the booking. Tokens: {first} {name} {order} {date}
// {checkout} {nights}.
export type Custom = { subject?: string; message?: string; skip?: boolean } | null;
export function customOf(r: Any, kind: string): Custom {
  const all = r && r.email_custom && typeof r.email_custom === "object" ? r.email_custom : null;
  const x = all ? all[kind] : null;
  return x && typeof x === "object" ? x : null;
}
export function fillTokens(text: string, r: Any) {
  const first = String(r.guest_name || "there").trim().split(/\s+/)[0];
  const n = isOvernight(r) && r.check_out ? Math.round((new Date(r.check_out + "T00:00:00Z").getTime() - new Date(r.check_in + "T00:00:00Z").getTime()) / 86400000) : 0;
  const map: Record<string, string> = {
    first, name: String(r.guest_name || ""), order: String(r.order_code || ""),
    date: r.check_in ? fmtDate(r.check_in) : "", checkout: r.check_out ? fmtDate(r.check_out) : "", nights: n ? String(n) : "",
  };
  return text.replace(/\{(first|name|order|date|checkout|nights)\}/g, (_m, k) => map[k] || "");
}
export function messageHtml(text: string, r: Any) {
  const paras = fillTokens(String(text || ""), r).replace(/\r/g, "").trim().split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  return paras.map((t) => p(esc(t).replace(/\n/g, "<br>"))).join("\n");
}
// Swap the generated greeting + opening paragraph for the staff's message.
export function applyIntro(body: string, custom: Custom, r: Any) {
  if (!custom || !String(custom.message || "").trim()) return body;
  const rest = body.replace(/^\s*<p[^>]*>[\s\S]*?<\/p>\s*<p[^>]*>[\s\S]*?<\/p>/, "");
  return messageHtml(String(custom.message), r) + "\n" + rest;
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
    : `Thank you for choosing Virgin Beach Resort! We've received your <strong>${esc(r.stay_type_label || TYPE_NAMES[r.stay_type])}</strong> booking for <strong>${esc(fmtDate(r.check_in))}</strong>${cabanas.length ? ` and are holding ${cabanas.length === 1 ? "your cabana" : "your cabanas"} for you` : ""}.`)}
${p(dl.date
    ? securePara(r, q.total, dl, "cabana(s)")
    : `<strong>Payment is settled upon arrival at the resort.</strong>`)}
${poolNotice(c, r.check_in)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ...(dl.date ? secureRows(r, q.total, dl) : [["Amount due", esc(peso(q.total))] as [string, string]]),
  ])}
${h2("Your reservation")}${kv(reservationRows(r, cabanas))}${cabanaNote(cabanas, r)}
${h2("Quotation")}${quoteTable(q)}
${paysOnline(r) ? `${h2("How to pay")}
${p(`<strong>Pay online</strong> &mdash; ${ONLINE_METHODS} &mdash; through our secure payment partner <strong>Xendit</strong>. Pay the full amount on the next page; your booking is confirmed as soon as the payment goes through.`)}
${button(payUrl, "Pay now")}
${h2("Next steps")}
<ol style="margin:0 0 12px;padding-left:20px;font-size:14px;">
<li style="margin:0 0 8px;"><strong>Pay online</strong> using the button above &mdash; you'll get your booking confirmation by email right after.</li>
${need.seniors ? `<li style="margin:0 0 8px;"><strong>Upload the Senior Citizen / PWD ID${int(r.senior_count) > 1 ? "s" : ""}</strong> on the same page — the 20% discount applies only with a valid ID. Please bring ${int(r.senior_count) > 1 ? "them" : "it"} on the day too.</li>` : ""}
${need.pets ? `<li style="margin:0 0 8px;"><strong>Upload your pet${int(r.pet_count) > 1 ? "s'" : "'s"} vaccination card${int(r.pet_count) > 1 ? "s" : ""}</strong> and agree to the Pet Policy on the same page. Please bring it on the day too, with a leash and food and water bowls.</li>` : ""}
${int(r.pet_count) && !need.pets ? `<li style="margin:0 0 8px;"><strong>Bringing your pet${int(r.pet_count) > 1 ? "s" : ""}:</strong> please bring the vaccination card${int(r.pet_count) > 1 ? "s" : ""} you uploaded (we'll check ${int(r.pet_count) > 1 ? "them" : "it"} at check-in), a leash, food and water bowls. The Pet Policy you agreed to applies during your visit.</li>` : ""}
<li style="margin:0 0 8px;"><strong>Reply with the signed Reservations Agreement</strong> (attached as a PDF — a photo of the signed last page is fine) and a photo of <strong>one (1) valid ID</strong>${int(r.senior_count) && !need.seniors ? " (we already have the Senior Citizen/PWD ID you uploaded)" : ""}.</li>
</ol>
${need.any ? button(payUrl, "Upload documents") : ""}` : `${h2("How to pay")}
${p(`<strong>Bank or e-wallet transfer</strong> (InstaPay / PESONet &mdash; GCash and Maya can send to these accounts via InstaPay). Please put <strong>${esc(r.order_code)}</strong> and your name in the reference / remarks.`)}
${bankTable()}
${h2("After you pay")}
<ol style="margin:0 0 12px;padding-left:20px;font-size:14px;">
<li style="margin:0 0 8px;"><strong>Send us your proof of payment</strong> — upload the screenshot or transaction slip using the button below, or simply reply to this email with it attached.</li>
${need.seniors ? `<li style="margin:0 0 8px;"><strong>Upload the Senior Citizen / PWD ID${int(r.senior_count) > 1 ? "s" : ""}</strong> on the same page — the 20% discount applies only with a valid ID. Please bring ${int(r.senior_count) > 1 ? "them" : "it"} on the day too.</li>` : ""}
${need.pets ? `<li style="margin:0 0 8px;"><strong>Upload your pet${int(r.pet_count) > 1 ? "s'" : "'s"} vaccination card${int(r.pet_count) > 1 ? "s" : ""}</strong> and agree to the Pet Policy on the same page. The card should show the pet's details and a current anti-rabies vaccination. Please bring it on the day too, with a leash and food and water bowls.</li>` : ""}
${int(r.pet_count) && !need.pets ? `<li style="margin:0 0 8px;"><strong>Bringing your pet${int(r.pet_count) > 1 ? "s" : ""}:</strong> please bring the vaccination card${int(r.pet_count) > 1 ? "s" : ""} you uploaded (we'll check ${int(r.pet_count) > 1 ? "them" : "it"} at check-in), a leash, food and water bowls. The Pet Policy you agreed to applies during your visit.</li>` : ""}
<li style="margin:0 0 8px;"><strong>Reply with the signed Reservations Agreement</strong> (attached as a PDF — a photo of the signed last page is fine) and a photo of <strong>one (1) valid ID</strong>${int(r.senior_count) && !need.seniors ? " (we already have the Senior Citizen/PWD ID you uploaded)" : ""}.</li>
<li style="margin:0 0 8px;"><strong>We'll email your confirmation</strong> as soon as the payment is verified (during office hours, 9:00 AM–4:00 PM, Monday–Friday).</li>
</ol>
${button(payUrl, need.any ? "Upload payment & documents" : "Upload proof of payment")}`}
<p style="margin:14px 0 0;padding:12px 14px;background:${C.sand};border-radius:8px;font-size:13px;color:${C.soft};">This is a quotation, not yet a confirmed booking. Reservations are on a first-come, first-served basis and are confirmed only once payment is received. In the absence of a signed agreement, guests are not relieved of the resort rules, regulations and conditions.</p>
${goodToKnow(r.stay_type)}
${rebookNote()}
${signature(c)}`;

  return {
    subject: guestSubject(r, c),
    html: shell({ preheader: `${r.order_code} · ${payTerms(r, q.total).half ? `50% (${peso(Math.ceil(q.total / 2))}) secures it` : `${peso(q.total)} due`} · ${paysOnline(r) ? "Pay online" : "Bank details inside"}`, body: applyIntro(body, customOf(r, "quote"), r), c }),
  };
}

// What the guest was sent with a new booking: the quotation, the confirmation
// (staff created / sent an already-Confirmed booking) or nothing (Cancelled).
export function staffSentMode(r: Any): "quote" | "confirmed" | "none" {
  if (r.status === "confirmed" || r.status === "completed") return "confirmed";
  if (r.status === "declined" || r.status === "expired") return "none";
  return "quote";
}
function staffSentLine(r: Any, mode: "confirmed" | "none", guestSent: { ok: boolean; error?: string }, now: Date) {
  if (mode === "none") return `This booking is <strong>${esc(statusLabel(r))}</strong>, so no email was sent to the guest.`;
  return guestSent.ok
    ? `Booking confirmation sent to <strong>${esc(r.guest_email)}</strong> at ${esc(fmtDateTime(now))}. It's in the <strong>Sent</strong> folder — the guest's replies will land in that same thread.`
    : `<strong style="color:${C.red};">The guest has NOT received an email.</strong>`;
}

export function staffNewEmail(r: Any, cabanas: Any[], q: Quote | null, c: ReturnType<typeof cfg>, guestSent: { ok: boolean; error?: string; monitor?: string }, now = new Date()) {
  if (isOvernight(r)) return staffNewEmailOvernight(r, cabanas, q, c, guestSent, now);
  const d = daysUntil(r.check_in, now);
  const dl = paymentDeadline(r, c.deadlineHours);
  const flags: string[] = [];
  const flag = (t: string, tone: "warn" | "red" = "warn") =>
    flags.push(`<li style="margin:0 0 6px;color:${tone === "red" ? C.red : C.warn};">${t}</li>`);

  const mode = staffSentMode(r);
  if (!guestSent.ok && !guestSent.monitor && mode !== "none") flag(`<strong>Guest email FAILED to send</strong> (${esc(guestSent.error || "unknown error")}). Send the ${mode === "confirmed" ? "confirmation" : "quotation"} manually.`, "red");
  const needDocs = docsNeeded(r);
  if (needDocs.any) flag(`Guest still has to upload ${[needDocs.seniors ? "Senior/PWD ID(s)" : "", needDocs.pets ? "pet vaccination card(s)" : ""].filter(Boolean).join(" and ")} — the quotation email links to the upload page.`);
  if (q?.mismatch && !r.cb_owned) flag(...mismatchFlag(r, q));
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
  if (!cabanaCountText(r, cabanas) && r.stay_type !== "corporate") flag("No cabanas on this booking — add the Dining / Lounge count in the dashboard.");
  if (r.stay_type === "corporate" && !(Number(r.total_amount) > 0)) flag("Corporate request — no automatic quote was sent. Prepare a tailored quotation.");

  const tel = String(r.guest_phone || "").replace(/[^\d+]/g, "");
  const { dash, gmail } = staffLinks(r, c);

  const body = `${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Amount due", q ? esc(peso(q.total)) : "Quote needed"],
    ["Status", esc(statusLabel(r))],
  ])}
${isStaffMade(r) && !guestSent.monitor ? p(`Added in the staff dashboard${r.booked_by ? ` by <strong>${esc(r.booked_by)}</strong>` : ""} (${esc(label(r.source))})${mode === "confirmed" ? " as an already-Confirmed booking — the guest was sent the confirmation email, not a quotation." : mode === "none" ? "." : " and sent to the guest as a quotation."}`) : ""}
${guestSent.monitor ? p(guestSent.monitor) : p(mode !== "quote" ? staffSentLine(r, mode, guestSent, now) : guestSent.ok
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
<li>Watch the guest thread (search the Booking ID) for proof of payment, the signed agreement and one valid ID. Website uploads also alert this inbox.</li>
<li>Verify the deposit against the bank statement, then click <strong>Verify</strong> on the payment in the dashboard (Payments) — that confirms the booking and emails the guest.</li>
<li>Not paid? The guest gets a payment reminder, then an &ldquo;expecting you today&rdquo; email at 8:00 AM on the trip day. If nothing has been paid by <strong>5:00 PM on the trip day</strong>, the booking closes automatically and the guest is emailed. A part-paid booking is never closed automatically — it stays under &ldquo;Action needed&rdquo; until the balance is recorded.</li>
</ol>
${button(dash, "Open in staff dashboard")}${button(gmail, "Find guest thread in Gmail")}`;

  return {
    subject: attentionPrefix(flags) + staffSubject(r, c),
    html: shell({ preheader: staffPreview(r, q, flags, c), body, c, internal: true }),
  };
}

export function staffProofEmail(r: Any, q: Quote | null, c: ReturnType<typeof cfg>, hasAttachment: boolean, now = new Date(), ps: PaySummary | null = null) {
  const d = daysUntil(r.check_in, now);
  const urgent = d !== null && d <= 2
    ? `<p style="margin:0 0 12px;padding:10px 14px;background:${C.redBg};color:${C.red};border-radius:8px;font-weight:bold;">${isOvernight(r) ? "Arrival" : "Trip"} is ${d <= 0 ? "TODAY" : d === 1 ? "TOMORROW" : "in 2 days"} — please validate and confirm right away.</p>`
    : "";
  const { dash } = staffLinks(r, c);
  const body = `${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Guest says", ps?.last ? `${esc(KIND_WORDS[ps.last.kind] || "payment")}: ${esc(peso(ps.last.amount))}` : (q ? esc(peso(q.total)) : "—")],
    ["Booking total", ps?.total != null ? esc(peso(ps.total)) : (q ? esc(peso(q.total)) : "—")],
  ])}
${urgent}${p(`<strong>${esc(r.guest_name)}</strong> uploaded a payment screenshot on the website${r.payment_uploaded_at ? ` (${esc(fmtDateTime(new Date(r.payment_uploaded_at)))})` : ""}.${hasAttachment ? " It's attached to this email." : " Open it from the dashboard."}`)}
${p(`Please check it against the bank statement for <strong>${ps?.last ? esc(peso(ps.last.amount)) : q ? esc(peso(q.total)) : "the quoted amount"}</strong>, confirm the signed Reservations Agreement is in the guest thread, then click <strong>Verify</strong> on the payment in the dashboard (Payments). ${ps?.last?.kind === "balance" ? "That completes the payment and sends the guest a thank-you." : "That confirms the booking and sends the guest their confirmation."} The guest has been told we're verifying it.`)}
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

export function guestProofEmail(r: Any, c: ReturnType<typeof cfg>, ps: PaySummary | null = null) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const last = ps?.last || null;
  const what = last ? `your <strong>${esc(KIND_WORDS[last.kind] || "payment")} of ${esc(peso(last.amount))}</strong>` : "your proof of payment";
  const isBalance = last?.kind === "balance";
  const balanceAfter = ps && last && last.kind === "deposit" && ps.total ? r2(Number(ps.total) - Number(last.amount)) : 0;
  const body = `${p(`Hi ${first},`)}
${p(`Thank you! We've received ${last ? `the proof of ${what}` : what} for <strong>${esc(r.order_code)}</strong>${r.payment_uploaded_at ? ` (uploaded ${esc(fmtDateTime(new Date(r.payment_uploaded_at)))})` : ""}.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    [isOvernight(r) ? "Stay" : "Date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in, "short"))],
    ["Status", esc(inCloudbeds(r) ? "Confirmation Pending · payment being verified" : statusLabel({ ...r, status: "pending_payment" }))],
  ])}
${inCloudbeds(r)
    // villa stays in Cloudbeds: the confirmation comes from our reservations system, not this thread
    ? p(isBalance
      ? "Our team is now verifying it against our bank records. Once it's confirmed, it will show on your booking as paid &mdash; and you're all set for your arrival."
      : "Our team is now verifying it against our bank records. As soon as it's confirmed, you'll receive your <strong>booking confirmation</strong> by email from our reservations system &mdash; no need to do anything else in the meantime. If you don't see it, kindly check your Spam or Junk folder.")
    : p(isBalance
    ? "Our team is now verifying it against our bank records. Once it's confirmed, we'll email you in this same thread &mdash; and you're all set for your arrival."
    : "Our team is now verifying it against our bank records. As soon as it's confirmed, we'll send your <strong>booking confirmation</strong> in this same email thread &mdash; no need to do anything else in the meantime. If you don't see it, kindly check your Spam or Junk folder.")}
${balanceAfter > 0.5 && ps?.balance_due ? p(`The remaining balance of <strong>${esc(peso(balanceAfter))}</strong> is due by <strong>${esc(fmtDate(ps.balance_due))}</strong>${isOvernight(r) && Number(r.online_discount) > 0 ? ` &mdash; please pay it by bank or e-wallet transfer too, to keep your 5% Convenience Discount` : ""}. You'll upload that proof the same way.`) : ""}
${p("If you haven't yet, please reply with the signed Reservations Agreement and a photo of one (1) valid ID so we can finalize everything.", `font-size:13.5px;color:${C.soft};`)}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `We received your payment proof for ${r.order_code} — verifying it now`, body, c }),
  };
}

// "Thank you for your payment" line for the confirmation, when payment was received.
function paidThanks(r: Any, q: Quote | null, ps: PaySummary | null = null, c?: ReturnType<typeof cfg>) {
  if (ps && ps.paid > 0 && !ps.fully_paid) {
    const keep = isOvernight(r) && Number(r.online_discount) > 0 ? " Please pay it by bank or e-wallet transfer too, to keep your 5% Convenience Discount." : "";
    return p(`Thank you for your payment of <strong>${esc(peso(ps.paid))}</strong> &mdash; we've verified it, and your booking is now <strong>confirmed</strong>.`) +
      p(`The remaining balance of <strong>${esc(peso(ps.balance))}</strong> is due by <strong>${esc(fmtDate(ps.balance_due))}</strong>.${keep}${paysOnline(r) ? " You can pay it online with the button below." : " When you've paid it, upload the proof using the same link:"}`, `background:${C.tint};border-radius:8px;padding:10px 14px;font-size:14px;`) +
      (c ? `<p style="margin:0 0 16px;">${button(uploadUrl(r, c), paysOnline(r) ? "Pay balance now" : "Upload balance payment")}</p>` : "");
  }
  const paid = !!(r.payment_uploaded_at || r.payment_screenshot_path || (ps && ps.paid > 0));
  if (!paid) return "";
  const amt = ps && ps.paid > 0 ? ps.paid : q ? q.total : null;
  return p(`Thank you for your payment${amt ? ` of <strong>${esc(peso(amt))}</strong>` : ""} &mdash; we've verified it, and your booking is now <strong>confirmed</strong>.`);
}
function paidRows(q: Quote | null, ps: PaySummary | null): [string, string][] {
  if (ps && ps.paid > 0 && !ps.fully_paid) {
    return [["Amount paid", `<strong>${esc(peso(ps.paid))}</strong>`], ["Balance due", `<strong>${esc(peso(ps.balance))}</strong> by ${esc(fmtDate(ps.balance_due, "short"))}`]];
  }
  return q ? [["Amount paid", `<strong>${esc(peso(ps && ps.paid > 0 ? ps.paid : q.total))}</strong>`]] : [];
}

export function guestConfirmedEmail(r: Any, cabanas: Any[], q: Quote | null, c: ReturnType<typeof cfg>, ps: PaySummary | null = null) {
  if (isOvernight(r)) return guestConfirmedEmailOvernight(r, cabanas, q, c, ps);
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const t = TIMES[r.stay_type] || TIMES.day_trip;
  const map = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Virgin Beach Resort, Laiya, San Juan, Batangas");
  const body = `${p(`Hi ${first},`)}
${paidThanks(r, q, ps, c)}${p(`We are delighted to confirm your reservation for a <strong>${esc(tripLabel(r))}</strong> on <strong>${esc(fmtDate(r.check_in))}</strong>.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Date", esc(fmtDate(r.check_in, "short"))],
    ["Status", esc(statusLabel({ ...r, status: "confirmed" }))],
  ], "ok")}
${h2("Your reservation")}${kv([
    ...reservationRows(r, cabanas).slice(1),
    ...paidRows(q, ps),
  ])}${cabanaNote(cabanas, r)}
${p(`Kindly present this confirmation, your proof of payment, and one (1) valid ID upon check-in at the Resort. Check-in is from <strong>${t.in}</strong>; check-out is at <strong>${t.out}</strong>. ${r.stay_type === "half_day" ? "Afternoon snacks are included for every guest." : "Lunch is served from 12:00 NN to 2:00 PM only."}`, "margin-top:14px;")}
${p("If you haven't sent it yet, please reply with a signed copy of the Reservations Agreement. Once you receive this email, we'd appreciate a quick reply to acknowledge it.", `font-size:13.5px;color:${C.soft};`)}
${button(map, "Directions to the resort")}
${goodToKnow(r.stay_type)}
${rebookNote(true)}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `${r.payment_uploaded_at || r.payment_screenshot_path ? "Payment received — " : ""}Confirmed: ${fmtDate(r.check_in, "short")} · ${r.order_code}`, body: applyIntro(body, customOf(r, "confirmed"), r), c }),
  };
}

// ---------- cancelled / expired / payment proof rejected -----------------------
// All reply in the guest's existing thread (same subject as the quotation).

function unitsWord(r: Any) {
  return isOvernight(r) ? "casita(s)" : "cabana(s)";
}
function whenText(r: Any) {
  return isOvernight(r) ? stayRange(r) : fmtDate(r.check_in);
}

export function guestCancelledEmail(r: Any, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const paid = Number(r.amount_paid) || 0;
  const body = `${p(`Hi ${first},`)}
${p(`This is to let you know that your reservation <strong>${esc(r.order_code || "")}</strong> for ${isOvernight(r) ? "your overnight stay" : `your <strong>${esc(tripLabel(r))}</strong>`} on <strong>${esc(whenText(r))}</strong> has been <strong>cancelled</strong>.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    [isOvernight(r) ? "Stay" : "Date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in, "short"))],
    ["Status", esc(statusLabel(r))],
  ])}
${paid > 0.5 ? p(`We have a payment of <strong>${esc(peso(paid))}</strong> on record for this booking. Our reservations team will contact you in this same email thread about it, in line with the cancellation policy in your Reservations Agreement.`) : ""}
${p("If this is unexpected, or you'd like to rebook for another date, simply reply to this email and we'll be happy to help. You can also make a new booking any time on our website.")}
${button(PUBLIC_SITE, "Book again on our website")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Your reservation ${r.order_code} has been cancelled`, body: applyIntro(body, customOf(r, "cancelled"), r), c }),
  };
}

export function guestExpiredEmail(r: Any, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const units = unitsWord(r);
  const body = `${p(`Hi ${first},`)}
${p(`We didn't receive payment for your reservation <strong>${esc(r.order_code || "")}</strong> (${esc(whenText(r))}) by the payment deadline, so the booking has been cancelled and the hold on your ${units} released. ${isOvernight(r) ? "The dates and casita(s)" : "The date and cabana(s)"} may now be booked by other guests.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    [isOvernight(r) ? "Stay" : "Date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in, "short"))],
    ["Status", esc(statusLabel(r))],
  ])}
${p("<strong>Still planning to visit?</strong> You're welcome to book again on our website &mdash; we'll hold your new booking while you pay.")}
${button(PUBLIC_SITE, "Book again on our website")}
${p(`<strong>Already paid?</strong> Please reply to this email with your proof of payment (screenshot or transaction slip) attached, and our team will check it and get back to you as soon as possible.`, "margin-top:14px;")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Payment not received — ${r.order_code} has been released`, body: applyIntro(body, customOf(r, "expired"), r), c }),
  };
}

export function guestProofRejectedEmail(r: Any, c: ReturnType<typeof cfg>, reason: string, deadline: Date | null) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const need = docsNeeded(r);
  const body = `${p(`Hi ${first},`)}
${p(`Thank you for sending your proof of payment for <strong>${esc(r.order_code || "")}</strong>. Unfortunately, we couldn't verify it against our bank records.`)}
${reason ? p(`<strong>Reason:</strong> ${esc(reason)}`, `background:${C.warnBg};color:${C.warn};border-radius:8px;padding:10px 14px;font-size:14px;`) : ""}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    [isOvernight(r) ? "Stay" : "Date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in, "short"))],
    ...(deadline ? [["Please pay by", esc(fmtDateTime(deadline))] as [string, string]] : []),
  ])}
${p(`Please upload a clearer or the correct proof of payment &mdash; a screenshot or transaction slip that shows the amount, date, reference number and the receiving account (${esc(ACCOUNT_NAME)}) &mdash; using the button below, or simply reply to this email with it attached.`)}
${deadline ? p(`To keep your reservation, please send it by <strong>${esc(fmtDateTime(deadline))}</strong>. If we don't receive a valid payment by then, the booking will be cancelled and the ${unitsWord(r)} released.`) : ""}
${button(uploadUrl(r, c), need.any ? "Upload payment & documents" : "Upload proof of payment")}
${h2("Bank details")}${bankTable()}
${p(`Please put <strong>${esc(r.order_code)}</strong> and your name in the reference / remarks. If you have any questions, just reply to this email.`, "margin-top:12px;")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `We couldn't verify your payment for ${r.order_code} — please upload it again`, body: applyIntro(body, customOf(r, "proof_rejected"), r), c }),
  };
}

export type Change = { label: string; before: string; after: string };

export const CABANA_MOVED_NOTE =
  "Cabana numbers are subject to change due to privacy and group concerns — if we ever need to move your group, it'll be to a comparable cabana and we'll email you again. Everything else about your day trip stays the same.";

// v64: a change that raises the total of a booking already (part-)paid shows
// what's paid, the balance, and how to pay it.
function changeBalanceDue(r: Any, ps: PaySummary | null) {
  return ps && ps.balance_due ? fmtDate(ps.balance_due) : isOvernight(r) ? "" : "on or before your visit (" + fmtDate(r.check_in) + ")";
}
function changeBalanceRows(r: Any, ps: PaySummary | null): [string, string][] {
  if (!ps || !(ps.paid > 0) || ps.fully_paid || !(ps.balance > 0.5)) return [];
  const due = changeBalanceDue(r, ps);
  return [["Amount paid", `<strong>${esc(peso(ps.paid))}</strong>`], ["Balance due", `<strong>${esc(peso(ps.balance))}</strong>${due && ps.balance_due ? " by " + esc(fmtDate(ps.balance_due, "short")) : ""}`]];
}
function changeBalanceNote(r: Any, ps: PaySummary | null, c: ReturnType<typeof cfg>) {
  if (!ps || !(ps.paid > 0) || ps.fully_paid || !(ps.balance > 0.5)) return "";
  const due = changeBalanceDue(r, ps);
  return p(`Thank you for your payment of <strong>${esc(peso(ps.paid))}</strong>. With these changes, the remaining balance is <strong>${esc(peso(ps.balance))}</strong>${due ? `, due ${ps.balance_due ? "by " : ""}<strong>${esc(due)}</strong>` : ""}.${paysOnline(r) ? " You can pay it online with the button below." : " When you've paid it, upload the proof using the same link:"}`, `background:${C.tint};border-radius:8px;padding:10px 14px;font-size:14px;margin-top:12px;`) +
    `<p style="margin:0 0 16px;">${button(uploadUrl(r, c), paysOnline(r) ? "Pay balance now" : "Upload balance payment")}</p>`;
}
// v71: a change to a booking that's still unpaid (e.g. a corrected email
// address) carries the payment link, so the guest can pay from this email.
export function changeUnpaidNote(r: Any, ps: PaySummary | null, c: ReturnType<typeof cfg>, changes: Change[], deadline?: string | null) {
  if (!["pending", "pending_payment"].includes(String(r.status))) return "";
  if (ps && (ps.paid > 0 || ps.pending > 0)) return "";
  const total = Number(r.total_amount) || 0;
  if (!(total > 0)) return "";
  let dl: { date: Date | null; label: string } = { date: null, label: "" };
  if (deadline && Date.parse(deadline) > Date.now()) dl = paymentDeadline({ ...r, _deadline: deadline }, c.deadlineHours);
  else { const d = paymentDeadline(r, c.deadlineHours); if (d.date && d.date.getTime() > Date.now()) dl = d; }
  const emailFixed = changes.some((ch) => /e-?mail/i.test(ch.label));
  return p(`${emailFixed ? "Here is your payment link at your updated email address. " : ""}<strong>Your booking isn't paid yet.</strong> Please pay <strong>${esc(peso(total))}</strong>${dl.date ? ` by <strong>${esc(dl.label)}</strong>` : ""} to secure it.${paysOnline(r) ? " You can pay online with the button below." : " When you've paid, upload the proof using the button below."}`, `background:${C.tint};border-radius:8px;padding:10px 14px;font-size:14px;margin-top:12px;`) +
    `<p style="margin:0 0 16px;">${button(uploadUrl(r, c), paysOnline(r) ? "Pay now" : "Upload proof of payment")}</p>`;
}
export function guestChangedEmail(r: Any, cabanas: Any[], changes: Change[], c: ReturnType<typeof cfg>, threadRecord: Any, source = "", ps: PaySummary | null = null, deadline: string | null = null) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const td = `padding:8px 8px;border-bottom:1px solid ${C.line};font-size:13.5px;vertical-align:top;`;
  const rows = changes.map((ch) =>
    `<tr><td style="${td}color:${C.soft};width:28%;">${esc(ch.label)}</td><td style="${td}color:${C.soft};text-decoration:line-through;">${esc(ch.before || "—")}</td><td style="${td}font-weight:bold;color:${C.deep};">${esc(ch.after || "—")}</td></tr>`
  ).join("");
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr style="color:${C.soft};font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;"><td style="padding:6px 8px;">Detail</td><td style="padding:6px 8px;">Original</td><td style="padding:6px 8px;">Updated</td></tr>
${rows}</table>`;
  const body = `${p(`Hi ${first},`)}
${p(source === "cloudbeds"
    ? `Our reservations team has updated your booking <strong>${esc(r.order_code || "")}</strong>. Here ${changes.length === 1 ? "is the change" : "are the changes"}:`
    : `We've made the following ${changes.length === 1 ? "change" : "changes"} to your reservation <strong>${esc(r.order_code || "")}</strong>:`)}
${table}
${!isOvernight(r) && changes.some((ch) => /cabana no/i.test(ch.label)) ? p(esc(CABANA_MOVED_NOTE), `font-size:13.5px;color:${C.soft};margin-top:10px;`) : ""}
${h2("Your updated reservation")}${kv([
    ...reservationRows(r, cabanas),
    ...(r.total_amount !== null && r.total_amount !== undefined ? [["Total", `<strong>${esc(peso(Number(r.total_amount)))}</strong>`] as [string, string]] : []),
    ...changeBalanceRows(r, ps),
  ])}
${changeBalanceNote(r, ps, c)}${changeUnpaidNote(r, ps, c, changes, deadline)}
${p("If anything here doesn't look right, or you didn't ask for this change, simply reply to this email and we'll sort it out.", "margin-top:16px;")}
${signature(c)}`;
  return {
    // Same subject as the guest's existing thread (built from the ORIGINAL
    // date if the date itself changed), so it lands in that conversation.
    subject: "Re: " + guestSubject(threadRecord, c),
    html: shell({ preheader: `Updated: ${changes.map((ch) => ch.label).join(", ")} · ${r.order_code}`, body: applyIntro(body, customOf(r, "change"), r), c }),
  };
}

// ---------- overnight stays (casitas) ----------------------------------------
// Same look, threading and flow as the Day Trip emails. The bill comes from
// quote_overnight() in the database (booking-v8-villas.sql) — the very same
// calculation the website showed the guest and the dashboard uses.

// Display names for add-on slugs in reservation summaries (the price lines in
// the quotation come from the add_ons table via quote_overnight()).
const ADD_ON_NAMES: Record<string, string> = {
  massage_60: "Massage (60 min)", massage_90: "Massage (90 min)", massage_120: "Massage (120 min)",
  jetski_30: "Jet Ski (30 min)", jetski_60: "Jet Ski (1 hour)", banana_boat: "Banana Boat (15 min)",
  disco_ball: "Disco Ball (15 min)", flying_fish: "Flying Fish (15 min)", boat_snorkel: "Boat Ride & Snorkeling (2 hours)",
  boat_snorkel_cave: "Boat Ride, Snorkeling & Napayong Cave (2 hours)", atv_1: "ATV Solo (40 min)", atv_2: "ATV Double (40 min)",
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
  const companions = Array.isArray(r.companions) ? r.companions.length : 0;
  return companions + 1 >= party; // a party of one has no companions to list
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
    ["Booking ID", `<strong>${esc(r.order_code || "—")}</strong>`],
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
${li("<strong>Drivers, nannies &amp; bodyguards:</strong> ₱1,000 per night for quarters plus ₱825 per night for meals — please let us know in advance.")}
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
    : `Thank you for choosing Virgin Beach Resort! We've received your booking for an <strong>overnight stay</strong> from <strong>${esc(fmtDate(r.check_in))}</strong> to <strong>${esc(fmtDate(r.check_out))}</strong> and are holding ${casitaWord} for you.`)}
${p(dl.date
    ? (q ? securePara(r, q.total, dl, `casita${villas.length === 1 ? "" : "s"}`) : `<strong>Payment is required by ${esc(dl.label)}</strong> to secure the reservation.`)
    : `<strong>Payment is settled upon arrival at the resort.</strong>`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ...(q && dl.date ? secureRows(r, q.total, dl) : [["Amount due", q ? esc(peso(q.total)) : "To follow"] as [string, string], ["Please pay by", esc(dl.label)] as [string, string]]),
  ])}
${q && q.onlineDiscount ? p(`Your total already includes the <strong>${q.onlineDiscountRate ? esc(String(q.onlineDiscountRate)) + "% " : ""}Convenience Discount (${esc(peso(q.onlineDiscount))})</strong> for stays ${CONVENIENCE_RULE}.${payTerms(r, q.total).half ? " Please settle the balance the same way to keep it." : ""}`, `background:${C.tint};border-radius:8px;padding:10px 14px;font-size:14px;`) : ""}
${h2("Your reservation")}${kv(overnightRows(r, villas))}${cabanaNote(villas)}
${h2("Guest list")}${rosterTable(r)}
${q ? h2("Quotation") + quoteTable(q) + p("The full-board meal package (lunch, dinner and breakfast) is mandatory for every guest and is charged per guest, per night. Children 0–5 eat free.", `font-size:12.5px;color:${C.soft};margin-top:8px;`) : ""}
${h2("How to pay")}
${p(`<strong>Pay online</strong> &mdash; ${ONLINE_METHODS} &mdash; through our secure payment partner <strong>Xendit</strong>. Pay the full amount on the next page; your stay is confirmed as soon as the payment goes through.`)}
${button(payUrl, "Pay now")}
${h2("Next steps")}
<ol style="margin:0 0 12px;padding-left:20px;font-size:14px;">
<li style="margin:0 0 8px;"><strong>Pay online</strong> using the button above &mdash; you'll get your booking confirmation by email right after.</li>
${need.seniors ? `<li style="margin:0 0 8px;"><strong>Upload the Senior Citizen / PWD ID${int(r.senior_count) > 1 ? "s" : ""}</strong> on the same page — the 20% discount applies only with a valid ID. Please bring ${int(r.senior_count) > 1 ? "them" : "it"} on arrival too.</li>` : ""}
${need.pets ? `<li style="margin:0 0 8px;"><strong>Upload your pet${int(r.pet_count) > 1 ? "s'" : "'s"} vaccination card${int(r.pet_count) > 1 ? "s" : ""}</strong> and agree to the Pet Policy on the same page.</li>` : ""}
${int(r.pet_count) && !need.pets ? `<li style="margin:0 0 8px;"><strong>Bringing your pet${int(r.pet_count) > 1 ? "s" : ""}:</strong> please bring the vaccination card${int(r.pet_count) > 1 ? "s" : ""} you uploaded, a leash, food and water bowls. Pets stay only in the casita they're registered to.</li>` : ""}
<li style="margin:0 0 8px;"><strong>Reply with the signed Reservations Agreement</strong> (attached as a PDF — a photo of the signed last page is fine) and a photo of <strong>one (1) valid ID</strong> of the primary guest.</li>
</ol>
${need.any ? button(payUrl, "Upload documents") : ""}
<p style="margin:14px 0 0;padding:12px 14px;background:${C.sand};border-radius:8px;font-size:13px;color:${C.soft};">This is a quotation, not yet a confirmed booking. Your casita${villas.length === 1 ? " is" : "s are"} held until the payment deadline above and confirmed once your payment goes through. In the absence of a signed agreement, guests are not relieved of the resort rules, regulations and conditions.</p>
${overnightGoodToKnow()}
${cancellationTable()}
${p("<strong>Need to change your dates or guest list?</strong> Just reply to this email and we'll help.", `font-size:13.5px;color:${C.soft};margin-top:14px;`)}
${signature(c)}`;
  return {
    subject: guestSubject(r, c),
    html: shell({ preheader: `${r.order_code} · ${q ? (payTerms(r, q.total).half ? `50% (${peso(Math.ceil(q.total / 2))}) secures it · ` : peso(q.total) + " due · ") : ""}${stayRange(r)} · Pay online`, body: applyIntro(body, customOf(r, "quote"), r), c }),
  };
}

export function staffNewEmailOvernight(r: Any, villas: Any[], q: Quote | null, c: ReturnType<typeof cfg>, guestSent: { ok: boolean; error?: string; monitor?: string }, now = new Date()) {
  const d = daysUntil(r.check_in, now);
  const dl = paymentDeadline(r, c.deadlineHours);
  const flags: string[] = [];
  const flag = (t: string, tone: "warn" | "red" = "warn") =>
    flags.push(`<li style="margin:0 0 6px;color:${tone === "red" ? C.red : C.warn};">${t}</li>`);
  const mode = staffSentMode(r);
  if (!guestSent.ok && !guestSent.monitor && mode !== "none") flag(`<strong>Guest email FAILED to send</strong> (${esc(guestSent.error || "unknown error")}). Send the ${mode === "confirmed" ? "confirmation" : "quotation"} manually.`, "red");
  if (q?.mismatch && !r.cb_owned) flag(...mismatchFlag(r, q));
  if (!villas.length) flag(r.cb_owned ? "No casita assigned yet — assign one in Cloudbeds." : "No casita assigned — assign one in the dashboard before taking payment.", "red");
  if (d !== null && d <= 1) flag(`Arrival is <strong>${d <= 0 ? "today" : "tomorrow"}</strong> — call the guest now to arrange payment.`, "red");
  else if (d !== null && d <= 7) flag(`Arrival is in ${plural(d, "day")} — inside the 7-day non-refundable window. Follow up by phone.`, "red");
  else if (d !== null && d <= 14) flag(`Arrival is in ${plural(d, "day")} — inside the 14-day (50% forfeit) window.`);
  if (!r.cb_owned && !rosterComplete(r)) flag("Guest list is incomplete — ask the guest for every companion's full name and age (meals are per person).");
  if (int(r.extra_beds)) flag(`${plural(int(r.extra_beds), "extra floor mattress", "extra floor mattresses")} needed — tell Housekeeping.`);
  const needDocs = docsNeeded(r);
  if (needDocs.any && !r.cb_owned) flag(`Guest still has to upload ${[needDocs.seniors ? "Senior/PWD ID(s)" : "", needDocs.pets ? "pet vaccination card(s)" : ""].filter(Boolean).join(" and ")}.`);
  if (int(r.senior_count)) flag(`${plural(int(r.senior_count), "senior citizen/PWD", "senior citizens/PWDs")} — ${Array.isArray(r.senior_id_paths) && r.senior_id_paths.length ? plural(r.senior_id_paths.length, "ID photo") + " uploaded" : "no ID photo yet"}. Verify at check-in.`);
  if (int(r.pet_count)) flag(`${plural(int(r.pet_count), "pet")} — ${Array.isArray(r.pet_vaccination_paths) && r.pet_vaccination_paths.length ? "vaccination card(s) uploaded" : "NO vaccination card yet"}${r.pet_policy_agreed_at ? ", Pet Policy agreed online" : ""}.`);
  if (r.occasion) flag(`Occasion: <strong>${esc(label(r.occasion))}</strong> — consider a welcome touch.`);

  const tel = String(r.guest_phone || "").replace(/[^\d+]/g, "");
  const { dash, gmail } = staffLinks(r, c);
  const body = `${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Amount due", q ? esc(peso(q.total)) : "Quote needed"],
    ["Stay", esc(`${fmtDate(r.check_in, "short").replace(/^\w+, /, "")} · ${plural(nightsOf(r), "night")}`)],
    ["Status", esc(statusLabel(r))],
  ])}
${isStaffMade(r) && !guestSent.monitor ? p(`Added in the staff dashboard${r.booked_by ? ` by <strong>${esc(r.booked_by)}</strong>` : ""} (${esc(label(r.source))})${mode === "confirmed" ? " as an already-Confirmed booking — the guest was sent the confirmation email, not a quotation." : mode === "none" ? "." : " and sent to the guest as a quotation."}`) : ""}
${guestSent.monitor ? p(guestSent.monitor) : p(mode !== "quote" ? staffSentLine(r, mode, guestSent, now) : guestSent.ok
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
<li>The guest pays online through <strong>Xendit</strong>: the payment is recorded and posted to Cloudbeds, and the booking is confirmed automatically (Cloudbeds sends the confirmation).</li>
<li>Watch the guest thread (search the Booking ID) for the signed agreement and a valid ID. ID / pet-card uploads also alert this inbox.</li>
<li>No payment by ${esc(dl.label)}? The booking automatically turns <strong>Expired</strong> and the casita(s) are released.</li>
<li>Share the guest count with the kitchen (full board, ${plural(nightsOf(r), "night")}) and any extra mattress with Housekeeping once confirmed.</li>
</ol>
${button(dash, "Open in staff dashboard")}${button(gmail, "Find guest thread in Gmail")}`;
  return {
    subject: attentionPrefix(flags) + staffSubject(r, c),
    html: shell({ preheader: staffPreview(r, q, flags, c), body, c, internal: true }),
  };
}

export function guestConfirmedEmailOvernight(r: Any, villas: Any[], q: Quote | null, c: ReturnType<typeof cfg>, ps: PaySummary | null = null) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const map = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Virgin Beach Resort, Laiya, San Juan, Batangas");
  const body = `${p(`Hi ${first},`)}
${paidThanks(r, q, ps, c)}${p(`We are delighted to confirm your <strong>overnight stay</strong> at Virgin Beach Resort from <strong>${esc(fmtDate(r.check_in))}</strong> to <strong>${esc(fmtDate(r.check_out))}</strong>. We can't wait to welcome you.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Arrival", esc(fmtDate(r.check_in, "short"))],
    ["Status", esc(statusLabel({ ...r, status: "confirmed" }))],
  ], "ok")}
${h2("Your reservation")}${kv([
    ...overnightRows(r, villas).slice(1),
    ...paidRows(q, ps),
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
    html: shell({ preheader: `${r.payment_uploaded_at || r.payment_screenshot_path ? "Payment received — " : ""}Confirmed: ${stayRange(r)} · ${r.order_code}`, body: applyIntro(body, customOf(r, "confirmed"), r), c }),
  };
}

// ---------- balance reminders & paid in full (booking-v16) ----------------------
export function guestBalanceEmail(r: Any, ps: PaySummary, c: ReturnType<typeof cfg>, overdue: boolean) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const keep = isOvernight(r) && Number(r.online_discount) > 0
    ? p(`Please pay by bank or e-wallet transfer to keep your 5% Convenience Discount (for stays ${CONVENIENCE_RULE}).`, `font-size:13.5px;color:${C.soft};`)
    : "";
  const body = `${p(`Hi ${first},`)}
${p(overdue
    ? `Our records show the remaining balance for your reservation <strong>${esc(r.order_code)}</strong> was due on <strong>${esc(fmtDate(ps.balance_due))}</strong> and hasn't reached us yet. Please settle it as soon as possible, or reply to this email if you've already paid or need help &mdash; our team will get in touch.`
    : `A friendly reminder that the remaining balance for your ${isOvernight(r) ? "stay" : "visit"} on <strong>${esc(fmtDate(r.check_in))}</strong> is due by <strong>${esc(fmtDate(ps.balance_due))}</strong>.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Paid so far", esc(peso(ps.paid))],
    ["Balance", `<strong>${esc(peso(ps.balance))}</strong>`],
    ["Due by", esc(fmtDate(ps.balance_due, "short"))],
  ])}
${h2("How to pay")}
${paysOnline(r)
    ? `${p(`Pay online &mdash; ${ONLINE_METHODS} &mdash; through our secure payment partner <strong>Xendit</strong>.`)}
${button(uploadUrl(r, c), "Pay balance now")}`
    : `${p(`Bank or e-wallet transfer (InstaPay / PESONet &mdash; GCash and Maya can send to these accounts via InstaPay). Please put <strong>${esc(r.order_code)}</strong> and your name in the reference / remarks.`)}
${bankTable()}
${keep}
${p("Then upload your proof of payment &mdash; or simply reply to this email with it attached.")}
${button(uploadUrl(r, c), "Upload balance payment")}`}
${cancellationTable()}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `${overdue ? "Balance overdue" : "Balance due " + fmtDate(ps.balance_due, "short")} · ${peso(ps.balance)} · ${r.order_code}`, body, c }),
  };
}

export function staffBalanceOverdueEmail(r: Any, ps: PaySummary, c: ReturnType<typeof cfg>) {
  const { dash } = staffLinks(r, c);
  const body = `${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Balance", esc(peso(ps.balance))],
    ["Was due", esc(fmtDate(ps.balance_due, "short"))],
  ])}
${p(`<strong>${esc(r.guest_name)}</strong> has paid ${esc(peso(ps.paid))} of ${esc(peso(ps.total))} for ${isOvernight(r) ? "the stay" : "the visit"} on <strong>${esc(fmtDate(r.check_in))}</strong>; the balance was due ${esc(fmtDate(ps.balance_due))}. The guest has been sent a reminder.`)}
${p("Nothing has been cancelled. Please follow up with the guest, then decide: extend the deadline, record a payment received another way, or cancel under the cancellation policy (50% of the booking value is forfeited from 14 days before arrival).")}
<p style="margin-top:16px;">${button(dash, "Open in staff dashboard")}</p>`;
  return {
    subject: "Re: " + staffSubject(r, c),
    html: shell({ preheader: `Balance overdue for ${r.order_code} — please follow up`, body, c, internal: true }),
  };
}

export function guestPaidInFullEmail(r: Any, ps: PaySummary, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const body = `${p(`Hi ${first},`)}
${p(`Thank you &mdash; we've received your ${ps.last?.kind === "balance" ? "remaining balance" : "payment"}, and your reservation <strong>${esc(r.order_code)}</strong> is now <strong>fully paid</strong>.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    [isOvernight(r) ? "Stay" : "Date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in, "short"))],
    ["Paid", `<strong>${esc(peso(ps.paid))}</strong>`],
  ], "ok")}
${p(`We look forward to welcoming you! Please bring your booking confirmation and one (1) valid ID${isOvernight(r) ? " for every guest" : ""} on the day.`)}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Fully paid · ${r.order_code} · see you soon`, body, c }),
  };
}

// v34: receipt for one online (Xendit) payment — villa stays, whose
// confirmation itself comes from Cloudbeds.
const CHANNEL_NAMES: Record<string, string> = { GCASH: "GCash", PAYMAYA: "Maya", GRABPAY: "GrabPay", SHOPEEPAY: "ShopeePay", QRPH: "QR Ph" };
export function channelName(ch: unknown) {
  const k = String(ch || "").toUpperCase();
  if (!k) return "";
  if (CHANNEL_NAMES[k]) return CHANNEL_NAMES[k];
  if (/^DD_/.test(k)) return k.replace(/^DD_/, "").replace(/_.*/, "") + " online banking";
  return k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, " ");
}
export function guestPaymentReceivedEmail(r: Any, pay: Any, ps: PaySummary, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const ch = channelName(pay?.channel);
  const body = `${p(`Hi ${first},`)}
${p(`Thank you &mdash; we've received your <strong>${esc(KIND_WORDS[pay?.kind] || "payment")} of ${esc(peso(Number(pay?.amount) || 0))}</strong>${ch ? ` via ${esc(ch)}` : ""} for <strong>${esc(r.order_code)}</strong>.${ps.fully_paid ? " Your reservation is now <strong>fully paid</strong>." : " Your reservation is <strong>confirmed</strong>."}`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    [isOvernight(r) ? "Stay" : "Date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in, "short"))],
    ["Paid so far", `<strong>${esc(peso(ps.paid))}</strong>`],
    ...(ps.fully_paid ? [] : [["Balance", esc(peso(ps.balance))] as [string, string], ...(ps.balance_due ? [["Balance due by", esc(fmtDate(ps.balance_due, "short"))] as [string, string]] : [])]),
  ], "ok")}
${!ps.fully_paid && ps.balance > 0.5 ? p(`You can pay the remaining balance online any time before ${ps.balance_due ? esc(fmtDate(ps.balance_due)) : "your arrival"}:`) + `<p style="margin:0 0 16px;">${button(uploadUrl(r, c), "Pay balance now")}</p>` : ""}
${p(`Please keep this email as your payment acknowledgement. Your official receipt is issued by the resort${isOvernight(r) ? " at check-in" : ""}.`, `font-size:13.5px;color:${C.soft};`)}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Payment received · ${peso(Number(pay?.amount) || 0)} · ${r.order_code}`, body, c }),
  };
}

// v34: the booking was paid more than its total — staff refund it in Xendit.
export function staffOverpaidEmail(r: Any, ps: PaySummary | null, excess: number, payments: Any[], c: ReturnType<typeof cfg>) {
  const { dash } = staffLinks(r, c);
  const rows = payments.map((x: Any) => [`${esc(KIND_WORDS[x.kind] || "payment")} · ${esc(fmtDateTime(new Date(x.verified_at || x.created_at)))}`,
    `${esc(peso(Number(x.amount) || 0))} — ${esc(String(x.note || x.method || ""))}`] as [string, string]);
  const body = `${p(`<strong>${esc(r.order_code)}</strong> (${esc(r.guest_name || "")}) has been paid <strong>${esc(peso(excess))} more</strong> than its total of ${esc(peso(Number(r.total_amount) || 0))} through online payments.`)}
${p("This usually means the guest paid two payment pages. Please <strong>refund the extra amount in the Xendit dashboard</strong> (Transactions → the payment → Refund) and let the guest know.")}
${h2("Online payments on this booking")}${kv(rows)}
${ps ? p(`Paid in total: <strong>${esc(peso(ps.paid))}</strong>.`) : ""}
${button(dash, "Open in staff dashboard")}`;
  return {
    subject: `Refund needed — ${r.order_code} was paid ${peso(excess)} too much`,
    html: shell({ preheader: `Duplicate online payment on ${r.order_code}`, body, c, internal: true }),
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
  // The seniors' own share of the casita + their meals (computed in SQL).
  const vatExemptSales = oq.vat_exempt_sales !== undefined && oq.vat_exempt_sales !== null
    ? r2(Number(oq.vat_exempt_sales))
    : r2(lines.filter((l) => l.vatExempt).reduce((s, l) => s + l.amount, 0));
  const gross = Math.max(0, r2(total - vatExemptSales));
  const vatableSales = r2(gross / 1.17);
  const vat = r2(vatableSales * 0.12);
  const serviceCharge = r2(gross - vatableSales - vat);
  const onlineDiscount = r2(Number(oq.online_discount) || 0);
  return {
    cardTotal: onlineDiscount > 0 ? r2(total + onlineDiscount) : total, onlineDiscount,
    onlineDiscountRate: oq.online_discount_rate != null ? Math.round(Number(oq.online_discount_rate) * 10000) / 100 : undefined,
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
  if (!isOvernight(r)) return honorBooked(r, buildQuote(r, units));
  const res = await db("rpc/quote_booking_overnight", { method: "POST", body: JSON.stringify({ p_booking_id: r.id }) });
  if (!res.ok) { console.error("quote_booking_overnight", res.status, await res.text()); return null; }
  return honorBooked(r, quoteFromOvernight(r, await res.json()));
}

// v58: a booking's price is the one saved when it was made — what the pay page
// and Xendit charge. Emails re-price the booking from today's rate sheet to
// itemise it; if that gives a different total (rates or the senior rule changed
// since, or the party was changed outside the website), the guest still sees
// the booked total, with the gap as one line, and staff get a flag. Before
// this, the guest could be emailed one amount and asked to pay another.
export function honorBooked(r: Any, q: Quote | null): Quote | null {
  if (!q || !q.mismatch || r.cb_owned || r.stay_type === "corporate") return q;
  const booked = q.websiteTotal;
  if (booked === null || !(booked > 0)) return q;
  const diff = r2(booked - q.total);
  const lines = [...q.lines, { desc: "Adjustment to your booked price", rate: diff, qty: 1, amount: diff, vatExempt: false }];
  const total = r2(booked);
  const gross = Math.max(0, r2(total - q.vatExemptSales));
  const vatableSales = r2(gross / 1.17);
  const vat = r2(vatableSales * 0.12);
  return {
    ...q, lines, subtotal: total, total, vatableSales, vat, serviceCharge: r2(gross - vatableSales - vat),
    cardTotal: q.onlineDiscount ? r2(total + q.onlineDiscount) : total, rateSheetTotal: q.total,
  };
}
// Staff flag for honorBooked: a small gap is usually a rate change since the
// booking; a big one means the guest count / casitas / extras need a look.
export function mismatchFlag(r: Any, q: Quote): [string, "warn" | "red"] {
  const sheet = q.rateSheetTotal ?? q.total, booked = Number(q.websiteTotal) || 0, gap = r2(booked - sheet);
  const big = Math.abs(gap) > Math.max(500, booked * 0.03);
  const who = isStaffMade(r) ? "saved in the dashboard" : "booked on the website";
  return [`Price ${who}: <strong>${peso(booked)}</strong>; today's rate sheet gives <strong>${peso(sheet)}</strong> (${gap > 0 ? "+" : "−"}${peso(Math.abs(gap))}). ` +
    `Guest emails show the booked price. ` + (big
      ? "That's a big gap — check the guest count, casitas and extras against the booking before accepting payment."
      : "Usually a rate change since the booking — no action needed."), big ? "red" : "warn"];
}

async function paySummary(id: string): Promise<PaySummary | null> {
  const res = await db("rpc/booking_payment_summary", { method: "POST", body: JSON.stringify({ p_booking_id: id }) });
  if (!res.ok) { console.error("booking_payment_summary", res.status, await res.text()); return null; }
  return await res.json();
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

// Links back to our website in GUEST emails carry utm_* tags, so the site's
// own analytics (site_events) can tell which email brought the guest back.
export function tagLinks(html: string, kind: string) {
  const campaign = encodeURIComponent(kind.split(":")[0]);
  return html.replace(/href="(https:\/\/(?:www\.)?virginbeachresort\.com[^"]*)"/g, (_m, url: string) => {
    if (/[?&]utm_/.test(url)) return `href="${url}"`;
    const [base, hash] = url.split("#");
    const sep = base.includes("?") ? "&amp;" : "?";
    return `href="${base}${sep}utm_source=booking_email&amp;utm_medium=email&amp;utm_campaign=${campaign}${hash !== undefined ? "#" + hash : ""}"`;
  });
}

async function send(opts: {
  booking: Any; kind: string; to: string | string[]; subject: string; html: string;
  thread: "guest" | "staff"; first?: boolean; replyTo?: string; attachments?: Any[]; cc?: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const to = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
  const logId = await claim(opts.booking.id, opts.kind, opts.cc ? `${to} (cc ${opts.cc})` : to, opts.subject);
  if (!logId) return { ok: true, skipped: true };
  const root = msgId(opts.booking, opts.thread);
  const messageId = opts.first ? root : `<${opts.kind.replace(/[^a-z0-9]+/gi, ".")}.${Date.now()}.${root.slice(1)}`;
  try {
    const t = await smtp();
    await t.sendMail({
      from: opts.thread === "staff" ? `${staffSender(opts.kind, opts.booking)} <${MAILBOX}>` : FROM,
      to,
      ...(opts.cc ? { cc: opts.cc } : {}),
      // monitor copy: staff alerts only (new booking, proofs, overdue…), not the guest's copy
      ...(opts.thread === "staff" && monitorEmails().filter((m) => !to.includes(m)).length
        ? { bcc: monitorEmails().filter((m) => !to.includes(m)).join(", ") } : {}),
      replyTo: opts.replyTo || MAILBOX,
      subject: opts.subject,
      html: opts.thread === "guest" ? tagLinks(opts.html, opts.kind) : opts.html,
      text: htmlToText(opts.thread === "guest" ? tagLinks(opts.html, opts.kind) : opts.html),
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

// A new website villa booking takes Cloudbeds' confirmation number as its
// Booking ID (VBR-<number>, booking-v25) once it reaches Cloudbeds, which
// happens at the same moment as this email. Wait for it (up to ~24 s, inside
// the trigger's 30 s) so the quotation already carries the one final number;
// if Cloudbeds is slow it goes out with the temporary code, which keeps working.
async function waitForCloudbeds(r: Any): Promise<Any> {
  if (!isOvernight(r) || !r.cb_ref_code || r.cb_reservation_id || !r.id) return r;
  try {
    const st = await db(`cb_sync_state?key=eq.push_enabled&select=value`);
    const on = st.ok ? (await st.json())?.[0]?.value === true : false;
    if (!on) return r;
    for (let i = 0; i < 8; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const fresh = await loadBooking(String(r.id));
      if (!fresh) break;
      if (fresh.cb_reservation_id || fresh.cb_push_state === "error") return { ...r, ...fresh };
    }
  } catch { /* send with the temporary code */ }
  return r;
}

async function onInsert(r0: Any) {
  const c = cfg();
  if (!autoEmail(r0, c)) return await onInsertMonitor(r0, c);
  const r = await waitForCloudbeds(r0);
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  const mode = staffSentMode(r);
  let guest: Any = { ok: false, error: "no guest email on booking" };
  let confirmed: Any = undefined;
  if (mode === "none") {
    // Already Cancelled when staff sent it: nothing goes to the guest.
    guest = { ok: false, skipped: true, error: "booking is " + statusLabel(r) };
  } else if (mode === "confirmed") {
    // Staff took payment before sending: the guest gets the confirmation,
    // not a quotation asking them to pay.
    confirmed = await onConfirmed(r);
    guest = confirmed && "ok" in confirmed ? confirmed : { ok: false, error: String(confirmed?.skipped || "not sent") };
  } else if (r.guest_email) {
    const g = guestQuoteEmail(r, cabanas, q, c);
    guest = await send({
      booking: r, kind: "guest_quote", to: r.guest_email, subject: g.subject, html: g.html,
      thread: "guest", first: true, attachments: q ? await agreementAttachment() : [],
    });
  }
  const s = staffNewEmail(r, cabanas, q, c, guest);
  const to = r.stay_type === "corporate" ? [...c.staffEmails, EVENTS_EMAIL] : c.staffEmails;
  const staff = await send({ booking: r, kind: "staff_new", to, subject: s.subject, html: s.html, thread: "staff", first: true });
  return mode === "confirmed" ? { confirmed, staff } : { guest, staff };
}

// v51: a booking REQUEST (status "inquiry") for dates past the online booking
// window. Nothing is held or charged and it never goes to Cloudbeds, so the
// guest gets a "request received — subject to review" note (no quotation, no
// payment button) and staff get an alert to review it.
export function guestInquiryEmail(r: Any, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const guests = (Number(r.adults) || 0) + (Number(r.children_6_12) || 0) + (Number(r.children_0_5) || 0);
  const body = `${p(`Hi ${first},`)}
${p(`Thank you for your interest in Virgin Beach Resort! We've received your <strong>booking request</strong> for <strong>${esc(stayRange(r))}</strong>${guests ? ` for ${guests} guest${guests === 1 ? "" : "s"}` : ""}. It's now <strong>under review</strong> by our reservations team.`)}
<div style="margin:16px 0;">${kv([
    ["Stay", esc(stayRange(r))],
    ["Casitas requested", esc(r.room_name || "—")],
    ["Estimated total", `<strong>${esc(peso(Number(r.total_amount) || 0))}</strong> <span style="color:#6b6559;">at 2026 rates</span>`],
    ["Status", "<strong>Inquiry &mdash; not yet booked</strong>"],
  ])}</div>
${p(`<strong>Please note: this is an inquiry only, not a confirmed reservation.</strong> No casita has been reserved for you yet and nothing has been charged.`)}
${p(`The estimated total above uses our <strong>2026 rates</strong> as a guide. <strong>2027 rates are subject to change</strong>, so your final price may be different.`)}
${p("Our reservations team will review your request and reply to this email to confirm availability and the final rate. Please don't send any payment until we've confirmed your booking.")}
${signature(c)}`;
  return {
    subject: `Booking request received — ${stayRange(r)} — Virgin Beach Resort`,
    html: shell({ preheader: "We've received your booking request — it's subject to review, nothing has been charged", body, c }),
  };
}

function staffInquiryEmail(r: Any, c: ReturnType<typeof cfg>, guest: Any) {
  const links = staffLinks(r, c);
  const guests = (Number(r.adults) || 0) + (Number(r.children_6_12) || 0) + (Number(r.children_0_5) || 0);
  const body = `${p(`<strong>New booking REQUEST from the website &mdash; not a reservation.</strong> No casita is held, nothing was sent to Cloudbeds and no payment was asked for.`)}
<div style="margin:16px 0;">${kv([
    ["Reference", esc(r.order_code || "—")],
    ["Guest", esc(r.guest_name || "—")],
    ["Email", r.guest_email ? `<a href="mailto:${esc(r.guest_email)}">${esc(r.guest_email)}</a>` : "—"],
    ["Mobile", esc(r.guest_phone || "—")],
    ["Stay", esc(stayRange(r))],
    ["Casitas requested", esc(r.room_name || "—")],
    ["Guests", esc(`${guests} (${r.adults || 0} adult${Number(r.adults) === 1 ? "" : "s"}${Number(r.senior_count) ? `, ${r.senior_count} senior/PWD` : ""}${Number(r.children_6_12) ? `, ${r.children_6_12} child 6–12` : ""}${Number(r.children_0_5) ? `, ${r.children_0_5} child 0–5` : ""})`)],
    ["Names", esc(r.guest_names || "—")],
    ["Estimate shown", `${esc(peso(Number(r.total_amount) || 0))} at 2026 rates (guest told 2027 rates are subject to change)`],
    ["Notes", esc(r.notes || "—")],
    ["Guest email", guest?.ok ? "Request-received note sent" : esc(String(guest?.error || "not sent"))],
  ])}</div>
${p("Check availability and the 2027 rate in Cloudbeds, then reply to the guest (replying to this email goes to them). If they go ahead, create the booking in the dashboard or Cloudbeds; otherwise set this request to Cancelled (no email is sent to the guest for a request).")}
${button(links.dash, "Open in staff dashboard")}${button(links.gmail, "Find guest emails in Gmail")}`;
  const est = Number(r.total_amount) || 0;
  return {
    subject: staffSubject(r, c),
    html: shell({
      preheader: [est ? `Est. ${pesoShort(est)} at 2026 rates` : "", "Not held — needs a reply", r.guest_phone || "", r.guest_email || "",
        r.notes ? `Notes: ${String(r.notes).slice(0, 80)}` : ""].filter(Boolean).join(" · "),
      body, c, internal: true,
    }),
  };
}

async function onInquiry(r: Any) {
  const c = cfg();
  let guest: Any = { ok: false, error: "no guest email on request" };
  if (r.guest_email) {
    const g = guestInquiryEmail(r, c);
    guest = await send({ booking: r, kind: "guest_inquiry", to: r.guest_email, subject: g.subject, html: g.html, thread: "guest", first: true });
  }
  const s = staffInquiryEmail(r, c, guest);
  const staff = await send({ booking: r, kind: "staff_inquiry", to: c.staffEmails, subject: s.subject, html: s.html, thread: "staff", first: true, replyTo: r.guest_email || undefined });
  return { guest, staff };
}

// Every other NEW booking — made in Cloudbeds (OTAs, walk-ins) or added by
// staff without emailing the guest — still gets the same staff alert, sent
// only to the monitor address(es). Sheet imports and old/past stays (e.g. a
// Cloudbeds re-sync) are left out so a bulk load never floods the inbox.
async function onInsertMonitor(r: Any, c: ReturnType<typeof cfg>) {
  const to = monitorEmails();
  if (!to.length) return { skipped: "no monitor address" };
  if (r.source === "sheet_import") return { skipped: "sheet import" };
  const made = new Date(r.created_at || Date.now()).getTime();
  if (Date.now() - made > 48 * 3600e3) return { skipped: "older booking (sync)" };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  if ((r.check_out || r.check_in || today) < today) return { skipped: "past stay" };
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  const where = r.cb_owned
    ? `Made in <strong>Cloudbeds</strong>${r.cb_info?.source || r.source ? ` (${esc(String(r.cb_info?.source || label(r.source)))})` : ""} — Cloudbeds emails the guest; nothing was sent from the website.`
    : `Added in the staff dashboard${r.booked_by ? ` by <strong>${esc(r.booked_by)}</strong>` : ""} (${esc(label(r.source))}) — not emailed to the guest (handled by staff).`;
  const s = staffNewEmail(r, cabanas, q, c, { ok: true, monitor: where });
  return await send({ booking: r, kind: "staff_new_monitor", to, subject: s.subject, html: s.html, thread: "staff", first: true });
}

// Staff-added bookings (phone, Messenger, email, walk-in) are handled by hand
// unless staff ticked "Send this booking to the guest" (email_guest) — then
// they get exactly the same emails as a website booking.
function autoEmail(r: Any, c: ReturnType<typeof cfg>) {
  return c.autoSources.includes(String(r.source || "website")) || r.email_guest === true;
}

// v21: a website villa booking that's now a Cloudbeds reservation follows
// Cloudbeds' own emails (Confirmed, Cancelled, its schedules). The website
// sends only the quotation and the "payment proof received" acknowledgement;
// staff alerts still come from here.
export const inCloudbeds = (r: Any) => !!r?.cb_reservation_id && !r?.cb_owned;
const CB_SKIP = { skipped: "in Cloudbeds — Cloudbeds emails the guest" };

async function onProof(r: Any) {
  const c = cfg();
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  if (String(r.payment_screenshot_path || "").startsWith("staff/")) return { skipped: "uploaded by staff" };
  const ps = await paySummary(r.id);
  // A confirmed booking only gets these for a new (balance) upload waiting to be verified.
  if (r.status === "confirmed" && !(ps?.last && ps.last.status === "pending")) return { skipped: "already confirmed" };
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  const att = await proofAttachment(r.payment_screenshot_path);
  const s = staffProofEmail(r, q, c, att.length > 0, new Date(), ps);
  const stamp = String(r.payment_uploaded_at || Date.now());
  const staff = await send({ booking: r, kind: `proof_staff:${stamp}`, to: [...c.staffEmails, ...c.proofCc], subject: s.subject, html: s.html, thread: "staff", attachments: att });
  let guest = null;
  // the "we received your payment proof" acknowledgement goes to every guest,
  // including villas in Cloudbeds (Cloudbeds has no such email)
  if (r.guest_email) {
    const g = guestProofEmail(r, c, ps);
    guest = await send({ booking: r, kind: `proof_guest:${stamp}`, to: r.guest_email, subject: g.subject, html: g.html, thread: "guest" });
  }
  return { staff, guest };
}

export function staffDocsEmail(r: Any, seniorIds: number, petCards: number, c: ReturnType<typeof cfg>, hasAttachment: boolean) {
  const { dash } = staffLinks(r, c);
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
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
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
  if (inCloudbeds(r)) return CB_SKIP;
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  if (r.cb_owned === true) return { skipped: "made in Cloudbeds" };
  if (!r.guest_email) return { skipped: "no guest email" };
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  const ps = await paySummary(r.id);
  const g = guestConfirmedEmail(r, cabanas, q, c, ps);
  return await send({ booking: r, kind: "guest_confirmed", to: r.guest_email, subject: g.subject, html: g.html, thread: "guest" });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function onBalance(r: Any, overdue: boolean) {
  const c = cfg();
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  const ps = await paySummary(r.id);
  if (!ps || ps.fully_paid || !(ps.balance > 0.5)) return { skipped: "nothing outstanding" };
  const out: Record<string, unknown> = {};
  // villas paying online get the reminder too (Cloudbeds doesn't send one with a pay button)
  if (r.guest_email && EMAIL_RE.test(String(r.guest_email).trim()) && (!inCloudbeds(r) || paysOnline(r))) {
    const g = guestBalanceEmail(r, ps, c, overdue);
    out.guest = await send({ booking: r, kind: overdue ? "balance_overdue_guest" : "balance_due", to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
  }
  if (overdue) {
    const s = staffBalanceOverdueEmail(r, ps, c);
    out.staff = await send({ booking: r, kind: "balance_overdue_staff", to: c.staffEmails, subject: s.subject, html: s.html, thread: "staff" });
  }
  return out;
}

async function onPaidInFull(r: Any) {
  const c = cfg();
  if (inCloudbeds(r)) return CB_SKIP;
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  if (r.status === "completed") return { skipped: "already completed" };
  if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
  const ps = await paySummary(r.id);
  if (!ps || !ps.fully_paid) return { skipped: "not fully paid" };
  const g = guestPaidInFullEmail(r, ps, c);
  return await send({ booking: r, kind: "paid_in_full", to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
}

async function onPaymentReceived(r: Any, payload: Any) {
  const c = cfg();
  // Day trips get the website's confirmation / paid-in-full emails; villa stays
  // (confirmed through Cloudbeds) get this receipt for each online payment.
  if (!inCloudbeds(r)) return { skipped: "not a villa in Cloudbeds — confirmation emails cover it" };
  if (r.cb_owned === true) return { skipped: "made in Cloudbeds" };
  if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
  const pid = String(payload.payment_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(pid)) return { skipped: "no payment id" };
  const res = await db(`booking_payments?id=eq.${pid}&booking_id=eq.${encodeURIComponent(r.id)}&select=kind,amount,note,method`);
  const pay = res.ok ? (await res.json())[0] : null;
  if (!pay) return { skipped: "payment not found" };
  const inv = await db(`xendit_invoices?payment_id=eq.${pid}&select=payment_channel`);
  const chan = inv.ok ? (await inv.json())[0]?.payment_channel : null;
  const ps = await paySummary(r.id);
  if (!ps) return { skipped: "no payment summary" };
  const g = guestPaymentReceivedEmail(r, { ...pay, channel: chan }, ps, c);
  return await send({ booking: r, kind: `payment_received:${pid}`, to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
}

async function onOverpaid(r: Any, payload: Any) {
  const c = cfg();
  const pid = String(payload.payment_id || "");
  const res = await db(`booking_payments?booking_id=eq.${encodeURIComponent(r.id)}&method=eq.xendit&status=eq.verified&select=kind,amount,note,method,verified_at,created_at&order=created_at`);
  const payments = res.ok ? await res.json() : [];
  const ps = await paySummary(r.id);
  const excess = Number(payload.excess) || (ps ? Math.max(0, ps.paid - (Number(r.total_amount) || 0)) : 0);
  const s = staffOverpaidEmail(r, ps, excess, payments, c);
  return await send({ booking: r, kind: `overpaid:${pid || Date.now()}`, to: c.staffEmails, subject: s.subject, html: s.html, thread: "staff" });
}

// Shared gate for the guest-only notices below: auto-email source (or staff
// ticked "send to guest"), not a Cloudbeds-made booking, valid guest email.
function guestGate(r: Any, c: ReturnType<typeof cfg>): { skipped: string } | null {
  if (!autoEmail(r, c)) return { skipped: "source " + r.source };
  if (r.cb_owned === true) return { skipped: "made in Cloudbeds" };
  if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
  return null;
}

async function onCancelled(r: Any) {
  const c = cfg();
  // v67: staff "Cancel booking…" (staff_cancel_booking) on ANY booking — villas and day trips,
  // website, staff or Cloudbeds-made: the website's cancellation email, opening with the
  // staff's message, only if they ticked "Email the guest" (email_custom.cancelled.skip = false).
  // Cloudbeds' own email is off for these (cancel_notify = false), so the guest gets one email.
  const staffCx = r.cancelled_at && Date.now() - Date.parse(String(r.cancelled_at)) < 30 * 60_000 ? customOf(r, "cancelled") : null;
  if (staffCx) {
    if (staffCx.skip) return { skipped: "staff chose not to email the guest" };
    if (r.status !== "declined") return { skipped: "no longer cancelled" };
    if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
    const g = guestCancelledEmail(r, c);
    return await send({ booking: r, kind: "guest_cancelled", to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
  }
  if (inCloudbeds(r)) return CB_SKIP;
  const skip = guestGate(r, c);
  if (skip) return skip;
  if (r.status !== "declined") return { skipped: "no longer cancelled" };
  if (r.cb_info?.status === "no_show") return { skipped: "no-show" };
  const g = guestCancelledEmail(r, c);
  return await send({ booking: r, kind: "guest_cancelled", to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
}

// v45: payment-deadline options, set by staff in the dashboard (booking_settings)
type DeadlineSettings = { auto_expire: boolean; expiry_email_all: boolean; pay_reminder_hours: number; daytrip_reminder_hours: number; expiry_staff_alert: boolean };
async function deadlineSettings(): Promise<DeadlineSettings> {
  const d: DeadlineSettings = { auto_expire: true, expiry_email_all: true, pay_reminder_hours: 6, daytrip_reminder_hours: 4, expiry_staff_alert: true };
  try {
    const c = cfg();
    const res = await fetch(`${c.supabaseUrl}/rest/v1/booking_settings?id=eq.1&select=*`, { headers: { apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}` } });
    const row = (await res.json())?.[0] || {};
    for (const k of Object.keys(d) as (keyof DeadlineSettings)[]) if (row[k] !== undefined && row[k] !== null) (d as Any)[k] = row[k];
  } catch (_) { /* defaults */ }
  return d;
}
// with "email every guest" on, staff-entered bookings and website villas already in Cloudbeds are included
function deadlineGate(r: Any, c: ReturnType<typeof cfg>, all: boolean): { skipped: string } | null {
  if (r.cb_owned === true) return { skipped: "made in Cloudbeds" };
  if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
  if (!all) { if (inCloudbeds(r)) return CB_SKIP; return guestGate(r, c); }
  return null;
}
const dueFrom = (r: Any) => ({ ...r, created_at: r.pay_deadline_from || r.created_at });

export function guestPayReminderEmail(r: Any, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const dl = finalDeadline(dueFrom(r));
  const body = `${p(`Hi ${first},`)}
${p(`A friendly reminder: we're still holding ${isOvernight(r) ? "your casita(s)" : "your cabana(s)"} for reservation <strong>${esc(r.order_code || "")}</strong>, but we haven't received a payment yet. Please pay <strong>by ${esc(dl.label)}</strong>${isOvernight(r) ? " &mdash; after that the booking is cancelled automatically and the casita(s) released to other guests." : " to secure your cabana(s). Unpaid day trips can be released to other guests on the day."}`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    [isOvernight(r) ? "Stay" : "Date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in, "short"))],
    ["Total", esc(peso(r.total_amount))],
    ["Pay by", `<strong>${esc(dl.label)}</strong>`],
  ])}
${button(uploadUrl(r, c), "Pay now or upload your proof")}
${p("Already paid by GCash or bank transfer? Upload the screenshot on the same page, or reply to this email with it attached, and we'll keep your booking.", "margin-top:14px;")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Payment reminder — please pay by ${dl.label} to keep ${r.order_code}`, body, c }),
  };
}

// v48: villa booked 14 days or less before arrival, not fully paid 24 h after booking
export function guestFullPayReminderEmail(r: Any, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const owe = Math.max(0, (Number(r.total_amount) || 0) - (Number(r.amount_paid) || 0));
  const part = Number(r.amount_paid) > 0;
  const body = `${p(`Hi ${first},`)}
${p(`Thank you for booking with us! As your stay <strong>${esc(r.order_code || "")}</strong> is less than ${BALANCE_DAYS} days away, <strong>full payment</strong> is needed to secure your casita(s). ${part ? `We've received ${esc(peso(r.amount_paid))} so far.` : "We haven't received a payment yet."}`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Stay", esc(stayRange(r))],
    [part ? "Balance" : "To pay", `<strong>${esc(peso(owe))}</strong>`],
  ])}
${button(uploadUrl(r, c), "Pay now or upload your proof")}
${p("Please complete your payment as soon as you can &mdash; unpaid bookings may be cancelled by our reservations team and the casita released to other guests. Already paid by GCash or bank transfer? Upload the screenshot on the same page or reply with it attached.", "margin-top:14px;")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Full payment needed to secure ${r.order_code}`, body, c }),
  };
}

// v47: 8:00 AM on the trip day — day-trip guests who still owe something
export function guestArrivalNoticeEmail(r: Any, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const owe = Math.max(0, (Number(r.total_amount) || 0) - (Number(r.amount_paid) || 0));
  const unpaid = !(Number(r.amount_paid) > 0);
  const body = `${p(`Good morning ${first}!`)}
${p(`We're expecting you <strong>today</strong> for your day trip <strong>${esc(r.order_code || "")}</strong>. ${unpaid ? "We haven't received a payment for this booking yet" : "There's still a balance on this booking"} &mdash; you can pay online now, or settle it at the front desk when you arrive.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Date", esc(fmtDate(r.check_in, "short"))],
    [unpaid ? "To pay" : "Balance", `<strong>${esc(peso(owe))}</strong>`],
  ])}
${button(uploadUrl(r, c), "Pay now online")}
${unpaid ? p(`<strong>Not able to make it?</strong> Please reply to let us know. If you don't arrive and the booking is still unpaid by <strong>5:00 PM today</strong>, it will be cancelled and your cabana(s) may be released to other guests.`, "margin-top:14px;") : p(`<strong>Not able to make it?</strong> Please reply to let us know.`, "margin-top:14px;")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `We're expecting you today — ${r.order_code}`, body, c }),
  };
}

// v47: 5:00 PM on the trip day — still unpaid / balance not recorded
export function guestTripDayClosedEmail(r: Any, c: ReturnType<typeof cfg>) {
  const first = esc(String(r.guest_name || "there").trim().split(/\s+/)[0]);
  const paid = Number(r.amount_paid) > 0;
  const body = `${p(`Hi ${first},`)}
${p(`As we didn't see you today and the booking was ${paid ? "not fully paid" : "unpaid"} by 5:00 PM, your day trip <strong>${esc(r.order_code || "")}</strong> (${esc(fmtDate(r.check_in))}) has been cancelled and the cabana(s) released.`)}
${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    ["Date", esc(fmtDate(r.check_in, "short"))],
    ["Status", "Cancelled"],
  ])}
${paid ? p("Your down payment follows our cancellation policy &mdash; reply to this email and our team will help you rebook.") : ""}
${p("<strong>Did you visit or already pay?</strong> Please reply with your proof of payment and we'll correct this right away.")}
${button(PUBLIC_SITE, "Book another day")}
${signature(c)}`;
  return {
    subject: "Re: " + guestSubject(r, c),
    html: shell({ preheader: `Your day trip ${r.order_code} has been cancelled`, body, c }),
  };
}

export function staffExpiredEmail(r: Any, c: ReturnType<typeof cfg>, guestNote: string) {
  const { dash } = staffLinks(r, c);
  const body = `${statusBox([
    ["Booking ID", esc(r.order_code || "—")],
    [isOvernight(r) ? "Stay" : "Date", esc(isOvernight(r) ? stayRange(r) : fmtDate(r.check_in, "short"))],
    ["Total", esc(peso(r.total_amount))],
  ])}
${p(`<strong>${esc(r.guest_name)}</strong>'s booking was <strong>cancelled automatically</strong> &mdash; no payment by the deadline. ${isOvernight(r) ? "The casita(s) are" : "The cabana(s) are"} free again.`)}
${p(esc(guestNote))}
${p("If the guest paid another way, record the payment in the dashboard and set the status back to Confirmed.")}
<p style="margin-top:16px;">${button(dash, "Open in staff dashboard")}</p>`;
  return {
    subject: "Re: " + staffSubject(r, c),
    html: shell({ preheader: `Auto-cancelled — no payment for ${r.order_code}`, body, c, internal: true }),
  };
}

async function onExpired(r: Any) {
  const c = cfg();
  const s = await deadlineSettings();
  const out: Record<string, unknown> = {};
  if (r.status !== "expired") return { skipped: "no longer expired" };
  // v46: part-paid day trip closed at 5 PM on the trip day — staff only (the guest may be at the resort)
  const tripDay = r.expire_reason === "trip_day_unpaid" || r.expire_reason === "balance_unpaid";
  // v48: cancelled by staff from the dashboard ("Cancel booking — not paid")
  if (r.expire_reason === "manual_unpaid") {
    if (customOf(r, "expired")?.skip) return { skipped: "staff chose not to email the guest" };
    const ms = deadlineGate(r, c, true);
    if (ms) return ms;
    const g = guestExpiredEmail(r, c);
    return { guest: await send({ booking: r, kind: "guest_expired", to: String(r.guest_email).trim(), cc: MAILBOX, subject: g.subject, html: g.html, thread: "guest" }) };
  }
  const skip = deadlineGate(r, c, s.expiry_email_all);
  if (!skip) {
    const g = tripDay ? guestTripDayClosedEmail(r, c) : guestExpiredEmail(r, c);
    // v46: reservations@ gets a copy of the guest's cancellation email
    out.guest = await send({ booking: r, kind: "guest_expired", to: String(r.guest_email).trim(), cc: s.expiry_staff_alert ? MAILBOX : undefined, subject: g.subject, html: g.html, thread: "guest" });
  } else out.guest = skip;
  if (s.expiry_staff_alert && !r.cb_owned && skip) {
    const m = staffExpiredEmail(r, c, `The guest was not emailed (${skip.skipped}).`);
    out.staff = await send({ booking: r, kind: "staff_expired", to: c.staffEmails, subject: m.subject, html: m.html, thread: "staff" });
  }
  return out;
}

async function onFullPayReminder(r: Any) {
  const c = cfg();
  const s = await deadlineSettings();
  if (!isOvernight(r)) return { skipped: "not a villa" };
  if (!["confirmed", "pending", "pending_payment"].includes(r.status)) return { skipped: "status " + r.status };
  if (!((Number(r.total_amount) || 0) - (Number(r.amount_paid) || 0) > 0.5)) return { skipped: "paid" };
  const skip = deadlineGate(r, c, s.expiry_email_all);
  if (skip) return skip;
  const g = guestFullPayReminderEmail(r, c);
  return await send({ booking: r, kind: "full_pay_reminder", to: String(r.guest_email).trim(), cc: s.expiry_staff_alert ? MAILBOX : undefined, subject: g.subject, html: g.html, thread: "guest" });
}

async function onArrivalNotice(r: Any) {
  const c = cfg();
  const s = await deadlineSettings();
  if (isOvernight(r)) return { skipped: "villa" };
  if (!["confirmed", "pending", "pending_payment"].includes(r.status)) return { skipped: "status " + r.status };
  if (!((Number(r.total_amount) || 0) - (Number(r.amount_paid) || 0) > 0.5)) return { skipped: "paid" };
  const skip = deadlineGate(r, c, s.expiry_email_all);
  if (skip) return skip;
  const g = guestArrivalNoticeEmail(r, c);
  return await send({ booking: r, kind: "arrival_notice", to: String(r.guest_email).trim(), cc: s.expiry_staff_alert ? MAILBOX : undefined, subject: g.subject, html: g.html, thread: "guest" });
}

async function onPayReminder(r: Any) {
  const c = cfg();
  const s = await deadlineSettings();
  if (!((isOvernight(r) ? s.pay_reminder_hours : s.daytrip_reminder_hours) > 0)) return { skipped: "reminders off" };
  if (!["pending", "pending_payment"].includes(r.status)) return { skipped: "not pending" };
  const skip = deadlineGate(r, c, s.expiry_email_all);
  if (skip) return skip;
  const g = guestPayReminderEmail(r, c);
  return await send({ booking: r, kind: "pay_reminder", to: String(r.guest_email).trim(), cc: s.expiry_staff_alert ? MAILBOX : undefined, subject: g.subject, html: g.html, thread: "guest" });
}

// PROOF_REJECTED: { record: {id}, payment_id, reason?, deadline? (ISO) }
async function onProofRejected(r: Any, payload: Any) {
  const c = cfg();
  if (inCloudbeds(r)) return CB_SKIP;
  const skip = guestGate(r, c);
  if (skip) return skip;
  if (!payload.payment_id) return { skipped: "no payment_id" };
  const reason = String(payload.reason ?? "").trim().slice(0, 500);
  const dl = payload.deadline ? new Date(String(payload.deadline)) : null;
  const deadline = dl && !isNaN(dl.getTime()) ? dl : null;
  const g = guestProofRejectedEmail(r, c, reason, deadline);
  return await send({ booking: r, kind: `proof_rejected:${String(payload.payment_id)}`, to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
}

async function onChanged(r: Any, payload: Any) {
  const c = cfg();
  if (inCloudbeds(r)) return CB_SKIP;
  // cabana numbers are internal unless ticked for guest emails (v33)
  const raw = (Array.isArray(payload.changes) ? payload.changes.slice(0, 30) : [])
    .filter((x: Any) => r.email_cabana_numbers === true || !/cabana no/i.test(String(x?.label ?? "")));
  if (!raw.length) return { skipped: "only internal cabana-number changes" };
  // A day-trip cabana change is always emailed (v28), whoever made the booking.
  const cabanaMove = !isOvernight(r) && raw.some((x: Any) => /cabana no/i.test(String(x?.label ?? "")));
  if (!cabanaMove && !autoEmail(r, c)) return { skipped: "source " + r.source };
  if (r.cb_owned === true) return { skipped: "made in Cloudbeds" };
  if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
  const changes: Change[] = raw
    .map((x: Any) => ({ label: String(x?.label ?? "").slice(0, 80), before: String(x?.before ?? "").slice(0, 300), after: String(x?.after ?? "").slice(0, 300) }))
    .filter((x: Change) => x.label);
  if (!changes.length) return { skipped: "no changes" };
  const cabanas = await loadUnits(r);
  const threadRecord = { ...r, check_in: payload.old_check_in || r.check_in };
  const custom = payload.message ? { message: String(payload.message).slice(0, 5000) } : null;
  const rc = custom ? { ...r, email_custom: { ...(r.email_custom || {}), change: custom } } : r;
  const ps = await paySummary(r.id);
  const g = guestChangedEmail(rc, cabanas, changes, c, threadRecord, String(payload.source || ""), ps, payload.deadline ? String(payload.deadline) : null);
  const kind = `guest_changed:${String(payload.change_id || Date.now())}`;
  return await send({ booking: r, kind, to: String(r.guest_email).trim(), subject: g.subject, html: g.html, thread: "guest" });
}

// v71: staff "Send payment link" — the quotation with the Pay now button again,
// to the email that's on the booking NOW (e.g. after a typo was corrected).
// Only for bookings still waiting for payment with nothing paid. The deadline
// shown is when the booking really closes (from booking_auto_cancel, sent by
// staff_resend_payment_link); past it, the trip/arrival morning.
async function onResendQuote(r: Any, payload: Any) {
  const c = cfg();
  if (!["pending", "pending_payment"].includes(String(r.status))) return { skipped: "booking is " + statusLabel(r) };
  if (r.cb_owned === true) return { skipped: "made in Cloudbeds" };
  if (!r.guest_email || !EMAIL_RE.test(String(r.guest_email).trim())) return { skipped: "no valid guest email" };
  const ps = await paySummary(r.id);
  if (ps && (ps.paid > 0 || ps.pending > 0)) return { skipped: "a payment is already recorded" };
  const cabanas = await loadUnits(r);
  const q = await quoteFor(r, cabanas);
  let deadline: string | null = payload.deadline && Date.parse(String(payload.deadline)) > Date.now() ? String(payload.deadline) : null;
  if (!deadline) {
    const d = paymentDeadline(r, c.deadlineHours);
    if (!(d.date && d.date.getTime() > Date.now())) { const t8 = trip8(r.check_in); if (t8 && t8.getTime() > Date.now()) deadline = t8.toISOString(); }
  }
  const msg = String(payload.message || "").trim() ||
    "Hi {first},\n\nAs requested, here is the payment link for your reservation {order} for {date}. Your booking details are below.";
  const rr = { ...r, ...(deadline ? { _deadline: deadline } : {}), email_custom: { ...(r.email_custom || {}), quote: { message: msg.slice(0, 5000) } } };
  const g = guestQuoteEmail(rr, cabanas, q, c);
  return await send({
    booking: r, kind: `guest_quote_resend:${String(payload.resend_id || Date.now())}`, to: String(r.guest_email).trim(),
    subject: g.subject, html: g.html, thread: "guest", attachments: q ? await agreementAttachment() : [],
  });
}

// ---------- dashboard preview (signed-in staff only) ---------------------------
// The staff dashboard shows the exact guest email — before anything is saved —
// so staff can review and edit the opening message. Called with the staff
// member's own login token (supabase.functions.invoke); nothing is sent.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PREVIEW_FIELDS = ["source", "status", "stay_type", "stay_type_label", "guest_name", "guest_email", "guest_phone", "country",
  "check_in", "check_out", "adults", "children_6_12", "children_0_5", "senior_count", "pwd_kid_count", "pet_count", "companions", "primary_is_senior",
  "discount_type", "discount_value", "discount_amount", "discount_reason", "total_amount", "subtotal_people", "cabana_total",
  "senior_discount", "notes", "add_ons", "online_discount", "booked_by", "email_custom", "dining_cabanas", "lounge_cabanas",
  "email_cabana_numbers"];

async function staffUser(auth: string) {
  const c = cfg();
  const res = await fetch(`${c.supabaseUrl}/auth/v1/user`, { headers: { apikey: c.serviceKey, Authorization: auth } });
  if (!res.ok) return null;
  const u = await res.json();
  return u && u.id ? u : null;
}

async function unitsByIds(overnight: boolean, ids: string[]): Promise<Any[]> {
  const clean = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!clean.length) return [];
  const list = `(${clean.join(",")})`;
  if (overnight) {
    const res = await db(`villas?id=in.${list}&select=unit_label,room_type,room_type_name,base_occupancy,max_extra,sort`);
    return res.ok ? (await res.json()).sort((a: Any, b: Any) => (a.sort || 0) - (b.sort || 0)) : [];
  }
  const res = await db(`cabanas?id=in.${list}&select=label,cabana_type,price,capacity,section,number`);
  return res.ok ? (await res.json()).sort((a: Any, b: Any) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true })) : [];
}

export async function preview(req: Request): Promise<Response> {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  const user = await staffUser(req.headers.get("authorization") || "");
  if (!user) return json({ error: "Sign in to the staff dashboard first." }, 401);
  let b: Any;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const c = cfg();
  const kind = ["quote", "change", "confirmed", "cancelled", "expired", "proof_rejected"].includes(b.kind) ? b.kind : "quote";
  let r: Any = b.booking_id ? await loadBooking(String(b.booking_id)) : null;
  if (b.booking_id && !r) return json({ error: "Booking not found" }, 404);
  r = r ? { ...r } : { id: "00000000-0000-0000-0000-000000000000", order_code: "VBR-····", created_at: new Date().toISOString(), source: "phone" };
  const d = b.draft && typeof b.draft === "object" ? b.draft : {};
  for (const k of PREVIEW_FIELDS) if (k in d) r[k] = d[k];
  if (!r.created_at) r.created_at = new Date().toISOString();
  const overnight = isOvernight(r);
  const units = Array.isArray(b.unit_ids) ? await unitsByIds(overnight, b.unit_ids) : (b.booking_id ? await loadUnits(r) : []);
  let q: Quote | null = null;
  if (overnight && b.quote_params && typeof b.quote_params === "object") {
    const res = await db("rpc/quote_overnight", { method: "POST", body: JSON.stringify(b.quote_params) });
    if (res.ok) q = quoteFromOvernight(r, await res.json());
  } else {
    q = overnight ? (b.booking_id ? await quoteFor(r, units) : null) : buildQuote(r, units);
  }
  const custom = b.custom && typeof b.custom === "object"
    ? { subject: String(b.custom.subject || "").slice(0, 180), message: String(b.custom.message || "").slice(0, 5000) } : null;
  if (custom) r.email_custom = { ...(r.email_custom || {}), [kind]: custom };
  let out: { subject: string; html: string };
  if (kind === "change") {
    const raw = Array.isArray(b.changes) ? b.changes.slice(0, 30) : [];
    const changes: Change[] = raw.map((x: Any) => ({ label: String(x?.label ?? "").slice(0, 80), before: String(x?.before ?? "").slice(0, 300), after: String(x?.after ?? "").slice(0, 300) })).filter((x: Change) => x.label);
    // v64: the preview shows the balance against the total being saved
    let pps = b.booking_id ? await paySummary(String(b.booking_id)) : null;
    if (pps && r.total_amount !== null && r.total_amount !== undefined) {
      const bal = Math.round((Number(r.total_amount) - Number(pps.paid || 0)) * 100) / 100;
      pps = { ...pps, total: Number(r.total_amount), balance: bal, fully_paid: bal <= 0.5 };
    }
    out = guestChangedEmail(r, units, changes.length ? changes : [{ label: "(no changes yet)", before: "—", after: "—" }], c, r, String(b.source || ""), pps);
  } else if (kind === "confirmed") {
    out = guestConfirmedEmail(r, units, q, c);
  } else if (kind === "cancelled") {
    out = guestCancelledEmail({ ...r, status: "declined" }, c);
  } else if (kind === "expired") {
    out = guestExpiredEmail({ ...r, status: "expired" }, c);
  } else if (kind === "proof_rejected") {
    const dl = b.deadline ? new Date(String(b.deadline)) : null;
    out = guestProofRejectedEmail(r, c, String(b.reason ?? "").trim().slice(0, 500), dl && !isNaN(dl.getTime()) ? dl : null);
  } else {
    out = guestQuoteEmail(r, units, q, c);
  }
  return json({ subject: out.subject, html: out.html, to: r.guest_email || null, total: q ? q.total : null });
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "POST" && !req.headers.get("x-webhook-secret") && /^Bearer /i.test(req.headers.get("authorization") || "")) {
    try { return await preview(req); } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  }
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
    // v51: booking requests — their own emails; INQUIRY_UPDATE is ignored on purpose
    if (payload.type === "INQUIRY_INSERT") out.inquiry = await onInquiry(r);
    if (payload.type === "INSERT") out.insert = await onInsert(r);
    if (payload.type === "CHANGE") out.changed = await onChanged(r, payload);
    if (payload.type === "RESEND_QUOTE") out.resent = await onResendQuote(r, payload);
    if (payload.type === "DOCS") out.docs = await onDocs(r, payload);
    if (payload.type === "BALANCE_DUE") out.balance = await onBalance(r, false);
    if (payload.type === "BALANCE_OVERDUE") out.balance = await onBalance(r, true);
    if (payload.type === "PAID_IN_FULL") out.paid = await onPaidInFull(r);
    if (payload.type === "PAYMENT_RECEIVED") out.receipt = await onPaymentReceived(r, payload);
    if (payload.type === "OVERPAID") out.overpaid = await onOverpaid(r, payload);
    if (payload.type === "PROOF_REJECTED") out.rejected = await onProofRejected(r, payload);
    if (payload.type === "PAY_REMINDER") out.reminder = await onPayReminder(r);
    if (payload.type === "ARRIVAL_NOTICE") out.arrival = await onArrivalNotice(r);
    if (payload.type === "FULL_PAY_REMINDER") out.fullPay = await onFullPayReminder(r);
    if (payload.type === "UPDATE") {
      // Staff ticked "Send this booking to the guest" — the dashboard flips
      // email_guest after the cabanas are attached, so the quote lists them.
      if (payload.record.email_guest === true && old.email_guest !== true) out.insert = await onInsert(r);
      if (payload.record.payment_uploaded_at && payload.record.payment_uploaded_at !== old.payment_uploaded_at) {
        out.proof = await onProof(r);
      }
      if (payload.record.status === "confirmed" && old.status !== "confirmed") out.confirmed = await onConfirmed(r);
      if (payload.record.status === "declined" && old.status !== "declined") out.cancelled = await onCancelled(r);
      if (payload.record.status === "expired" && old.status !== "expired") out.expired = await onExpired(r);
    }
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), { status: 500 });
  }
  return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
if ((globalThis as Any).Deno?.serve) (globalThis as Any).Deno.serve(handle);
