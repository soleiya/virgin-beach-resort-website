# -*- coding: utf-8 -*-
"""Manager summary — manager/index.html.
A read-only, phone-friendly overview of who's coming and what they booked, by
day / week / month. Not linked from the site. The passcode is checked by the
database (manager_summary() in booking-v41-manager-summary.sql), never here."""

import hashlib
import os

ROOT = os.path.dirname(os.path.abspath(__file__))


def v(rel):
    with open(os.path.join(ROOT, rel), "rb") as fh:
        return hashlib.sha1(fh.read()).hexdigest()[:10]


html = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Manager Summary · Virgin Beach Resort</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="../assets/brand/logo-mark.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..600&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/css/style.css?v=__V_CSS__">
<style>
  body { background: var(--sand); min-height: 100vh; margin: 0; }
  .mg { max-width: 1100px; margin: 0 auto; padding: 18px 16px 70px; }
  .mg-top { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .mg-top img { width: 34px; height: 34px; }
  .mg-top h1 { font-family: var(--font-display); font-weight: 600; font-size: 1.25rem; margin: 0; line-height: 1.1; }
  .mg-top small { display: block; font-size: .74rem; color: var(--ink-soft); font-family: var(--font-body); font-weight: 600; }
  .mg-top .out { margin-left: auto; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 999px; padding: 6px 12px; font: 600 .78rem var(--font-body); cursor: pointer; }

  /* passcode */
  #lock { max-width: 340px; margin: 12vh auto 0; text-align: center; background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 30px 24px; }
  #lock img { width: 52px; }
  #lock h2 { font-family: var(--font-display); font-weight: 600; margin: 10px 0 4px; font-size: 1.35rem; }
  #lock p { color: var(--ink-soft); font-size: .88rem; margin: 0 0 18px; }
  #code { width: 100%; box-sizing: border-box; text-align: center; font: 700 1.6rem var(--font-body); letter-spacing: .5em; padding: 12px 10px 12px 22px; border: 1px solid var(--line); border-radius: 12px; background: var(--sand); color: var(--ink); }
  #lock button { margin-top: 14px; width: 100%; border: 0; border-radius: 999px; background: var(--lagoon); color: #fff; font: 700 .95rem var(--font-body); padding: 12px; cursor: pointer; }
  #lockErr { color: #b4513f; font-size: .85rem; font-weight: 600; min-height: 1.2em; margin-top: 10px; }

  /* controls */
  .ctl { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
  .seg { display: inline-flex; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
  .seg button { border: 0; background: none; color: var(--ink-soft); font: 700 .85rem var(--font-body); padding: 7px 16px; border-radius: 999px; cursor: pointer; }
  .seg button.on { background: var(--lagoon); color: #fff; }
  .nav { display: inline-flex; align-items: center; gap: 6px; }
  .nav button { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 999px; min-width: 36px; height: 36px; font: 700 .9rem var(--font-body); cursor: pointer; padding: 0 12px; }
  .range { font-family: var(--font-display); font-size: 1.15rem; font-weight: 600; flex: 1 1 100%; order: -1; }
  @media (min-width: 700px) { .range { flex: 1 1 auto; order: 0; } }

  /* KPIs */
  .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 18px; }
  @media (min-width: 700px) { .kpis { grid-template-columns: repeat(6, 1fr); } }
  .kpi { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
  .kpi span { display: block; font-size: .66rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); }
  .kpi b { display: block; font-size: 1.3rem; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .kpi em { font-style: normal; font-size: .74rem; color: var(--ink-soft); }

  /* days & bookings */
  .day { margin-bottom: 18px; }
  .day-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 6px 2px; border-bottom: 2px solid var(--line); margin-bottom: 8px; position: sticky; top: 0; background: var(--sand); z-index: 2; }
  .day-h h3 { font-family: var(--font-display); font-weight: 600; font-size: 1.05rem; margin: 0; }
  .day-h .sum { font-size: .78rem; color: var(--ink-soft); font-weight: 600; }
  .grp { font-size: .68rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-soft); margin: 10px 2px 6px; }
  .bk { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; }
  .bk-1 { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .bk-1 b { font-size: .98rem; }
  .bk-1 .code { font-size: .72rem; color: var(--ink-soft); font-weight: 700; }
  .pill { font-size: .68rem; font-weight: 800; border-radius: 999px; padding: 2px 8px; background: var(--sand-deep); color: var(--ink-soft); }
  .pill.ok { background: var(--lagoon-tint); color: var(--lagoon-deep); }
  .pill.wait { background: #f6e6cf; color: #94591c; }
  .pill.in { background: #e3e9f6; color: #34508a; }
  .bk-amt { margin-left: auto; font-size: .8rem; font-weight: 700; white-space: nowrap; }
  .bk-amt small { font-weight: 600; color: var(--ink-soft); }
  .bk-party { font-size: .84rem; margin-top: 3px; }
  .bk-names { font-size: .8rem; color: var(--ink-soft); margin-top: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
  .chips span { font-size: .74rem; font-weight: 600; background: var(--sand); border: 1px solid var(--line); border-radius: 7px; padding: 2px 8px; }
  .chips span.k { background: var(--lagoon-tint); border-color: transparent; color: var(--lagoon-deep); }
  .empty { text-align: center; color: var(--ink-soft); padding: 40px 10px; background: var(--surface); border: 1px dashed var(--line); border-radius: 14px; }
  .note { font-size: .76rem; color: var(--ink-soft); margin-top: 20px; text-align: center; }
  .compact .bk-names, .compact .chips span:not(.k) { display: none; }
  .compact .bk { padding: 8px 10px; }
  #loading { color: var(--ink-soft); font-size: .85rem; padding: 20px 2px; }
</style>
</head>
<body>
<div class="mg">
  <div id="lock">
    <img src="../assets/brand/logo-mark.png" alt="">
    <h2>Manager Summary</h2>
    <p>Enter the passcode to view bookings.</p>
    <form id="lockForm" autocomplete="off">
      <input id="code" type="password" inputmode="numeric" maxlength="12" aria-label="Passcode" autofocus>
      <button type="submit" id="lockBtn">View summary</button>
    </form>
    <div id="lockErr"></div>
  </div>

  <div id="app" hidden>
    <div class="mg-top">
      <img src="../assets/brand/logo-mark.png" alt="">
      <h1>Manager Summary<small>Virgin Beach Resort · read-only</small></h1>
      <button class="out" id="outBtn" type="button">Lock</button>
    </div>
    <div class="ctl">
      <div class="seg" role="tablist">
        <button type="button" data-v="day" class="on">Day</button>
        <button type="button" data-v="week">Week</button>
        <button type="button" data-v="month">Month</button>
      </div>
      <div class="range" id="rangeLbl"></div>
      <div class="nav">
        <button type="button" id="prevBtn" aria-label="Previous">&lsaquo;</button>
        <button type="button" id="todayBtn">Today</button>
        <button type="button" id="nextBtn" aria-label="Next">&rsaquo;</button>
      </div>
    </div>
    <div class="kpis" id="kpis"></div>
    <div id="list"><div id="loading">Loading…</div></div>
    <p class="note">Cancelled and expired bookings are not shown. Overnight stays appear on every night they're in-house. Amounts for Cloudbeds bookings come from Cloudbeds.</p>
  </div>
</div>

<script src="../assets/js/booking-config.js?v=__V_CFG__"></script>
<script>
(function () {
  var cfg = window.SUPABASE_CONFIG || {};
  var KEY = "vbr.mgr";
  var code = null, view = "day", anchor = today(), data = null, cache = {};
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function addDays(d, k) { var x = new Date(d); x.setDate(x.getDate() + k); return x; }
  function parse(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function peso(n) { return n == null ? "" : "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 0 }); }
  function fmt(d, o) { return d.toLocaleDateString("en-PH", o); }
  function plural(n, a, b) { return n + " " + (n === 1 ? a : (b || a + "s")); }

  function range() {
    var a = anchor, from, to;
    if (view === "day") { from = to = a; }
    else if (view === "week") { from = addDays(a, -((a.getDay() + 6) % 7)); to = addDays(from, 6); }
    else { from = new Date(a.getFullYear(), a.getMonth(), 1); to = new Date(a.getFullYear(), a.getMonth() + 1, 0); }
    return { from: from, to: to };
  }
  function rangeLabel(r) {
    if (view === "day") return fmt(r.from, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (view === "week") return fmt(r.from, { month: "short", day: "numeric" }) + " – " + fmt(r.to, { month: "short", day: "numeric", year: "numeric" });
    return fmt(r.from, { month: "long", year: "numeric" });
  }

  function call(from, to) {
    return fetch(cfg.url + "/rest/v1/rpc/manager_summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey },
      body: JSON.stringify({ p_code: code, p_from: iso(from), p_to: iso(to) }),
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error((j && (j.message || j.hint)) || "Couldn't load");
        return j;
      });
    });
  }

  // ---------- passcode ----------
  function unlock(c, quiet) {
    code = c;
    var r = range();
    $("lockBtn").disabled = true;
    return call(r.from, r.to).then(function (j) {
      $("lockBtn").disabled = false;
      if (!j.ok) { code = null; $("lockErr").textContent = j.error || "Wrong passcode"; try { sessionStorage.removeItem(KEY); } catch (e) {} return; }
      try { sessionStorage.setItem(KEY, c); } catch (e) {}
      $("lock").hidden = true; $("app").hidden = false;
      cache = {}; cache[iso(r.from) + iso(r.to)] = j;
      render(j);
    }).catch(function (e) { $("lockBtn").disabled = false; code = null; if (!quiet) $("lockErr").textContent = e.message; });
  }
  $("lockForm").addEventListener("submit", function (e) { e.preventDefault(); $("lockErr").textContent = ""; var c = $("code").value.trim(); if (c) unlock(c); });
  $("outBtn").addEventListener("click", function () { try { sessionStorage.removeItem(KEY); } catch (e) {} code = null; cache = {}; $("app").hidden = true; $("lock").hidden = false; $("code").value = ""; $("code").focus(); });

  // ---------- navigation ----------
  Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (b) {
    b.addEventListener("click", function () {
      view = b.getAttribute("data-v");
      Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (x) { x.classList.toggle("on", x === b); });
      load();
    });
  });
  function step(k) {
    if (view === "day") anchor = addDays(anchor, k);
    else if (view === "week") anchor = addDays(anchor, 7 * k);
    else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + k, 1);
    load();
  }
  $("prevBtn").addEventListener("click", function () { step(-1); });
  $("nextBtn").addEventListener("click", function () { step(1); });
  $("todayBtn").addEventListener("click", function () { anchor = today(); load(); });
  document.addEventListener("keydown", function (e) { if ($("app").hidden || e.target.tagName === "INPUT") return; if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); });

  function load() {
    var r = range(), k = iso(r.from) + iso(r.to);
    $("rangeLbl").textContent = rangeLabel(r);
    if (cache[k]) return render(cache[k]);
    $("list").innerHTML = '<div id="loading">Loading…</div>';
    call(r.from, r.to).then(function (j) {
      if (!j.ok) { $("outBtn").click(); $("lockErr").textContent = j.error || "Please enter the passcode again."; return; }
      cache[k] = j; render(j);
    }).catch(function (e) { $("list").innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; });
  }

  // ---------- render ----------
  var TYPE = { overnight: "Overnight", day_trip: "Day Trip", half_day: "Half-Day Trip", corporate: "Corporate" };
  function statusPill(b) {
    if (b.type === "overnight" && b.cb_status === "checked_in") return '<span class="pill in">In-house</span>';
    if (b.status === "confirmed") return '<span class="pill ok">Confirmed</span>';
    if (b.status === "completed") return '<span class="pill">Completed</span>';
    if (b.status === "pending_payment") return '<span class="pill wait">Payment to verify</span>';
    return '<span class="pill wait">Awaiting payment</span>';
  }
  function party(b) { return (b.adults || 0) + (b.kids612 || 0) + (b.kids05 || 0); }
  function partyText(b) {
    var t = [plural(b.adults || 0, "adult")];
    if (b.kids612) t.push(plural(b.kids612, "kid") + " 6–12");
    if (b.kids05) t.push(plural(b.kids05, "kid") + " 0–5");
    var x = t.join(", ");
    var sp = [];
    if (b.seniors) sp.push(b.seniors + " senior/PWD");
    if (b.pwd_kids) sp.push(b.pwd_kids + " PWD kid" + (b.pwd_kids === 1 ? "" : "s"));
    return x + (sp.length ? " (incl. " + sp.join(", ") + ")" : "");
  }
  function nights(b) { return b.check_out ? Math.round((parse(b.check_out) - parse(b.check_in)) / 864e5) : 1; }
  function chips(b) {
    var c = [];
    if (b.type === "overnight") {
      if (b.villas) b.villas.split(", ").forEach(function (v) { c.push('<span class="k">' + esc(v) + "</span>"); });
      else c.push('<span class="k">Casita to assign</span>');
      c.push("<span>" + plural(nights(b), "night") + " · " + fmt(parse(b.check_in), { month: "short", day: "numeric" }) + " → " + fmt(parse(b.check_out), { month: "short", day: "numeric" }) + "</span>");
      c.push("<span>Full-board meals</span>");
      if (b.extra_beds) c.push("<span>" + plural(b.extra_beds, "extra bed") + "</span>");
    } else {
      if (b.dining) c.push('<span class="k">' + plural(b.dining, "Dining Cabana") + "</span>");
      if (b.lounge) c.push('<span class="k">' + plural(b.lounge, "Lounge Cabana") + "</span>");
      if (!b.dining && !b.lounge && b.type !== "corporate") c.push('<span class="k" style="background:#f6e6cf;color:#94591c">No cabana</span>');
      if (b.cabana_nos) c.push("<span>Cabana no. " + esc(b.cabana_nos) + "</span>");
      c.push("<span>" + (b.type === "half_day" ? "Afternoon snacks" : b.type === "corporate" ? "Corporate package" : "Lunch included") + "</span>");
    }
    if (b.add_ons) c.push("<span>" + esc(b.add_ons) + "</span>");
    if (b.pets) c.push("<span>" + plural(b.pets, "pet") + "</span>");
    if (b.occasion) c.push("<span>🎉 " + esc(b.occasion) + "</span>");
    return '<div class="chips">' + c.join("") + "</div>";
  }
  function card(b, tag) {
    var names = b.party_names && b.party_names !== b.guest ? b.party_names.replace(new RegExp("^" + b.guest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ",\\s*"), "") : "";
    var amt = b.total != null ? peso(b.total) + (b.paid != null && b.total > 0 ? " <small>· " + (Number(b.paid) >= Number(b.total) - 0.5 ? "paid" : Number(b.paid) > 0 ? peso(b.paid) + " paid" : "unpaid") + "</small>" : "") : "";
    if (b.sheet && b.status === "confirmed" && !Number(b.paid)) amt = (b.total != null ? peso(b.total) + " " : "") + "<small>· paid (sheet)</small>";
    return '<div class="bk"><div class="bk-1"><b>' + esc(b.guest || "—") + '</b><span class="code">' + esc(b.code || "") + "</span>" + statusPill(b) +
      (tag ? '<span class="pill">' + tag + "</span>" : "") + '<span class="bk-amt">' + amt + "</span></div>" +
      '<div class="bk-party">' + esc(TYPE[b.type] || b.type_label || "") + " · " + esc(partyText(b)) + "</div>" +
      (names ? '<div class="bk-names">With: ' + esc(names) + "</div>" : "") + chips(b) + "</div>";
  }

  function render(j) {
    var r = range(), days = [], bk = j.bookings || [];
    for (var d = new Date(r.from); d <= r.to; d = addDays(d, 1)) days.push(new Date(d));
    var nDays = days.length;

    // KPIs (range)
    var dayGuests = 0, cab = 0, arrivals = 0, arrGuests = 0, roomNights = 0, value = 0, pending = 0, inRange = 0;
    var fromS = iso(r.from), toS = iso(r.to);
    bk.forEach(function (b) {
      var startsIn = b.check_in >= fromS && b.check_in <= toS;
      if (b.type === "overnight") {
        var units = b.villas ? b.villas.split(", ").length : 1;
        days.forEach(function (d) { var s = iso(d); if (s >= b.check_in && s < b.check_out) roomNights += units; });
        if (startsIn) { arrivals++; arrGuests += party(b); }
      } else if (startsIn) { dayGuests += party(b); cab += (b.dining || 0) + (b.lounge || 0); }
      if (startsIn) { inRange++; value += Number(b.total) || 0; if (b.status === "pending" || b.status === "pending_payment") pending++; }
    });
    var occ = j.casitas_total ? Math.round(roomNights / (j.casitas_total * nDays) * 100) : null;
    $("kpis").innerHTML = [
      ["Day-trip guests", dayGuests, plural(cab, "cabana")],
      ["Overnight arrivals", arrGuests, plural(arrivals, "booking")],
      ["Casita-nights", roomNights, occ != null ? occ + "% occupancy" : ""],
      ["Bookings", inRange, pending ? pending + " awaiting payment" : "all settled"],
      ["Booked value", peso(value), "by arrival date"],
      ["Casitas", j.casitas_total || "—", "in total"],
    ].map(function (k) { return '<div class="kpi"><span>' + k[0] + "</span><b>" + k[1] + "</b><em>" + k[2] + "</em></div>"; }).join("");

    // per day
    var out = "";
    days.forEach(function (d) {
      var s = iso(d);
      var arriving = [], staying = [], dayt = [];
      bk.forEach(function (b) {
        if (b.type === "overnight") {
          if (b.check_in === s) arriving.push(b);
          else if (b.check_in < s && b.check_out > s) staying.push(b);
        } else if (b.check_in === s) dayt.push(b);
      });
      if (view !== "day" && !arriving.length && !dayt.length && !staying.length) return;
      var dg = dayt.reduce(function (t, b) { return t + party(b); }, 0);
      var og = arriving.concat(staying).reduce(function (t, b) { return t + party(b); }, 0);
      var h = '<div class="day"><div class="day-h"><h3>' + esc(fmt(d, { weekday: "short", month: "short", day: "numeric" })) + "</h3>" +
        '<span class="sum">' + [dayt.length ? plural(dg, "day-trip guest") : "", og ? plural(og, "overnight guest") : ""].filter(Boolean).join(" · ") + "</span></div>";
      if (arriving.length) h += '<div class="grp">Arriving · overnight</div>' + arriving.map(function (b) { return card(b); }).join("");
      if (staying.length && view === "day") h += '<div class="grp">Staying over</div>' + staying.map(function (b) { return card(b, "night " + (Math.round((d - parse(b.check_in)) / 864e5) + 1) + " of " + nights(b)); }).join("");
      else if (staying.length) h += '<div class="grp">Staying over: ' + esc(staying.map(function (b) { return b.guest; }).join(", ")) + "</div>";
      if (dayt.length) h += '<div class="grp">Day trips</div>' + dayt.map(function (b) { return card(b); }).join("");
      if (!arriving.length && !staying.length && !dayt.length) h += '<div class="empty">No bookings on this day.</div>';
      out += h + "</div>";
    });
    $("list").className = view === "month" ? "compact" : "";
    $("list").innerHTML = out || '<div class="empty">No bookings in this ' + view + ".</div>";
  }

  // remember the passcode for this browser tab only
  var saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (e) {}
  $("rangeLbl").textContent = rangeLabel(range());
  if (saved) unlock(saved, true);
})();
</script>
</body>
</html>
"""

html = html.replace("__V_CSS__", v("assets/css/style.css")).replace("__V_CFG__", v("assets/js/booking-config.js"))
os.makedirs(os.path.join(ROOT, "manager"), exist_ok=True)
with open(os.path.join(ROOT, "manager", "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print("wrote manager/index.html")
