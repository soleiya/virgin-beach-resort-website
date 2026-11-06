/* ==========================================================================
   Virgin Beach Resort — first-party analytics (no cookies, no third parties)
   Records page views, where visitors came from, and booking-funnel steps
   into our own database (site_events via track_event()). Visitors are a
   random ID kept in this browser — no names, emails or phone numbers.
   Pages call  window.VBRTrack(kind, data, orderCode)  or  VBRTrack.once(...).
   Respects "Do Not Track". Never blocks or breaks the page.
   ========================================================================== */
(function () {
  "use strict";
  var noop = function () {}; noop.once = noop;
  window.VBRTrack = noop;
  try {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
    if (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) || location.protocol === "file:") return;
    if (/\/staff\//.test(location.pathname)) return;
  } catch (e) { return; }

  var cfg = window.SUPABASE_CONFIG || {
    url: "https://dokscqjvqtyhecmbshqd.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRva3NjcWp2cXR5aGVjbWJzaHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTQzNDksImV4cCI6MjEwMzA5MDM0OX0.DbnnSokdaT_4E48LvgxG5An-xqVKGnxKjAVGrR-YLvk",
  };
  if (!cfg.url || !cfg.anonKey || !window.fetch) return;

  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function get(store, k) { try { return store.getItem(k); } catch (e) { return null; } }
  function set(store, k, v) { try { store.setItem(k, v); } catch (e) {} }

  // visitor (this browser) and visit (30 minutes of activity)
  var vid = get(localStorage, "vbr.vid") || rid();
  set(localStorage, "vbr.vid", vid);
  var now = Date.now(), lastAt = +(get(sessionStorage, "vbr.sidAt") || 0);
  var sid = get(sessionStorage, "vbr.sid");
  var newVisit = !sid || now - lastAt > 30 * 60e3;
  if (newVisit) { sid = rid(); set(sessionStorage, "vbr.sid", sid); }
  set(sessionStorage, "vbr.sidAt", String(now));

  // where the visit came from — kept for the whole visit
  var qs = new URLSearchParams(location.search);
  var src = newVisit ? null : JSON.parse(get(sessionStorage, "vbr.src") || "null");
  if (!src || qs.get("utm_source")) {
    var ref = "";
    try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
    if (ref === location.hostname) ref = "";
    src = {
      ref_host: ref || (src && src.ref_host) || null,
      utm_source: qs.get("utm_source") || (qs.get("fbclid") ? "facebook" : qs.get("gclid") ? "google_ads" : null),
      utm_medium: qs.get("utm_medium") || (qs.get("gclid") ? "cpc" : null),
      utm_campaign: qs.get("utm_campaign"),
    };
    set(sessionStorage, "vbr.src", JSON.stringify(src));
  }

  var ua = navigator.userAgent || "";
  var device = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) ? "mobile" : "desktop";
  var browser = /Edg\//.test(ua) ? "Edge" : /FBAN|FBAV|Instagram/.test(ua) ? "In-app (FB/IG)" : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Other";

  function send(kind, data, orderCode) {
    try {
      set(sessionStorage, "vbr.sidAt", String(Date.now()));
      var body = JSON.stringify({ p: {
        kind: kind, vid: vid, sid: sid, path: location.pathname, title: document.title.slice(0, 150),
        ref_host: src.ref_host, utm_source: src.utm_source, utm_medium: src.utm_medium, utm_campaign: src.utm_campaign,
        device: device, browser: browser, lang: (navigator.language || "").slice(0, 20),
        order_code: orderCode || null, data: data || null,
      } });
      fetch(cfg.url + "/rest/v1/rpc/track_event", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey },
        body: body,
      }).catch(function () {});
    } catch (e) {}
  }
  var done = {};
  var track = function (kind, data, orderCode) { send(String(kind || "").slice(0, 40), data, orderCode); };
  track.once = function (kind, data, orderCode) { if (done[kind]) return; done[kind] = 1; send(kind, data, orderCode); };
  window.VBRTrack = track;

  track("page_view", { w: window.innerWidth || null });

  // contact clicks (call, email, Messenger, social) and outbound links
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var h = a.getAttribute("href") || "";
    var k = /^tel:/i.test(h) ? "call" : /^mailto:/i.test(h) ? "email" : /m\.me|messenger/i.test(h) ? "messenger"
      : /facebook\.com/i.test(h) ? "facebook" : /instagram\.com/i.test(h) ? "instagram" : /wa\.me|whatsapp/i.test(h) ? "whatsapp"
      : /viber/i.test(h) ? "viber" : /maps\.(google|app)|goo\.gl\/maps|waze/i.test(h) ? "directions" : null;
    if (k) track("contact_click", { via: k });
    else if (/^https?:/i.test(h) && a.hostname && a.hostname !== location.hostname) track("outbound_click", { host: a.hostname });
  }, true);

  // how far down the page people read (once per page, at 50% and 90%)
  var marks = { 50: 0, 90: 0 };
  window.addEventListener("scroll", function () {
    var d = document.documentElement, pct = (window.scrollY + window.innerHeight) / Math.max(d.scrollHeight, 1) * 100;
    [50, 90].forEach(function (m) { if (!marks[m] && pct >= m) { marks[m] = 1; track("scroll_" + m); } });
  }, { passive: true });
})();
