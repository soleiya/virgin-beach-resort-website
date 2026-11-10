// =============================================================================
// Staff dashboard: "Executive" view — the website at a glance, live.
//   • Right now: who's on the site, where they came from, how far into a
//     booking they are, and a feed of booking-funnel activity (every 15 s)
//   • Today so far vs the same time yesterday: visitors, website bookings,
//     money paid online, visits by hour
//   • A period (7 / 30 / 90 days, this month): traffic, website sales vs the
//     previous period, both booking funnels with drop-offs, sources, landing
//     pages, devices and why bookings were blocked
//   • A plain-language executive summary at the top
// Data: site_live() and site_sales() (booking-v58), site_insights() (v44).
// Shown only to EXEC_STAFF accounts, who land on it when they sign in.
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc;
  var EXEC_STAFF = ["miguel@staff.local", "nicho@staff.local", "tristan@staff.local"];
  var dashScreen = document.getElementById("dashScreen");
  var $ = function (id) { return document.getElementById(id); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function todayStr() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmtDay(s, o) { o = o || { month: "short", day: "numeric" }; o.timeZone = "UTC"; return new Date(String(s).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-PH", o); }
  function num(v) { return Number(v) || 0; }
  function n0(v) { return num(v).toLocaleString("en-PH"); }
  function money(v) { return "₱" + num(v).toLocaleString("en-PH", { maximumFractionDigits: 0 }); }
  function moneyShort(v) { v = num(v); return v >= 1e6 ? "₱" + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M" : v >= 1e4 ? "₱" + Math.round(v / 1e3) + "k" : money(v); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function plural(n, a, b) { return n0(n) + " " + (num(n) === 1 ? a : (b || a + "s")); }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago";
  }
  // ▲12% / ▼8% vs a comparison; "new" when the comparison was zero
  function delta(cur, prev, money_) {
    cur = num(cur); prev = num(prev);
    if (!prev && !cur) return '<strong class="ex-d flat">no change</strong>';
    if (!prev) return '<strong class="ex-d up">▲ new</strong>';
    var d = Math.round((cur - prev) / prev * 100);
    if (d === 0) return '<strong class="ex-d flat">same</strong>';
    return '<strong class="ex-d ' + (d > 0 ? "up" : "down") + '">' + (d > 0 ? "▲ " : "▼ ") + Math.abs(d) + "%</strong>";
  }
  function sourceName(s) {
    s = String(s || "direct").toLowerCase();
    if (s === "direct" || /virginbeachresort/.test(s)) return "Direct / typed";
    if (/(^|\.)google\./.test(s) || s === "google_ads") return "Google";
    if (/facebook|fb\.|messenger|m\.me/.test(s)) return "Facebook / Messenger";
    if (/instagram/.test(s)) return "Instagram";
    if (/tiktok/.test(s)) return "TikTok";
    if (s === "booking_email") return "Booking emails";
    return s;
  }
  var STAGE = ["Browsing", "Opened a booking form", "Picked dates", "Chose a casita / cabana", "Entering details", "Pressed Book Now", "Booked ✓", "On the pay page"];
  var EVENT = {
    st_view: "Opened the casita booking form", st_dates: "Picked stay dates", st_casita: "Chose a casita", st_form: "Started guest details",
    st_submit: "Pressed Book Now — casita", st_booked: "Booked a casita stay ✓", st_requested: "Sent a booking request (2027)",
    st_blocked: "Blocked on the casita form", st_error: "Error on the casita form",
    dt_view: "Opened the day-trip booking form", dt_date: "Picked a day-trip date", dt_cabana: "Chose a cabana", dt_form: "Started guest details",
    dt_submit: "Pressed Book Now — day trip", dt_booked: "Booked a day trip ✓", dt_blocked: "Blocked on the day-trip form", dt_error: "Error on the day-trip form",
    pay_view: "Opened the pay page", pay_click: "Went to pay online", pay_uploaded: "Uploaded proof of payment", pay_error: "Payment error",
    pay_return_ok: "Paid online ✓", contact_click: "Tapped call / Messenger / email", outbound_click: "Clicked an outside link",
  };
  function eventText(e) {
    if (e.kind === "page_view") return "Viewed " + (e.path || "/");
    var t = EVENT[e.kind] || e.kind.replace(/_/g, " ");
    var why = e.data && (e.data.reason || e.data.error);
    return t + (why ? " — " + String(why).slice(0, 80) : "");
  }
  function eventTone(k) { return /booked|requested|pay_return_ok/.test(k) ? "good" : /blocked|error/.test(k) ? "bad" : /submit|pay_/.test(k) ? "hot" : ""; }

  // ---------------------------------------------------------------- state
  var shown = false, period = store("vbr.exPeriod") || "30", live = null, ins = null, sales = null, liveAt = 0, liveErr = "", perErr = "";
  if (["7", "30", "90", "month"].indexOf(period) === -1) period = "30";
  function range() {
    var t = todayStr();
    if (period === "month") return { from: t.slice(0, 8) + "01", to: t };
    return { from: addDays(t, -(+period - 1)), to: t };
  }

  // ---------------------------------------------------------------- shell
  var el = document.createElement("section");
  el.id = "exView";
  el.innerHTML =
    '<div class="ex-head"><div><h2>Website — executive view</h2><p><span class="ex-live"><i></i><span id="exUpdated">Connecting…</span></span></p></div>' +
    '<div class="sum-seg" id="exPeriod"><button type="button" data-p="7">7 days</button><button type="button" data-p="30">30 days</button><button type="button" data-p="month">This month</button><button type="button" data-p="90">90 days</button></div></div>' +
    '<div class="ex-summary" id="exSummary"></div>' +
    '<h3 class="ex-h">Today so far <small>vs the same time yesterday</small></h3><div class="ex-tiles" id="exToday"></div>' +
    '<div class="ex-grid2"><div class="ex-card"><div class="ex-card-h"><h4>Visits by hour</h4><span class="ex-legend"><i class="s1"></i>Today <i class="s2"></i>Yesterday</span></div><div id="exHours" class="ex-chart"></div></div>' +
    '<div class="ex-card"><div class="ex-card-h"><h4>On the site now</h4><span class="muted" id="exNowCount"></span></div><div id="exNow" class="ex-now"></div></div></div>' +
    '<div class="ex-card"><div class="ex-card-h"><h4>Live activity</h4><span class="muted">booking forms, payments and contact taps · newest first</span></div><div id="exFeed" class="ex-feed"></div></div>' +
    '<h3 class="ex-h" id="exPerH">Last 30 days</h3><div class="ex-tiles" id="exPerTiles"></div>' +
    '<div class="ex-grid2"><div class="ex-card"><div class="ex-card-h"><h4>Visitors per day</h4></div><div id="exVisDay" class="ex-chart"></div></div>' +
    '<div class="ex-card"><div class="ex-card-h"><h4>Website bookings per day <small>(value)</small></h4></div><div id="exSalesDay" class="ex-chart"></div></div></div>' +
    '<div class="ex-grid2"><div class="ex-card"><div class="ex-card-h"><h4>Casita booking funnel</h4></div><div id="exFunV"></div></div>' +
    '<div class="ex-card"><div class="ex-card-h"><h4>Day-trip booking funnel</h4></div><div id="exFunD"></div></div></div>' +
    '<div class="ex-grid2"><div class="ex-card"><div class="ex-card-h"><h4>Where visitors come from</h4></div><div id="exSources"></div></div>' +
    '<div class="ex-card"><div class="ex-card-h"><h4>Landing pages</h4></div><div id="exLanding"></div></div></div>' +
    '<div class="ex-grid2"><div class="ex-card"><div class="ex-card-h"><h4>Devices</h4></div><div id="exDevices"></div></div>' +
    '<div class="ex-card"><div class="ex-card-h"><h4>Why bookings were blocked</h4></div><div id="exBlocked"></div></div></div>' +
    '<div class="ex-card"><div class="ex-card-h"><h4>Latest website bookings</h4><span class="muted">made by guests on the website</span></div><div id="exRecent"></div></div>' +
    '<p class="ex-foot">Visits are counted by the site\'s own privacy-friendly tracking (no cookies; “Do Not Track” browsers and staff pages aren\'t counted) since Nov 6, 2026. ' +
    'A visit = one browser, 30 minutes of activity. Website bookings = made by guests on the website (not staff or Cloudbeds). Times are Manila time.</p>';
  dashScreen.insertBefore(el, dashScreen.firstChild);

  el.addEventListener("click", function (e) {
    var b = e.target.closest("[data-p]");
    if (b) { period = b.getAttribute("data-p"); store("vbr.exPeriod", period); loadPeriod(); }
  });

  // ---------------------------------------------------------------- charts (SVG)
  var tip = document.createElement("div");
  tip.className = "ex-tip"; tip.hidden = true;
  document.body.appendChild(tip);
  function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; var w = tip.offsetWidth; tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + "px"; tip.style.top = (y - tip.offsetHeight - 12 + window.scrollY) + "px"; }
  function hideTip() { tip.hidden = true; }
  function niceMax(v) { if (v <= 4) return 4; var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }

  // one or two series as lines over 24 hours; crosshair tooltip
  function hourChart(box, rows, nowHour) {
    var W = box.clientWidth || 520, H = 190, L = 34, R = 10, T = 12, B = 24;
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return Math.max(r.today, r.yday); }).concat([1])));
    var x = function (h) { return L + (W - L - R) * h / 23; }, y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var line = function (key, upto) {
      return rows.filter(function (r) { return r.h <= upto; }).map(function (r, i) { return (i ? "L" : "M") + x(r.h).toFixed(1) + " " + y(r[key]).toFixed(1); }).join(" ");
    };
    var grid = [0, max / 2, max].map(function (v) { return '<line class="ex-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ex-ax" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + n0(v) + "</text>"; }).join("");
    var xt = [0, 6, 12, 18, 23].map(function (h) { return '<text class="ex-ax" x="' + x(h) + '" y="' + (H - 6) + '" text-anchor="middle">' + (h === 0 ? "12am" : h === 12 ? "12pm" : h === 23 ? "11pm" : (h % 12) + (h < 12 ? "am" : "pm")) + "</text>"; }).join("");
    var lastT = rows[Math.min(nowHour, 23)];
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '" role="img" aria-label="Visits by hour, today and yesterday">' + grid + xt +
      '<path class="ex-l2" d="' + line("yday", 23) + '"/><path class="ex-l1" d="' + line("today", nowHour) + '"/>' +
      '<circle class="ex-dot1" cx="' + x(lastT.h) + '" cy="' + y(lastT.today) + '" r="4"/>' +
      '<line class="ex-cross" y1="' + T + '" y2="' + (H - B) + '" x1="0" x2="0" visibility="hidden"/><rect class="ex-hit" x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '"/></svg>';
    var svg = box.querySelector("svg"), cross = svg.querySelector(".ex-cross");
    svg.querySelector(".ex-hit").addEventListener("mousemove", function (ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
      var h = Math.max(0, Math.min(23, Math.round((px - L) / (W - L - R) * 23))), row = rows[h];
      cross.setAttribute("x1", x(h)); cross.setAttribute("x2", x(h)); cross.setAttribute("visibility", "visible");
      var lbl = (h % 12 || 12) + (h < 12 ? " am" : " pm") + " – " + ((h + 1) % 12 || 12) + (h + 1 < 12 || h + 1 === 24 ? " am" : " pm");
      showTip("<b>" + lbl + "</b><br>Today: " + (h <= nowHour ? plural(row.today, "visit") : "—") + "<br>Yesterday: " + plural(row.yday, "visit"), ev.clientX, r.top + ev.clientY - r.top);
    });
    svg.querySelector(".ex-hit").addEventListener("mouseleave", function () { cross.setAttribute("visibility", "hidden"); hideTip(); });
  }
  // single-series bars per day; per-bar tooltip
  function dayBars(box, rows, key, fmtV, label) {
    var W = box.clientWidth || 520, H = 170, L = 40, R = 6, T = 10, B = 22, n = rows.length || 1;
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return num(r[key]); }).concat([1])));
    var bw = (W - L - R) / n, gap = Math.min(2, bw * 0.25);
    var y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var grid = [0, max / 2, max].map(function (v) { return '<line class="ex-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ex-ax" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(key === "value" ? moneyShort(v) : n0(v)) + "</text>"; }).join("");
    var bars = rows.map(function (r, i) {
      var v = num(r[key]), h = Math.max(v ? 2 : 0, H - B - y(v)), x0 = L + i * bw + gap / 2, w = Math.max(1, bw - gap);
      var rad = Math.min(4, w / 2);
      return '<g class="ex-bar" data-i="' + i + '"><rect class="ex-hitbar" x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '"/>' +
        (h ? '<path class="ex-b1" d="M' + x0 + " " + (H - B) + "V" + (H - B - h + rad) + "q0 -" + rad + " " + rad + " -" + rad + "H" + (x0 + w - rad) + "q" + rad + " 0 " + rad + " " + rad + "V" + (H - B) + 'Z"/>' : "") + "</g>";
    }).join("");
    var step = Math.max(1, Math.ceil(n / 6));
    var xt = rows.map(function (r, i) { return i % step ? "" : '<text class="ex-ax" x="' + (L + i * bw + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(fmtDay(r.day)) + "</text>"; }).join("");
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '" role="img" aria-label="' + esc(label) + '">' + grid + bars + xt + "</svg>";
    Array.prototype.forEach.call(box.querySelectorAll(".ex-bar"), function (g) {
      g.addEventListener("mousemove", function (ev) { var r = rows[+g.getAttribute("data-i")]; showTip("<b>" + esc(fmtDay(r.day, { weekday: "short", month: "short", day: "numeric" })) + "</b><br>" + fmtV(r), ev.clientX, ev.clientY); });
      g.addEventListener("mouseleave", hideTip);
    });
  }
  function funnel(box, steps) {
    if (!steps || !steps.length || !num(steps[0].visits)) { box.innerHTML = '<p class="ex-empty">No one opened this booking form in the period.</p>'; return; }
    var top = num(steps[0].visits), worst = -1, worstLoss = 0;
    steps.forEach(function (s, i) { if (i && num(steps[i - 1].visits)) { var loss = 1 - num(s.visits) / num(steps[i - 1].visits); if (loss > worstLoss && i < steps.length - 2) { worstLoss = loss; worst = i; } } });
    box.innerHTML = steps.map(function (s, i) {
      var v = num(s.visits), w = top ? Math.max(1.5, v / top * 100) : 0;
      var drop = i && num(steps[i - 1].visits) ? Math.round((1 - v / num(steps[i - 1].visits)) * 100) : null;
      return '<div class="ex-fs' + (i === worst ? " worst" : "") + '"><div class="ex-fl"><span>' + esc(s.step) + "</span><b>" + n0(v) + '</b><em>' + pct(v, top) + "%</em></div>" +
        '<div class="ex-ft"><i style="width:' + w + '%"></i></div>' +
        (drop !== null && drop > 0 ? '<div class="ex-fd">' + (i === worst ? "⚠ biggest drop-off: " : "") + drop + "% didn't continue</div>" : "") + "</div>";
    }).join("");
  }
  function barTable(rows, cols) {
    if (!rows.length) return '<p class="ex-empty">Nothing in this period.</p>';
    var max = Math.max.apply(null, rows.map(function (r) { return num(r[cols[1].key]); }).concat([1]));
    return '<table class="ex-t"><thead><tr>' + cols.map(function (c, i) { return "<th" + (i ? ' class="num"' : "") + ">" + esc(c.t) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr>" + cols.map(function (c, i) {
          var v = c.fmt ? c.fmt(r) : esc(r[c.key]);
          if (i === 0) return '<td><div class="ex-tn">' + v + '</div><div class="ex-tb"><i style="width:' + (num(r[cols[1].key]) / max * 100) + '%"></i></div></td>';
          return '<td class="num">' + v + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
  }

  // ---------------------------------------------------------------- data
  var liveBusy = false, perBusy = false;
  function loadLive() {
    if (!shown || liveBusy || document.hidden) return;
    liveBusy = true;
    sb.rpc("site_live").then(function (res) {
      liveBusy = false;
      if (res.error) { liveErr = res.error.message; drawLive(); return; }
      liveErr = ""; live = res.data; liveAt = Date.now(); drawLive(); drawSummary();
    }, function (e) { liveBusy = false; liveErr = String(e && e.message || e); drawLive(); });
  }
  function loadPeriod() {
    if (!shown || perBusy) return;
    perBusy = true;
    var r = range();
    drawPeriodChrome();
    Promise.all([sb.rpc("site_insights", { p_from: r.from, p_to: r.to }), sb.rpc("site_sales", { p_from: r.from, p_to: r.to })]).then(function (res) {
      perBusy = false;
      var err = res[0].error || res[1].error;
      if (err) { perErr = err.message; drawPeriod(); return; }
      perErr = ""; ins = res[0].data; sales = res[1].data; drawPeriod(); drawSummary();
    }, function (e) { perBusy = false; perErr = String(e && e.message || e); drawPeriod(); });
  }

  // ---------------------------------------------------------------- draw: live
  function tile(label, value, sub, cls) { return '<div class="sum-tile ex-tile' + (cls ? " " + cls : "") + '"><span>' + label + "</span><b>" + value + "</b><em>" + sub + "</em></div>"; }
  function drawLive() {
    if (!shown) return;
    if (liveErr) {
      $("exUpdated").textContent = /site_live|function/.test(liveErr) ? "Live data needs a one-time database update (booking-v58)." : "Live data paused: " + liveErr;
      el.classList.add("ex-stale");
      return;
    }
    if (!live) return;
    el.classList.remove("ex-stale");
    var t = live.today || {}, y = live.yday_same_time || {}, st = live.sales_today || {}, sy = live.sales_yday_same_time || {}, pt = live.paid_today || {}, py = live.paid_yday_same_time || {};
    $("exToday").innerHTML =
      tile("On the site now", n0(live.active_5), plural(live.active_30, "visit") + " in the last 30 min", num(live.active_5) ? "hot" : "") +
      tile("Visitors today", n0(t.visitors), delta(t.visitors, y.visitors) + " · " + plural(t.visits, "visit")) +
      tile("Opened a booking form", n0(t.booking_forms), delta(t.booking_forms, y.booking_forms) + " · " + pct(t.booking_forms, t.visits) + "% of visits") +
      tile("Website bookings today", n0(st.bookings), money(st.value) + " · " + delta(st.value, sy.value) + (num(st.requests) ? " · +" + plural(st.requests, "request") : "")) +
      tile("Paid online today", money(pt.amount), plural(pt.count, "payment") + " · " + delta(pt.amount, py.amount)) +
      tile("Conversion today", pct(st.bookings, t.visits) + "%", "website bookings ÷ visits");
    hourChart($("exHours"), live.by_hour || [], num(live.hour));
    var ses = live.sessions || [];
    var active = ses.filter(function (s) { return Date.now() - new Date(s.last_at).getTime() < 5 * 60e3; });
    $("exNowCount").textContent = active.length ? plural(active.length, "visitor") + " active in the last 5 min" : "no one in the last 5 min";
    $("exNow").innerHTML = ses.length ? ses.slice(0, 12).map(function (s) {
      var on = Date.now() - new Date(s.last_at).getTime() < 5 * 60e3, stage = num(s.stage);
      var what = stage ? STAGE[stage] + (stage < 6 && (s.villa || s.daytrip) ? (s.villa ? " · casita" : " · day trip") : "") : STAGE[0];
      return '<div class="ex-ses' + (on ? " on" : "") + '"><i class="ex-pip"></i><div><b>' + esc(s.page || "/") + '</b><span>' + esc(sourceName(s.source)) + " · " + esc(s.device || "?") + " · " + plural(s.views, "page") + "</span></div>" +
        '<div class="ex-ses-r"><span class="ex-stage s' + stage + '">' + esc(what) + "</span><em>" + esc(ago(s.last_at)) + "</em></div></div>";
    }).join("") : '<p class="ex-empty">No visits in the last 30 minutes.</p>';
    var feed = live.feed || [];
    $("exFeed").innerHTML = feed.length ? feed.slice(0, 30).map(function (e) {
      return '<div class="ex-ev ' + eventTone(e.kind) + '"><time>' + esc(new Date(e.at).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })) + "</time>" +
        '<span class="ex-evt">' + esc(eventText(e)) + (e.order_code ? ' <b>' + esc(e.order_code) + "</b>" : "") + "</span>" +
        '<span class="ex-evm">' + esc(sourceName(e.source)) + " · " + esc(e.device || "?") + "</span></div>";
    }).join("") : '<p class="ex-empty">No booking activity since yesterday.</p>';
    tickUpdated();
  }
  function tickUpdated() {
    if (!liveAt || liveErr) return;
    var s = Math.round((Date.now() - liveAt) / 1000);
    $("exUpdated").textContent = "Live · updated " + (s < 5 ? "just now" : s + "s ago") + " · refreshes every 15 s";
  }

  // ---------------------------------------------------------------- draw: period
  function drawPeriodChrome() {
    Array.prototype.forEach.call($("exPeriod").querySelectorAll("button"), function (b) { b.classList.toggle("on", b.getAttribute("data-p") === period); });
    var r = range();
    $("exPerH").innerHTML = (period === "month" ? "This month" : "Last " + period + " days") + " <small>" + esc(fmtDay(r.from)) + " – " + esc(fmtDay(r.to, { month: "short", day: "numeric", year: "numeric" })) + " · vs the " + (period === "month" ? "same number of days before" : "previous " + period + " days") + "</small>";
  }
  function drawPeriod() {
    if (!shown) return;
    drawPeriodChrome();
    if (perErr) {
      $("exPerTiles").innerHTML = '<p class="ex-empty cb-warn">' + esc(/site_sales|function/.test(perErr) ? "Sales figures need a one-time database update (booking-v58)." : "Couldn't load: " + perErr) + "</p>";
      return;
    }
    if (!ins || !sales) return;
    var tt = ins.totals || {}, c = sales.cur || {}, p = sales.prev || {};
    $("exPerTiles").innerHTML =
      tile("Visitors", n0(tt.visitors), plural(tt.visits, "visit") + " · " + plural(tt.page_views, "page view")) +
      tile("Website bookings", n0(c.live), delta(c.live, p.live) + (num(c.requests) ? " · +" + plural(c.requests, "request") : "") + (num(c.cancelled) ? " · " + n0(c.cancelled) + " expired/cancelled" : "")) +
      tile("Booked value", moneyShort(c.value), delta(c.value, p.value) + " · avg " + money(num(c.live) ? num(c.value) / num(c.live) : 0)) +
      tile("Paid online (Xendit)", moneyShort(c.paid_online), delta(c.paid_online, p.paid_online) + " · " + plural(c.paid_online_count, "payment")) +
      tile("Conversion", pct(c.live, tt.visits) + "%", "website bookings ÷ visits") +
      tile("Villas · Day trips", n0(c.villa) + " · " + n0(c.daytrip), moneyShort(c.villa_value) + " · " + moneyShort(c.daytrip_value) + (c.lead_days !== null && c.lead_days !== undefined ? " · booked " + n0(c.lead_days) + " days ahead" : ""));
    dayBars($("exVisDay"), ins.by_day || [], "visitors", function (r) { return plural(r.visitors, "visitor") + "<br>" + plural(r.visits, "visit"); }, "Visitors per day");
    dayBars($("exSalesDay"), sales.by_day || [], "value", function (r) { return plural(r.bookings, "website booking") + "<br>" + money(r.value); }, "Website booking value per day");
    funnel($("exFunV"), ins.funnel_villas);
    funnel($("exFunD"), ins.funnel_daytrip);
    var srcs = (ins.sources || []).slice(0, 8);
    $("exSources").innerHTML = barTable(srcs, [{ t: "Source", key: "name" }, { t: "Visits", key: "visits", fmt: function (r) { return n0(r.visits); } },
      { t: "Share", key: "s", fmt: function (r) { return pct(r.visits, tt.visits) + "%"; } }, { t: "Booked", key: "booked", fmt: function (r) { return n0(r.booked); } },
      { t: "Conv.", key: "c", fmt: function (r) { return pct(r.booked, r.visits) + "%"; } }]);
    $("exLanding").innerHTML = barTable((ins.landing || []).slice(0, 8), [{ t: "First page of the visit", key: "path" }, { t: "Visits", key: "visits", fmt: function (r) { return n0(r.visits); } },
      { t: "Booked", key: "booked", fmt: function (r) { return n0(r.booked); } }, { t: "Conv.", key: "c", fmt: function (r) { return pct(r.booked, r.visits) + "%"; } }]);
    var dv = ins.devices || [], dvt = dv.reduce(function (s, d) { return s + num(d.visits); }, 0);
    $("exDevices").innerHTML = barTable(dv, [{ t: "Device", key: "name" }, { t: "Visits", key: "visits", fmt: function (r) { return n0(r.visits); } }, { t: "Share", key: "s", fmt: function (r) { return pct(r.visits, dvt) + "%"; } }]);
    $("exBlocked").innerHTML = barTable((ins.blocked || []).slice(0, 8), [{ t: "Reason shown to the guest", key: "reason" }, { t: "Times", key: "times", fmt: function (r) { return n0(r.times); } }, { t: "Visits", key: "visits", fmt: function (r) { return n0(r.visits); } }]);
    var rec = sales.recent || [];
    $("exRecent").innerHTML = rec.length ? '<div class="ex-twrap"><table class="ex-t"><thead><tr><th>Booked</th><th>Booking #</th><th>Guest</th><th>Type</th><th>Stay</th><th class="num">Value</th><th class="num">Paid</th><th>Status</th></tr></thead><tbody>' +
      rec.map(function (b) {
        var villa = b.stay_type === "overnight";
        var st = D.statusLabel ? D.statusLabel(b) : b.status;
        return "<tr><td>" + esc(new Date(b.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + "</td><td>" + esc(b.order_code || "") + "</td><td>" + esc(b.first_name || "") +
          "</td><td>" + (villa ? "Villa" : "Day trip") + "</td><td>" + esc(fmtDay(b.check_in) + (villa && b.check_out ? " → " + fmtDay(b.check_out) : "")) + " · " + plural(b.pax, "guest") +
          '</td><td class="num">' + esc(money(b.total_amount)) + '</td><td class="num">' + esc(money(b.amount_paid)) + "</td><td>" + esc(st) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="ex-empty">No website bookings in this period.</p>';
  }

  // ---------------------------------------------------------------- executive summary
  function drawSummary() {
    if (!shown) return;
    var out = [];
    if (live && !liveErr) {
      var t = live.today || {}, y = live.yday_same_time || {}, st = live.sales_today || {}, pt = live.paid_today || {};
      var onForm = (live.sessions || []).filter(function (s) { return Date.now() - new Date(s.last_at).getTime() < 5 * 60e3 && num(s.stage) >= 1 && num(s.stage) <= 5; }).length;
      out.push("<b>Right now</b> " + (num(live.active_5) ? plural(live.active_5, "person is", "people are") + " on the site" + (onForm ? ", " + n0(onForm) + " in a booking form" : "") : "the site is quiet") + ".");
      var dv = num(y.visitors) ? Math.round((num(t.visitors) - num(y.visitors)) / num(y.visitors) * 100) : null;
      out.push("<b>Today so far</b> " + plural(t.visitors, "visitor") + (dv !== null ? " (" + (dv >= 0 ? "+" : "") + dv + "% vs this time yesterday)" : "") + ", " +
        plural(st.bookings, "website booking") + (num(st.value) ? " worth " + money(st.value) : "") + (num(pt.amount) ? " and " + money(pt.amount) + " paid online" : "") + ".");
    }
    if (ins && sales && !perErr) {
      var tt = ins.totals || {}, c = sales.cur || {}, p = sales.prev || {};
      var lbl = period === "month" ? "This month" : "Last " + period + " days";
      var dvv = num(p.value) ? Math.round((num(c.value) - num(p.value)) / num(p.value) * 100) : null;
      out.push("<b>" + lbl + "</b> " + plural(tt.visitors, "visitor") + ", " + plural(c.live, "website booking") + " worth " + moneyShort(c.value) +
        (dvv !== null ? " (" + (dvv >= 0 ? "+" : "") + dvv + "% vs the period before)" : "") + " — " + pct(c.live, tt.visits) + "% of visits booked.");
      var srcs = (ins.sources || []).filter(function (s) { return num(s.visits) >= 5; });
      if (srcs.length) {
        var topS = srcs[0], best = srcs.slice().sort(function (a, b) { return num(b.booked) / num(b.visits) - num(a.booked) / num(a.visits); })[0];
        out.push(esc(topS.name) + " brings the most visits (" + pct(topS.visits, tt.visits) + "%)" + (best && num(best.booked) && best.name !== topS.name ? "; " + esc(best.name) + " converts best (" + pct(best.booked, best.visits) + "%)" : "") + ".");
      }
      var worst = null;
      [["casita", ins.funnel_villas], ["day-trip", ins.funnel_daytrip]].forEach(function (f) {
        var s = f[1] || [];
        for (var i = 1; i < s.length - 2; i++) {
          var a = num(s[i - 1].visits), b = num(s[i].visits);
          if (a >= 5) { var loss = 1 - b / a; if (!worst || loss > worst.loss) worst = { loss: loss, name: f[0], from: s[i - 1].step, to: s[i].step }; }
        }
      });
      if (worst && worst.loss > 0.2) out.push("Biggest leak: " + worst.name + " funnel, “" + esc(worst.from) + "” → “" + esc(worst.to) + "” (" + Math.round(worst.loss * 100) + "% don't continue).");
      var bl = (ins.blocked || [])[0];
      if (bl && num(bl.times) >= 3) out.push("Most common block: “" + esc(String(bl.reason).slice(0, 90)) + "” (" + plural(bl.times, "time") + ").");
    }
    $("exSummary").innerHTML = out.length ? out.map(function (s) { return "<p>" + s + "</p>"; }).join("") : '<p class="muted">Loading…</p>';
  }

  // ---------------------------------------------------------------- timers
  var tLive = null, tPer = null, tTick = null;
  function start() {
    stop();
    loadLive(); loadPeriod();
    tLive = setInterval(loadLive, 15000);
    tPer = setInterval(function () { if (!document.hidden) loadPeriod(); }, 120000);
    tTick = setInterval(tickUpdated, 1000);
  }
  function stop() { clearInterval(tLive); clearInterval(tPer); clearInterval(tTick); tLive = tPer = tTick = null; }
  document.addEventListener("visibilitychange", function () { if (shown && !document.hidden) loadLive(); });
  var rz = null;
  window.addEventListener("resize", function () { if (!shown) return; clearTimeout(rz); rz = setTimeout(function () { drawLive(); drawPeriod(); }, 200); });

  // ---------------------------------------------------------------- executive accounts
  var exDone = false;
  function whenView(fn, tries) {
    if (window.VBRView) return fn(window.VBRView);
    if ((tries || 0) < 100) setTimeout(function () { whenView(fn, (tries || 0) + 1); }, 50);
  }
  function checkAccount() {
    if (dashScreen.style.display !== "block") { document.body.classList.remove("exec-staff"); exDone = false; return; }
    sb.auth.getSession().then(function (res) {
      var email = res.data && res.data.session && res.data.session.user ? String(res.data.session.user.email || "").toLowerCase() : "";
      var ex = EXEC_STAFF.indexOf(email) !== -1;
      document.body.classList.toggle("exec-staff", ex);
      if (ex && !exDone) { exDone = true; whenView(function (V) { V.set("executive"); }); }
      if (!ex && shown) whenView(function (V) { V.set("new"); });
    });
  }
  new MutationObserver(checkAccount).observe(dashScreen, { attributes: true, attributeFilter: ["style"] });
  checkAccount();

  window.VBRExec = {
    show: function (on) {
      var was = shown; shown = !!on;
      document.body.classList.toggle("exv", shown);
      if (shown && !was) start(); else if (!shown && was) { stop(); hideTip(); }
    },
  };
})();
