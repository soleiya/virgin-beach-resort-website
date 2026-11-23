// =============================================================================
// campaigns — Offers & Campaigns for the staff dashboard (booking-v65).
//
// Staff calls (Authorization: Bearer <staff session>; any staff account; view-only accounts may only preview (v70)):
//   import_guests { page? }   Cloudbeds guest directory (getGuestList) →
//                             cb_guest_contacts, page by page (continues on its
//                             own), then rebuilds guest_profiles.
//   probe_guests              first page of the Cloudbeds guest list, shape only.
//   rebuild                   rebuild guest_profiles now.
//   suggest { count?, focus? } Claude proposes offers → campaigns 'suggested'.
//   rewrite { campaign, instruction }  Claude rewrites one campaign's email.
//   preview { campaign }      the email as a guest would get it (sample code).
//   v82: offer.kind "none" = no promotion (no code/offer box); offer.layout = classic|letter|spotlight|news.
//   v88: offer.layout "rooms" = room showcase: each casita in offer.rooms with its own photos, weeknight
//        price and the nights still open (live from cb_rates). offer.safety = the fake-website safety
//        notice (any layout; on by default for "rooms"). offer.preheader = the inbox preview line.
//        offer.weekdays_only = the code only takes % off Sun–Thu (non-peak) casita nights (booking-v88).
//   send_test { campaign, to? }  that email, to one address.
//   process                   send the next batch now (also every 5 min by pg_cron).
// Cron (header x-webhook-secret = cb_webhook_secret()): process, import_guests.
// Unsubscribe links go to virginbeachresort.com/unsubscribe/?t=<token>, which
// calls campaign_unsubscribe() itself (this function keeps "Verify JWT" ON).
//
// Secrets (Edge Functions → Secrets): ANTHROPIC_API_KEY (new), SMTP_PASSWORD
// and CLOUDBEDS_API_KEY (already there). Optional: ANTHROPIC_MODEL (default
// claude-sonnet-5-5), CLOUDBEDS_PROPERTY_ID (default 208402).
// "Verify JWT" ON: staff calls carry their session; pg_cron and the function's
// own follow-up calls send the public anon key plus x-webhook-secret.
// =============================================================================

// deno-lint-ignore-file no-explicit-any
type Any = any;

const env = (k: string, d = "") => (globalThis as Any).Deno?.env.get(k) ?? d;
const MAILBOX = "reservations@virginbeachresort.com";
const SITE = "https://virginbeachresort.com";
const SB_URL = () => env("SUPABASE_URL");
const SR = () => env("SUPABASE_SERVICE_ROLE_KEY");
const SELF = () => `${SB_URL()}/functions/v1/campaigns`;
const MODEL = () => env("ANTHROPIC_MODEL", "claude-sonnet-5-5");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------------------------------------------------------- Supabase
async function rpc(name: string, args: Record<string, unknown> = {}, jwt?: string): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SR(), Authorization: `Bearer ${jwt || SR()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text).message || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}
// the name we hold for an email address (guest records), "" if none; drops "TEST" markers
const cleanName = (n: unknown) => String(n || "").replace(/\btest\b/gi, " ").replace(/\s+-\s*$/, "").replace(/\s+/g, " ").trim();
export async function nameForEmail(email: string): Promise<string> {
  const e = email.trim().replace(/([\\%_])/g, "\\$1");
  for (const t of ["cb_guest_contacts", "guest_profiles"]) {
    const res = await fetch(`${SB_URL()}/rest/v1/${t}?select=name&email=ilike.${encodeURIComponent(e)}&name=not.is.null&order=updated_at.desc&limit=10`,
      { headers: { apikey: SR(), Authorization: `Bearer ${SR()}` } }).catch(() => null);
    const rows: Any[] = res?.ok ? await res.json().catch(() => []) : [];
    // prefer a full name, then any name with a usable first name
    const names = rows.map((r) => cleanName(r?.name)).filter((n) => firstName(n));
    const best = names.find((n) => n.includes(" ")) || names[0];
    if (best) return best;
  }
  return "";
}
let secretCache: string | null = null;
async function secret() { if (!secretCache) secretCache = await rpc("cb_webhook_secret").catch(() => null); return secretCache; }

// staff session → their email, if they may use Campaigns
async function staffEmail(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt === SR()) return null;
  const u = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: SR(), Authorization: `Bearer ${jwt}` } });
  if (!u.ok) return null;
  const user = await u.json();
  const ok = await rpc("campaign_is_admin", {}, jwt).catch(() => false);
  return ok === true ? String(user?.email || "") : null;
}

// ---------------------------------------------------------------- Cloudbeds
let lastCall = 0;
function form(params: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out.append(k, String(v));
  return out;
}
async function cb(path: string, params: Record<string, unknown> = {}, version = "v1.3"): Promise<Any> {
  const key = env("CLOUDBEDS_API_KEY");
  if (!key) throw new Error("CLOUDBEDS_API_KEY is not set");
  const p = { propertyID: env("CLOUDBEDS_PROPERTY_ID", "208402"), ...params };
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + 250 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(`https://api.cloudbeds.com/api/${version}/${path}?${form(p)}`, { headers: { "x-api-key": key, Accept: "application/json" } });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
    const text = await res.text();
    let j: Any;
    try { j = JSON.parse(text); } catch { throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 160)}`); }
    if (!res.ok || j?.success === false) throw new Error(`${path}: ${j?.message || "HTTP " + res.status}`);
    return j;
  }
}
async function guestPage(page: number) {
  const params = { pageNumber: page, pageSize: 100 };
  try { return await cb("getGuestList", params); }
  catch (e) {
    if (/not found|unknown|invalid method|404/i.test(String((e as Error).message))) return await cb("getGuestList", params, "v1.2");
    throw e;
  }
}
// one Cloudbeds guest-list item → contact rows (one per reservation)
function contactsOf(g: Any): Any[] {
  const name = g.guestName || [g.guestFirstName ?? g.firstName, g.guestLastName ?? g.lastName].filter(Boolean).join(" ") || null;
  const base = {
    guest_id: String(g.guestID ?? g.guestId ?? g.id ?? ""),
    name, email: g.guestEmail ?? g.email ?? null,
    phone: g.guestCellPhone || g.guestPhone || g.cellPhone || g.phone || null,
    country: g.guestCountry ?? g.country ?? null,
    is_main: g.isMainGuest === undefined ? true : !!g.isMainGuest,
  };
  const resIds: string[] = [];
  if (g.reservationID ?? g.reservationId) resIds.push(String(g.reservationID ?? g.reservationId));
  for (const r of (Array.isArray(g.reservations) ? g.reservations : [])) {
    const id = r?.reservationID ?? r?.reservationId ?? r;
    if (id && typeof id !== "object") resIds.push(String(id));
  }
  return [...new Set(resIds)].map((rid) => ({ ...base, reservation_id: rid }));
}
const listOf = (res: Any): Any[] => Array.isArray(res?.data) ? res.data : res?.data && typeof res.data === "object" ? Object.values(res.data) : [];

async function importGuests(page = 1) {
  const deadline = Date.now() + 100_000;
  let fetched = 0, saved = 0, more = true, p = page;
  for (; Date.now() < deadline; p++) {
    const res = await guestPage(p);
    const items = listOf(res);
    fetched += items.length;
    const rows = items.flatMap(contactsOf);
    if (rows.length) saved += Number(await rpc("campaign_upsert_contacts", { p: rows })) || 0;
    if (items.length < 100) { more = false; break; }
  }
  if (more) {
    // continue in a fresh invocation
    fetch(SELF(), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("SUPABASE_ANON_KEY")}`, "x-webhook-secret": (await secret()) || "" },
      body: JSON.stringify({ action: "import_guests", page: p }) }).catch(() => null);
    await sleep(500);
    return { from_page: page, next_page: p, fetched, saved, more: true };
  }
  const profiles = await rpc("campaign_rebuild_profiles");
  return { from_page: page, last_page: p, fetched, saved, more: false, profiles };
}

// ---------------------------------------------------------------- email
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// ---------------------------------------------------------------- photos
// Email photos live on the website (assets/images/email/<key>.jpg, 1200×800).
// The AI picks them by key; staff can change them in the editor. If none are
// chosen, pickPhotos() matches the offer's words (ATV → an ATV shot, food →
// a food shot, …).
const PHOTO_BASE = `${SITE}/assets/images/email/`;
export const PHOTOS: Record<string, { topic: string; alt: string; caption: string }> = {
  "atv-beach": { topic: "atv", alt: "ATVs lined up on the white sand beach", caption: "ATV rides along the shore" },
  "atv-ride": { topic: "atv", alt: "Guests riding ATVs down to the beach", caption: "ATV rides down to the beach" },
  "dining-restaurant": { topic: "dining", alt: "The open-air beachfront restaurant", caption: "Beachfront dining" },
  "dining-pizza": { topic: "dining", alt: "Pizza from the wood-fired oven", caption: "Wood-fired pizza" },
  "dining-kare-kare": { topic: "dining", alt: "Kare-kare with crispy pork", caption: "Kare-kare, our way" },
  "dining-burger": { topic: "dining", alt: "Burger and fries by the beach", caption: "Lunch by the sea" },
  "dining-pasta": { topic: "dining", alt: "Seafood pasta on the sand", caption: "Seafood pasta" },
  "dining-bread": { topic: "dining", alt: "Freshly baked breads", caption: "Fresh from our bakery" },
  "dining-lanterns": { topic: "dining", alt: "Lantern-lit dinner table", caption: "Dinner by lantern light" },
  "dinner-beach": { topic: "romance", alt: "Private dinner on the beach with lanterns", caption: "A private dinner on the sand" },
  "massage": { topic: "wellness", alt: "Massage at the resort", caption: "Massage by the sea" },
  "kayaking": { topic: "activities", alt: "Kayaking in the bay", caption: "Kayaking in the bay" },
  "snorkeling": { topic: "activities", alt: "Snorkeling over the reef", caption: "Snorkeling the reef" },
  "biking": { topic: "activities", alt: "Bicycle on a shaded resort path", caption: "Bike rides under the trees" },
  "cabana-celebrate": { topic: "celebration", alt: "Canopy cabana on the sand", caption: "A cabana for celebrations" },
  "wedding": { topic: "celebration", alt: "Pavilion set up for a reception", caption: "Celebrations in the pavilion" },
  "daytrip-family": { topic: "daytrip", alt: "Families in the day-trip cabanas", caption: "Day-trip cabanas" },
  "daytrip-cabanas-pools": { topic: "daytrip", alt: "Aerial view of the cabanas, pools and beach", caption: "Cabanas, pools and the beach" },
  "villa-deluxe": { topic: "villa", alt: "A private villa among the trees", caption: "Your private villa" },
  "casita-sunset": { topic: "villa", alt: "A casita at sunset", caption: "Casita evenings" },
  "casita-interior": { topic: "villa", alt: "Inside a bamboo casita", caption: "Inside a bamboo casita" },
  "corporate-aerial": { topic: "corporate", alt: "Aerial view of the pavilion with a tour bus", caption: "Outings for the whole team" },
  "aerial-beach-cabanas": { topic: "beach", alt: "Aerial view of the long white sand beach", caption: "Virgin white sand beach" },
  "aerial-cabanas-beach": { topic: "beach", alt: "Cabanas on the white sand", caption: "Cabanas on the sand" },
  "aerial-beach-mountains": { topic: "beach", alt: "The beach with the mountains behind", caption: "Sea and mountains" },
  "aerial-villas-pool": { topic: "beach", alt: "Aerial view of the villas, pool and beach", caption: "Private villas by the sea" },
  "aerial-pool": { topic: "beach", alt: "The pool beside the beach", caption: "The pool by the beach" },
  "aerial-reef": { topic: "beach", alt: "The reef along the shore", caption: "Clear water and reef" },
  "reef-aerial": { topic: "beach", alt: "Turquoise water off the beach", caption: "Turquoise water" },
  "aerial-beach-trees": { topic: "beach", alt: "Beachfront trees and sand", caption: "Shade right on the beach" },
  "aerial-forest-path": { topic: "beach", alt: "Shaded path through the trees", caption: "Paths under the trees" },
  "aerial-coast-road": { topic: "drive", alt: "The coastal road to the resort", caption: "A drive away from Manila" },
  "aerial-road": { topic: "drive", alt: "Road along the coast", caption: "The road to Laiya" },
};
const TOPIC_WORDS: [string, RegExp][] = [
  ["atv", /\batvs?\b|quad|off-?road/i],
  ["wellness", /massage|\bspa\b|wellness/i],
  ["romance", /romantic|couple|anniversary|honeymoon|date night|private dinner/i],
  ["corporate", /corporate|\bteams?\b|team-?building|company|offsite|colleague|office/i],
  ["celebration", /birthday|celebrat|wedding|debut|reunion|party/i],
  ["dining", /food|meal|dinner|lunch|breakfast|dessert|pizza|kare|buffet|dining|\beat\b|feast|\bdrinks?\b|full-?board/i],
  ["activities", /kayak|snorkel|bike|biking|paddle|adventure|activit/i],
  ["daytrip", /day ?trip|cabana|day visit/i],
  ["villa", /casita|villa|overnight|stay|night/i],
];
const TOPIC_PHOTOS: Record<string, string[]> = {
  atv: ["atv-beach", "atv-ride", "aerial-beach-cabanas"],
  wellness: ["massage", "aerial-beach-trees", "villa-deluxe"],
  romance: ["dinner-beach", "casita-sunset", "dining-lanterns"],
  corporate: ["corporate-aerial", "dining-restaurant", "atv-beach"],
  celebration: ["cabana-celebrate", "dinner-beach", "dining-pizza"],
  dining: ["dining-restaurant", "dining-pizza", "dining-kare-kare"],
  activities: ["kayaking", "snorkeling", "atv-beach"],
  daytrip: ["daytrip-cabanas-pools", "daytrip-family", "dining-burger"],
  villa: ["aerial-villas-pool", "villa-deluxe", "casita-interior"],
  beach: ["aerial-beach-cabanas", "aerial-pool", "aerial-reef"],
};
export const SOUNDBITES = [
  "Exclusive resort in Batangas",
  "White sand beach, 3 hours from Manila",
  "Private villa resort",
  "Virgin white sand beach",
  "A drive away white sand beach",
];
const validPhotos = (v: unknown) => Array.isArray(v) ? [...new Set(v.map(String).filter((k) => k in PHOTOS))].slice(0, 3) : [];
export function pickPhotos(c: Any): string[] {
  const chosen = validPhotos(c?.offer?.images);
  const o = c?.offer || {};
  const text = [o.perk, c?.headline, c?.subject, c?.name, c?.body, c?.audience_label].map((x) => String(x || "")).join(" \n ");
  const topics: string[] = [];
  for (const [t, re] of TOPIC_WORDS) if (re.test(text)) topics.push(t);
  // the freebie decides the main photo when there is one
  if (o.kind === "perk") for (const [t, re] of TOPIC_WORDS) if (re.test(String(o.perk || ""))) { topics.unshift(t); break; }
  // a company audience gets the corporate photo on top
  const segs: string[] = Array.isArray(c?.audience?.segments) ? c.audience.segments : [];
  if (segs.length && segs.every((x) => x === "corporate")) topics.unshift("corporate");
  const kinds: string[] = Array.isArray(o.booking_kinds) ? o.booking_kinds : ["overnight"];
  topics.push(kinds.includes("day_trip") && !kinds.includes("overnight") ? "daytrip" : "villa", "beach");
  const out = [...chosen];
  for (const t of topics) for (const k of TOPIC_PHOTOS[t] || []) { if (out.length >= 3) break; if (!out.includes(k)) out.push(k); }
  return out.slice(0, 3);
}
// "cove" isn't a word the resort uses
export const noCove = (s: unknown) => String(s ?? "")
  .replace(/\bprivate[- ]cove(s)?\b/gi, "private beach")
  .replace(/\b(a|our|the|this)\s+(quiet|hidden|secret|little|private|secluded)?\s*cove\b/gi, (_m, a, adj) => `${a} ${adj ? adj + " " : ""}beach`)
  .replace(/\bcoves?\b/gi, "beach");
function soundbite(c: Any) {
  const t = String(c?.offer?.tagline || "").trim();
  if (t && !/cove/i.test(t)) return t.slice(0, 70);
  const s = String(c?.id || c?.name || c?.code_prefix || "");
  let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SOUNDBITES[h % SOUNDBITES.length];
}

const peso = (n: unknown) => "₱" + Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
const fmtDate = (s: unknown) => s ? new Date(String(s).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-PH", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }) : "";
const firstName = (n: unknown) => String(n || "").trim().split(/\s+/)[0]?.replace(/[^A-Za-zÀ-ž'-]/g, "") || "";

export function offerLine(o: Any): string {
  const kinds: string[] = Array.isArray(o?.booking_kinds) && o.booking_kinds.length ? o.booking_kinds : ["overnight"];
  const what = kinds.includes("overnight") && kinds.includes("day_trip") ? "your stay or day trip" : kinds.includes("day_trip") ? "your day trip" : "your stay";
  if (o?.kind === "perk") return String(o.perk || "A free treat");
  if (o?.kind === "fixed") return `${peso(o.amount)} off ${what}`;
  const on = o?.applies_to === "rooms" ? (kinds.includes("day_trip") && !kinds.includes("overnight") ? "the cabana rental" : "casita rates") : o?.applies_to === "add_ons" ? "add-ons (massage, ATV and more)" : what;
  return `${Number(o?.percent || 0)}% off ${on}`;
}
export function offerTerms(o: Any, expires: unknown): string[] {
  const t: string[] = [];
  const kinds: string[] = Array.isArray(o?.booking_kinds) && o.booking_kinds.length ? o.booking_kinds : ["overnight"];
  t.push(kinds.includes("overnight") && kinds.includes("day_trip") ? "For casita stays and day trips." : kinds.includes("day_trip") ? "For day trips." : "For overnight casita stays.");
  if (o?.stay_from || o?.stay_to) t.push(`For ${kinds.includes("overnight") ? "check-ins" : "visits"}${o.stay_from ? " from " + fmtDate(o.stay_from) : ""}${o.stay_to ? " until " + fmtDate(o.stay_to) : ""}.`);
  if (o?.layout === "rooms") t.push("Nights shown were still open when this email was sent and go first-come, first-served.");
  if (Number(o?.min_nights) > 1) t.push(`Minimum stay of ${o.min_nights} nights.`);
  if (Number(o?.min_total) > 0) t.push(`For bookings over ${peso(o.min_total)}.`);
  if (o?.weekdays_only) t.push("Your code applies to weeknights only (Sunday to Thursday nights, not holiday eves). Friday and Saturday nights are at the regular rate.");
  if (o?.layout === "rooms" && kinds.includes("overnight")) t.push("Full-board meals (buffet breakfast, lunch and dinner) are ₱2,695 per adult per night, not discounted.");
  if (expires) t.push(`Book by ${fmtDate(expires)}.`);
  t.push("One booking per code; it's linked to this email address. Subject to availability.");
  return t;
}
// v82: an email can go out with no promotion at all (offer.kind "none" — no code, no offer box, no terms)
export const hasPromo = (o: Any) => !!o && o.kind !== "none";
// v82: email layouts staff can pick in the editor
export const LAYOUTS: Record<string, string> = {
  classic: "Classic — big photo, message, offer box, two photos",
  letter: "Personal letter — text first, signed by the team, one photo",
  spotlight: "Photo spotlight — edge-to-edge photos, short centred text",
  news: "Announcement — coloured headline banner, then photo and message",
  rooms: "Room showcase — safety notice, then each casita with photos, price and open nights",
};
export const layoutOf = (o: Any) => (o && String(o.layout) in LAYOUTS ? String(o.layout) : "classic");
function ctaUrl(o: Any, code: string | null | undefined, slug = "") {
  const kinds: string[] = Array.isArray(o?.booking_kinds) && o.booking_kinds.length ? o.booking_kinds : ["overnight"];
  const page = kinds.includes("overnight") ? "book-stay/" : "book/";
  if (!code) return `${SITE}/${page}?utm_source=campaign_email&utm_medium=email&utm_campaign=${encodeURIComponent(slug || "newsletter")}`;
  return `${SITE}/${page}?code=${encodeURIComponent(code)}&utm_source=offer_email&utm_medium=email&utm_campaign=${encodeURIComponent(String(code).split("-")[0].toLowerCase())}`;
}
function fill(t: unknown, v: Record<string, string>) {
  return String(t || "").replace(/\{(first_name|name|code|expires|offer)\}/g, (_, k) => v[k] ?? "");
}
const slugOf = (c: Any) => String(c?.code_prefix || c?.name || "newsletter").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "newsletter";

// ---------------------------------------------------------------- v88: room showcase
// Casita photos live on the website (assets/images/casitas/<room_type>-0N.jpg).
// Words come from each casita's page; price and open nights are read live.
export const ROOM_INFO: Record<string, { facts: string; pitch: string }> = {
  "sunrise-casita": { facts: "Sleeps 4 · 2 queen beds · 42 m²", pitch: "Sliding glass doors open straight toward the sea. Made for early risers who can't wait to hit the sand." },
  "louver-window-casita": { facts: "Sleeps 4 (+1 extra) · 2 queen beds · 42 m²", pitch: "Wooden jalousies keep it cool, dim and private. Perfect for late risers and long afternoon naps." },
  "bamboo-casita": { facts: "Sleeps 4 · 2 queen beds · 31 m²", pitch: "Classic Filipino bamboo build with floor-to-ceiling doors you can slide open to the sea breeze." },
  "double-queen-casita": { facts: "Sleeps 4 (+1 extra) · 2 queen beds · 118 m² with garden", pitch: "Our largest casita, with its own private garden, a bathtub and an outdoor shower." },
  "deluxe-king-casita": { facts: "For 2 (+1 extra) · king bed · 107 m² with garden", pitch: "A private garden, a daybed, a bathtub and an outdoor shower. Our most romantic casita." },
  "bamboo-king-casita": { facts: "For 2 · king bed · 31 m²", pitch: "A cozy bamboo hideaway for two, with an elevated patio made for slow mornings and sunset drinks." },
};
export const ROOM_ORDER = ["sunrise-casita", "louver-window-casita", "bamboo-casita", "double-queen-casita", "deluxe-king-casita", "bamboo-king-casita"];
// the casitas a campaign shows: staff's pick, else by the audience's kind of group
export function roomsFor(c: Any): string[] {
  const o = c?.offer || {};
  const picked = Array.isArray(o.rooms) ? o.rooms.map(String).filter((k: string) => k in ROOM_INFO) : [];
  if (picked.length) return [...new Set(picked)].slice(0, 6) as string[];
  const segs: string[] = Array.isArray(c?.audience?.segments) ? c.audience.segments : [];
  if (segs.length && segs.every((x) => x === "couple" || x === "solo")) return ["deluxe-king-casita", "bamboo-king-casita", "sunrise-casita"];
  return ["sunrise-casita", "louver-window-casita", "bamboo-casita", "double-queen-casita"];
}
export type RoomCard = { slug: string; name: string; rate: number; nights: string[] };
async function rest(path: string): Promise<Any> {
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, { headers: { apikey: SR(), Authorization: `Bearer ${SR()}` } });
  if (!res.ok) throw new Error(`rest ${path.split("?")[0]}: ${res.status}`);
  return res.json();
}
const manilaToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
// open nights per casita type, inside the offer's stay window (from tomorrow), Cloudbeds rooms_available > 0.
// weekdays_only → Sun–Thu nights that aren't peak / holiday eves.
export async function loadRooms(c: Any): Promise<RoomCard[]> {
  const o = c?.offer || {};
  const slugs = roomsFor(c);
  const tomorrow = new Date(Date.parse(manilaToday() + "T00:00:00Z") + 86400_000).toISOString().slice(0, 10);
  const from = [String(o.stay_from || "").slice(0, 10), tomorrow].filter(Boolean).sort().pop() as string;
  const toDefault = new Date(Date.parse(from + "T00:00:00Z") + 60 * 86400_000).toISOString().slice(0, 10);
  const to = String(o.stay_to || "").slice(0, 10) || toDefault;
  const villas: Any[] = await rest(`villas?select=room_type,room_type_name,weekday_rate,cb_room_type_id&active=eq.true&room_type=in.(${slugs.join(",")})`);
  const types = [...new Set(villas.map((v) => v.cb_room_type_id).filter(Boolean))];
  const rates: Any[] = types.length && from <= to
    ? await rest(`cb_rates?select=cb_room_type_id,night,rooms_available&night=gte.${from}&night=lte.${to}&cb_room_type_id=in.(${types.join(",")})&order=night`)
    : [];
  const peak = new Set(((await rest(`peak_dates?select=night&night=gte.${from}&night=lte.${to}`).catch(() => [])) as Any[]).map((p) => String(p.night)));
  const weeknight = (d: string) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); return w !== 5 && w !== 6 && !peak.has(d); };
  return slugs.map((slug) => {
    const v = villas.find((x) => x.room_type === slug);
    if (!v) return null;
    const nights = rates.filter((r) => r.cb_room_type_id === v.cb_room_type_id && Number(r.rooms_available) > 0 && (!o.weekdays_only || weeknight(String(r.night)))).map((r) => String(r.night));
    return { slug, name: String(v.room_type_name), rate: Number(v.weekday_rate), nights };
  }).filter((x): x is RoomCard => !!x && x.nights.length > 0);
}
// the safety notice (fake websites / pages) — v88
export const SAFETY = {
  title: "Please watch out for fake Virgin Beach Resort pages",
  lead: "We've been alerted to fake websites and social media pages using our name and photos to take payments. Here's how to know it's really us:",
  items: [
    { ok: true, b: "Book only on virginbeachresort.com.", t: "Check the address bar before you enter any details." },
    { ok: true, b: "Pay only through our secure payment link.", t: "You'll get it on our website right after booking, or in an email from @virginbeachresort.com. It opens a checkout page run by our payment partner, Xendit." },
    { ok: false, b: "We never ask you to send money to a GCash or Maya number, or to a personal bank account.", t: "GCash and Maya only work inside our secure checkout." },
    { ok: true, b: "Bookings are only confirmed by email from @virginbeachresort.com.", t: "You're welcome to message us on Facebook, Instagram or Viber, but we never confirm a booking or take a payment there." },
  ],
  verify: "Not sure about a page, a message or a payment request? Call us on +63 917 792 0712 or email reservations@virginbeachresort.com before you pay.",
};
export const safetyOn = (o: Any) => o?.safety === true || (o?.safety !== false && layoutOf(o) === "rooms");

export function renderEmail(c: Any, r: { name?: string; code?: string | null; unsub?: string }, rooms: RoomCard[] = []) {
  const o = c.offer || {};
  const promo = hasPromo(o);
  const layout = layoutOf(o);
  const code = promo ? String(r.code || "") : "";
  const v = { first_name: firstName(r.name) || "there", name: String(r.name || ""), code, expires: fmtDate(c.expires_on), offer: promo ? offerLine(o) : "" };
  const subject = noCove(fill(c.subject, v));
  const headline = noCove(fill(c.headline || (promo ? offerLine(o) : c.subject), v));
  const paras = noCove(fill(c.body, v)).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const url = ctaUrl(o, code || null, slugOf(c));
  const unsub = r.unsub ? `${SITE}/unsubscribe/?t=${encodeURIComponent(r.unsub)}` : `${SITE}/unsubscribe/`;
  const terms = promo ? offerTerms(o, c.expires_on) : [];
  const photos = pickPhotos(c);
  const img = (k: string) => PHOTO_BASE + k + ".jpg";
  const [hero, ...more] = photos;
  const tag = layout === "rooms" && safetyOn(o) && !String(o.tagline || "").trim() ? "Security notice · Virgin Beach Resort" : soundbite(c);  // v88
  const cta = c.cta_label || (promo ? "Book with my code" : "Plan your visit");
  const preheader = String(o.preheader || "").trim() ? noCove(fill(o.preheader, v)).replace(/\s+/g, " ").slice(0, 140)
    : promo ? `${offerLine(o)} — your personal code ${code}` : (paras.find((p) => !/^hi\b/i.test(p)) || headline).replace(/\s+/g, " ").slice(0, 110);
  // the website's look: Fraunces headings, Manrope text, sand / lagoon colours
  const SERIF = `font-family:Fraunces,'Iowan Old Style','Palatino Linotype',Georgia,serif`;
  const SANS = `font-family:Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
  const INK = "#23241f", SOFT = "#6b6559", LAGOON = "#1f7a72", DEEP = "#14524c", TINT = "#e4f1ee", LINE = "#ddd2ba", SAND = "#f6f1e6", SURF = "#fffdf8";
  const eyebrow = `${SANS};font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${DEEP}`;
  const center = layout === "spotlight";
  const tile = (k: string) => `<td class="tile" width="50%" valign="top" style="padding:0 6px">
<a href="${esc(url)}" style="text-decoration:none"><img src="${img(k)}" width="264" alt="${esc(PHOTOS[k].alt)}" style="display:block;width:100%;max-width:264px;height:auto;border:0;border-radius:14px"></a>
<div style="${SANS};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${DEEP};padding:10px 2px 0">${esc(PHOTOS[k].caption)}</div></td>`;
  const tiles = more.length ? `<tr><td style="padding:22px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${more.map(tile).join("")}${more.length === 1 ? '<td class="tile" width="50%"></td>' : ""}</tr></table></td></tr>` : "";
  const heroRow = (k: string | undefined, edge = false) => k ? `<tr><td style="padding:${edge ? "0" : "0 20px"}"><a href="${esc(url)}"><img src="${img(k)}" width="${edge ? 600 : 560}" alt="${esc(PHOTOS[k].alt)}" style="display:block;width:100%;height:auto;border:0${edge ? "" : ";border-radius:14px"}"></a></td></tr>` : "";
  const bigPhoto = (k: string) => `<tr><td style="padding:22px 0 0"><a href="${esc(url)}"><img src="${img(k)}" width="600" alt="${esc(PHOTOS[k].alt)}" style="display:block;width:100%;height:auto;border:0"></a>
<div style="${SANS};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${DEEP};padding:10px 36px 0;text-align:center">${esc(PHOTOS[k].caption)}</div></td></tr>`;
  const eyebrowRow = `<tr><td class="pad" style="padding:26px 36px 0${center ? ";text-align:center" : ""}"><div style="${eyebrow}">${esc(tag)}</div></td></tr>`;
  const headRow = `<tr><td class="pad" style="padding:12px 36px 22px${center ? ";text-align:center" : ""}"><h1 class="h1" style="margin:0;${SERIF};font-weight:460;font-size:31px;line-height:1.15;color:${INK}">${esc(headline)}</h1></td></tr>`;
  const banner = `<tr><td style="background:${DEEP};padding:30px 36px 28px" class="pad"><div style="${SANS};font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#bfe3dc">${esc(tag)}</div>
<h1 class="h1" style="margin:10px 0 0;${SERIF};font-weight:460;font-size:31px;line-height:1.15;color:#ffffff">${esc(headline)}</h1></td></tr>`;
  const msgRow = (top = 26) => `<tr><td class="pad" style="padding:${top}px 36px 6px${center ? ";text-align:center" : ""}">
${paras.map((p) => `<p style="margin:0 0 15px;font-size:16px;line-height:1.65;color:${layout === "letter" ? INK : SOFT}">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</td></tr>`;
  const signRow = `<tr><td class="pad" style="padding:0 36px 8px"><p style="margin:4px 0 0;font-size:16px;line-height:1.6;color:${INK}">Warm regards,<br><span style="${SERIF};font-size:19px">The Virgin Beach Resort team</span></p></td></tr>`;
  const promoRow = promo ? `<tr><td class="pad" style="padding:6px 36px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TINT};border-radius:14px">
<tr><td align="center" style="padding:22px 18px"><div style="${eyebrow}">Your offer</div>
<div style="${SERIF};font-size:23px;font-weight:500;line-height:1.25;color:${INK};margin:8px 0 14px">${esc(offerLine(o))}</div>
<div style="${SANS};font-size:12px;color:${SOFT}">Your personal code</div>
<div style="font-family:'Courier New',monospace;font-size:24px;font-weight:bold;letter-spacing:.14em;color:${DEEP};margin-top:4px">${esc(code)}</div></td></tr></table></td></tr>` : "";
  const ctaRow = `<tr><td align="center" style="padding:24px 28px 8px"><a href="${esc(url)}" style="display:inline-block;background:${LAGOON};color:#ffffff;text-decoration:none;${SANS};font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase;padding:16px 32px;border-radius:999px">${esc(cta)}</a>
${promo ? `<div style="font-size:12px;color:${SOFT};margin-top:12px">The code is filled in for you — or enter it on the booking page.</div>` : ""}</td></tr>`;
  const termsRow = terms.length ? `<tr><td class="pad" style="padding:18px 36px 24px"><ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.65;color:${SOFT}">${terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></td></tr>` : `<tr><td style="padding:12px 0 0"></td></tr>`;
  // v88: safety notice + room showcase
  const RED = "#a4473a";
  const safetyRow = safetyOn(o) ? `<tr><td class="pad" style="padding:8px 36px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${LINE};border-left:4px solid ${DEEP};border-radius:12px">
<tr><td style="padding:20px 22px 18px"><div style="${SERIF};font-size:20px;font-weight:600;line-height:1.25;color:${INK}">${esc(SAFETY.title)}</div>
<p style="margin:6px 0 10px;font-size:14px;line-height:1.55;color:${SOFT}">${esc(SAFETY.lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${SAFETY.items.map((it) => `<tr><td width="20" valign="top" style="padding:12px 0 8px;border-top:1px solid #efe8da"><div style="width:9px;height:9px;border-radius:50%;background:${it.ok ? DEEP : RED}"></div></td>
<td style="padding:8px 0;border-top:1px solid #efe8da;font-size:14px;line-height:1.5;color:${SOFT}"><b style="color:${INK}">${esc(it.b)}</b> ${esc(it.t)}</td></tr>`).join("")}</table>
<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:${SOFT}">${esc(SAFETY.verify)}</p></td></tr></table></td></tr>` : "";
  const roomUrl = (slug: string) => `${SITE}/book-stay/?casita=${encodeURIComponent(slug)}${code ? "&code=" + encodeURIComponent(code) : ""}&utm_source=${code ? "offer_email" : "campaign_email"}&utm_medium=email&utm_campaign=${encodeURIComponent(code ? String(code).split("-")[0].toLowerCase() : slugOf(c))}`;
  const chips = (nights: string[]) => {
    const by: Record<string, Date[]> = {};
    for (const n of nights) { const d = new Date(n + "T00:00:00Z"); const m = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" }); (by[m] ||= []).push(d); }
    return Object.entries(by).map(([m, ds]) => `<div style="${SANS};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9a907f;margin:10px 0 6px">${m}</div><div>${ds.map((d) =>
      `<span style="display:inline-block;margin:0 4px 6px 0;padding:5px 0;width:38px;text-align:center;border-radius:8px;background:${TINT};color:${DEEP};${SANS};font-size:11px;font-weight:600;line-height:1.2">${d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }).slice(0, 2)}<br><b style="font-size:15px">${d.getUTCDate()}</b></span>`).join("")}</div>`).join("");
  };
  const casitaImg = (slug: string, n: number) => `${SITE}/assets/images/casitas/${slug}-0${n}.jpg`;
  const roomCard = (rm: RoomCard) => { const info = ROOM_INFO[rm.slug]; const u = roomUrl(rm.slug); const sale = promo && o.kind === "percent" ? rm.rate * (1 - Number(o.percent || 0) / 100) : 0;
    return `<tr><td class="pad" style="padding:0 36px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden">
<tr><td style="padding:0"><a href="${esc(u)}"><img src="${casitaImg(rm.slug, 1)}" width="528" alt="${esc(rm.name)}" style="display:block;width:100%;height:auto;border:0"></a></td></tr>
<tr><td style="padding:3px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" style="padding:0 1.5px 0 0"><img src="${casitaImg(rm.slug, 2)}" width="263" alt="" style="display:block;width:100%;height:auto;border:0"></td><td width="50%" style="padding:0 0 0 1.5px"><img src="${casitaImg(rm.slug, 3)}" width="263" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr></table></td></tr>
<tr><td style="padding:20px 22px 22px"><div style="${SERIF};font-size:23px;font-weight:600;line-height:1.2;color:${INK}">${esc(rm.name)}</div>
<div style="font-size:13px;color:#7a6f5e;margin-top:4px">${esc(info?.facts || "")}</div>
<p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:${SOFT}">${esc(info?.pitch || "")}</p>
<p style="margin:14px 0 0;font-size:15px;color:${SOFT}">${sale ? `Weeknight rate with your code: <b style="color:${INK};font-size:17px">${peso(sale)}</b> <span style="color:#7a6f5e;font-size:13px">(regular ${peso(rm.rate)})</span>` : `Weeknight rate: <b style="color:${INK};font-size:17px">${peso(rm.rate)}</b>`}</p>
<div style="${SANS};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${DEEP};margin-top:16px">Open ${o.weekdays_only ? "weeknights" : "nights"}</div>
${chips(rm.nights)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr><td align="center" style="background:${DEEP};border-radius:999px"><a href="${esc(u)}" style="display:block;padding:13px 10px;color:#ffffff;text-decoration:none;${SANS};font-weight:600;font-size:15px">Book the ${esc(rm.name)}</a></td></tr></table>
<div style="text-align:center;font-size:12px;color:#7a6f5e;margin-top:8px">Opens virginbeachresort.com</div></td></tr></table></td></tr>`; };
  const codeRow = promo ? `<tr><td class="pad" style="padding:0 36px 6px"><p style="margin:0 0 15px;font-size:16px;line-height:1.65;color:${SOFT}">Your personal code is <b style="font-family:'Courier New',monospace;color:${DEEP};letter-spacing:.06em">${esc(code)}</b>. It takes ${esc(offerLine(o).replace(/^(\d+%) off /, "$1 off the "))}${o.weekdays_only ? " for weeknights" : ""} and is already applied when you book through the buttons below, which take you to <b style="color:${INK}">virginbeachresort.com</b>.</p></td></tr>` : "";
  const expRow = photos.length ? `<tr><td style="padding:4px 30px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${photos.map((k) => `<td class="tile" width="33%" valign="top" style="padding:0 6px"><img src="${img(k)}" width="170" alt="${esc(PHOTOS[k].alt)}" style="display:block;width:100%;height:auto;border:0;border-radius:12px"><div style="${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${DEEP};padding:8px 2px 0;line-height:1.35">${esc(PHOTOS[k].caption)}</div></td>`).join("")}</tr></table></td></tr>` : "";
  const noRooms = `<tr><td class="pad" style="padding:0 36px 20px"><p style="margin:0;font-size:15px;line-height:1.6;color:${SOFT}">Our casitas for these dates have filled up. Reply to this email or call us and we'll find you the next best nights.</p></td></tr>`;
  let main = "";
  if (layout === "rooms") main = eyebrowRow + headRow + msgRow(0) + safetyRow + codeRow + (rooms.length ? rooms.map(roomCard).join("") : noRooms) + expRow + termsRow;
  else if (layout === "letter") main = eyebrowRow + headRow.replace("padding:12px 36px 22px", "padding:12px 36px 4px") + msgRow(18) + signRow + (promo ? `<tr><td style="padding:14px 0 0"></td></tr>` + promoRow : "") + ctaRow + (hero ? `<tr><td style="padding:22px 20px 0"><a href="${esc(url)}"><img src="${img(hero)}" width="560" alt="${esc(PHOTOS[hero].alt)}" style="display:block;width:100%;height:auto;border:0;border-radius:14px"></a></td></tr>` : "") + termsRow;
  else if (layout === "spotlight") main = heroRow(hero, true) + eyebrowRow + headRow + msgRow(0) + promoRow + ctaRow + more.map(bigPhoto).join("") + termsRow;
  else if (layout === "news") main = banner + (hero ? `<tr><td style="padding:22px 20px 0"><a href="${esc(url)}"><img src="${img(hero)}" width="560" alt="${esc(PHOTOS[hero].alt)}" style="display:block;width:100%;height:auto;border:0;border-radius:14px"></a></td></tr>` : "") + msgRow() + ctaRow + (promo ? `<tr><td style="padding:16px 0 0"></td></tr>` + promoRow : "") + tiles + termsRow;
  else main = eyebrowRow + headRow + heroRow(hero) + msgRow() + promoRow + ctaRow + tiles + termsRow;
  if (layout !== "rooms" && safetyRow) main = main.replace(termsRow, safetyRow + termsRow);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..600&family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
<style>@media (max-width:520px){.pad{padding-left:20px!important;padding-right:20px!important}.tile{display:block!important;width:100%!important;padding:0 0 16px!important}.tile img{max-width:100%!important}.h1{font-size:26px!important}}</style></head>
<body style="margin:0;padding:0;background:${SAND}">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${SURF};border:1px solid ${LINE};border-radius:18px;overflow:hidden;${SANS};color:${INK}">
<tr><td><a href="${SITE}/"><img src="${img("header-logo")}" width="600" alt="Virgin Beach Resort" style="display:block;width:100%;height:auto;border:0"></a></td></tr>
${main}
<tr><td align="center" style="padding:4px 28px 22px;${SERIF};font-style:italic;font-size:17px;line-height:1.5;color:${INK}">Private villa resort on a virgin white sand beach —<br>just a drive away, about 3 hours from Manila.</td></tr>
<tr><td><img src="${img("footer-beach")}" width="600" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr>
<tr><td style="background:${SAND};padding:20px 32px;font-size:12px;line-height:1.7;color:${SOFT}">
Questions? Reply to this email or call +63 917 792 0712 · <a href="${SITE}/" style="color:${LAGOON}">virginbeachresort.com</a><br>
You're getting this because you've been our guest. <a href="${esc(unsub)}" style="color:${SOFT}">Unsubscribe from ${promo ? "offers" : "these emails"}</a>.<br>
Virgin Beach Resort · Laiya, San Juan, Batangas, Philippines</td></tr>
</table></td></tr></table></body></html>`;
  const safetyText = safetyOn(o) ? [SAFETY.title.toUpperCase(), SAFETY.lead, ...SAFETY.items.map((it) => `• ${it.b} ${it.t}`), SAFETY.verify, ""] : [];
  const roomText = layout === "rooms" ? rooms.flatMap((rm) => [`${rm.name} — ${ROOM_INFO[rm.slug]?.facts || ""}`, `Open: ${rm.nights.map((n) => fmtDate(n).replace(/, \d{4}$/, "")).join(", ")}`, `Book: ${roomUrl(rm.slug)}`, ""]) : [];
  const text = [headline, "", ...paras.flatMap((p) => [p, ""]), ...safetyText, ...roomText, ...(layout === "letter" ? ["Warm regards,", "The Virgin Beach Resort team", ""] : []),
    ...(promo ? [`Your offer: ${offerLine(o)}`, `Your personal code: ${code}`] : []), `${promo ? "Book" : cta}: ${url}`, "",
    ...(terms.length ? [...terms.map((t) => "• " + t), ""] : []), "Virgin Beach Resort — private villa resort on a virgin white sand beach, about 3 hours from Manila.",
    "Questions? Reply to this email or call +63 917 792 0712.", `Unsubscribe: ${unsub}`].join("\n");
  return { subject, html, text, unsub, images: photos, rooms: rooms.map((x) => ({ slug: x.slug, name: x.name, nights: x.nights.length })) };
}

let transporter: Any = null;
async function smtp() {
  if (transporter) return transporter;
  const nodemailer = (await import("npm:nodemailer@6.9.16")).default;
  if (env("SMTP_DRY_RUN") === "true") return (transporter = nodemailer.createTransport({ jsonTransport: true }));
  transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, pool: true, maxConnections: 1,
    auth: { user: MAILBOX, pass: env("SMTP_PASSWORD") } });
  return transporter;
}
async function sendMail(to: string, mail: { subject: string; html: string; text: string; unsub: string }) {
  const t = await smtp();
  await t.sendMail({
    from: `Virgin Beach Resort <${MAILBOX}>`, to, replyTo: MAILBOX, subject: mail.subject, html: mail.html, text: mail.text,
    headers: { "List-Unsubscribe": `<${mail.unsub}>, <mailto:${MAILBOX}?subject=unsubscribe>` },
  });
}

async function processQueue() {
  const deadline = Date.now() + 100_000;
  let sent = 0, failed = 0;
  const errors: string[] = [];
  const batch = await rpc("campaign_claim_batch", {});
  const roomCache: Record<string, RoomCard[]> = {};  // v88: one live room lookup per campaign per batch
  for (const it of (batch?.items || []) as Any[]) {
    if (Date.now() > deadline) break;
    try {
      const cid = String(it.campaign?.id || "");
      if (layoutOf(it.campaign?.offer) === "rooms" && !(cid in roomCache)) roomCache[cid] = await loadRooms(it.campaign);
      await sendMail(it.email, renderEmail(it.campaign, { name: it.name, code: it.code, unsub: it.unsub_token }, roomCache[cid] || []));
      await rpc("campaign_mark", { p_id: it.id, p_ok: true, p_error: null });
      sent++;
      await sleep(400); // gentle on Gmail
    } catch (e) {
      const msg = String((e as Error).message || e);
      await rpc("campaign_mark", { p_id: it.id, p_ok: false, p_error: msg }).catch(() => null);
      failed++; errors.push(`${it.email}: ${msg}`);
    }
  }
  return { sent, failed, errors: errors.slice(0, 5), sent_today: (batch?.sent_today || 0) + sent, cap: batch?.cap, capped: !!batch?.capped };
}

// ---------------------------------------------------------------- AI
const RULE_KEYS = ["segments", "tiers", "kinds", "min_visits", "max_visits", "min_spend", "max_spend", "last_from", "last_to",
  "min_days_since", "max_days_since", "months", "kids", "opt_in_only", "include_upcoming", "countries", "skip_contacted_days"];
const SYSTEM = `You are the revenue and CRM marketer for Virgin Beach Resort, an exclusive private villa resort on a virgin white sand beach in Laiya, San Juan, Batangas, Philippines, about 3 hours' drive from Manila (18 private casitas with full-board meals; day trips with Dining or Lounge Cabanas; corporate outings, team building and events). Guests are mostly from Metro Manila; families, barkadas (friend groups), couples and companies.
You design targeted email offers for past guests. Each offer goes to one audience, with a personal single-use code. Staff will review, tweak or decline every suggestion before anything is sent.
Rules:
- Base every suggestion on the data given: segment sizes, spend, recency, months guests visit, occupancy gaps, the sales team's 2027 calendar and past campaign results (repeat what worked, avoid what was declined).
- Audiences must be big enough to matter (normally 20+ guests) and must not overlap heavily between suggestions.
- AVAILABILITY COMES FIRST. "availability" is live from Cloudbeds: by_month and free_casitas_per_night ("MM-DD:free casitas"; 0 or x = full or closed). Only offer dates that still have free casitas — never promote a night, weekend or holiday that is full (e.g. if Dec 24–Jan 3 shows 0, don't offer Christmas or New Year stays). Every overnight offer must set stay_from and stay_to around nights with room (ideally 3+ free casitas on most nights), and its message must not mention full dates. For day trips, avoid day_trip_full_days and day_trip_busy_days. Fill the months and Sunday–Thursday nights with the most free casitas.
- Online booking limits are in "online_booking" (villa_nights_until, day_trips_until); later dates are by request only. Fri/Sat nights and Holy Week are closed online. Keep overnight windows inside what can be booked unless the offer is clearly a request-based early bird.
- Protect rate integrity: percent discounts normally 5–15% (max 20%), peso discounts modest, never discount peak dates (Holy Week, Christmas to New Year). For high-value (vip) guests prefer perks over discounts (e.g. a free massage, welcome drinks, late check-out, a free ATV ride, dessert platter, bonfire setup).
- Offers apply to: casita rates ("rooms"), add-ons (overnight only), or the whole booking ("all"). booking_kinds: "overnight" and/or "day_trip".
- How the resort talks about itself: "Exclusive resort in Batangas", "White sand beach 3 hours away from Manila", "Private villa resort", "Virgin white sand beach", "A drive away white sand beach". Never call it a "cove" (or "hidden gem", "paradise island"); it is a beach resort on the mainland.
- Each email has photos. Choose "images": 1–3 photo keys from this list, the first is the big photo at the top, so it must show what the offer is about (an ATV offer → an ATV photo, a food perk → a food photo, corporate → the corporate photo; otherwise the beach or villas). Photo keys: ${Object.entries(PHOTOS).map(([k, p]) => `${k} (${p.alt})`).join("; ")}.
- Choose "tagline": one of the soundbites above, shown above the photo.
- Write warm, short, personal emails (2–3 short paragraphs, under 120 words), in natural English with an occasional light Filipino touch; no hype, no ALL CAPS, no false urgency, no invented facilities. Use {first_name} for the guest's first name. Don't repeat the code or the terms in the body: the email shows them below the message.
Answer ONLY with a JSON array (no prose) of objects with exactly these keys:
name, rationale (2–3 sentences with the numbers that justify it), audience (object using only: ${RULE_KEYS.join(", ")}; segments from family|friends|couple|solo|corporate; tiers from vip|repeat|one_time|upcoming; kinds from villa|daytrip; months are 1–12; dates YYYY-MM-DD), audience_label (plain words), offer ({kind: percent|fixed|perk, percent?, amount?, perk?, applies_to: rooms|add_ons|all, booking_kinds: [..], stay_from?, stay_to?, min_nights?, min_total?}), code_prefix (3–10 letters/digits), expires_on (YYYY-MM-DD), subject (under 60 characters), headline, body, cta_label, est_bookings (number), est_revenue (pesos), images (array of photo keys), tagline.`;

function extractJson(text: string): Any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return JSON.parse(raw);
}
async function claude(system: string, user: string, maxTokens = 12000): Promise<string> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (Supabase → Edge Functions → Secrets)");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Claude API: ${j?.error?.message || res.status}`);
  return (j.content || []).filter((b: Any) => b.type === "text").map((b: Any) => b.text).join("\n");
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function cleanSuggestion(s: Any, today: string) {
  const o = s.offer || {};
  const kind = ["percent", "fixed", "perk"].includes(o.kind) ? o.kind : "percent";
  const kinds = (Array.isArray(o.booking_kinds) ? o.booking_kinds : ["overnight"]).filter((k: string) => k === "overnight" || k === "day_trip");
  const offer: Any = { kind, applies_to: ["rooms", "add_ons", "all"].includes(o.applies_to) ? o.applies_to : "all", booking_kinds: kinds.length ? kinds : ["overnight"] };
  if (kind === "percent") offer.percent = Math.min(Math.max(Math.round(Number(o.percent) || 10), 1), 30);
  if (kind === "fixed") offer.amount = Math.max(Math.round(Number(o.amount) || 500), 1);
  if (kind === "perk") offer.perk = String(o.perk || "A free treat on us").slice(0, 120);
  if (offer.applies_to === "add_ons" && offer.booking_kinds.join() !== "overnight") offer.applies_to = "all";
  for (const k of ["stay_from", "stay_to"]) if (/^\d{4}-\d{2}-\d{2}$/.test(String(o[k] || ""))) offer[k] = o[k];
  if (Number(o.min_nights) > 1) offer.min_nights = Math.round(Number(o.min_nights));
  if (Number(o.min_total) > 0) offer.min_total = Math.round(Number(o.min_total));
  const aud: Any = {};
  for (const k of RULE_KEYS) if (s.audience && s.audience[k] !== undefined && s.audience[k] !== null && s.audience[k] !== "") aud[k] = s.audience[k];
  const exp = /^\d{4}-\d{2}-\d{2}$/.test(String(s.expires_on || "")) && s.expires_on > today ? s.expires_on : ymd(new Date(Date.now() + 30 * 864e5));
  const imgs = validPhotos(s.images ?? o.images);
  offer.images = imgs.length ? imgs : pickPhotos({ ...s, offer });
  if (s.tagline && !/cove/i.test(String(s.tagline))) offer.tagline = String(s.tagline).slice(0, 70);
  if (String(o.layout || s.layout || "") in LAYOUTS) offer.layout = String(o.layout || s.layout);
  delete s.layout;
  const txt: Any = {};
  for (const k of ["name", "rationale", "audience_label", "subject", "headline", "body", "cta_label"]) if (s[k] !== undefined) txt[k] = noCove(s[k]);
  delete s.images; delete s.tagline;
  return { ...s, ...txt, offer, audience: aud, expires_on: exp };
}
async function suggest(count: number, focus: string, by: string) {
  const ctx = await rpc("campaign_ai_context");
  const n = Math.min(Math.max(count || 4, 1), 8);
  const ask = Math.min(n + 2, 10); // a couple spare: suggestions for full dates are dropped below
  const user = `Today is ${ctx.today} (Manila). Propose ${ask} campaign${ask === 1 ? "" : "s"} for the next 2–3 months, each for dates that still have room.` +
    (focus ? `\nStaff asked to focus on: ${focus}` : "") +
    `\n\nResort data (JSON):\n${JSON.stringify(ctx)}`;
  const text = await claude(SYSTEM, user);
  let list: Any;
  try { list = extractJson(text); } catch { throw new Error("The AI's answer couldn't be read; please try again."); }
  if (!Array.isArray(list) || !list.length) throw new Error("The AI didn't return any suggestions; please try again.");
  // check every suggestion's dates against Cloudbeds; drop the ones with no room
  const keep: Any[] = [], dropped: string[] = [];
  for (const raw of list) {
    if (keep.length >= n) break;
    const s = cleanSuggestion(raw, ctx.today);
    const chk = await rpc("campaign_window_check", { p_offer: s.offer, p_expires: s.expires_on }).catch(() => null);
    if (chk?.verdict === "full") { dropped.push(String(s.name || "?")); continue; }
    if (chk) {
      if (!s.offer.stay_from && chk.from) s.offer.stay_from = chk.from;
      if (!s.offer.stay_to && chk.to) s.offer.stay_to = chk.to;
      s.rationale = `${s.rationale || ""}\n\nAvailability check: ${chk.note}`.trim();
    }
    keep.push(s);
  }
  if (!keep.length) throw new Error("Every idea the AI had was for dates that are already full in Cloudbeds. Try again or give it a focus (e.g. February weekdays).");
  const added = await rpc("campaign_add_suggestions", { p: keep, p_model: MODEL(), p_by: by });
  return { added, dropped, model: MODEL() };
}
async function rewrite(c: Any, instruction: string) {
  const sys = SYSTEM.split("Answer ONLY")[0] +
    "Rewrite the email for the campaign below as instructed. Answer ONLY with a JSON object with keys subject, headline, body, cta_label.";
  const text = await claude(sys, `Instruction from staff: ${instruction || "Make it warmer and shorter."}\n\nCampaign (JSON):\n${JSON.stringify({
    name: c.name, audience_label: c.audience_label, offer: c.offer, offer_line: hasPromo(c.offer) ? offerLine(c.offer || {}) : "NO PROMOTION — this email has no discount, freebie or code; don't mention one", expires_on: hasPromo(c.offer) ? c.expires_on : null,
    subject: c.subject, headline: c.headline, body: c.body, cta_label: c.cta_label })}`, 3000);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The AI's answer couldn't be read; please try again.");
  const j = JSON.parse(m[0]);
  return { subject: noCove(j.subject), headline: noCove(j.headline), body: noCove(j.body), cta_label: noCove(j.cta_label) };
}

// ---------------------------------------------------------------- unsubscribe page
function page(title: string, msg: string) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f4efe6;font-family:Arial,Helvetica,sans-serif;color:#24302e"><div style="max-width:520px;margin:12vh auto;background:#fffdf8;border-radius:14px;padding:32px 28px">
<h1 style="font-family:Georgia,serif;font-weight:normal;color:#0f4f4a;margin:0 0 12px">${esc(title)}</h1><p style="line-height:1.6">${msg}</p>
<p><a href="${SITE}/" style="color:#0f6f68">virginbeachresort.com</a></p></div></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ---------------------------------------------------------------- handler
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (url.searchParams.has("unsub")) {
    const tok = url.searchParams.get("unsub") || "";
    if (!/^[0-9a-f-]{36}$/i.test(tok)) return page("Unsubscribe", "This is a sample link — nothing was changed.");
    const r = await rpc("campaign_unsubscribe", { p_token: tok }).catch(() => null);
    return page(r?.ok ? "You're unsubscribed" : "Link not recognised",
      r?.ok ? `We won't send offers to ${esc(r.email)} anymore. Booking emails for your reservations will still reach you.` : "This unsubscribe link isn't valid anymore. Reply to any of our emails and we'll take you off the list.");
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });
  let body: Any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const s = await secret();
  const isCron = !!s && req.headers.get("x-webhook-secret") === s;
  const who = isCron ? "cron" : await staffEmail(req);
  if (!who) return json({ error: "Not allowed" }, 401);
  // v70: every staff account may open Campaigns; view-only (Accounting) accounts may only preview
  if (!isCron && body.action !== "preview") {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const acc = await rpc("campaign_access", {}, jwt).catch(() => null);
    if (!acc?.can_edit) return json({ error: "This account is view-only. Ask the reservations team to make this change." }, 403);
  }
  try {
    switch (body.action) {
      case "process": return json(await processQueue());
      case "import_guests": return json(await importGuests(Number(body.page) || 1));
      case "rebuild": return json(await rpc("campaign_rebuild_profiles"));
    }
    if (isCron && body.action !== "send_test") return json({ error: "unknown action" }, 400);
    switch (body.action) {
      case "probe_guests": {
        const res = await guestPage(1);
        const items = listOf(res);
        return json({ total: res.total ?? res.count ?? null, items: items.length, keys: items[0] ? Object.keys(items[0]) : [],
          contacts_from_first: items.slice(0, 3).flatMap(contactsOf).map((c: Any) => ({ ...c, email: c.email ? String(c.email).replace(/^(.).*(@.*)$/, "$1•••$2") : null, phone: c.phone ? "•••" : null })) });
      }
      case "suggest": return json(await suggest(Number(body.count) || 4, String(body.focus || "").slice(0, 400), who));
      case "rewrite": return json(await rewrite(body.campaign || {}, String(body.instruction || "").slice(0, 400)));
      case "preview": {
        const c = body.campaign || {};
        const rooms = layoutOf(c.offer) === "rooms" ? await loadRooms(c) : [];
        const m = renderEmail(c, { name: body.name || "Maria Santos", code: (String(c.code_prefix || "VBR").toUpperCase().replace(/[^A-Z0-9]/g, "") || "VBR") + "-SAMPLE" }, rooms);
        return json({ subject: m.subject, html: m.html, rooms: m.rooms, room_choices: ROOM_ORDER.map((k) => ({ key: k, facts: ROOM_INFO[k].facts })), offer_line: hasPromo(c.offer) ? offerLine(c.offer || {}) : "No promotion", images: m.images, layouts: LAYOUTS,
          photos: body.catalog ? Object.entries(PHOTOS).map(([k, p]) => ({ key: k, topic: p.topic, alt: p.alt, caption: p.caption, url: PHOTO_BASE + k + ".jpg" })) : undefined });
      }
      case "send_test": {
        const c = body.campaign || {};
        const settings = await rpc("campaign_overview").then((o: Any) => o?.settings || {}).catch(() => ({}));
        // internal calls may only send to the configured test address
        const to = String((isCron ? "" : body.to) || settings.test_email || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return json({ error: "Enter an email address for the test" }, 400);
        // greet the test recipient by their own name (from the guest records), never a stand-in
        const name = String(body.name || "").trim() || await nameForEmail(to);
        const rooms = layoutOf(c.offer) === "rooms" ? await loadRooms(c) : [];
        const m = renderEmail(c, { name, code: (String(c.code_prefix || "VBR").toUpperCase().replace(/[^A-Z0-9]/g, "") || "VBR") + "-SAMPLE" }, rooms);
        await sendMail(to, { ...m, subject: "[TEST] " + m.subject });
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
