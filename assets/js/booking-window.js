/* Booking window (booking-v28): guests can book up to booking_settings
   .bookings_open_until — set by staff in the dashboard (Booking Window).
   Every guest-facing date box marked data-booking-date="checkin" | "checkout"
   | "visit" gets a max date, and a later date is cleared with a short note
   (before the page's own change handlers run). The database enforces the
   same limit on every website booking.
   v51: casita dates (checkin / checkout) past the casita window are NOT
   cleared — book-stay/ turns them into a booking REQUEST (subject to review,
   2026 rates as a guide). Day-trip dates keep the hard limit. */
(function () {
  "use strict";
  var FALLBACK = "2026-12-31"; // used until the live setting loads (or if it can't)
  var cfg = window.SUPABASE_CONFIG || {};
  var W = (window.VBRBookingWindow = { until: FALLBACK, stayUntil: null });
  // v36: casitas (data-booking-date checkin/checkout) can have their own, later
  // window (booking_settings.villa_bookings_open_until); day trips use until.
  function untilFor(kind) { return (kind === "checkin" || kind === "checkout") && W.stayUntil ? W.stayUntil : W.until; }

  function manilaToday() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmt(s) {
    return new Date(s + "T00:00:00Z").toLocaleDateString("en-PH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  W.message = function (kind) { return "We're taking bookings up to " + fmt(untilFor(kind)) + " for now — later dates open soon."; };
  W.limitFor = function (kind) { var u = untilFor(kind); return u ? (kind === "checkout" ? addDays(u, 1) : u) : null; };
  W.tooLate = function (value, kind) { var l = W.limitFor(kind || "visit"); return !!(l && value && value > l); };
  // v51: last night guests can book online for casitas (null = no limit)
  W.stayLimit = function () { return untilFor("checkin"); };
  W.stayLimitText = function () { var u = untilFor("checkin"); return u ? fmt(u) : ""; };
  // v51: a stay whose last night is past the casita window → booking request
  W.isRequest = function (checkIn, checkOut) {
    var u = untilFor("checkin");
    return !!(u && checkIn && checkOut && checkOut > checkIn && addDays(checkOut, -1) > u);
  };
  function isStayKind(kind) { return kind === "checkin" || kind === "checkout"; }
  function farLimit() { return addDays(manilaToday(), 550); } // same 18-month cap as the database

  function inputs() { return Array.prototype.slice.call(document.querySelectorAll("input[data-booking-date]")); }
  function noteFor(el, show) {
    var qbErr = el.closest("form") && el.closest("form").querySelector(".qb-error");
    if (qbErr) { // home page booking box has its own message line
      if (show) { qbErr.textContent = W.message(el.getAttribute("data-booking-date")); qbErr.hidden = false; }
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
    n.textContent = W.message(el.getAttribute("data-booking-date"));
  }
  // returns true if the value was cleared
  function check(el) {
    if (!el.value) return false; // keep any note until a good date is picked
    if (isStayKind(el.getAttribute("data-booking-date"))) { noteFor(el, false); return false; } // v51: later stays → request
    var bad = W.tooLate(el.value, el.getAttribute("data-booking-date"));
    if (bad) el.value = "";
    noteFor(el, bad);
    return bad;
  }
  function applyMax() {
    inputs().forEach(function (el) {
      var kind = el.getAttribute("data-booking-date");
      var lim = isStayKind(kind) ? farLimit() : W.limitFor(kind); // v51: casitas can be requested further out
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

  // One quiet line under the dates of every booking form.
  //   Casitas (v51): how far online booking goes, and that later stays are a
  //   booking request at rates subject to change — shown while the casita
  //   window is in the future.
  //   Day trips: the upcoming rate increase, until RATE_NOTE_UNTIL (Manila date).
  var RATE_NOTE_UNTIL = "2026-12-31";
  var RATE_NOTE = "2027 rates are scheduled to increase. Book early to secure today\u2019s rates.";
  function stayNote() {
    var u = untilFor("checkin");
    if (!u || manilaToday() > u) return "";
    return "Online booking is open for stays through " + fmt(u) + ". For later dates, you can send us a booking request \u2014 2027 rates are subject to change.";
  }
  function noteText(kind) {
    if (isStayKind(kind)) return stayNote();
    return !RATE_NOTE_UNTIL || manilaToday() > RATE_NOTE_UNTIL ? "" : RATE_NOTE;
  }
  // the home page box switches between Overnight stay and Day trip
  function currentKind(form, el) {
    var on = form.querySelector(".qb-tab.is-on");
    if (on && on.getAttribute("data-mode")) return on.getAttribute("data-mode") === "day" ? "visit" : "checkin";
    return el.getAttribute("data-booking-date");
  }
  function refreshRateNote() {
    var n = document.querySelector(".bw-rate");
    if (!n) return;
    var form = n.closest("form"), el = inputs()[0];
    var txt = form && el ? noteText(currentKind(form, el)) : "";
    n.textContent = txt;
    n.hidden = !txt;
  }
  W.refreshRateNote = refreshRateNote;
  function addRateNotes() {
    if (!document.getElementById("bwRateCss")) {
      var css = document.createElement("style");
      css.id = "bwRateCss";
      css.textContent = ".bw-rate{display:flex;gap:8px;align-items:baseline;margin:10px 0 0;font-size:.86rem;line-height:1.45;color:var(--ink-soft,#6b6559)}" +
        ".bw-rate::before{content:\"\";flex:none;width:7px;height:7px;border-radius:50%;background:var(--driftwood,#a89a7c);transform:translateY(-1px)}" +
        ".quickbook .bw-rate{margin:12px 0 0}.bw-rate[hidden]{display:none}";
      document.head.appendChild(css);
    }
    // once per page: on the first booking form (the hero box where there is one)
    var el = inputs()[0];
    if (!el || document.querySelector(".bw-rate")) return;
    (function () {
      var form = el.closest("form");
      if (!form) return;
      var n = document.createElement("p");
      n.className = "bw-rate";
      n.textContent = noteText(currentKind(form, el));
      n.hidden = !n.textContent;
      Array.prototype.forEach.call(form.querySelectorAll(".qb-tab"), function (b) {
        b.addEventListener("click", function () { setTimeout(refreshRateNote, 0); });
      });
      var err = form.querySelector(".qb-error");
      if (err) { err.parentNode.insertBefore(n, err); return; } // home + day-trip quick-book boxes
      var host = el.closest("div") || el.parentNode;
      if (host.parentNode && host.parentNode.classList && host.parentNode.classList.contains("row-2")) host = host.parentNode; // check-in + check-out side by side
      host.parentNode.insertBefore(n, host.nextSibling);
    })();
  }

  applyMax();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { applyMax(); addRateNotes(); setTimeout(recheckPrefilled, 0); });
  else { addRateNotes(); setTimeout(recheckPrefilled, 0); }

  if (cfg.url && cfg.anonKey) {
    fetch(cfg.url + "/rest/v1/booking_settings?select=*&id=eq.1", {
      headers: { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (!rows || !rows.length) return; // table not set up yet: keep the fallback
        W.until = rows[0].bookings_open_until || null;
        W.stayUntil = rows[0].villa_bookings_open_until || null;
        applyMax();
        refreshRateNote();
        recheckPrefilled();
        document.dispatchEvent(new CustomEvent("vbr:booking-window"));
      })
      .catch(function () {});
  }
})();
