// =============================================================================
// cloudbeds-sync — keeps the website and Cloudbeds in step (Cloudbeds is the
// master for villas). See supabase-functions/booking-v14-cloudbeds-sync.sql.
//
// Called with header x-webhook-secret (the same vault secret the booking
// emails use) and a JSON body { action, ... }:
//   pull     every 5 min (pg_cron): reservations changed in Cloudbeds since the
//            last run → booking_requests; then retries website bookings that
//            haven't reached Cloudbeds yet.
//   full     nightly: every stay checking out from yesterday on (in pages).
//   push     { booking_id } a villa booked on the website → new Cloudbeds
//            reservation on the same casita(s).
//   status   { booking_id } website confirmed / cancelled it → same in Cloudbeds.
//   payments verified website payments → Cloudbeds folio (postPayment), and
//            their proof screenshots → the reservation's Documents
//            (postReservationDocument).
// A pushed booking also gets its folio lines: meals, extra beds, pets, add-ons
// (postCustomItem) and discounts (postAdjustment); a total that still differs
// is noted for staff (booking_requests.cb_folio_note).
//   setup    link villas to Cloudbeds rooms (by name) + register webhooks.
//   test     check the API key.
// TEST MODE (cb_sync_state.push_enabled = false, the default): nothing is
// sent to Cloudbeds — no push, no status changes. Cloudbeds → website runs.
// Cloudbeds webhooks (reservation/created, …) arrive with the same header and
// a Cloudbeds event body; they're answered at once and processed after.
//
// Secrets (Edge Functions → Secrets): CLOUDBEDS_API_KEY (Cloudbeds →
// Account → Apps & Marketplace → API Credentials → API key). Optional:
// CLOUDBEDS_PROPERTY_ID (default 208402).
// Deploy with "Verify JWT" OFF (pg_net and Cloudbeds call it without a JWT).
// =============================================================================

// deno-lint-ignore-file no-explicit-any
type Any = any;

const env = (k: string, d = "") => (globalThis as Any).Deno?.env.get(k) ?? d;
const CB = "https://api.cloudbeds.com/api/v1.3";
const PROPERTY = () => env("CLOUDBEDS_PROPERTY_ID", "208402");
const SB_URL = () => env("SUPABASE_URL");
const SR = () => env("SUPABASE_SERVICE_ROLE_KEY");
const SELF = () => `${SB_URL()}/functions/v1/cloudbeds-sync`;
const RESERVATION_EVENTS = [
  "created", "status_changed", "dates_changed", "accommodation_changed",
  "accommodation_type_changed", "accommodation_removed", "deleted",
];

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

async function bookingRow(id: string): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/booking_requests?id=eq.${encodeURIComponent(id)}&select=id,status,cb_reservation_id,cb_owned`, {
    headers: { apikey: SR(), Authorization: `Bearer ${SR()}` },
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : null;
}

let secretCache: string | null = null;
async function secret(): Promise<string | null> {
  if (!secretCache) secretCache = await rpc("cb_webhook_secret");
  return secretCache;
}

const stateSet = (key: string, value: unknown) => rpc("cb_state_set", { p_key: key, p_value: value }).catch(() => null);

// ---------------------------------------------------------------- Cloudbeds
let lastCall = 0;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Flatten { rooms: [{ roomTypeID: 1 }] } → rooms[0][roomTypeID]=1
export function form(params: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  const add = (key: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => add(`${key}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) add(`${key}[${k}]`, x);
    else out.append(key, String(v));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out;
}

export async function cb(method: "GET" | "POST" | "PUT" | "DELETE", path: string, params: Record<string, unknown> = {}): Promise<Any> {
  const key = env("CLOUDBEDS_API_KEY");
  if (!key) throw new Error("CLOUDBEDS_API_KEY is not set (Edge Functions → Secrets)");
  const p = { propertyID: PROPERTY(), ...params };
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + 220 - Date.now(); // stay well under Cloudbeds' rate limit
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const inQuery = method === "GET" || method === "DELETE";
    const url = inQuery ? `${CB}/${path}?${form(p)}` : `${CB}/${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "x-api-key": key,
        Accept: "application/json",
        ...(inQuery ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: inQuery ? undefined : form(p),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    let json: Any;
    try { json = JSON.parse(text); } catch { throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`); }
    if (!res.ok || json?.success === false) {
      const err = new Error(`${path}: ${json?.message || "HTTP " + res.status}`);
      (err as Any).status = res.status;
      throw err;
    }
    return json;
  }
}

// ---------------------------------------------------------------- mapping
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const sumBy = (xs: Any[], k: string) => xs.reduce((a, x) => a + (Number(x?.[k]) || 0), 0);

// Cloudbeds' reservation dates are in the property's time (Manila).
export function manila(dt: unknown): string | null {
  const s = String(dt || "").trim();
  if (!s) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return s;
  return s.replace(" ", "T") + "+08:00";
}

// getReservation data → the shape cb_apply_reservation() expects
export function normalize(d: Any) {
  const guests = Object.values(d.guestList || {}) as Any[];
  const main = guests.find((g) => g?.isMainGuest) || guests[0] || {};
  const assigned = Array.isArray(d.assigned) ? d.assigned : [];
  const unassigned = Array.isArray(d.unassigned) ? d.unassigned : [];
  const all = [...assigned, ...unassigned];
  const bal = Array.isArray(d.balanceDetailed) ? d.balanceDetailed[0] : d.balanceDetailed;
  return {
    id: String(d.reservationID),
    status: d.status,
    source: d.sourceName || d.source || null,
    guest_name: d.guestName || [main.guestFirstName, main.guestLastName].filter(Boolean).join(" ") || null,
    guest_email: d.guestEmail || main.guestEmail || null,
    guest_phone: main.guestCellPhone || main.guestPhone || null,
    country: main.guestCountry || null,
    start: d.startDate,
    end: d.endDate,
    adults: all.length ? sumBy(all, "adults") : num(d.adults),
    children: all.length ? sumBy(all, "children") : num(d.children),
    total: num(d.total),
    balance: num(d.balance),
    paid: num(bal?.paid),
    created: manila(d.dateCreated),
    modified: d.dateModified ? String(d.dateModified) : null,
    ota_ref: d.thirdPartyIdentifier || null,
    rooms: assigned.map((a: Any) => ({ room_id: String(a.roomID), room_name: a.roomName, room_type_id: String(a.roomTypeID), room_type_name: a.roomTypeName })),
    unassigned: unassigned.map((u: Any) => ({ room_type_id: String(u.roomTypeID), room_type_name: u.roomTypeName })),
  };
}

async function syncOne(id: string): Promise<Any> {
  try {
    const r = await cb("GET", "getReservation", { reservationID: id });
    return await rpc("cb_apply_reservation", { p: normalize(r.data) });
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/not found|does not exist|invalid reservation/i.test(msg)) {
      return await rpc("cb_apply_reservation", { p: { id, status: "deleted" } });
    }
    throw e;
  }
}

// ---------------------------------------------------------------- actions
const fmtUtc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function listPage(params: Record<string, unknown>, page: number) {
  return await cb("GET", "getReservations", { ...params, pageSize: 100, pageNumber: page });
}

// Go through list items, fetch + apply the ones that changed.
async function processList(items: Any[], force: boolean, deadline: number) {
  const ids = items.map((x) => String(x.reservationID));
  const known: Record<string, string> = force ? {} : (await rpc("cb_known", { p_ids: ids })) || {};
  let applied = 0, skipped = 0, failed = 0, stopped = false;
  const errors: string[] = [];
  for (const it of items) {
    const id = String(it.reservationID);
    if (!force && id in known && known[id] && known[id] === String(it.dateModified || "")) { skipped++; continue; }
    if (Date.now() > deadline) { stopped = true; break; }
    try { await syncOne(id); applied++; } catch (e) { failed++; errors.push(`${id}: ${(e as Error).message}`); }
  }
  return { applied, skipped, failed, stopped, errors: errors.slice(0, 5) };
}

// Cloudbeds room blocks for the next `days` days, in the 35-day windows the API allows
async function syncBlocks(days: number) {
  const from = new Date(Date.now() - 86_400_000);
  const to = new Date(from.getTime() + days * 86_400_000);
  const blocks = new Map<string, Any>();
  for (let a = from; a < to; a = new Date(a.getTime() + 35 * 86_400_000)) {
    const b = new Date(Math.min(a.getTime() + 34 * 86_400_000, to.getTime()));
    for (let page = 1; page <= 10; page++) {
      const res = await cb("GET", "getRoomBlocks", { startDate: ymd(a), endDate: ymd(b), pageSize: 100, pageNumber: page });
      const list = (Array.isArray(res.data) ? res.data.flatMap((d: Any) => d.roomBlocks || []) : res.data?.roomBlocks) || [];
      for (const k of list) {
        blocks.set(String(k.roomBlockID), {
          block_id: String(k.roomBlockID), type: k.roomBlockType, reason: k.roomBlockReason,
          start: k.startDate, end: k.endDate, rooms: (k.rooms || []).map((r: Any) => String(r.roomID)),
        });
      }
      if (list.length < 100) break;
    }
  }
  return await rpc("cb_apply_blocks", { p_from: ymd(from), p_to: ymd(to), p: [...blocks.values()] });
}

async function pull() {
  const started = new Date();
  const deadline = Date.now() + 110_000;
  const stateRes = await fetch(`${SB_URL()}/rest/v1/cb_sync_state?key=eq.last_pull&select=value`, {
    headers: { apikey: SR(), Authorization: `Bearer ${SR()}` },
  });
  const st = (await stateRes.json())?.[0]?.value;
  // Overlap generously: Cloudbeds may read the time as Manila or UTC.
  const from = st?.at ? new Date(new Date(st.at).getTime() - 30 * 60_000) : new Date(Date.now() - 2 * 86_400_000);
  const params = { modifiedFrom: fmtUtc(from), modifiedTo: fmtUtc(new Date(Date.now() + 86_400_000)) };
  const totals = { applied: 0, skipped: 0, failed: 0, pushed: 0, push_failed: 0 };
  const errors: string[] = [];
  let complete = true;
  for (let page = 1; page <= 20; page++) {
    const res = await listPage(params, page);
    const items = Array.isArray(res.data) ? res.data : [];
    const r = await processList(items, false, deadline);
    totals.applied += r.applied; totals.skipped += r.skipped; totals.failed += r.failed; errors.push(...r.errors);
    if (r.stopped) { complete = false; break; }
    if (items.length < 100) break;
  }
  const blocks = await syncBlocks(105).catch((e) => { errors.push("room blocks: " + (e as Error).message); return null; });
  // website bookings still waiting for Cloudbeds
  const waiting: string[] = (await rpc("cb_pending_pushes")) || [];
  for (const id of waiting) {
    if (Date.now() > deadline) break;
    const r = await push(String(id));
    if (r?.reservation_id) totals.pushed++; else if (r?.error) { totals.push_failed++; errors.push(`push ${id}: ${r.error}`); }
  }
  // verified website payments not on the Cloudbeds folio yet
  const pay = await postPayments(deadline).catch((e) => { errors.push("payments: " + (e as Error).message); return null; });
  if (pay?.errors?.length) errors.push(...pay.errors);
  // only move the window forward when everything in it was handled
  const value = { at: complete && totals.failed === 0 ? started.toISOString() : (st?.at || from.toISOString()), ran_at: new Date().toISOString(), ...totals, complete, blocks };
  await stateSet("last_pull", value);
  if (errors.length) await stateSet("last_error", { at: new Date().toISOString(), errors: errors.slice(0, 10) });
  return value;
}

async function full(page = 1, force = true) {
  const deadline = Date.now() + 110_000;
  if (page === 1) await syncBlocks(400).catch(() => null);
  const yesterday = new Date(Date.now() - 86_400_000);
  const res = await listPage({ checkOutFrom: ymd(yesterday), checkOutTo: ymd(new Date(Date.now() + 2 * 365 * 86_400_000)) }, page);
  const items = Array.isArray(res.data) ? res.data : [];
  const r = await processList(items, force, deadline);
  const more = items.length === 100 || r.stopped;
  const next = r.stopped ? page : page + 1;
  if (more) {
    // continue in a fresh invocation (keeps each run short)
    const s = await secret();
    fetch(SELF(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": s || "" },
      body: JSON.stringify({ action: "full", page: next, force: r.stopped ? false : force }),
    }).catch(() => null);
    await sleep(500);
  }
  const value = { page, items: items.length, ...r, more, at: new Date().toISOString() };
  await stateSet("last_full", value);
  return value;
}

const ISO2: Record<string, string> = {
  philippines: "PH", ph: "PH", "united states": "US", usa: "US", us: "US", "united kingdom": "GB", uk: "GB",
  australia: "AU", canada: "CA", japan: "JP", korea: "KR", "south korea": "KR", china: "CN", singapore: "SG",
  germany: "DE", france: "FR", spain: "ES", italy: "IT", netherlands: "NL", "hong kong": "HK", taiwan: "TW",
  india: "IN", malaysia: "MY", indonesia: "ID", vietnam: "VN", thailand: "TH", "new zealand": "NZ",
  "united arab emirates": "AE", uae: "AE", switzerland: "CH", sweden: "SE", norway: "NO", denmark: "DK",
  ireland: "IE", russia: "RU", israel: "IL", "saudi arabia": "SA", qatar: "QA",
};
export function iso2(country: unknown): string {
  const s = String(country || "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return ISO2[s.toLowerCase()] || "PH";
}

export function splitName(name: unknown): [string, string] {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return ["Guest", "Website"];
  if (parts.length === 1) return [parts[0], "-"];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

// Spread n over k rooms: 5 over 2 → [3, 2]
export function spread(n: number, k: number): number[] {
  const base = Math.floor(n / k), extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

export function reservationParams(b: Any) {
  const villas: Any[] = b.villas || [];
  const missing = villas.filter((v) => !v.cb_room_id || !v.cb_room_type_id).map((v) => v.unit_label);
  if (missing.length) throw new Error(`Not linked to a Cloudbeds room yet: ${missing.join(", ")} (run setup)`);
  const adults = spread(Math.max(Number(b.adults) || 1, villas.length), villas.length);
  const kids = spread((Number(b.children_6_12) || 0) + (Number(b.children_0_5) || 0), villas.length);
  const [first, last] = splitName(b.guest_name);
  const email = String(b.guest_email || "").trim();
  return {
    startDate: b.check_in,
    endDate: b.check_out,
    guestFirstName: first,
    guestLastName: last,
    guestCountry: iso2(b.country),
    guestZip: "0000",
    guestEmail: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "reservations@virginbeachresort.com",
    guestPhone: b.guest_phone || undefined,
    rooms: villas.map((v) => ({ roomTypeID: v.cb_room_type_id, quantity: 1 })),
    adults: villas.map((v, i) => ({ roomTypeID: v.cb_room_type_id, quantity: adults[i] })),
    children: villas.map((v, i) => ({ roomTypeID: v.cb_room_type_id, quantity: kids[i] })),
    paymentMethod: "ebanking",
    // optional: a Cloudbeds source made for the website (Settings → Sources), e.g. "VBR Website"
    sourceID: env("CLOUDBEDS_SOURCE_ID") || undefined,
    thirdPartyIdentifier: b.order_code || undefined,
    sendEmailConfirmation: "false",
  };
}

const peso = (n: unknown) => n === null || n === undefined ? "—" : "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 2 });

async function push(bookingId: string): Promise<Any> {
  const b = await rpc("cb_claim_push", { p_booking_id: bookingId });
  if (!b) return { skipped: "not waiting to be pushed" };
  let reservationId: string | null = null;
  const notes: string[] = [];
  try {
    const created = await cb("POST", "postReservation", reservationParams(b));
    reservationId = String(created.reservationID);
    // put each room on the exact casita booked on the website
    let open: Any[] = Array.isArray(created.unassigned) ? created.unassigned : [];
    if (!open.length) open = (await cb("GET", "getReservation", { reservationID: reservationId })).data?.unassigned || [];
    for (const v of b.villas as Any[]) {
      const i = open.findIndex((u: Any) => String(u.roomTypeID) === String(v.cb_room_type_id));
      const slot = i >= 0 ? open.splice(i, 1)[0] : null;
      try {
        await cb("POST", "postRoomAssign", {
          reservationID: reservationId,
          subReservationID: slot?.subReservationID,
          reservationRoomID: slot?.reservationRoomID,
          newRoomID: v.cb_room_id,
          roomTypeID: v.cb_room_type_id,
        });
      } catch (e) {
        notes.push(`${v.unit_label} not assigned in Cloudbeds: ${(e as Error).message}`);
      }
    }
    const wantStatus = b.status === "confirmed" ? "confirmed" : "not_confirmed";
    if (created.status !== wantStatus) {
      await cb("PUT", "putReservation", { reservationID: reservationId, status: wantStatus, sendStatusChangeEmail: "false" }).catch((e) => notes.push(`status: ${e.message}`));
    }
    // meals, extra beds, pets, add-ons and discounts → the Cloudbeds folio, so its total matches the website's
    const folio = await postFolio(reservationId, b).catch((e) => ({ state: "partial", notes: [`folio: ${(e as Error).message}`] }));
    await rpc("cb_folio_result", { p_booking_id: bookingId, p_state: folio.state, p_note: folio.notes.join(" · ") || null }).catch(() => null);
    if (folio.state !== "done") notes.push(...folio.notes);
    await cb("POST", "postReservationNote", {
      reservationID: reservationId,
      reservationNote: `Booked on the website${b.booked_by ? " by " + b.booked_by : ""} (${b.source}) · ${b.order_code} · ` +
        `website total ${peso(b.total_amount)} incl. full-board meals — the website handles this guest's quotation, payment and booking emails; verified payments are posted to this folio. Change dates, casitas, guests or status here in Cloudbeds — the website follows.`,
    }).catch(() => null);
  } catch (e) {
    const msg = String((e as Error).message || e);
    await rpc("cb_push_result", { p_booking_id: bookingId, p_reservation_id: reservationId, p_error: msg });
    return { booking_id: bookingId, reservation_id: reservationId, error: msg };
  }
  await rpc("cb_push_result", { p_booking_id: bookingId, p_reservation_id: reservationId, p_error: notes.length ? notes.join(" · ") : null });
  await syncOne(reservationId).catch(() => null);
  await postPayments().catch(() => null); // e.g. a proof verified before it reached Cloudbeds
  return { booking_id: bookingId, reservation_id: reservationId, notes };
}

// ---------------------------------------------------------------- folio lines
// The room is charged by Cloudbeds from its own rates (they match the website's
// villa rates). Everything else the website priced is posted as its own folio
// line, and discounts as adjustments; then the totals are compared.
const r2 = (n: number) => Math.round(n * 100) / 100;
export function folioLines(b: Any): Array<{ ref: string; name: string; price: number; qty: number; note?: string }> {
  const lines: Array<{ ref: string; name: string; price: number; qty: number; note?: string }> = [];
  const code = String(b.order_code || b.id);
  const nights = Number(b.nights) || 0;
  const guests = (Number(b.adults) || 0) + (Number(b.children_6_12) || 0);
  if (Number(b.meal_total) > 0) lines.push({ ref: `${code}-meals`, name: "Full-board meal package", price: r2(Number(b.meal_total)), qty: 1, note: `${guests} guest(s) × ${nights} night(s)` });
  if (Number(b.extra_bed_total) > 0) lines.push({ ref: `${code}-beds`, name: "Extra floor mattress", price: r2(Number(b.extra_bed_total)), qty: 1, note: `${b.extra_beds || ""} mattress(es) × ${nights} night(s)` });
  if (Number(b.pet_total) > 0) lines.push({ ref: `${code}-pets`, name: "Pet fee", price: r2(Number(b.pet_total)), qty: 1, note: `${b.pet_count || ""} pet(s) × ${nights} night(s)` });
  for (const a of (b.addon_lines || []) as Any[]) {
    if (Number(a.price) > 0 && Number(a.qty) > 0) lines.push({ ref: `${code}-addon-${a.slug}`, name: String(a.name), price: r2(Number(a.price)), qty: Number(a.qty) });
  }
  return lines;
}
export function folioDiscounts(b: Any): Array<{ name: string; amount: number }> {
  const d: Array<{ name: string; amount: number }> = [];
  if (Number(b.senior_discount) > 0) d.push({ name: "Senior Citizen / PWD discount", amount: r2(Number(b.senior_discount)) });
  if (Number(b.online_discount) > 0) d.push({ name: "Convenience Discount (booked on the website)", amount: r2(Number(b.online_discount)) });
  if (Number(b.discount_amount) > 0) d.push({ name: "Discount" + (b.discount_reason ? ` — ${b.discount_reason}` : ""), amount: r2(Number(b.discount_amount)) });
  return d;
}
async function cbTotal(reservationId: string): Promise<number | null> {
  const d = (await cb("GET", "getReservation", { reservationID: reservationId })).data || {};
  const t = d.total ?? d.grandTotal ?? d.balanceDetailed?.grandTotal;
  return t === undefined || t === null ? null : Number(t);
}
async function postFolio(reservationId: string, b: Any): Promise<{ state: string; notes: string[] }> {
  const notes: string[] = [];
  for (const l of folioLines(b)) {
    try {
      await cb("POST", "postCustomItem", {
        reservationID: reservationId,
        referenceID: l.ref, // Cloudbeds ignores a repeat of the same reference
        items: [{ itemID: l.ref, itemName: l.name, itemQuantity: l.qty, itemPrice: l.price, itemNote: l.note || "", itemPaid: "false" }],
      });
    } catch (e) {
      notes.push(`${l.name}: ${(e as Error).message}`);
    }
  }
  for (const d of folioDiscounts(b)) {
    try {
      await cb("POST", "postAdjustment", { reservationID: reservationId, type: "rate", amount: d.amount, notes: `${d.name} · ${b.order_code}` });
    } catch (e) {
      notes.push(`${d.name}: ${(e as Error).message}`);
    }
  }
  // Compare totals; a difference is reported to staff (never auto-corrected).
  const total = await cbTotal(reservationId).catch(() => null);
  const site = Number(b.total_amount);
  if (total !== null && Number.isFinite(site) && Math.abs(total - site) > 1) {
    notes.push(`Cloudbeds total ${peso(total)} vs website ${peso(site)} (difference ${peso(r2(site - total))}) — check the folio`);
  }
  return { state: notes.length ? "partial" : "done", notes };
}

// ---------------------------------------------------------------- proof → Cloudbeds Documents
async function postProofDocument(reservationId: string, path: string, label: string): Promise<void> {
  const key = env("CLOUDBEDS_API_KEY");
  const obj = await fetch(`${SB_URL()}/storage/v1/object/payment-proofs/${path.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { apikey: SR(), Authorization: `Bearer ${SR()}` },
  });
  if (!obj.ok) throw new Error(`proof file: HTTP ${obj.status}`);
  const blob = await obj.blob();
  const ext = (path.split(".").pop() || "jpg").toLowerCase();
  const fd = new FormData();
  fd.append("propertyID", PROPERTY());
  fd.append("reservationID", reservationId);
  fd.append("file", blob, `${label}.${ext}`);
  const res = await fetch(`${CB}/postReservationDocument`, { method: "POST", headers: { "x-api-key": key, Accept: "application/json" }, body: fd });
  const text = await res.text();
  let json: Any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || json?.success === false) throw new Error(`postReservationDocument: ${json?.message || "HTTP " + res.status}`);
}

// Payment method on the website → Cloudbeds payment type
export function cbPaymentType(method: unknown): string {
  return String(method || "").toLowerCase() === "cash" ? "cash" : "ebanking";
}

// Verified website payments → Cloudbeds folio (each once; retried by every pull).
async function postPayments(deadline = Date.now() + 50_000): Promise<Any> {
  const list: Any[] = (await rpc("cb_pending_payment_posts")) || [];
  let posted = 0, docs = 0;
  const errors: string[] = [];
  for (const p of list) {
    if (Date.now() > deadline) break;
    if (p.need_payment) {
      try {
        await cb("POST", "postPayment", {
          reservationID: String(p.reservation_id),
          type: cbPaymentType(p.method),
          amount: Number(p.amount),
          description: `Website payment · ${p.kind || "payment"} · ${p.order_code || ""}${p.note ? " · " + String(p.note).slice(0, 120) : ""}`,
        });
        await rpc("cb_payment_posted", { p_payment_id: p.payment_id, p_error: null });
        posted++;
      } catch (e) {
        const msg = String((e as Error).message || e);
        await rpc("cb_payment_posted", { p_payment_id: p.payment_id, p_error: msg });
        errors.push(`payment ${p.payment_id}: ${msg}`);
        continue; // attach the proof once the payment itself is on the folio
      }
    }
    // the guest's (or staff's) proof screenshot → the reservation's Documents in Cloudbeds
    if (p.need_doc && p.proof_path) {
      try {
        await postProofDocument(String(p.reservation_id), String(p.proof_path), `Proof of payment ${p.order_code || ""} ${p.kind || ""}`.trim().replace(/\s+/g, "-"));
        await rpc("cb_payment_doc_posted", { p_payment_id: p.payment_id, p_error: null });
        docs++;
      } catch (e) {
        const msg = String((e as Error).message || e);
        await rpc("cb_payment_doc_posted", { p_payment_id: p.payment_id, p_error: msg });
        errors.push(`proof ${p.payment_id}: ${msg}`);
      }
    }
  }
  return { waiting: list.length, posted, docs, errors };
}

export function cbStatusFor(status: string): string | null {
  if (status === "confirmed") return "confirmed";
  if (status === "pending" || status === "pending_payment") return "not_confirmed";
  if (status === "declined" || status === "expired") return "canceled";
  return null;
}

async function pushStatus(bookingId: string) {
  if (!(await rpc("cb_push_enabled"))) return { skipped: "test mode — website changes aren't sent to Cloudbeds" };
  const b = await bookingRow(bookingId);
  if (!b?.cb_reservation_id || b.cb_owned) return { skipped: "not a website booking in Cloudbeds" };
  const want = cbStatusFor(b.status);
  if (!want) return { skipped: "status " + b.status };
  try {
    await cb("PUT", "putReservation", { reservationID: b.cb_reservation_id, status: want, sendStatusChangeEmail: "false" });
  } catch (e) {
    await stateSet("last_error", { at: new Date().toISOString(), errors: [`status ${b.cb_reservation_id} → ${want}: ${(e as Error).message}`] });
    throw e;
  }
  await syncOne(b.cb_reservation_id).catch(() => null);
  return { reservation_id: b.cb_reservation_id, status: want };
}

// Our Cloudbeds webhook subscriptions, keyed "entity/action".
const hookKey = (w: Any) => `${w.event?.entity ?? w.object ?? ""}/${w.event?.action ?? w.action ?? ""}`.toLowerCase();
const hookUrl = (w: Any) => String(w.subscriptionData?.endpoint ?? w.endpointUrl ?? w.endpoint ?? "");
// getWebhooks doesn't always return the endpoint; subscriptions made with this
// API key are ours, so an empty URL counts as ours.
const isOurs = (w: Any) => !hookUrl(w) || hookUrl(w).includes("/functions/v1/cloudbeds-sync");

// List our webhooks; with dedupe, keep one per event and delete the rest.
async function webhooks(dedupe: boolean) {
  const all: Any[] = (await cb("GET", "getWebhooks")).data || [];
  const ours = all.filter(isOurs);
  const seen = new Set<string>();
  const removed: string[] = [];
  if (dedupe) {
    for (const w of ours) {
      const k = hookKey(w);
      if (!seen.has(k)) { seen.add(k); continue; }
      await cb("DELETE", "deleteWebhook", { subscriptionID: w.id, propertyIDs: PROPERTY() });
      removed.push(k);
    }
  }
  return {
    total: all.length, ours: ours.length, removed,
    events: ours.map((w) => hookKey(w)).sort(),
    sample: all[0] ? { keys: Object.keys(all[0]), event: all[0].event, url: hookUrl(all[0]).replace(/\?.*$/, "") } : null,
  };
}

async function setup() {
  const rooms: Any[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await cb("GET", "getRooms", { propertyIDs: PROPERTY(), pageSize: 100, pageNumber: page });
    const list = (res.data || []).flatMap((p: Any) => p.rooms || []);
    rooms.push(...list);
    if (list.length < 100) break;
  }
  const linked = await rpc("cb_set_rooms", {
    p: rooms.filter((r) => !r.isVirtual).map((r) => ({ room_id: String(r.roomID), room_name: r.roomName, room_type_id: String(r.roomTypeID), room_type_name: r.roomTypeName })),
  });
  const s = await secret();
  const existing: Any[] = (await cb("GET", "getWebhooks").catch(() => ({ data: [] }))).data || [];
  const have = new Set(existing.filter(isOurs).map(hookKey));
  const webhooks: Record<string, string> = {};
  for (const action of RESERVATION_EVENTS) {
    if (have.has(`reservation/${action}`)) { webhooks[action] = "already registered"; continue; }
    try {
      await cb("POST", "postWebhook", {
        object: "reservation", action, endpointUrl: SELF(),
        authHeaderName: "x-webhook-secret", authHeaderValue: s,
      });
      webhooks[action] = "registered";
    } catch (e) {
      webhooks[action] = "error: " + (e as Error).message;
    }
  }
  for (const action of ["created", "removed", "details_changed"]) {
    if (have.has(`roomblock/${action}`)) { webhooks["roomblock/" + action] = "already registered"; continue; }
    try {
      await cb("POST", "postWebhook", { object: "roomblock", action, endpointUrl: SELF(), authHeaderName: "x-webhook-secret", authHeaderValue: s });
      webhooks["roomblock/" + action] = "registered";
    } catch (e) {
      webhooks["roomblock/" + action] = "error: " + (e as Error).message;
    }
  }
  const blocks = await syncBlocks(400).catch((e) => ({ error: (e as Error).message }));
  const value = { at: new Date().toISOString(), rooms: rooms.length, linked, webhooks, blocks };
  await stateSet("setup", value);
  return value;
}

// ---------------------------------------------------------------- handler
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function background(p: Promise<unknown>) {
  const done = p.catch(async (e) => {
    console.error(e);
    await stateSet("last_error", { at: new Date().toISOString(), errors: [String((e as Error)?.message || e)] });
  });
  const rt = (globalThis as Any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(done);
  return done;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const given = req.headers.get("x-webhook-secret") || "";
  const s = await secret().catch(() => null);
  if (!s || given !== s) return new Response("Unauthorized", { status: 401 });

  let body: Any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Cloudbeds webhook: answer within 2 seconds, work afterwards
  const event = String(body?.event || "");
  if (!body?.action && event.startsWith("reservation/")) {
    const id = String(body.reservationID ?? body.reservationId ?? "");
    if (id) background(syncOne(id));
    return json({ ok: true });
  }
  if (!body?.action && /^room_?block\//i.test(event)) {
    background(syncBlocks(400));
    return json({ ok: true });
  }

  try {
    switch (body.action) {
      case "pull": return json(await pull());
      case "full": background(full(Number(body.page) || 1, body.force !== false)); return json({ started: true });
      case "push": return json(await push(String(body.booking_id)));
      case "status": return json(await pushStatus(String(body.booking_id)));
      case "payments": return json(await postPayments());
      case "sync_one": return json(await syncOne(String(body.reservation_id)));
      case "setup": return json(await setup());
      case "webhooks": return json(await webhooks(body.dedupe === true));
      case "fields": {
        // field names (no values) Cloudbeds returns for one reservation — for diagnostics
        const r = await cb("GET", "getReservation", { reservationID: String(body.reservation_id) });
        const d = r.data || {};
        return json({ keys: Object.keys(d), ids: Object.fromEntries(Object.entries(d).filter(([k, v]) => /id$/i.test(k) && typeof v !== "object")) });
      }
      case "test": {
        const r = await cb("GET", "getRooms", { propertyIDs: PROPERTY(), pageSize: 1 });
        return json({ ok: true, rooms_total: r.total ?? null });
      }
      default: return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await stateSet("last_error", { at: new Date().toISOString(), action: body.action, errors: [msg] });
    return json({ error: msg }, 500);
  }
}

if ((globalThis as Any).Deno?.serve) (globalThis as Any).Deno.serve(handle);
