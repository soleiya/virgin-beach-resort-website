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
       request  — past the casita booking window (VBRBookingWindow), or (v63)
                  closed in Cloudbeds on/after VBRBookingWindow.requestFrom
                  (e.g. 2027 weekends): can be sent as a booking REQUEST
                  (subject to review). Clickable.
       off      — past, or more than 18 months ahead.
   * v86: weekends and holidays in the closure period (public_stay_rules:
     booking_settings.closed_weekends_from/until + peak_dates) are "blocked"
     everywhere — no booking and no booking request. v63 is undone: a night
     closed in Cloudbeds is blocked, never a request.
   * v86: bookable nights show the lowest casita rate under the date
     (public_night_prices; the ?casita= type if the page was opened for one).
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
    rules: {},             // v86: night -> reason (weekend / holiday) — closed for guests
    rulesP: null,
    prices: {},            // v86: night -> { room_type: rate }
  };
  var PRE_TYPE = (function () { try { return new URLSearchParams(location.search).get("casita") || null; } catch (e) { return null; } })();

  // v86: one small style block for the price line (keeps style.css untouched)
  (function () {
    if (document.getElementById("sc-price-css")) return;
    var st = document.createElement("style");
    st.id = "sc-price-css";
    st.textContent = ".stay-cal .sc-price{font-size:.6rem;line-height:1;margin-top:3px;color:var(--lagoon);font-weight:600;letter-spacing:-.01em;white-space:nowrap}" +
      ".stay-cal .sc-day.is-start .sc-price,.stay-cal .sc-day.is-end .sc-price{color:inherit}" +
      ".stay-cal .sc-legend .sc-lg-price{color:var(--lagoon);font-weight:600}" +
      "@media (max-width:380px){.stay-cal .sc-price{font-size:.55rem}}";
    document.head.appendChild(st);
  })();

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
  // v86: weekend / holiday closure — every closed night, loaded once
  function loadRules() {
    if (S.rulesP) return S.rulesP;
    if (!S.sb) return Promise.resolve();
    S.rulesP = pageAll(function () { return S.sb.from("public_stay_rules").select("night,reason").order("night"); })
      .then(function (rows) { var o = {}; rows.forEach(function (r) { o[r.night] = r.reason || "Closed"; }); S.rules = o; })
      .catch(function () { S.rulesP = null; }); // view not installed yet → no rule
    return S.rulesP;
  }
  function ruleReason(n) { return S.rules[n] || null; }
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
      pageAll(function () { return S.sb.from("public_night_prices").select("night,room_type,rate").gte("night", start).lt("night", end); })
        .catch(function () { return []; }), // v86: view not installed yet → no prices
      loadRules(),
    ]).then(function (r) {
      for (var n = start; n < end; n = addDays(n, 1)) { S.held[n] = new Set(); S.closed[n] = new Set(); S.prices[n] = {}; }
      (r[2] || []).forEach(function (p) { if (S.prices[p.night] && Number(p.rate) > 0) S.prices[p.night][p.room_type] = Number(p.rate); });
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
    if (ruleReason(n)) return "blocked"; // v86: weekend / holiday closure — no booking, no request
    var lim = stayLimit();
    if (lim && n > lim) return "request";
    if (!S.held[n]) return "loading";
    var vs = S.villas();
    if (!vs.length) return "loading";
    var closed = S.closed[n] || new Set();
    var tt = types();
    if (tt.length && tt.every(function (t) { return closed.has(t); })) return "blocked"; // v86: v63 undone
    var free = vs.filter(function (v) { return !S.held[n].has(v.id) && !closed.has(v.room_type); }).length;
    return free > 0 ? "open" : "full";
  }
  // v86: lowest casita rate that night among the types with a free casita
  // (only the ?casita= type when the page was opened for one)
  function priceOf(n) {
    var p = S.prices[n];
    if (!p || !S.held[n]) return null;
    var closed = S.closed[n] || new Set(), best = null, seen = {};
    S.villas().forEach(function (v) {
      var t = v.room_type;
      if (seen[t] || (PRE_TYPE && t !== PRE_TYPE) || closed.has(t) || S.held[n].has(v.id) || !(p[t] > 0)) return;
      seen[t] = true;
      if (best === null || p[t] < best) best = p[t];
    });
    return best;
  }
  function fmtPrice(x) {
    if (x >= 1000) { var k = Math.round(x / 100) / 10; return "₱" + (k % 1 ? k.toFixed(1) : String(k)) + "k"; }
    return "₱" + Math.round(x);
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
        var why = ruleReason(n), pr = st === "open" ? priceOf(n) : null;
        var label = fmtLong(n) + (st === "blocked" ? (why ? " — not open for booking (" + why + ")" : " — blocked") : st === "full" ? " — fully booked" : st === "request" ? " — booking request only" : "") +
          (pr ? " — from ₱" + Math.round(pr).toLocaleString("en-US") + " per night" : "");
        html += '<button type="button" class="' + cls + '" data-d="' + n + '" aria-label="' + label.replace(/"/g, "&quot;") + '"' + (why ? ' title="' + why.replace(/"/g, "&quot;") + '"' : "") + (clickable ? "" : " disabled") + ">" +
          '<span class="sc-num">' + (+n.slice(8)) + "</span>" +
          (st === "blocked" ? '<span class="sc-tag">' + (why ? "Closed" : "Blocked") + "</span>" : st === "full" ? '<span class="sc-tag">Full</span>' : pr ? '<span class="sc-price">' + fmtPrice(pr) + "</span>" : "") + "</button>";
      }
      html += "</div></div>";
      m = nextMonth(m);
    }
    var hasRules = Object.keys(S.rules).length > 0;
    html += '</div><div class="sc-legend"><span><i class="lg lg-open"></i>Available</span><span><i class="lg lg-off"></i>' +
      (hasRules ? "Closed / full &mdash; not bookable" : "Blocked / full &mdash; not bookable") + "</span>" +
      (stayLimit() ? '<span><i class="lg lg-req"></i>Booking request only (' + fmtShort(addDays(stayLimit(), 1)) + " \u2013 " + fmtShort(farLimit()) + ")</span>" : "") +
      '<span><b class="sc-lg-price">\u20b19.2k</b> = lowest casita rate per night' + (PRE_TYPE ? " for this casita" : "") + ", meals not included</span>" +
      (hasRules ? "<span>Weekends &amp; holidays in 2027 aren\u2019t open yet</span>" : "") +
      (a ? '<button type="button" class="sc-clear">Clear dates</button>' : "") + "</div>";
    S.host.innerHTML = html;
  }
  function fmtShort(s) { return new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }); }

  function refresh() {
    var p = [loadRules()], m = S.view; // v86: closure rules also cover request-only months
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
