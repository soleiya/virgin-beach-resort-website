/* Booking window (booking-v28): guests can book up to booking_settings
   .bookings_open_until — set by staff in the dashboard (Booking Window).
   Every guest-facing date box marked data-booking-date="checkin" | "checkout"
   | "visit" gets a max date, and a later date is cleared with a short note
   (before the page's own change handlers run). The database enforces the
   same limit on every website booking. */
(function () {
  "use strict";
  var FALLBACK = "2026-12-31"; // used until the live setting loads (or if it can't)
  var cfg = window.SUPABASE_CONFIG || {};
  var W = (window.VBRBookingWindow = { until: FALLBACK });

  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmt(s) {
    return new Date(s + "T00:00:00Z").toLocaleDateString("en-PH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  W.message = function () { return "We're taking bookings up to " + fmt(W.until) + " for now — later dates open soon."; };
  W.limitFor = function (kind) { return W.until ? (kind === "checkout" ? addDays(W.until, 1) : W.until) : null; };
  W.tooLate = function (value, kind) { var l = W.limitFor(kind || "visit"); return !!(l && value && value > l); };

  function inputs() { return Array.prototype.slice.call(document.querySelectorAll("input[data-booking-date]")); }
  function noteFor(el, show) {
    var qbErr = el.closest("form") && el.closest("form").querySelector(".qb-error");
    if (qbErr) { // home page booking box has its own message line
      if (show) { qbErr.textContent = W.message(); qbErr.hidden = false; }
      return;
    }
    var host = el.closest(".qb-field, div") || el.parentNode;
    var n = host.nextElementSibling && host.nextElementSibling.classList && host.nextElementSibling.classList.contains("bw-note") ? host.nextElementSibling : null;
    if (!show) { if (n) n.remove(); return; }
    if (!n) {
      n = document.createElement("p");
      n.className = "bw-note";
      n.setAttribute("role", "status");
      host.parentNode.insertBefore(n, host.nextSibling);
    }
    n.textContent = W.message();
  }
  // returns true if the value was cleared
  function check(el) {
    if (!el.value) return false; // keep any note until a good date is picked
    var bad = W.tooLate(el.value, el.getAttribute("data-booking-date"));
    if (bad) el.value = "";
    noteFor(el, bad);
    return bad;
  }
  function applyMax() {
    inputs().forEach(function (el) {
      var lim = W.limitFor(el.getAttribute("data-booking-date"));
      if (lim) el.max = lim; else el.removeAttribute("max");
    });
  }

  // capture phase: runs before the page's own "change" listeners
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (el && el.matches && el.matches("input[data-booking-date]")) check(el);
  }, true);

  // values filled in from the link (?in=…) after the page loads
  function recheckPrefilled() {
    inputs().forEach(function (el) {
      if (el.value && check(el)) el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  applyMax();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { applyMax(); setTimeout(recheckPrefilled, 0); });
  else setTimeout(recheckPrefilled, 0);

  if (cfg.url && cfg.anonKey) {
    fetch(cfg.url + "/rest/v1/booking_settings?select=bookings_open_until&id=eq.1", {
      headers: { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (!rows || !rows.length) return; // table not set up yet: keep the fallback
        W.until = rows[0].bookings_open_until || null;
        applyMax();
        recheckPrefilled();
      })
      .catch(function () {});
  }
})();
