// =============================================================================
// Staff dashboard: "F&B" view (booking-v89) — StoreHub POS sales from the food &
// beverage outlets (Front Office, Pavilion 1, Pavilion 2, Warehouse), synced to
// Supabase every 15 minutes by the storehub-sync edge function.
//   Tiles     net sales (excl. VAT + service charge), gross paid, transactions,
//             average sale, items sold
//   Tabs      By day · By outlet · Products · Payment methods · Transactions
// Data: sh_report(from, to). Read-only — nothing here changes data, so view-only
// staff (Accounting) can use it as is. Every tab exports to CSV.
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc;
  var dashScreen = document.getElementById("dashScreen");
  var $ = function (id) { return document.getElementById(id); };

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function todayStr() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function dd(s) { return new Date(s + "T00:00:00Z"); }
  function iso(x) { return x.toISOString().slice(0, 10); }
  function addDays(s, n) { var x = dd(s); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
  function fmt(s, o) { if (!s) return "—"; o = o || { weekday: "short", month: "short", day: "numeric", year: "numeric" }; o.timeZone = "UTC"; return dd(String(s).slice(0, 10)).toLocaleDateString("en-PH", o); }
  function manila(ts) { return ts ? new Date(ts).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; }
  function num(v) { return Number(v) || 0; }
  function money(n) { return "₱" + num(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function n0(n) { return num(n).toLocaleString("en-PH", { maximumFractionDigits: 1 }); }

  // ---------------------------------------------------------------- state
  var shown = false, tab = store("vbr.fnbTab") || "days", span = store("vbr.fnbSpan") || "month", from, to, R = null, err = "", loading = 0;
  if (["days", "stores", "products", "payments", "recent"].indexOf(tab) === -1) tab = "days";
  if (["day", "week", "month", "year"].indexOf(span) === -1) span = "month";
  function setSpan(anchor) {
    var a = anchor || todayStr();
    if (span === "day") { from = to = a; }
    else if (span === "week") { var wd = (dd(a).getUTCDay() + 6) % 7; from = addDays(a, -wd); to = addDays(from, 6); }
    else if (span === "month") { var x = dd(a); x.setUTCDate(1); from = iso(x); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); to = iso(x); }
    else { from = a.slice(0, 4) + "-01-01"; to = a.slice(0, 4) + "-12-31"; }
  }
  setSpan();
  function step(k) {
    if (span === "custom") { var n = Math.round((dd(to) - dd(from)) / 864e5) + 1; from = addDays(from, k * n); to = addDays(to, k * n); }
    else if (span === "day") setSpan(addDays(from, k));
    else if (span === "week") setSpan(addDays(from, 7 * k));
    else if (span === "month") { var x = dd(from); x.setUTCMonth(x.getUTCMonth() + k); setSpan(iso(x)); }
    else setSpan((Number(from.slice(0, 4)) + k) + "-01-01");
    load();
  }

  // ---------------------------------------------------------------- shell
  var el = document.createElement("section");
  el.id = "fnbView";
  el.innerHTML =
    '<div class="acc-head"><div><h2>F&amp;B outlets</h2><p id="fnbRangeLabel"></p></div>' +
    '<button type="button" class="btn-sm primary" id="fnbExport">⬇ Export to Excel (CSV)</button></div>' +
    '<div class="acc-ctl">' +
      '<div class="sum-seg" id="fnbSpan"><button type="button" data-s="day">Day</button><button type="button" data-s="week">Week</button><button type="button" data-s="month">Month</button><button type="button" data-s="year">Year</button></div>' +
      '<div class="acc-dates"><button type="button" class="acc-nav" data-step="-1" aria-label="Previous period">&lsaquo;</button>' +
        '<input type="date" id="fnbFrom" aria-label="From"><span>to</span><input type="date" id="fnbTo" aria-label="To">' +
        '<button type="button" class="acc-nav" data-step="1" aria-label="Next period">&rsaquo;</button></div>' +
    "</div>" +
    '<div class="acc-tiles" id="fnbTiles"></div>' +
    '<div class="acc-tabs" role="tablist"><button type="button" data-t="days">By day</button><button type="button" data-t="stores">By outlet</button>' +
      '<button type="button" data-t="products">Products</button><button type="button" data-t="payments">Payment methods</button><button type="button" data-t="recent">Transactions</button></div>' +
    '<div id="fnbBody"><p class="acc-empty">Loading…</p></div>' +
    '<p class="acc-foot" id="fnbFoot"></p>';
  dashScreen.insertBefore(el, dashScreen.firstChild);

  el.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-s]"))) { span = b.getAttribute("data-s"); store("vbr.fnbSpan", span); setSpan(span === "day" ? todayStr() : from); load(); return; }
    if ((b = e.target.closest("[data-t]"))) { tab = b.getAttribute("data-t"); store("vbr.fnbTab", tab); draw(); return; }
    if ((b = e.target.closest("[data-step]"))) { step(+b.getAttribute("data-step")); return; }
    if ((b = e.target.closest("[data-day]"))) { span = "day"; from = to = b.getAttribute("data-day"); tab = "recent"; load(); return; }
  });
  el.addEventListener("change", function (e) {
    if (e.target.id !== "fnbFrom" && e.target.id !== "fnbTo") return;
    var f = $("fnbFrom").value, t = $("fnbTo").value;
    if (!f || !t) return;
    if (t < f) { var x = f; f = t; t = x; }
    from = f; to = t; span = "custom";
    load();
  });
  $("fnbExport").addEventListener("click", exportCsv);

  // ---------------------------------------------------------------- data
  function load() {
    if (!shown) return;
    var my = ++loading;
    err = ""; R = null;
    $("fnbBody").innerHTML = '<p class="acc-empty">Loading…</p>';
    drawChrome();
    sb.rpc("sh_report", { p_from: from, p_to: to }).then(function (res) {
      if (my !== loading) return;
      if (res.error) { err = res.error.message || String(res.error); R = null; } else R = res.data;
      draw();
    }, function (e) { if (my !== loading) return; err = (e && e.message) || "Could not load"; draw(); });
  }

  // ---------------------------------------------------------------- drawing
  function drawChrome() {
    $("fnbRangeLabel").textContent = from === to ? fmt(from) : fmt(from, { month: "short", day: "numeric", year: "numeric" }) + " – " + fmt(to, { month: "short", day: "numeric", year: "numeric" });
    $("fnbFrom").value = from; $("fnbTo").value = to;
    Array.prototype.forEach.call(el.querySelectorAll("[data-s]"), function (b) { b.classList.toggle("on", b.getAttribute("data-s") === span); });
    Array.prototype.forEach.call(el.querySelectorAll("[data-t]"), function (b) { b.classList.toggle("on", b.getAttribute("data-t") === tab); });
  }
  function tile(k, v, s, cls) { return '<div class="sum-tile' + (cls ? " " + cls : "") + '"><span>' + k + "</span><b>" + v + "</b>" + (s ? "<em>" + s + "</em>" : "") + "</div>"; }
  function table(head, rows, foot) {
    return '<div class="acc-table-wrap"><table class="acc-table"><thead><tr>' + head.map(function (h) { return "<th" + (h.n ? ' class="num"' : "") + ">" + h.t + "</th>"; }).join("") + "</tr></thead><tbody>" +
      (rows.length ? rows.join("") : '<tr><td class="acc-none" colspan="' + head.length + '">No sales in this period.</td></tr>') + "</tbody>" +
      (foot && rows.length ? "<tfoot>" + foot + "</tfoot>" : "") + "</table></div>";
  }
  function draw() {
    drawChrome();
    var T = (R && R.totals) || {};
    var sales = num(T.sales);
    $("fnbTiles").innerHTML = R ? (
      tile("Net sales", money(T.net), "excl. VAT &amp; service charge") +
      tile("Gross paid", money(T.gross), "VAT " + money(T.tax) + (num(T.service_charge) ? " · service charge " + money(T.service_charge) : "")) +
      tile("Transactions", n0(sales), (num(T.returns) ? n0(T.returns) + " returns · " : "") + n0(T.cancelled) + " cancelled") +
      tile("Average sale", money(sales ? num(T.gross) / sales : 0), "gross per transaction") +
      tile("Items sold", n0(T.items), num(T.discount) ? "discounts " + money(T.discount) : "")) : "";
    var foot = "Source: StoreHub POS (ntq.storehubhq.com), synced every 15 minutes" +
      (R && R.synced_at ? " · last data " + manila(R.synced_at) : "") +
      (R && R.last_pull && R.last_pull.at ? " · last check " + manila(R.last_pull.at) : "") +
      ". Net = paid − VAT − service charge; cancelled sales excluded, returns subtracted. Dates are Manila time. Not included in Cloudbeds or the accounting figure.";
    $("fnbFoot").textContent = foot;
    if (err) { $("fnbBody").innerHTML = '<p class="acc-empty">Couldn’t load F&amp;B sales: ' + esc(err) + "</p>"; return; }
    if (!R) return;
    var h;
    if (tab === "days") {
      h = table([{ t: "Date" }, { t: "Transactions", n: 1 }, { t: "Gross paid", n: 1 }, { t: "Net sales", n: 1 }],
        (R.days || []).map(function (d) { return '<tr><td><a href="#" data-day="' + esc(d.date) + '">' + esc(fmt(d.date)) + '</a></td><td class="num">' + n0(d.sales) + '</td><td class="num">' + money(d.gross) + '</td><td class="num">' + money(d.net) + "</td></tr>"; }),
        '<tr><td>Total</td><td class="num">' + n0(sales) + '</td><td class="num">' + money(T.gross) + '</td><td class="num">' + money(T.net) + "</td></tr>");
    } else if (tab === "stores") {
      h = table([{ t: "Outlet" }, { t: "Transactions", n: 1 }, { t: "Gross paid", n: 1 }, { t: "Net sales", n: 1 }, { t: "Share", n: 1 }],
        (R.stores || []).map(function (s) { return "<tr><td>" + esc(s.store) + '</td><td class="num">' + n0(s.sales) + '</td><td class="num">' + money(s.gross) + '</td><td class="num">' + money(s.net) + '</td><td class="num">' + (num(T.net) ? Math.round(num(s.net) / num(T.net) * 1000) / 10 + "%" : "—") + "</td></tr>"; }),
        '<tr><td>Total</td><td class="num">' + n0(sales) + '</td><td class="num">' + money(T.gross) + '</td><td class="num">' + money(T.net) + '</td><td class="num">100%</td></tr>');
    } else if (tab === "products") {
      h = '<p class="acc-note">Top 50 products by sales amount (net of VAT for days loaded from StoreHub’s reports).</p>' +
        table([{ t: "#" }, { t: "Product" }, { t: "Category" }, { t: "Qty", n: 1 }, { t: "Amount", n: 1 }],
          (R.products || []).map(function (p, i) { return "<tr><td>" + (i + 1) + "</td><td>" + esc(p.product) + "</td><td>" + esc(p.category || "—") + '</td><td class="num">' + n0(p.qty) + '</td><td class="num">' + money(p.amount) + "</td></tr>"; }));
    } else if (tab === "payments") {
      h = table([{ t: "Payment method" }, { t: "Payments", n: 1 }, { t: "Amount", n: 1 }],
        (R.payments || []).map(function (p) { return "<tr><td>" + esc(p.method) + '</td><td class="num">' + n0(p.count) + '</td><td class="num">' + money(p.amount) + "</td></tr>"; }));
    } else {
      h = '<p class="acc-note">Latest 300 entries in the period, newest first. Days loaded from StoreHub’s reports show one “Daily summary” line per outlet.</p>' +
        table([{ t: "Time" }, { t: "Invoice" }, { t: "Outlet" }, { t: "Items" }, { t: "Paid by" }, { t: "Total", n: 1 }],
          (R.recent || []).map(function (r) {
            var cls = r.cancelled ? ' class="acc-rejected"' : "";
            var tag = r.cancelled ? " <small>(cancelled)</small>" : r.type === "Return" ? " <small>(return)</small>" : "";
            return "<tr" + cls + "><td>" + esc(manila(r.time)) + "</td><td>" + esc(r.invoice || "—") + tag + "</td><td>" + esc(r.store) + "</td><td>" + esc(r.items || "—") + "</td><td>" + esc(r.method || "—") + '</td><td class="num">' + (r.type === "Return" ? "−" : "") + money(r.total) + "</td></tr>";
          }));
    }
    $("fnbBody").innerHTML = h;
  }

  // ---------------------------------------------------------------- CSV
  function exportCsv() {
    if (!R) return;
    var rows, name = "fnb-" + tab + "-" + from + (to !== from ? "_" + to : "") + ".csv";
    if (tab === "days") rows = [["Date", "Transactions", "Gross paid", "Net sales"]].concat((R.days || []).map(function (d) { return [d.date, d.sales, d.gross, d.net]; }));
    else if (tab === "stores") rows = [["Outlet", "Transactions", "Gross paid", "Net sales"]].concat((R.stores || []).map(function (s) { return [s.store, s.sales, s.gross, s.net]; }));
    else if (tab === "products") rows = [["Product", "Category", "Qty", "Amount"]].concat((R.products || []).map(function (p) { return [p.product, p.category || "", p.qty, p.amount]; }));
    else if (tab === "payments") rows = [["Payment method", "Payments", "Amount"]].concat((R.payments || []).map(function (p) { return [p.method, p.count, p.amount]; }));
    else rows = [["Time (Manila)", "Invoice", "Outlet", "Type", "Cancelled", "Items", "Paid by", "Total"]].concat((R.recent || []).map(function (r) { return [manila(r.time), r.invoice || "", r.store, r.type, r.cancelled ? "yes" : "", r.items || "", r.method || "", r.total]; }));
    var csv = rows.map(function (r) { return r.map(function (c) { c = c == null ? "" : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // refresh while open, in step with the 15-minute sync
  setInterval(function () { if (shown && !document.hidden) load(); }, 5 * 60 * 1000);

  window.VBRFnb = {
    show: function (on) { var was = shown; shown = !!on; document.body.classList.toggle("fnbv", shown); if (shown && !was) load(); },
  };
})();
