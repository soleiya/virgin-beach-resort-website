// =============================================================================
// Staff dashboard: "Insights" — website traffic, sources, booking funnels,
// why bookings were blocked, bookings, payments, emails and staff activity
// for any date range. Data: site_insights() (booking-v44-analytics.sql).
// "Download raw events" exports every recorded event in the range as CSV.
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc, peso = D.peso;
  var $ = function (id) { return document.getElementById(id); };

  // toolbar button
  var right = document.querySelector(".toolbar-right");
  if (right) {
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn-sm ghost"; btn.id = "insightsBtn"; btn.textContent = "Insights";
    right.insertBefore(btn, $("logBtn") || right.firstChild);
  }

  var bd = document.createElement("div");
  bd.className = "modal-backdrop"; bd.id = "insightsBackdrop";
  bd.innerHTML = '<div class="modal modal-wide ins-modal">' +
    '<div class="ins-head"><h2>Insights</h2><button type="button" class="btn-sm ghost" id="insClose">Close</button></div>' +
    '<div class="ins-ctl"><div class="ins-chips" id="insChips">' +
    '<button type="button" data-r="today">Today</button><button type="button" data-r="7">7 days</button><button type="button" data-r="30" class="on">30 days</button>' +
    '<button type="button" data-r="month">This month</button><button type="button" data-r="lastmonth">Last month</button><button type="button" data-r="90">90 days</button></div>' +
    '<label>From <input type="date" id="insFrom"></label><label>To <input type="date" id="insTo"></label>' +
    '<button type="button" class="btn-sm ghost" id="insCsv">Download raw events (CSV)</button></div>' +
    '<p class="ins-note">Website visits are counted from Nov 6, 2026 (when tracking started). Bookings, payments and emails go further back.</p>' +
    '<div id="insBody"><p class="muted">Loading…</p></div></div>';
  document.body.appendChild(bd);

  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function setRange(r) {
    var t = today(), from = t, to = t;
    if (r === "7" || r === "30" || r === "90") from = addDays(t, -(+r - 1));
    else if (r === "month") from = t.slice(0, 8) + "01";
    else if (r === "lastmonth") { var d = new Date(t.slice(0, 8) + "01T00:00:00Z"); d.setUTCDate(0); to = d.toISOString().slice(0, 10); from = to.slice(0, 8) + "01"; }
    $("insFrom").value = from; $("insTo").value = to;
    Array.prototype.forEach.call(bd.querySelectorAll("#insChips button"), function (b) { b.classList.toggle("on", b.getAttribute("data-r") === r); });
    load();
  }
  function open() { bd.classList.add("open"); if (!$("insFrom").value) setRange("30"); else load(); }
  if ($("insightsBtn")) $("insightsBtn").addEventListener("click", open);
  $("insClose").addEventListener("click", function () { bd.classList.remove("open"); });
  bd.addEventListener("click", function (e) { if (e.target === bd) bd.classList.remove("open"); });
  $("insChips").addEventListener("click", function (e) { var b = e.target.closest("[data-r]"); if (b) setRange(b.getAttribute("data-r")); });
  ["insFrom", "insTo"].forEach(function (id) { $(id).addEventListener("change", function () {
    Array.prototype.forEach.call(bd.querySelectorAll("#insChips button"), function (b) { b.classList.remove("on"); }); load(); }); });

  var seq = 0;
  function load() {
    var from = $("insFrom").value, to = $("insTo").value, my = ++seq;
    if (!from || !to || to < from) return;
    $("insBody").innerHTML = '<p class="muted">Loading…</p>';
    sb.rpc("site_insights", { p_from: from, p_to: to }).then(function (res) {
      if (my !== seq) return;
      if (res.error) { $("insBody").innerHTML = '<p class="muted">Couldn\'t load insights: ' + esc(res.error.message) + "</p>"; return; }
      render(res.data || {});
    });
  }

  // ------------------------------------------------------------ helpers
  function n(x) { return Number(x || 0).toLocaleString("en-PH"); }
  function pct(a, b) { return b ? Math.round(a / b * 100) + "%" : "—"; }
  function tile(label, value, sub) { return '<div class="ins-tile"><span>' + label + "</span><b>" + value + "</b>" + (sub ? "<em>" + sub + "</em>" : "") + "</div>"; }
  function bars(rows, labelKey, valueKey, extra) {
    var max = Math.max.apply(null, rows.map(function (r) { return +r[valueKey] || 0; }).concat(1));
    return rows.length ? '<div class="ins-bars">' + rows.map(function (r) {
      var v = +r[valueKey] || 0;
      return '<div class="ins-bar"><span class="l" title="' + esc(r[labelKey]) + '">' + esc(r[labelKey]) + '</span><span class="t"><i style="width:' + Math.max(2, v / max * 100) + '%"></i></span><span class="v">' + n(v) + (extra ? extra(r) : "") + "</span></div>";
    }).join("") + "</div>" : '<p class="muted">Nothing recorded yet.</p>';
  }
  function obj(o, labels) {
    var rows = Object.keys(o || {}).map(function (k) { return { name: (labels && labels[k]) || k, n: o[k] }; }).sort(function (a, b) { return b.n - a.n; });
    return bars(rows, "name", "n");
  }
  function funnel(steps) {
    var first = steps && steps[0] ? +steps[0].visits : 0;
    if (!first) return '<p class="muted">No visits to this booking form yet.</p>';
    return '<div class="ins-funnel">' + steps.map(function (s, i) {
      var v = +s.visits || 0, prev = i ? +steps[i - 1].visits || 0 : v;
      var drop = i && prev ? Math.round((1 - v / prev) * 100) : null;
      return '<div class="ins-fstep"><span class="l">' + esc(s.step) + '</span><span class="t"><i style="width:' + Math.max(2, v / first * 100) + '%"></i></span>' +
        '<span class="v">' + n(v) + " <small>" + pct(v, first) + "</small>" + (drop !== null && drop > 0 ? ' <small class="drop">−' + drop + "%</small>" : "") + "</span></div>";
    }).join("") + "</div>";
  }
  function section(title, html, hint) { return '<section class="ins-sec"><h3>' + title + "</h3>" + (hint ? '<p class="ins-hint">' + hint + "</p>" : "") + html + "</section>"; }

  var ORIGIN = { site_guest: "Website · guest", site_staff: "Website · staff", cloudbeds: "Cloudbeds / OTAs", sheet: "Day Trip sheet" };
  var TYPE = { day_trip: "Day Trip", half_day: "Half-Day", overnight: "Villa stay", corporate: "Corporate" };
  var EMAIL = { guest_quote: "Quotation", staff_new: "Staff alert (new)", staff_new_monitor: "Owner alert", guest_confirmed: "Confirmation",
    proof_staff: "Proof to check", proof_guest: "Proof received", guest_changed: "Change notice", balance_due: "Balance reminder",
    balance_overdue_guest: "Overdue (guest)", balance_overdue_staff: "Overdue (staff)", paid_in_full: "Paid in full", payment_received: "Payment received",
    guest_cancelled: "Cancelled", guest_expired: "Expired", proof_rejected: "Proof rejected", docs_staff: "Documents uploaded", overpaid: "Overpaid" };

  function render(d) {
    var t = d.totals || {}, b = d.bookings || {}, pay = d.payments || {}, em = d.emails || {};
    var dt = d.funnel_daytrip || [], vl = d.funnel_villas || [];
    var bookedVisits = (dt[5] ? +dt[5].visits : 0) + (vl[5] ? +vl[5].visits : 0);
    var html = '<div class="ins-tiles">' +
      tile("Visitors", n(t.visitors), n(t.visits) + " visits") +
      tile("Page views", n(t.page_views), t.visits ? (t.page_views / t.visits).toFixed(1) + " per visit" : "") +
      tile("Booked online", n(bookedVisits), pct(bookedVisits, t.visits) + " of visits") +
      tile("All new bookings", n(b.count), n(b.guests) + " guests" + (b.cancelled ? " · " + n(b.cancelled) + " cancelled" : "")) +
      tile("Booked value", peso(b.value || 0).replace(/\.00$/, ""), "excl. cancelled") +
      tile("Paid online", peso(pay.paid_amount || 0).replace(/\.00$/, ""), n(pay.paid) + " of " + n(pay.links_created) + " payment links") +
      tile("Booked ahead", b.lead_days != null ? n(b.lead_days) + " days" : "—", "average, booking → arrival") +
      "</div>";

    var days = d.by_day || [];
    var maxV = Math.max.apply(null, days.map(function (x) { return +x.visitors || 0; }).concat(1));
    var maxB = Math.max.apply(null, days.map(function (x) { return +x.bookings || 0; }).concat(1));
    html += section("Day by day", days.length > 62 ? "" : '<div class="ins-days">' + days.map(function (x) {
      return '<div class="ins-day" title="' + esc(x.day) + ": " + n(x.visitors) + " visitors, " + n(x.bookings) + ' bookings"><i class="v" style="height:' + (x.visitors / maxV * 100) + '%"></i><i class="b" style="height:' + (x.bookings / maxB * 100) + '%"></i><span>' + esc(String(x.day).slice(8)) + "</span></div>";
    }).join("") + '</div><p class="ins-legend"><i class="v"></i> visitors <i class="b"></i> bookings (all channels)</p>');

    html += '<div class="ins-grid">' +
      section("Day-trip booking funnel", funnel(dt), "How many visits reached each step. Red = lost since the step before.") +
      section("Villa booking funnel", funnel(vl), "Same, for the casita booking page.") + "</div>";

    html += '<div class="ins-grid">' +
      section("Where visitors came from", bars(d.sources || [], "name", "visits", function (r) { return r.booked ? ' <small>' + n(r.booked) + " booked</small>" : ""; })) +
      section("Why bookings were stopped", bars((d.blocked || []).map(function (r) { return { reason: r.reason, times: r.times }; }), "reason", "times"),
        "Messages guests hit on the booking forms (and errors). Fixing the top ones wins bookings.") + "</div>";

    html += '<div class="ins-grid">' +
      section("Most viewed pages", bars(d.pages || [], "path", "views")) +
      section("Landing pages", bars(d.landing || [], "path", "visits", function (r) { return r.booked ? ' <small>' + n(r.booked) + " booked</small>" : ""; }), "The first page of each visit.") + "</div>";

    html += '<div class="ins-grid">' +
      section("Devices", bars(d.devices || [], "name", "visits")) +
      section("Clicks from booking emails", bars((d.email_clicks || []).map(function (r) { return { e: EMAIL[r.email] || r.email, v: r.visits }; }), "e", "v"), "Visits that came from a link in one of our emails.") + "</div>";

    html += '<div class="ins-grid">' +
      section("Bookings by where they were made", obj(b.by_origin, ORIGIN)) +
      section("Bookings by type", obj(b.by_type, TYPE)) + "</div>";
    html += '<div class="ins-grid">' +
      section("Bookings by channel", obj(b.by_source, D.SOURCE_LABELS)) +
      section("Online payments", '<div class="ins-tiles small">' + tile("Payment links", n(pay.links_created)) + tile("Paid", n(pay.paid)) +
        tile("Expired", n(pay.expired)) + tile("Failed", n(pay.failed)) + "</div>" + obj(pay.by_channel), "Xendit checkout links created in this period, and how they were paid.") + "</div>";
    html += '<div class="ins-grid">' +
      section("Emails sent", '<p class="ins-hint">' + n(em.sent) + " sent" + (em.failed ? ' · <b style="color:#b4513f">' + n(em.failed) + " failed</b>" : "") + "</p>" +
        obj(Object.keys(em.by_kind || {}).reduce(function (o, k) { o[EMAIL[k] || k] = em.by_kind[k]; return o; }, {}))) +
      section("Staff activity", (d.staff || []).length ? '<table class="ins-table"><thead><tr><th>Staff</th><th class="num">Actions</th><th class="num">Booking changes</th><th>Most often</th></tr></thead><tbody>' +
        d.staff.map(function (s) { return "<tr><td>" + esc(s.who) + '</td><td class="num">' + n(s.actions) + '</td><td class="num">' + n(s.changes) + "</td><td>" + esc((s.top || []).map(function (k) { return String(k).replace(/^staff_/, "").replace(/_/g, " "); }).join(", ")) + "</td></tr>"; }).join("") +
        "</tbody></table>" : '<p class="muted">No staff activity recorded.</p>') + "</div>";
    $("insBody").innerHTML = html;
  }

  // raw events → CSV (paged, up to 50,000 rows)
  $("insCsv").addEventListener("click", function () {
    var from = $("insFrom").value, to = $("insTo").value, b = this;
    if (!from || !to) return;
    var t0 = new Date(from + "T00:00:00+08:00").toISOString(), t1 = new Date(addDays(to, 1) + "T00:00:00+08:00").toISOString();
    var rows = [], page = 0, size = 1000;
    b.disabled = true; b.textContent = "Preparing…";
    (function next() {
      sb.from("site_events").select("at,kind,path,order_code,actor,device,browser,ref_host,utm_source,utm_medium,utm_campaign,vid,sid,data")
        .gte("at", t0).lt("at", t1).order("at").range(page * size, page * size + size - 1).then(function (res) {
          if (res.error) { b.disabled = false; b.textContent = "Download raw events (CSV)"; alert(res.error.message); return; }
          rows = rows.concat(res.data || []);
          if ((res.data || []).length === size && rows.length < 50000) { page++; return next(); }
          var cols = ["at", "kind", "path", "order_code", "actor", "device", "browser", "ref_host", "utm_source", "utm_medium", "utm_campaign", "vid", "sid", "data"];
          var q = function (v) { v = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
          var csv = cols.join(",") + "\n" + rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(","); }).join("\n");
          var a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
          a.download = "vbr-site-events-" + from + "-to-" + to + ".csv";
          document.body.appendChild(a); a.click(); a.remove();
          b.disabled = false; b.textContent = "Download raw events (CSV)";
        });
    })();
  });
})();
