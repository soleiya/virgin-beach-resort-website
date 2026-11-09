// =============================================================================
// Staff dashboard: "Accounting" view (v1) — money first, for the accounting
// team. Three tabs over one period:
//   Payments    — every payment (Xendit, transfers, cash, card…) with method,
//                 reference, who recorded / verified it and its Cloudbeds post
//   Receivables — bookings with money still owed, as of today, with due dates
//   Revenue     — totals per day / month: booked (rooms, meals, extras,
//                 discounts) by stay date, or collected per method by payment date
// "By payment date" / "By stay date" switches what the period means. Every
// tab exports to CSV (opens in Excel). Read-only: nothing here changes data.
// Accounting accounts (ACCOUNTING_STAFF) open on this view and are view-only
// everywhere — the database refuses their changes too (booking-v56).
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc;
  var ACCOUNTING_STAFF = ["mae@staff.local"];
  var dashScreen = document.getElementById("dashScreen");

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function todayStr() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function dd(s) { return new Date(s + "T00:00:00Z"); }
  function iso(x) { return x.toISOString().slice(0, 10); }
  function addDays(s, n) { var x = dd(s); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
  function fmt(s, o) { if (!s) return "—"; o = o || { month: "short", day: "numeric", year: "numeric" }; o.timeZone = "UTC"; return dd(String(s).slice(0, 10)).toLocaleDateString("en-PH", o); }
  function manilaDay(ts) { return ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) : ""; }
  function manilaTime(ts) { return ts ? new Date(ts).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }) : ""; }
  function num(v) { return Number(v) || 0; }
  function money(n) { return "₱" + num(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function plural(n, a, b) { return n + " " + (n === 1 ? a : (b || a + "s")); }
  function isVilla(r) { return r.stay_type === "overnight"; }
  function pax(r) { return num(r.adults) + num(r.children_6_12) + num(r.children_0_5); }

  // ---------------------------------------------------------------- state
  var shown = false, tab = store("vbr.accTab") || "payments", basis = store("vbr.accBasis") || "payment";
  var span = store("vbr.accSpan") || "month", kind = "all", recFilter = "all", showRejected = false;
  var from, to;
  if (["payments", "receivables", "revenue"].indexOf(tab) === -1) tab = "payments";
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
  el.id = "accView";
  el.innerHTML =
    '<div class="acc-head"><div><h2>Accounting</h2><p id="accRangeLabel"></p></div>' +
    '<button type="button" class="btn-sm primary" id="accExport">⬇ Export to Excel (CSV)</button></div>' +
    '<div class="acc-ctl">' +
      '<div class="sum-seg" id="accBasis"><button type="button" data-b="payment">By payment date</button><button type="button" data-b="stay">By stay date</button></div>' +
      '<div class="sum-seg" id="accSpan"><button type="button" data-s="day">Day</button><button type="button" data-s="week">Week</button><button type="button" data-s="month">Month</button><button type="button" data-s="year">Year</button></div>' +
      '<div class="acc-dates"><button type="button" class="acc-nav" data-step="-1" aria-label="Previous period">&lsaquo;</button>' +
        '<input type="date" id="accFrom" aria-label="From"><span>to</span><input type="date" id="accTo" aria-label="To">' +
        '<button type="button" class="acc-nav" data-step="1" aria-label="Next period">&rsaquo;</button></div>' +
      '<div class="sum-seg" id="accKind"><button type="button" data-k="all">All</button><button type="button" data-k="villas">Villas</button><button type="button" data-k="daytrip">Day trips</button></div>' +
    "</div>" +
    '<div class="acc-tiles" id="accTiles"></div>' +
    '<div class="acc-tabs" role="tablist"><button type="button" data-t="payments">Payments received</button><button type="button" data-t="receivables">Receivables</button><button type="button" data-t="revenue">Revenue summary</button></div>' +
    '<div id="accBody"><p class="acc-empty">Loading…</p></div>' +
    '<p class="acc-foot" id="accFoot"></p>';
  dashScreen.insertBefore(el, dashScreen.firstChild);
  var $ = function (id) { return document.getElementById(id); };

  el.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-b]"))) { basis = b.getAttribute("data-b"); store("vbr.accBasis", basis); load(); return; }
    if ((b = e.target.closest("[data-s]"))) { span = b.getAttribute("data-s"); store("vbr.accSpan", span); setSpan(span === "day" ? todayStr() : from); load(); return; }
    if ((b = e.target.closest("[data-k]"))) { kind = b.getAttribute("data-k"); draw(); return; }
    if ((b = e.target.closest("[data-t]"))) { tab = b.getAttribute("data-t"); store("vbr.accTab", tab); draw(); return; }
    if ((b = e.target.closest("[data-step]"))) { step(+b.getAttribute("data-step")); return; }
    if ((b = e.target.closest("[data-rf]"))) { recFilter = b.getAttribute("data-rf"); draw(); return; }
    if ((b = e.target.closest("[data-pay]"))) { e.preventDefault(); openPay(b.getAttribute("data-pay")); return; }
    if ((b = e.target.closest("[data-bd]"))) { e.preventDefault(); openBd(b.getAttribute("data-bd")); return; }
    if ((b = e.target.closest("[data-proof]"))) { e.preventDefault(); if (D.openSignedUrl) D.openSignedUrl("payment-proofs", b.getAttribute("data-proof")); return; }
  });
  el.addEventListener("change", function (e) {
    if (e.target.id === "accShowRej") { showRejected = e.target.checked; draw(); return; }
    if (e.target.id !== "accFrom" && e.target.id !== "accTo") return;
    var f = $("accFrom").value, t = $("accTo").value;
    if (!f || !t) return;
    if (t < f) { var x = f; f = t; t = x; }
    from = f; to = t; span = "custom";
    load();
  });
  $("accExport").addEventListener("click", exportCsv);

  function findBooking(id) { return bookings[id] || (D.rows() || []).filter(function (x) { return x.id === id; })[0]; }
  function openPay(id) { var r = findBooking(id); if (r && window.VBRPayments) window.VBRPayments.open(r); }
  function openBd(id) { var r = findBooking(id); if (r && D.openBreakdown) D.openBreakdown(r); }

  // ---------------------------------------------------------------- data
  var payments = [], bookings = {}, loading = 0, loadErr = "";
  var BOOKING_COLS = "id,order_code,guest_name,guest_email,guest_phone,stay_type,stay_type_label,status,check_in,check_out,total_amount,amount_paid," +
    "room_total,cabana_total,meal_total,add_on_total,extra_bed_total,pet_total,senior_discount,online_discount,code_discount,discount_amount," +
    "payment_plan,cb_owned,cb_reservation_id,cb_info,source,booked_by,adults,children_6_12,children_0_5,created_at";
  function inKind(r) { return !r || kind === "all" || (kind === "villas" ? isVilla(r) : !isVilla(r)); }
  function chunk(a, n) { var out = []; for (var i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

  function stayRows() {
    return (D.rows() || []).filter(function (r) { var a = String(r.check_in || "").slice(0, 10); return a && a >= from && a <= to; });
  }
  function load() {
    if (!shown) return;
    var my = ++loading;
    loadErr = "";
    $("accBody").innerHTML = '<p class="acc-empty">Loading…</p>';
    drawChrome();
    (D.rows() || []).forEach(function (r) { bookings[r.id] = r; });
    var q;
    if (basis === "payment") {
      // the period is Manila time
      q = sb.from("booking_payments").select("*").gte("created_at", from + "T00:00:00+08:00").lt("created_at", addDays(to, 1) + "T00:00:00+08:00")
        .order("created_at", { ascending: true }).limit(5000).then(function (res) { if (res.error) throw res.error; return res.data || []; });
    } else {
      var ids = stayRows().map(function (r) { return r.id; });
      q = Promise.all(chunk(ids, 150).map(function (c) {
        return sb.from("booking_payments").select("*").in("booking_id", c).then(function (res) { if (res.error) throw res.error; return res.data || []; });
      })).then(function (parts) { return [].concat.apply([], parts).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }); });
    }
    q.then(function (rows) {
      rows = rows.filter(function (p) { return !p.test; });
      var missing = rows.map(function (p) { return p.booking_id; }).filter(function (id, i, a) { return id && !bookings[id] && a.indexOf(id) === i; });
      return Promise.all(chunk(missing, 150).map(function (c) {
        return sb.from("booking_requests").select(BOOKING_COLS).in("id", c).then(function (res) { (res.data || []).forEach(function (r) { bookings[r.id] = r; }); });
      })).then(function () { return rows; });
    }).then(function (rows) {
      if (my !== loading) return;
      payments = rows;
      draw();
    }, function (err) {
      if (my !== loading) return;
      payments = [];
      loadErr = (err && err.message) || String(err);
      draw();
    });
  }

  // ---------------------------------------------------------------- helpers
  var KIND = { deposit: "50% down payment", full: "Full payment", balance: "Balance", other: "Other" };
  function methodOf(p) { return D.payMethodName ? D.payMethodName(p) : p.method; }
  function methodGroup(p) {
    if (p.method === "xendit" || p.method === "link") return "Online (Xendit)";
    return { transfer: "Bank transfer", cash: "Cash", card: "Card at resort" }[p.method] || "Other";
  }
  var GROUPS = ["Online (Xendit)", "Bank transfer", "Cash", "Card at resort", "Other"];
  // Xendit notes read "Xendit · GCASH · EWALLET · invoice 65f0…"
  function xenditInvoice(p) { var m = /invoice\s+([A-Za-z0-9_-]+)/.exec(String(p.note || "")); return p.method === "xendit" && m ? m[1] : ""; }
  function xenditUrl(id) { return "https://dashboard.xendit.co/invoices/" + encodeURIComponent(id); }
  function refOf(p) {
    var n = String(p.note || "");
    if (p.method === "xendit") return xenditInvoice(p) ? "Xendit invoice " + xenditInvoice(p) + (/TEST MODE/.test(n) ? " (test)" : "") : n;
    return n;
  }
  // Evidence for the payment: the Xendit invoice, and/or the guest's uploaded proof.
  function proofHtml(p) {
    var out = [], inv = xenditInvoice(p);
    if (inv) out.push('<a href="' + esc(xenditUrl(inv)) + '" target="_blank" rel="noopener" title="Open invoice ' + esc(inv) + ' in the Xendit dashboard">Open in Xendit ↗</a>');
    if (p.proof_path) out.push('<a href="#" data-proof="' + esc(p.proof_path) + '">View proof of payment</a>');
    return out.join("");
  }
  function who(e) { return e ? (D.staffLabel ? D.staffLabel(e) : e) : ""; }
  function typeShort(r) { return isVilla(r) ? "Villa" : ({ day_trip: "Day trip", half_day: "Half-day", corporate: "Corporate" })[r.stay_type] || r.stay_type_label || "Day trip"; }
  function stayText(r) { return isVilla(r) ? fmt(r.check_in, { month: "short", day: "numeric" }) + " → " + fmt(r.check_out, { month: "short", day: "numeric", year: "numeric" }) : fmt(r.check_in); }
  function live(r) { return ["declined", "expired", "inquiry"].indexOf(r.status) === -1; }
  function booked(r) { return r.status === "confirmed" || r.status === "completed"; }
  function balanceOf(r) { return Math.max(0, num(r.total_amount) - num(r.amount_paid)); }
  function dueOf(r) {
    if (!r.check_in) return "";
    var ci = String(r.check_in).slice(0, 10);
    return isVilla(r) ? addDays(ci, -15) : ci;
  }
  function verifiedSum(id) { return payments.filter(function (p) { return p.booking_id === id && p.status === "verified"; }).reduce(function (t, p) { return t + num(p.amount); }, 0); }
  function parts(r) {
    var rooms = num(r.room_total) + num(r.cabana_total), meals = num(r.meal_total), extras = num(r.add_on_total) + num(r.extra_bed_total) + num(r.pet_total);
    var disc = num(r.senior_discount) + num(r.online_discount) + num(r.code_discount) + num(r.discount_amount);
    var total = num(r.total_amount);
    var other = total - (rooms + meals + extras - disc);
    if (Math.abs(other) < 0.5) other = 0;
    return { rooms: rooms, meals: meals, extras: extras, disc: disc, other: other, total: total };
  }
  function codeLink(r, id) { return '<a href="#" data-pay="' + esc(id) + '" title="Payment history">' + esc(r ? r.order_code || "—" : "—") + "</a>"; }
  function guestLink(r) { return r ? '<a href="#" data-bd="' + esc(r.id) + '" title="Price breakdown">' + esc(r.guest_name || "—") + "</a>" : "—"; }
  function bucketOf(day) { return Math.round((dd(to) - dd(from)) / 864e5) > 62 ? day.slice(0, 7) : day; }
  function bucketLabel(b) { return b.length === 7 ? fmt(b + "-01", { month: "long", year: "numeric" }) : fmt(b, { weekday: "short", month: "short", day: "numeric" }); }

  // ---------------------------------------------------------------- draw
  var table = { head: [], rows: [], name: "" }; // what Export writes
  function drawChrome() {
    $("accFrom").value = from; $("accTo").value = to;
    $("accRangeLabel").textContent = (from === to ? fmt(from, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : fmt(from) + " – " + fmt(to)) +
      " · " + (basis === "payment" ? "by payment date (money received in this period)" : "by stay date (bookings arriving in this period)");
    [["accBasis", "data-b", basis], ["accSpan", "data-s", span], ["accKind", "data-k", kind]].forEach(function (g) {
      Array.prototype.forEach.call($(g[0]).querySelectorAll("button"), function (b) { b.classList.toggle("on", b.getAttribute(g[1]) === g[2]); });
    });
    Array.prototype.forEach.call(el.querySelectorAll(".acc-tabs button"), function (b) { b.classList.toggle("on", b.getAttribute("data-t") === tab); });
  }
  function draw() {
    if (!shown) return;
    drawChrome();
    var pays = payments.filter(function (p) { return inKind(bookings[p.booking_id]); });
    var ok = pays.filter(function (p) { return p.status === "verified"; });
    var pend = pays.filter(function (p) { return p.status === "pending"; });
    var collected = ok.reduce(function (t, p) { return t + num(p.amount); }, 0);
    var toVerify = pend.reduce(function (t, p) { return t + num(p.amount); }, 0);
    var open = (D.rows() || []).filter(function (r) { return live(r) && inKind(r) && num(r.total_amount) > 0 && balanceOf(r) >= 0.5 && num(r.amount_paid) > 0; });
    var today = todayStr();
    var owed = open.reduce(function (t, r) { return t + balanceOf(r); }, 0);
    var overdue = open.filter(function (r) { return dueOf(r) && dueOf(r) < today; });
    var stays = stayRows().filter(function (r) { return booked(r) && inKind(r); });
    var bookedTotal = stays.reduce(function (t, r) { return t + num(r.total_amount); }, 0);
    // by stay date, money taken in Cloudbeds (front desk / OTA) counts too
    var cbExtra = basis === "stay" ? stayRows().filter(function (r) { return live(r) && inKind(r); })
      .reduce(function (t, r) { return t + Math.max(0, num(r.amount_paid) - verifiedSum(r.id)); }, 0) : 0;
    var tiles = [
      ["Collected", money(collected + cbExtra), plural(ok.length, "verified payment") + (cbExtra ? " + " + money(cbExtra) + " recorded in Cloudbeds" : "")],
      ["To verify", money(toVerify), pend.length ? plural(pend.length, "proof") + " waiting" : "nothing waiting"],
      ["Receivables", money(owed), plural(open.length, "part-paid booking")],
      ["Overdue", money(overdue.reduce(function (t, r) { return t + balanceOf(r); }, 0)), plural(overdue.length, "booking")],
      ["Booked revenue", money(bookedTotal), plural(stays.length, "confirmed stay") + " arriving in period"],
    ];
    $("accTiles").innerHTML = tiles.map(function (k, i) {
      return '<div class="sum-tile' + (i === 3 && overdue.length ? " warn" : "") + '"><span>' + k[0] + "</span><b>" + k[1] + "</b><em>" + esc(k[2]) + "</em></div>";
    }).join("");
    if (loadErr) {
      $("accBody").innerHTML = '<p class="acc-empty cb-warn">Couldn\'t load payments: ' + esc(loadErr) + "</p>";
      return;
    }
    if (tab === "payments") drawPayments(pays);
    else if (tab === "receivables") drawReceivables();
    else drawRevenue(pays);
    $("accFoot").innerHTML = "Amounts in pesos. Tap a Booking # for its payment history, a guest name for the price breakdown. " +
      "Payments taken directly in Cloudbeds (front desk, OTAs) aren't itemised here — they show in Receivables / Revenue as “recorded in Cloudbeds”. " +
      "Bookings are loaded from the year set under “Bookings loaded” in the New version view.";
  }

  function tableHtml(head, rows, foot, cls) {
    return '<div class="acc-table-wrap"><table class="acc-table ' + (cls || "") + '"><thead><tr>' + head.map(function (h) {
      return "<th" + (h.n ? ' class="num"' : "") + ">" + esc(h.t) + "</th>";
    }).join("") + "</tr></thead><tbody>" + (rows.length ? rows.join("") : '<tr><td colspan="' + head.length + '" class="acc-none">Nothing in this period.</td></tr>') +
      "</tbody>" + (foot ? "<tfoot>" + foot + "</tfoot>" : "") + "</table></div>";
  }
  function td(v, n, cls) { return "<td" + (n || cls ? ' class="' + (n ? "num " : "") + (cls || "") + '"' : "") + ">" + v + "</td>"; }

  // ---- Payments received
  function drawPayments(pays) {
    var list = pays.filter(function (p) { return showRejected || p.status !== "rejected"; });
    var head = [{ t: "Paid on" }, { t: "Booking #" }, { t: "Guest" }, { t: "Type" }, { t: "Stay" }, { t: "For" }, { t: "Method" }, { t: "Reference / note" },
      { t: "Amount", n: 1 }, { t: "Status" }, { t: "Recorded / verified · proof" }, { t: "Cloudbeds" }];
    var csv = [];
    var rows = list.map(function (p) {
      var r = bookings[p.booking_id];
      var st = p.status === "verified" ? "Verified" : p.status === "pending" ? "To verify" : "Rejected";
      var xen = p.method === "xendit";
      var whoTxt = xen ? "Paid online · confirmed by Xendit " + manilaDay(p.verified_at || p.created_at)
        : [p.created_by ? "Recorded: " + who(p.created_by) : "Guest upload", p.verified_by ? "Verified: " + who(p.verified_by) + " " + manilaDay(p.verified_at) : ""].filter(Boolean).join(" · ");
      var cb = p.cb_posted_at ? "Posted " + manilaDay(p.cb_posted_at) : p.cb_post_error ? "Error" : r && isVilla(r) && p.status === "verified" ? "Not posted" : "—";
      csv.push([manilaDay(p.created_at), manilaTime(p.created_at), r ? r.order_code : "", r ? r.guest_name : "", r ? typeShort(r) : "", r ? r.check_in : "", r && isVilla(r) ? r.check_out : "",
        KIND[p.kind] || p.kind || "", methodOf(p), refOf(p), num(p.amount).toFixed(2), st, xenditInvoice(p) ? xenditUrl(xenditInvoice(p)) : "", p.proof_path ? "Yes" : "", whoTxt, cb, r && r.cb_reservation_id || ""]);
      return '<tr class="acc-' + p.status + '">' +
        td(esc(fmt(manilaDay(p.created_at), { month: "short", day: "numeric", year: "numeric" })) + '<span class="rel">' + esc(manilaTime(p.created_at)) + "</span>") +
        td(codeLink(r, p.booking_id)) + td(guestLink(r)) + td(esc(r ? typeShort(r) : "")) + td(esc(r ? stayText(r) : "")) +
        td(esc(KIND[p.kind] || p.kind || "")) + td(esc(methodOf(p))) + td(esc(refOf(p)) || '<span class="muted">—</span>') +
        td(esc(money(p.amount)), 1) + td('<span class="pay-st pay-st-' + esc(p.status) + '">' + st + "</span>") +
        td('<span class="rel">' + esc(whoTxt) + "</span>" + proofHtml(p), 0, "acc-who") + td('<span class="rel' + (cb === "Error" || cb === "Not posted" ? " cb-warn" : "") + '">' + esc(cb) + "</span>") + "</tr>";
    });
    // subtotals by method (verified only)
    var by = {};
    list.forEach(function (p) { if (p.status !== "verified") return; var g = methodGroup(p); by[g] = (by[g] || 0) + num(p.amount); });
    var totalOk = Object.keys(by).reduce(function (t, k) { return t + by[k]; }, 0);
    var foot = GROUPS.filter(function (g) { return by[g]; }).map(function (g) {
      return '<tr class="acc-sub"><td colspan="8">' + esc(g) + "</td>" + td(esc(money(by[g])), 1) + '<td colspan="3"></td></tr>';
    }).join("") + '<tr class="acc-total"><td colspan="8">Total collected (verified)</td>' + td(esc(money(totalOk)), 1) + '<td colspan="3"></td></tr>';
    $("accBody").innerHTML = '<div class="acc-bar"><label class="inline-check"><input type="checkbox" id="accShowRej"' + (showRejected ? " checked" : "") + "> <span>Show rejected payments</span></label>" +
      '<span class="muted">' + plural(list.length, "payment") + "</span></div>" + tableHtml(head, rows, foot);
    table = { name: "payments", head: ["Paid on", "Time", "Booking #", "Guest", "Type", "Check-in / date", "Check-out", "For", "Method", "Reference / note", "Amount", "Status", "Xendit invoice link", "Proof uploaded", "Recorded / verified by", "Cloudbeds", "Cloudbeds res #"], rows: csv };
  }

  // ---- Receivables (as of today)
  function drawReceivables() {
    var today = todayStr();
    var all = (D.rows() || []).filter(function (r) { return live(r) && inKind(r) && num(r.total_amount) > 0 && balanceOf(r) >= 0.5; });
    if (basis === "stay") all = all.filter(function (r) { var a = String(r.check_in || "").slice(0, 10); return a >= from && a <= to; });
    var cat = function (r) {
      if (!(num(r.amount_paid) > 0)) return "unpaid";
      var due = dueOf(r);
      if (due && due < today) return "overdue";
      if (due && due <= addDays(today, 15)) return "soon";
      return "later";
    };
    var counts = { all: all.length, overdue: 0, soon: 0, later: 0, unpaid: 0 };
    all.forEach(function (r) { counts[cat(r)]++; });
    var list = all.filter(function (r) { return recFilter === "all" || cat(r) === recFilter; })
      .sort(function (a, b) { return (dueOf(a) || "9") < (dueOf(b) || "9") ? -1 : 1; });
    var chips = [["all", "All open"], ["overdue", "Overdue"], ["soon", "Due in 15 days"], ["later", "Not yet due"], ["unpaid", "Unpaid bookings"]].map(function (c) {
      return '<button type="button" class="acc-chip' + (recFilter === c[0] ? " on" : "") + '" data-rf="' + c[0] + '">' + c[1] + " <b>" + counts[c[0]] + "</b></button>";
    }).join("");
    var head = [{ t: "Due" }, { t: "Booking #" }, { t: "Guest" }, { t: "Type" }, { t: "Stay" }, { t: "Status" }, { t: "Total", n: 1 }, { t: "Paid", n: 1 }, { t: "Balance", n: 1 }, { t: "Contact" }];
    var csv = [], tTot = 0, tPaid = 0, tBal = 0;
    var rows = list.map(function (r) {
      var c = cat(r), due = dueOf(r), late = c === "overdue" ? Math.round((dd(today) - dd(due)) / 864e5) : 0;
      var dueTxt = c === "unpaid" ? "Awaiting first payment" : fmt(due) + (late ? " · " + plural(late, "day") + " late" : "");
      tTot += num(r.total_amount); tPaid += num(r.amount_paid); tBal += balanceOf(r);
      var status = D.statusLabel ? D.statusLabel(r) : r.status;
      csv.push([c === "unpaid" ? "" : due, late || "", r.order_code, r.guest_name, typeShort(r), r.check_in, isVilla(r) ? r.check_out : "", status,
        num(r.total_amount).toFixed(2), num(r.amount_paid).toFixed(2), balanceOf(r).toFixed(2), r.guest_phone || "", r.guest_email || "", r.cb_owned ? "Cloudbeds" : "Website/Staff"]);
      return '<tr class="acc-rc-' + c + '">' + td(esc(dueTxt), 0, c === "overdue" ? "cb-warn" : "") + td(codeLink(r, r.id)) + td(guestLink(r)) + td(esc(typeShort(r))) + td(esc(stayText(r))) +
        td(esc(status) + (r.cb_owned ? '<span class="rel">recorded in Cloudbeds</span>' : "")) + td(esc(money(r.total_amount)), 1) + td(esc(money(r.amount_paid)), 1) +
        td("<b>" + esc(money(balanceOf(r))) + "</b>", 1) + td('<span class="rel">' + esc(r.guest_phone || "") + "</span>") + "</tr>";
    });
    var foot = '<tr class="acc-total"><td colspan="6">Total' + (recFilter === "all" ? "" : " (this filter)") + "</td>" + td(esc(money(tTot)), 1) + td(esc(money(tPaid)), 1) + td(esc(money(tBal)), 1) + "<td></td></tr>";
    $("accBody").innerHTML = '<div class="acc-bar acc-chips">' + chips + '</div><p class="acc-note">' +
      (basis === "stay" ? "Open balances on stays arriving in the selected period." : "Every open balance as of today, whatever the period.") +
      " Villa balances are due 15 days before check-in; day trips on the trip day. “Unpaid bookings” haven't paid anything yet and expire automatically if no payment comes in.</p>" +
      tableHtml(head, rows, foot);
    table = { name: "receivables", head: ["Due date", "Days late", "Booking #", "Guest", "Type", "Check-in / date", "Check-out", "Status", "Total", "Paid", "Balance", "Mobile", "Email", "Recorded in"], rows: csv };
  }

  // ---- Revenue summary
  function drawRevenue(pays) {
    var buckets = {}, order = [];
    function B(k) { if (!buckets[k]) { buckets[k] = { n: 0, g: 0, rooms: 0, meals: 0, extras: 0, disc: 0, other: 0, total: 0, paid: 0, bal: 0, m: {}, pend: 0, cnt: 0 }; order.push(k); } return buckets[k]; }
    var head, rows, csv = [], foot, T;
    if (basis === "stay") {
      var stays = stayRows().filter(function (r) { return booked(r) && inKind(r); });
      stays.forEach(function (r) {
        var b = B(bucketOf(String(r.check_in).slice(0, 10))), x = parts(r);
        b.n++; b.g += pax(r); b.rooms += x.rooms; b.meals += x.meals; b.extras += x.extras; b.disc += x.disc; b.other += x.other; b.total += x.total;
        b.paid += num(r.amount_paid); b.bal += balanceOf(r);
      });
      order.sort();
      T = B("__t"); order.pop();
      head = [{ t: basis === "stay" && order[0] && order[0].length === 7 ? "Month" : "Arrival date" }, { t: "Bookings", n: 1 }, { t: "Guests", n: 1 }, { t: "Rooms / cabanas", n: 1 }, { t: "Meals", n: 1 },
        { t: "Add-ons & extras", n: 1 }, { t: "Discounts", n: 1 }, { t: "Other / Cloudbeds", n: 1 }, { t: "Booked total", n: 1 }, { t: "Collected", n: 1 }, { t: "Balance", n: 1 }];
      rows = order.map(function (k) {
        var b = buckets[k];
        ["n", "g", "rooms", "meals", "extras", "disc", "other", "total", "paid", "bal"].forEach(function (f) { T[f] += b[f]; });
        csv.push([k, b.n, b.g, b.rooms.toFixed(2), b.meals.toFixed(2), b.extras.toFixed(2), (-b.disc).toFixed(2), b.other.toFixed(2), b.total.toFixed(2), b.paid.toFixed(2), b.bal.toFixed(2)]);
        return "<tr>" + td(esc(bucketLabel(k))) + td(b.n, 1) + td(b.g, 1) + td(esc(money(b.rooms)), 1) + td(esc(money(b.meals)), 1) + td(esc(money(b.extras)), 1) +
          td(b.disc ? "−" + esc(money(b.disc)) : "—", 1) + td(b.other ? esc(money(b.other)) : "—", 1) + td("<b>" + esc(money(b.total)) + "</b>", 1) + td(esc(money(b.paid)), 1) + td(esc(money(b.bal)), 1) + "</tr>";
      });
      foot = '<tr class="acc-total">' + td("Total") + td(T.n, 1) + td(T.g, 1) + td(esc(money(T.rooms)), 1) + td(esc(money(T.meals)), 1) + td(esc(money(T.extras)), 1) +
        td(T.disc ? "−" + esc(money(T.disc)) : "—", 1) + td(T.other ? esc(money(T.other)) : "—", 1) + td(esc(money(T.total)), 1) + td(esc(money(T.paid)), 1) + td(esc(money(T.bal)), 1) + "</tr>";
      table = { name: "revenue-by-stay-date", head: [order[0] && order[0].length === 7 ? "Month" : "Arrival date", "Bookings", "Guests", "Rooms / cabanas", "Meals", "Add-ons & extras", "Discounts", "Other / Cloudbeds", "Booked total", "Collected", "Balance"], rows: csv };
      $("accBody").innerHTML = '<p class="acc-note">Confirmed and completed bookings, by arrival date (a villa stay counts on its check-in day). Discounts = senior/PWD, online and code discounts. ' +
        "“Other / Cloudbeds” is the part of a booking total not split into rooms, meals and extras — mostly bookings made in Cloudbeds. Collected includes payments recorded in Cloudbeds.</p>" + tableHtml(head, rows, foot);
      return;
    }
    // by payment date: money in, per method
    pays.forEach(function (p) {
      if (p.status === "rejected") return;
      var b = B(bucketOf(manilaDay(p.created_at)));
      if (p.status === "pending") { b.pend += num(p.amount); return; }
      var g = methodGroup(p);
      b.m[g] = (b.m[g] || 0) + num(p.amount); b.total += num(p.amount); b.cnt++;
    });
    order.sort();
    var used = GROUPS.filter(function (g) { return order.some(function (k) { return buckets[k].m[g]; }); });
    if (!used.length) used = ["Online (Xendit)", "Bank transfer"];
    T = { m: {}, total: 0, pend: 0, cnt: 0 };
    head = [{ t: order[0] && order[0].length === 7 ? "Month" : "Date" }, { t: "Payments", n: 1 }].concat(used.map(function (g) { return { t: g, n: 1 }; }), [{ t: "Total collected", n: 1 }, { t: "To verify", n: 1 }]);
    rows = order.map(function (k) {
      var b = buckets[k];
      T.total += b.total; T.pend += b.pend; T.cnt += b.cnt;
      used.forEach(function (g) { T.m[g] = (T.m[g] || 0) + (b.m[g] || 0); });
      csv.push([k, b.cnt].concat(used.map(function (g) { return (b.m[g] || 0).toFixed(2); }), [b.total.toFixed(2), b.pend.toFixed(2)]));
      return "<tr>" + td(esc(bucketLabel(k))) + td(b.cnt, 1) + used.map(function (g) { return td(b.m[g] ? esc(money(b.m[g])) : "—", 1); }).join("") +
        td("<b>" + esc(money(b.total)) + "</b>", 1) + td(b.pend ? esc(money(b.pend)) : "—", 1, b.pend ? "cb-warn" : "") + "</tr>";
    });
    foot = '<tr class="acc-total">' + td("Total") + td(T.cnt, 1) + used.map(function (g) { return td(esc(money(T.m[g] || 0)), 1); }).join("") + td(esc(money(T.total)), 1) + td(T.pend ? esc(money(T.pend)) : "—", 1) + "</tr>";
    table = { name: "collections-by-payment-date", head: [order[0] && order[0].length === 7 ? "Month" : "Date", "Payments"].concat(used, ["Total collected", "To verify"]), rows: csv };
    $("accBody").innerHTML = '<p class="acc-note">Verified money received, by the day it was paid (Manila time) and how. “To verify” = guest-uploaded proofs not yet checked against the bank.</p>' + tableHtml(head, rows, foot);
  }

  // ---------------------------------------------------------------- export
  function exportCsv() {
    if (!table.rows) return;
    var cell = function (v) { v = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [table.head.map(cell).join(",")].concat(table.rows.map(function (r) { return r.map(cell).join(","); }));
    var k = kind === "all" ? "" : "-" + kind;
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "VBR-" + table.name + k + "-" + from + "_to_" + to + ".csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------------------------------------------------------------- accounting accounts
  // View-only everywhere (the database enforces it too); they open here.
  var roDone = false;
  function checkAccount() {
    if (dashScreen.style.display !== "block") { document.body.classList.remove("ro-staff"); roDone = false; return; }
    sb.auth.getSession().then(function (res) {
      var email = res.data && res.data.session && res.data.session.user ? String(res.data.session.user.email || "").toLowerCase() : "";
      var ro = ACCOUNTING_STAFF.indexOf(email) !== -1;
      document.body.classList.toggle("ro-staff", ro);
      if (ro && !roDone) { roDone = true; whenView(function (V) { V.set("accounting"); }); }
    });
  }
  // the view switcher (staff-cloudbeds.js) loads after this file
  function whenView(fn, tries) {
    if (window.VBRView) return fn(window.VBRView);
    if ((tries || 0) < 100) setTimeout(function () { whenView(fn, (tries || 0) + 1); }, 50);
  }
  new MutationObserver(checkAccount).observe(dashScreen, { attributes: true, attributeFilter: ["style"] });
  checkAccount();

  // redraw when the dashboard reloads its bookings
  var cl = document.getElementById("countLine"), pending = null, lastRows = null;
  if (cl && window.MutationObserver) new MutationObserver(function () {
    if (!shown || D.rows() === lastRows) return;
    clearTimeout(pending); pending = setTimeout(function () { lastRows = D.rows(); load(); }, 300);
  }).observe(cl, { childList: true, characterData: true, subtree: true });

  window.VBRAccounting = {
    show: function (on) { var was = shown; shown = !!on; document.body.classList.toggle("accv", shown); if (shown && !was) { lastRows = D.rows(); load(); } },
    isAccountingUser: function (email) { return ACCOUNTING_STAFF.indexOf(String(email || "").toLowerCase()) !== -1; },
  };
})();
