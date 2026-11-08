/* ==========================================================================
   Stay calendar (v52) — book-stay/ date picker that works like an airline
   calendar: nights that can't be booked are greyed out and can't be clicked.
   --------------------------------------------------------------------------
   * Click a check-in night, then a check-out day. A check-out is only offered
     if every night in between can be booked.
   * Night states:
       open     — at least one casita free (live holds, public_villa_holds)
       blocked  — closed for online booking in Cloudbeds (public_closed_nights:
                  every casita type closed that night, e.g. 2027 weekends,
                  holidays). Not clickable.
       full     — every casita booked. Not clickable.
       request  — past the casita booking window (VBRBookingWindow): can be
                  sent as a booking REQUEST (subject to review). Clickable.
       off      — past, or more than 18 months ahead.
   * The real <input type="date"> boxes stay in the form (read-only) and get a
     "change" event, so stay-booking.js works exactly as before.
   Exposes window.VBRStayCalendar = { init(opts), typeClosed(type, in, out) }.
   ========================================================================== */
(function () {
  "use strict";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function todayManila() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
  function ym(s) { return s.slice(0, 7); }
  function monthStart(s) { return s.slice(0, 7) + "-01"; }
  function nextMonth(s) { var d = new Date(monthStart(s) + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); }
  function prevMonth(s) { var d = new Date(monthStart(s) + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); }
  function dow(s) { return new Date(s + "T00:00:00Z").getUTCDay(); }
  function fmtLong(s) {
    return new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  var S = {
    sb: null, host: null, inEl: null, outEl: null,
    villas: function () { return []; },
    view: null,            // first month shown (YYYY-MM-01)
    phase: "in",           // which date the next click sets
    held: {},              // night -> Set(villa_id)
    closed: {},            // night -> Set(room_type)
    loaded: {},            // "YYYY-MM" -> true | Promise
    hover: null,
  };

  function BW() { return window.VBRBookingWindow || null; }
  function stayLimit() { var w = BW(); return w && w.stayLimit ? w.stayLimit() : null; }
  function farLimit() { var w = BW(); return w && w.requestLimit ? w.requestLimit() : addDays(todayManila(), 550); } // v53: request window

  // ------------------------------------------------------------ data
  function pageAll(q) {
    var out = [], size = 1000;
    function step(from) {
      return q().range(from, from + size - 1).then(function (res) {
        if (res.error) throw res.error;
        out = out.concat(res.data || []);
        return (res.data || []).length === size ? step(from + size) : out;
      });
    }
    return step(0);
  }
  function loadMonth(m0) {
    var key = ym(m0);
    if (S.loaded[key]) return S.loaded[key] === true ? Promise.resolve() : S.loaded[key];
    var start = monthStart(m0), end = nextMonth(m0), lim = stayLimit();
    // nights past the online window are requests — no need to load them
    if (lim && start > lim) return Promise.resolve(); // not cached: the live window may arrive later
    if (lim && end > addDays(lim, 1)) end = addDays(lim, 1);
    if (!S.sb) return Promise.resolve(); // not initialised yet — load later, don't cache "nothing"
    var p = Promise.all([
      pageAll(function () { return S.sb.from("public_villa_holds").select("villa_id,check_in,check_out").lt("check_in", end).gt("check_out", start); }),
      pageAll(function () { return S.sb.from("public_closed_nights").select("night,room_type").gte("night", start).lt("night", end); })
        .catch(function () { return []; }), // view not installed yet → no "blocked" labels
    ]).then(function (r) {
      for (var n = start; n < end; n = addDays(n, 1)) { S.held[n] = new Set(); S.closed[n] = new Set(); }
      r[0].forEach(function (h) {
        for (var n = h.check_in < start ? start : h.check_in; n < h.check_out && n < end; n = addDays(n, 1)) S.held[n].add(h.villa_id);
      });
      r[1].forEach(function (c) { if (S.closed[c.night]) S.closed[c.night].add(c.room_type); });
      S.loaded[key] = true;
      document.dispatchEvent(new CustomEvent("vbr:calendar-data", { detail: { month: key } }));
    }).catch(function () { delete S.loaded[key]; });
    S.loaded[key] = p;
    return p;
  }

  // ------------------------------------------------------------ night status
  function types() {
    var t = {};
    S.villas().forEach(function (v) { t[v.room_type] = true; });
    return Object.keys(t);
  }
  function status(n) {
    if (n < todayManila() || n > farLimit()) return "off";
    var lim = stayLimit();
    if (lim && n > lim) return "request";
    if (!S.held[n]) return "loading";
    var vs = S.villas();
    if (!vs.length) return "loading";
    var closed = S.closed[n] || new Set();
    var tt = types();
    if (tt.length && tt.every(function (t) { return closed.has(t); })) return "blocked";
    var free = vs.filter(function (v) { return !S.held[n].has(v.id) && !closed.has(v.room_type); }).length;
    return free > 0 ? "open" : "full";
  }
  function canCheckIn(n) { var s = status(n); return s === "open" || s === "request" || s === "loading"; }
  function canCheckOut(n) {
    var a = S.inEl.value;
    if (!a || n <= a || n > addDays(farLimit(), 1)) return false;
    for (var d = a; d < n; d = addDays(d, 1)) if (!canCheckIn(d)) return false;
    return true;
  }

  // ------------------------------------------------------------ render
  function monthsShown() { return S.host.clientWidth >= 620 ? 2 : 1; }
  function render() {
    var a = S.inEl.value, b = S.outEl.value, hv = S.phase === "out" && S.hover && a && S.hover > a ? S.hover : null;
    var count = monthsShown(), html = "";
    var canPrev = S.view > monthStart(todayManila());
    var canNext = nextMonth(S.view) <= monthStart(farLimit());
    html += '<div class="sc-head"><button type="button" class="sc-nav sc-prev" aria-label="Previous month"' + (canPrev ? "" : " disabled") + '>&lsaquo;</button>' +
      '<p class="sc-hint" aria-live="polite">' + (S.phase === "in" || !a ? "Select your <strong>check-in</strong> date" : "Now select your <strong>check-out</strong> date") + "</p>" +
      '<button type="button" class="sc-nav sc-next" aria-label="Next month"' + (canNext ? "" : " disabled") + '>&rsaquo;</button></div><div class="sc-months">';
    var m = S.view;
    for (var i = 0; i < count; i++) {
      html += '<div class="sc-month"><p class="sc-title">' + MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4) + '</p><div class="sc-grid" role="grid">';
      DOW.forEach(function (d) { html += '<span class="sc-dow">' + d.slice(0, 2) + "</span>"; });
      for (var k = 0; k < dow(m); k++) html += '<span class="sc-pad"></span>';
      for (var n = m; ym(n) === ym(m); n = addDays(n, 1)) {
        var st = status(n);
        var pickOut = S.phase === "out" && a && n > a;
        var clickable = pickOut ? (canCheckOut(n) || canCheckIn(n)) : canCheckIn(n);
        var cls = "sc-day is-" + st;
        if (pickOut && canCheckOut(n)) cls += " is-out-ok";
        if (n === a) cls += " is-start";
        if (b && n === b && S.phase !== "out") cls += " is-end";
        var end = hv || (S.phase !== "out" ? b : null);
        if (a && end && n > a && n < end) cls += " is-range";
        if (hv && n === hv) cls += " is-end";
        if (n === todayManila()) cls += " is-today";
        var label = fmtLong(n) + (st === "blocked" ? " — blocked" : st === "full" ? " — fully booked" : st === "request" ? " — booking request only" : "");
        html += '<button type="button" class="' + cls + '" data-d="' + n + '" aria-label="' + label + '"' + (clickable ? "" : " disabled") + ">" +
          '<span class="sc-num">' + (+n.slice(8)) + "</span>" +
          (st === "blocked" ? '<span class="sc-tag">Blocked</span>' : st === "full" ? '<span class="sc-tag">Full</span>' : "") + "</button>";
      }
      html += "</div></div>";
      m = nextMonth(m);
    }
    html += '</div><div class="sc-legend"><span><i class="lg lg-open"></i>Available</span><span><i class="lg lg-off"></i>Blocked / full &mdash; not bookable</span>' +
      (stayLimit() ? '<span><i class="lg lg-req"></i>Booking request only (' + fmtShort(addDays(stayLimit(), 1)) + " \u2013 " + fmtShort(farLimit()) + ")</span>" : "") +
      (a ? '<button type="button" class="sc-clear">Clear dates</button>' : "") + "</div>";
    S.host.innerHTML = html;
  }
  function fmtShort(s) { return new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }); }

  function refresh() {
    var p = [], m = S.view;
    for (var i = 0; i < monthsShown(); i++) { p.push(loadMonth(m)); m = nextMonth(m); }
    render();
    return Promise.all(p).then(render);
  }

  // ------------------------------------------------------------ input
  function setDates(a, b) {
    S.inEl.value = a || "";
    S.outEl.value = b || "";
    // stay-booking.js listens for "change" (and fills a 1-night check-out if empty)
    S.inEl.dispatchEvent(new Event("change", { bubbles: true }));
    if (b) S.outEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function onClick(e) {
    var t = e.target.closest("button");
    if (!t || t.disabled || !S.host.contains(t)) return;
    if (t.classList.contains("sc-prev")) { S.view = prevMonth(S.view); return refresh(); }
    if (t.classList.contains("sc-next")) { S.view = nextMonth(S.view); return refresh(); }
    if (t.classList.contains("sc-clear")) { S.phase = "in"; setDates("", ""); render(); return; }
    var d = t.getAttribute("data-d");
    if (!d) return;
    var a = S.inEl.value;
    if (S.phase === "out" && a && d > a && canCheckOut(d)) {
      S.phase = "in";
      setDates(a, d);
    } else if (canCheckIn(d)) {
      S.phase = "out";
      setDates(d, ""); // a 1-night stay until the guest picks a check-out
    }
    render();
  }

  function init(opts) {
    S.sb = opts.sb; S.host = opts.host; S.inEl = opts.checkIn; S.outEl = opts.checkOut;
    S.loaded = {};
    S.villas = opts.villas || S.villas;
    [S.inEl, S.outEl].forEach(function (el) {
      el.readOnly = true;
      el.setAttribute("aria-describedby", S.host.id);
      el.addEventListener("click", function (e) { e.preventDefault(); S.phase = el === S.outEl && S.inEl.value ? "out" : "in"; render(); S.host.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
      el.addEventListener("keydown", function (e) { if (e.key !== "Tab") e.preventDefault(); });
    });
    S.view = monthStart(S.inEl.value && S.inEl.value >= todayManila() ? S.inEl.value : todayManila());
    S.host.hidden = false;
    S.host.addEventListener("click", onClick);
    S.host.addEventListener("mouseover", function (e) {
      var t = e.target.closest("button.sc-day");
      var h = t && !t.disabled ? t.getAttribute("data-d") : null;
      if (h !== S.hover && S.phase === "out") { S.hover = h; render(); }
    });
    S.host.addEventListener("mouseleave", function () { if (S.hover) { S.hover = null; render(); } });
    var w0 = S.host.clientWidth;
    window.addEventListener("resize", function () { if ((S.host.clientWidth >= 620) !== (w0 >= 620)) { w0 = S.host.clientWidth; refresh(); } });
    refresh();
  }
  function setView(d) { if (d) { S.view = monthStart(d); refresh(); } }

  // true if casita type t is closed in Cloudbeds on any night of [a, b)
  function typeClosed(t, a, b) {
    for (var n = a; n < b; n = addDays(n, 1)) if (S.closed[n] && S.closed[n].has(t)) return true;
    return false;
  }
  function ensure(a, b) {
    var p = [], m = monthStart(a);
    while (m <= b) { p.push(loadMonth(m)); m = nextMonth(m); }
    return Promise.all(p);
  }

  // the live booking window arrives after load: forget months loaded with the
  // fallback window (registered now, so it runs before the booking form's own listener)
  document.addEventListener("vbr:booking-window", function () { S.loaded = {}; if (S.host) refresh(); });

  window.VBRStayCalendar = { init: init, refresh: refresh, setView: setView, typeClosed: typeClosed, ensure: ensure, status: status };
})();
