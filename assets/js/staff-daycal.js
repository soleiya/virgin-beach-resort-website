/* ==========================================================================
   Staff dashboard — Day Trip Calendar (booking-v29 / v30)
   --------------------------------------------------------------------------
   The 2026 Day Trip Calendar sheet, live, as the main Day Trips view:
     * month tabs (JAN … DEC) like the sheet's tabs
     * the month at a glance: how many Dining / Lounge cabanas are still free
       each day (green / amber / red), guests and bookings per day
     * every day a block in the sheet's columns (Booker, Guest, Adult, Kids,
       0–5, PWD | Sr, Pet, Dining, Lounge, Package, Total, Status, Remarks,
       Cabana no.) with a TOTAL row, and "+ Add" to type a booking straight
       into the day, like adding a row on the sheet
     * click a booking to edit it; "Assign" picks the cabana numbers
     * "Import from Sheet" brings the .xlsx in (booking-v30)
   ========================================================================== */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc, peso = D.peso;
  var $ = function (id) { return document.getElementById(id); };
  var panel = $("dcalPanel"), dash = $("dashScreen"), viewSwitch = $("dtViewSwitch");
  if (!panel || !dash) return;

  var MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PKG = {
    day_trip: "Day Trip", half_day: "Half Day", flash_sale: "Flash Sale", all_inclusive_family: "Family",
    all_inclusive_barkada: "Barkada", corporate: "Corporate", other: "Other",
  };
  var TYPE_LABELS = D.TYPE_LABELS || {};
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function int(v) { return Number(v) || 0; }
  function utc(ds) { return new Date(ds + "T00:00:00Z"); }
  function dayHead(ds) {
    var d = utc(ds);
    return { wd: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }), day: d.getUTCDate(),
      mon: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), dow: d.getUTCDay() };
  }
  function dayName(ds) { return utc(ds).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); }

  // ------------------------------------------------------------- state
  var st = {
    view: store("vbr.dtView") === "list" ? "list" : "cal",
    year: +today().slice(0, 4),
    month: +today().slice(5, 7),
    q: "",
  };
  var saved = store("vbr.dcalMonth");
  if (saved && /^\d{4}-\d{2}$/.test(saved)) { st.year = +saved.slice(0, 4); st.month = +saved.slice(5, 7); }
  function monthKey() { return st.year + "-" + pad(st.month); }

  // ------------------------------------------------------------- view switch
  function applyView() {
    var onDay = (D.section ? D.section() : "daytrip") === "daytrip";
    var cal = onDay && st.view === "cal";
    dash.classList.toggle("dt-cal", cal);
    panel.hidden = !cal;
    if (viewSwitch) Array.prototype.forEach.call(viewSwitch.querySelectorAll("button"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === st.view);
      b.setAttribute("aria-selected", b.getAttribute("data-view") === st.view ? "true" : "false");
    });
    if (cal) draw();
  }
  if (viewSwitch) viewSwitch.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (!b) return;
    st.view = b.getAttribute("data-view");
    store("vbr.dtView", st.view);
    applyView();
  });
  // the dashboard reloaded / re-rendered its bookings, or switched section
  var pending = null;
  function soon() { if (pending) return; pending = setTimeout(function () { pending = null; applyView(); }, 0); }
  document.addEventListener("vbr:render", soon);
  document.addEventListener("vbr:list", soon);

  // ------------------------------------------------------------- toolbar
  function setMonth(y, m) {
    st.year = y; st.month = m;
    store("vbr.dcalMonth", monthKey());
    closeAdd(); draw();
  }
  $("dcalTabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-m]");
    if (b) setMonth(st.year, +b.getAttribute("data-m"));
  });
  $("dcalYear").addEventListener("change", function () { setMonth(+this.value, st.month); });
  $("dcalToday").addEventListener("click", function () {
    var t = today();
    setMonth(+t.slice(0, 4), +t.slice(5, 7));
    jumpTo(t);
  });
  var qTimer = null;
  $("dcalSearch").addEventListener("input", function () {
    clearTimeout(qTimer);
    var v = this.value;
    qTimer = setTimeout(function () { st.q = v.trim().toLowerCase(); draw(); }, 150);
  });
  ["dcalEmpty", "dcalCancelled"].forEach(function (id) { $(id).addEventListener("change", function () { draw(); }); });
  $("dcalPrint").addEventListener("click", function () { window.print(); });

  function jumpTo(ds) {
    var t = panel.querySelector('.dcal-day[data-date="' + ds + '"]');
    if (!t) return;
    var sc = panel.querySelector(".dcal-scroll");
    var head = sc.querySelector("thead");
    sc.scrollTop = t.offsetTop - (head ? head.offsetHeight : 0);
    sc.scrollIntoView({ block: "start", behavior: "smooth" });
    t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash");
  }

  // ------------------------------------------------------------- data
  function isDayTrip(r) { return r.check_in && !D.isVillaRow(r); }
  function remarks(r) {
    var bits = [];
    var sn = String(r.staff_notes || "").replace(/^\[Imported from \d{4} Day Trip Calendar\]\s*/, "");
    if (sn) bits.push(sn);
    if (r.notes) bits.push(r.notes);
    if (r.discount_code) bits.push("Code " + r.discount_code);
    return bits.join(" · ");
  }
  function hay(r) {
    return [r.guest_name, r.booked_by, r.guest_phone, r.guest_email, r.order_code, r.staff_notes, r.notes, r.cb_reservation_id]
      .join(" ").toLowerCase();
  }
  function matches(r) { return !st.q || hay(r).indexOf(st.q) >= 0; }
  function guestsOf(r) { return int(r.adults) + int(r.children_6_12) + int(r.children_0_5); }
  function isExclusive(r) { return /exclusive/i.test(String(r.stay_type_label || "") + " " + String(r.staff_notes || "")) && !D.releasesCabanas(r.status); }
  function assignedIds(r) { return (r.booking_cabanas || []).map(function (bc) { return bc.cabana_id; }); }
  function level(left, stock) { return left <= 0 ? "full" : left <= Math.max(1, Math.floor(stock * 0.25)) ? "low" : "ok"; }
  function rowById(id) { return D.rows().filter(function (r) { return r.id === id; })[0]; }

  // ------------------------------------------------------------- draw
  function drawTabs(counts, hits) {
    var years = {};
    years[+today().slice(0, 4)] = 1; years[+today().slice(0, 4) + 1] = 1; years[st.year] = 1;
    D.rows().forEach(function (r) { if (isDayTrip(r)) years[+r.check_in.slice(0, 4)] = 1; });
    $("dcalYear").innerHTML = Object.keys(years).sort().map(function (y) {
      return '<option value="' + y + '"' + (+y === st.year ? " selected" : "") + ">" + y + "</option>";
    }).join("");
    $("dcalTabs").innerHTML = MONTHS.map(function (m, i) {
      var n = st.q ? hits[i + 1] : counts[i + 1];
      return '<button type="button" role="tab" data-m="' + (i + 1) + '" class="' + (i + 1 === st.month ? "active" : "") + (st.q && n ? " hit" : "") +
        '" aria-selected="' + (i + 1 === st.month) + '">' + m + (n ? '<span class="n">' + n + "</span>" : "") + "</button>";
    }).join("");
  }

  function draw() {
    if (panel.hidden) return;
    var month = monthKey(), y = st.year, m = st.month;
    var showEmpty = $("dcalEmpty").checked, showOff = $("dcalCancelled").checked;
    var counts = {}, hits = {}, byDay = {};
    D.rows().forEach(function (r) {
      if (!isDayTrip(r) || +r.check_in.slice(0, 4) !== y) return;
      var mi = +r.check_in.slice(5, 7);
      if (!D.releasesCabanas(r.status)) counts[mi] = (counts[mi] || 0) + 1;
      if (st.q && matches(r)) hits[mi] = (hits[mi] || 0) + 1;
      if (r.check_in.slice(0, 7) === month) (byDay[r.check_in] = byDay[r.check_in] || []).push(r);
    });
    drawTabs(counts, hits);

    var last = new Date(Date.UTC(y, m, 0)).getUTCDate(), t = today();
    var stock = D.stock();
    var days = [], mon = { bookings: 0, guests: 0, dining: 0, lounge: 0, total: 0, paid: 0, unpaid: 0, full: 0 };
    for (var d = 1; d <= last; d++) {
      var ds = month + "-" + pad(d);
      var list = (byDay[ds] || []).slice().sort(function (a, b) {
        return (int(a.sheet_row) || 1e9) - (int(b.sheet_row) || 1e9) || String(a.created_at).localeCompare(String(b.created_at));
      });
      var active = list.filter(function (r) { return !D.releasesCabanas(r.status); });
      var free = D.cabanasFreeOn(ds) || { dining: stock.dining, lounge: stock.lounge, stock: stock, blocked: { dining: 0, lounge: 0 } };
      var sum = { adults: 0, kids: 0, k05: 0, sr: 0, pets: 0, dining: 0, lounge: 0, total: 0, guests: 0 };
      active.forEach(function (r) {
        var n = D.countsOf(r), sr = int(r.senior_count);
        sum.adults += Math.max(int(r.adults) - sr, 0); sum.sr += sr; sum.kids += int(r.children_6_12); sum.k05 += int(r.children_0_5);
        sum.pets += int(r.pet_count); sum.dining += n.dining; sum.lounge += n.lounge; sum.total += int(r.total_amount);
        sum.guests += guestsOf(r);
        if (r.status === "confirmed" || r.status === "completed") mon.paid += int(r.total_amount); else mon.unpaid++;
      });
      mon.bookings += active.length; mon.guests += sum.guests; mon.dining += sum.dining; mon.lounge += sum.lounge; mon.total += sum.total;
      var excl = active.some(isExclusive);
      if (free.dining <= 0 && free.lounge <= 0) mon.full++;
      days.push({ ds: ds, list: list, active: active, free: free, sum: sum, excl: excl });
    }

    // month summary (the sheet's Summary tab, per month)
    var mName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    $("dcalSum").innerHTML =
      '<div class="dcal-kpi"><span>' + esc(mName) + "</span><b>" + mon.bookings + "</b><small>bookings</small></div>" +
      '<div class="dcal-kpi"><span>Guests</span><b>' + mon.guests.toLocaleString() + "</b><small>excl. cancelled</small></div>" +
      '<div class="dcal-kpi"><span>Cabanas sold</span><b>' + mon.dining + ' <i>D</i> · ' + mon.lounge + ' <i>L</i></b><small>of ' + stock.dining + " D / " + stock.lounge + " L a day</small></div>" +
      '<div class="dcal-kpi"><span>Paid</span><b>' + esc(peso(mon.paid)) + "</b><small>confirmed / completed</small></div>" +
      '<div class="dcal-kpi' + (mon.unpaid ? " warn" : "") + '"><span>Not yet paid</span><b>' + mon.unpaid + "</b><small>pending bookings</small></div>" +
      '<div class="dcal-kpi"><span>Sold-out days</span><b>' + mon.full + "</b><small>no cabanas left</small></div>";

    // availability grid
    var first = utc(month + "-01").getUTCDay();
    var g = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(function (w) { return '<div class="wd">' + w + "</div>"; });
    for (var b = 0; b < first; b++) g.push('<div class="dcal-cell blank"></div>');
    days.forEach(function (x) {
      var dl = level(x.free.dining, x.free.stock.dining), ll = level(x.free.lounge, x.free.stock.lounge);
      var hit = st.q && x.list.some(matches);
      var dow = utc(x.ds).getUTCDay();
      g.push('<button type="button" class="dcal-cell' + (x.ds < t ? " past" : "") + (x.ds === t ? " today" : "") + (x.excl ? " excl" : "") +
        (dow === 0 || dow === 6 ? " wkend" : "") + (hit ? " hit" : "") + (st.q && !hit ? " dim" : "") + '" data-date="' + x.ds + '" title="' +
        esc(dayName(x.ds) + " — " + x.free.dining + " dining and " + x.free.lounge + " lounge cabanas left · " + x.active.length + " bookings, " + x.sum.guests + " guests") + '">' +
        '<span class="dn">' + int(x.ds.slice(8)) + (x.excl ? "<em>Exclusive</em>" : x.active.length ? "<span>" + x.sum.guests + " pax</span>" : "") + "</span>" +
        '<span class="av"><b class="' + dl + '">D ' + Math.max(x.free.dining, 0) + '</b><b class="' + ll + '">L ' + Math.max(x.free.lounge, 0) + "</b></span>" +
        (x.active.length ? '<span class="bk">' + x.active.length + " booking" + (x.active.length === 1 ? "" : "s") + "</span>" : "") +
        "</button>");
    });
    $("dcalGrid").innerHTML = g.join("");

    // day blocks
    var html = [], shownRows = 0;
    days.forEach(function (x) {
      var shown = (showOff ? x.list : x.active).filter(matches);
      if (st.q && !shown.length) return;
      if (!shown.length && !showEmpty && addDate !== x.ds) return;
      var h = dayHead(x.ds), f = x.free;
      var pill = function (label, left, stock, blocked) {
        var lv = level(left, stock);
        return '<span class="pill-av ' + lv + '" title="' + stock + " a day" + (blocked ? ", " + blocked + " blocked" : "") + '">' + label + " <b>" +
          (left <= 0 ? (left < 0 ? "over by " + -left : "FULL") : left + " left") + "</b> / " + stock + "</span>";
      };
      html.push('<tr class="dcal-day' + (x.ds === t ? " is-today" : "") + (x.excl ? " is-excl" : "") + (h.dow === 0 || h.dow === 6 ? " is-wkend" : "") +
        '" data-date="' + x.ds + '"><td colspan="14"><div class="dcal-dayhead">' +
        '<span class="dcal-date"><b>' + h.day + "</b> " + esc(h.mon) + " <span>" + esc(h.wd) + "</span></span>" +
        (x.excl ? '<span class="pill-av excl">Exclusive booking</span>' : "") +
        pill("Dining", f.dining, f.stock.dining, f.blocked.dining) + pill("Lounge", f.lounge, f.stock.lounge, f.blocked.lounge) +
        '<span class="dcal-cap">' + x.active.length + " booking" + (x.active.length === 1 ? "" : "s") + " · <b>" + x.sum.guests + "</b> guests</span>" +
        '<button type="button" class="btn-sm ghost dcal-add" data-date="' + x.ds + '">+ Add</button></div></td></tr>');
      shown.forEach(function (r) { html.push(rowHtml(r)); shownRows++; });
      if (addDate === x.ds) html.push(addRowHtml(x));
      else if (!shown.length) html.push('<tr class="dcal-empty"><td colspan="14">No bookings — <button type="button" class="linklike dcal-add" data-date="' + x.ds + '">add one</button></td></tr>');
      if (x.active.length > 1 || (x.active.length && showOff && x.list.length > x.active.length)) {
        var s = x.sum;
        html.push('<tr class="dcal-tot"><td></td><td>TOTAL</td><td class="num">' + s.adults + '</td><td class="num">' + s.kids + '</td><td class="num">' + s.k05 +
          '</td><td class="num">' + s.sr + '</td><td class="num">' + s.pets + '</td><td class="num">' + s.dining + '</td><td class="num">' + s.lounge +
          '</td><td></td><td class="num">' + esc(peso(s.total)) + '</td><td colspan="3">' + s.guests + " guests</td></tr>");
      }
    });
    $("dcalBody").innerHTML = html.join("") || '<tr class="dcal-empty"><td colspan="14">' +
      (st.q ? "No match for “" + esc(st.q) + "” in " + esc(mName) + (Object.keys(hits).length ? " — the highlighted month tabs have matches." : " this year.")
        : "No day trips this month" + (showEmpty ? "" : " (tick “Empty days” to see every day)") + ".") + "</td></tr>";
    if (addDate) { var nf = $("dnName"); if (nf && document.activeElement !== nf && !addFocused) { nf.focus(); addFocused = true; } }
  }

  function rowHtml(r) {
    var n = D.countsOf(r), off = D.releasesCabanas(r.status), sr = int(r.senior_count);
    var ids = assignedIds(r);
    var tags = ids.map(function (id) {
      var c = D.cabanaById(id);
      return c ? '<span class="cab-tag' + (D.cabKind(c) === "lounge" ? " lounge" : "") + '" title="' + esc(c.label) + '">' + esc(D.cabShort(c)) + "</span>" : "";
    }).join("");
    var needs = n.dining + n.lounge, past = r.check_in < today();
    var booker = r.booked_by || (r.source === "website" ? "Website" : (D.SOURCE_LABELS && D.SOURCE_LABELS[r.source]) || r.source || "");
    return '<tr class="dcal-row' + (off ? " is-off" : "") + (st.q ? " hit" : "") + (r.source === "website" ? " is-web" : "") + '" data-id="' + esc(r.id) + '">' +
      "<td>" + esc(booker) + "</td>" +
      '<td class="dcal-guest"><b>' + esc(r.guest_name || "—") + "</b>" +
      (r.guest_phone || r.order_code ? '<span class="muted">' + esc([r.guest_phone, r.order_code].filter(Boolean).join(" · ")) + "</span>" : "") + "</td>" +
      '<td class="num">' + (Math.max(int(r.adults) - sr, 0) || "") + "</td>" +
      '<td class="num">' + (int(r.children_6_12) || "") + "</td>" +
      '<td class="num">' + (int(r.children_0_5) || "") + "</td>" +
      '<td class="num">' + (sr || "") + "</td>" +
      '<td class="num">' + (int(r.pet_count) || "") + "</td>" +
      '<td class="num cab-d">' + (n.dining || "") + "</td>" +
      '<td class="num cab-l">' + (n.lounge || "") + "</td>" +
      "<td>" + esc(PKG[r.stay_type] || r.stay_type_label || r.stay_type || "") + "</td>" +
      '<td class="num">' + (r.total_amount == null ? "—" : esc(peso(r.total_amount))) + "</td>" +
      '<td><span class="status-badge readonly status-' + esc(r.status) + '">' + esc(D.statusLabel(r)) + "</span></td>" +
      '<td class="dcal-remarks">' + esc(remarks(r)) + "</td>" +
      '<td class="dcal-cabno">' + tags + (off || !needs || (past && !ids.length) ? "" :
        ' <button type="button" class="btn-sm ghost dcal-assign" data-id="' + esc(r.id) + '">' + (ids.length ? "Change" : "Assign") + "</button>") +
      (!off && !past && needs && ids.length < needs ? '<span class="muted">' + (needs - ids.length) + " to assign</span>" : "") + "</td></tr>";
  }

  // ------------------------------------------------------------- quick add (a new row on the day)
  var addDate = null, addFocused = false, addOverOk = false, addTotalTouched = false;
  function addRowHtml(x) {
    var me = (D.staffName && D.staffName()) || "";
    var num = function (id, title) { return '<td class="num"><input class="n" type="number" min="0" step="1" inputmode="numeric" id="' + id + '" title="' + title + '" placeholder="0"></td>'; };
    return '<tr class="dcal-new" data-date="' + x.ds + '">' +
      '<td><span class="muted">' + esc(me || "You") + "</span></td>" +
      '<td><input id="dnName" type="text" placeholder="Guest name" autocomplete="off"><input id="dnPhone" type="tel" placeholder="Contact no." autocomplete="off">' +
      '<select id="dnVia" title="Came in via"><option value="messenger">via Messenger</option><option value="phone">via Phone</option><option value="email">via Email</option>' +
      '<option value="walk_in">Walk-in</option><option value="other">Other</option></select></td>' +
      num("dnAdults", "Adults (not counting PWD / Seniors)") + num("dnKids", "Kids 6–12") + num("dnK05", "Kids 0–5") + num("dnSr", "PWD / Seniors") + num("dnPets", "Pets") +
      num("dnDining", "Dining cabanas") + num("dnLounge", "Lounge cabanas") +
      '<td><select id="dnType">' + ["day_trip", "half_day", "flash_sale", "all_inclusive_family", "all_inclusive_barkada", "corporate", "other"].map(function (k) {
        return '<option value="' + k + '">' + esc(PKG[k]) + "</option>";
      }).join("") + "</select></td>" +
      '<td class="num"><input id="dnTotal" type="number" min="0" step="0.01" placeholder="₱"></td>' +
      '<td><span class="status-badge readonly status-pending">Pending</span></td>' +
      '<td><input id="dnRemarks" type="text" placeholder="Remarks (payment, requests…)"></td>' +
      '<td class="acts"><button type="button" class="btn-sm primary" id="dnSave">Save</button> <button type="button" class="btn-sm ghost" id="dnCancel">Cancel</button>' +
      '<div class="err" id="dnErr"></div></td></tr>';
  }
  function openAdd(ds) { addDate = ds; addFocused = false; addOverOk = false; addTotalTouched = false; draw(); }
  function closeAdd() { addDate = null; }
  function dnVal(id) { var el = $(id); return el ? Math.max(0, Math.floor(Number(el.value) || 0)) : 0; }
  function dnBill() {
    var P = window.VBRPricing;
    if (!P) return null;
    var type = $("dnType").value, sr = dnVal("dnSr");
    return P.compute({ type: type, adults: dnVal("dnAdults") + sr, seniors: sr, kids612: dnVal("dnKids"), kids05: dnVal("dnK05"),
      pets: dnVal("dnPets"), dining: dnVal("dnDining"), lounge: dnVal("dnLounge") });
  }
  function dnReprice() {
    var b = dnBill(), tot = $("dnTotal");
    if (!tot) return;
    if (b && b.rated && !addTotalTouched) tot.value = window.VBRPricing.r2(b.total);
    tot.placeholder = b && b.rated ? "₱" : "₱ (by hand)";
    $("dnErr").textContent = "";
    addOverOk = false;
    $("dnSave").textContent = "Save";
  }
  $("dcalBody").addEventListener("input", function (e) {
    if (!e.target.closest(".dcal-new")) return;
    if (e.target.id === "dnTotal") { addTotalTouched = e.target.value !== ""; return; }
    if (/^dn(Adults|Kids|K05|Sr|Pets|Dining|Lounge)$/.test(e.target.id)) dnReprice();
  });
  $("dcalBody").addEventListener("change", function (e) { if (e.target.id === "dnType") dnReprice(); });
  $("dcalBody").addEventListener("keydown", function (e) {
    if (!e.target.closest(".dcal-new")) return;
    if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); saveAdd(); }
    if (e.key === "Escape") { closeAdd(); draw(); }
  });
  function saveAdd() {
    var err = $("dnErr"), btn = $("dnSave");
    var name = $("dnName").value.trim(), ds = addDate;
    var sr = dnVal("dnSr"), adults = dnVal("dnAdults") + sr, kids = dnVal("dnKids"), k05 = dnVal("dnK05");
    var dining = dnVal("dnDining"), lounge = dnVal("dnLounge"), type = $("dnType").value;
    if (!name) { err.textContent = "Type the guest's name."; $("dnName").focus(); return; }
    if (!adults && !kids && !k05 && type.indexOf("all_inclusive") !== 0) { err.textContent = "Add at least one guest."; return; }
    var free = D.cabanasFreeOn(ds);
    if (free && (dining > free.dining || lounge > free.lounge) && !addOverOk) {
      err.textContent = "Only " + Math.max(free.dining, 0) + " dining and " + Math.max(free.lounge, 0) + " lounge cabanas are left that day. Click “Save anyway” to overbook.";
      addOverOk = true; btn.textContent = "Save anyway";
      return;
    }
    var b = dnBill(), P = window.VBRPricing;
    var totalEl = $("dnTotal"), total = totalEl.value === "" ? null : Number(totalEl.value);
    var priced = b && b.rated && !addTotalTouched;
    var payload = {
      source: $("dnVia").value, stay_type: type, stay_type_label: TYPE_LABELS[type] || PKG[type], status: "pending",
      guest_name: name, guest_phone: $("dnPhone").value.trim() || null, booked_by: (D.staffName && D.staffName()) || null,
      check_in: ds, adults: adults, senior_count: sr, children_6_12: kids, children_0_5: k05, pet_count: dnVal("dnPets"),
      dining_cabanas: dining, lounge_cabanas: lounge, total_amount: total,
      staff_notes: $("dnRemarks").value.trim() || null, email_guest: false, discount_amount: 0,
    };
    if (priced) {
      payload.subtotal_people = P.r2(b.subtotalPeople);
      payload.cabana_total = P.r2(b.isPackage ? b.extraCabanaCost : b.cabanaTotal);
      payload.senior_discount = P.r2(b.seniorDiscount);
    }
    if (!payload.staff_notes) delete payload.staff_notes;
    btn.disabled = true; err.textContent = "";
    sb.from("booking_requests").insert([payload]).select("id").then(function (res) {
      btn.disabled = false;
      if (res.error) { err.textContent = "Couldn't save: " + res.error.message; return; }
      closeAdd();
      D.reload();
    }, function (e2) { btn.disabled = false; err.textContent = "Couldn't save: " + (e2 && e2.message ? e2.message : e2); });
  }

  // ------------------------------------------------------------- clicks
  $("dcalGrid").addEventListener("click", function (e) {
    var c = e.target.closest(".dcal-cell[data-date]");
    if (c) jumpTo(c.getAttribute("data-date"));
  });
  $("dcalBody").addEventListener("click", function (e) {
    if (e.target.closest(".dcal-new")) {
      if (e.target.id === "dnSave") saveAdd();
      else if (e.target.id === "dnCancel") { closeAdd(); draw(); }
      return;
    }
    var add = e.target.closest(".dcal-add");
    if (add) { openAdd(add.getAttribute("data-date")); return; }
    var as = e.target.closest(".dcal-assign");
    if (as) { e.stopPropagation(); openPop(rowById(as.getAttribute("data-id")), as); return; }
    var tr = e.target.closest(".dcal-row");
    if (tr) { var r = rowById(tr.getAttribute("data-id")); if (r) D.openModal(r); }
  });

  // ------------------------------------------------------------- assign popover
  var pop = $("dcalPop"), popRow = null, popPicked = [];
  function closePop() { if (pop) pop.hidden = true; popRow = null; }
  if (pop) {
    $("dcalPopCancel").addEventListener("click", closePop);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pop.hidden) closePop(); });
    document.addEventListener("mousedown", function (e) { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(".dcal-assign")) closePop(); });
  }

  function holds(r) {
    var held = {}, ds = r.check_in;
    D.rows().forEach(function (o) {
      if (o.id === r.id || o.check_in !== ds || D.isVillaRow(o) || D.releasesCabanas(o.status)) return;
      assignedIds(o).forEach(function (id) { held[id] = "taken by " + (o.guest_name || "another group") + (o.order_code ? " (" + o.order_code + ")" : ""); });
    });
    var bl = D.blocksForDate(ds);
    bl.set.forEach(function (id) { held[id] = bl.info[id] || "blocked"; });
    return { held: held, blocked: bl.set };
  }
  function openPop(r, anchor) {
    if (!r || !pop) return;
    popRow = r;
    popPicked = assignedIds(r).slice();
    var n = D.countsOf(r);
    $("dcalPopTitle").textContent = "Cabana no. (internal) — " + (r.guest_name || "") + (r.order_code ? " · " + r.order_code : "");
    $("dcalPopSub").textContent = dayName(r.check_in) + " · booked " + [n.dining ? n.dining + " dining" : "", n.lounge ? n.lounge + " lounge" : ""].filter(Boolean).join(", ");
    drawPop();
    pop.hidden = false;
    var rect = anchor.getBoundingClientRect();
    var top = Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 12);
    pop.style.top = Math.max(top, 12) + "px";
    pop.style.left = Math.max(12, Math.min(rect.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 12)) + "px";
  }
  function pickedOf(kind) { return popPicked.filter(function (id) { var c = D.cabanaById(id); return c && D.cabKind(c) === kind; }).length; }
  function drawPop() {
    var r = popRow, h = holds(r), n = D.countsOf(r);
    var list = $("dcalPopList");
    list.innerHTML = "";
    var groups = {};
    D.cabanas().forEach(function (c) { var k = c.section + "|" + D.cabKind(c); (groups[k] = groups[k] || []).push(c); });
    Object.keys(groups).sort().forEach(function (key) {
      var kind = key.split("|")[1];
      if (!n[kind] && !pickedOf(kind)) return; // only the types this group booked
      var box = document.createElement("div");
      box.className = "cab-assign-group";
      box.innerHTML = "<h4>Section " + esc(key.split("|")[0]) + " · " + (kind === "lounge" ? "Lounge" : "Dining") + "</h4>";
      var wrap = document.createElement("div");
      wrap.className = "cab-assign-chips";
      groups[key].slice().sort(function (a, b) { return a.number - b.number; }).forEach(function (c) {
        var on = popPicked.indexOf(c.id) >= 0, info = h.held[c.id];
        var b = document.createElement("button");
        b.type = "button";
        b.className = "cab-chip" + (kind === "lounge" ? " lounge" : "") + (on ? " is-on" : "") + (!on && info ? (h.blocked.has(c.id) ? " is-blocked" : " is-taken") : "");
        b.textContent = String(c.number);
        b.title = c.label + (info ? " — " + info : "");
        b.disabled = !on && !!info;
        b.addEventListener("click", function () {
          var i = popPicked.indexOf(c.id);
          if (i >= 0) popPicked.splice(i, 1); else popPicked.push(c.id);
          drawPop();
        });
        wrap.appendChild(b);
      });
      box.appendChild(wrap);
      list.appendChild(box);
    });
    var dPick = pickedOf("dining"), lPick = pickedOf("lounge");
    var over = dPick > n.dining || lPick > n.lounge;
    $("dcalPopSave").disabled = over;
    $("dcalPopNote").textContent = "Assigned " + dPick + " of " + n.dining + " dining" + (n.lounge || lPick ? ", " + lPick + " of " + n.lounge + " lounge" : "") +
      (over ? " — more than this booking has. Untick some, or raise its Dining / Lounge count with ✎ Edit first." : "") +
      (EMAIL_RE.test(String(r.guest_email || "").trim()) ? " The guest is emailed the numbers." : " No guest email on this booking — nobody is emailed.");
  }
  if (pop) $("dcalPopSave").addEventListener("click", function () {
    var r = popRow;
    if (!r) return;
    var before = assignedIds(r), after = popPicked.slice();
    var add = after.filter(function (id) { return before.indexOf(id) < 0; });
    var rem = before.filter(function (id) { return after.indexOf(id) < 0; });
    if (!add.length && !rem.length) { closePop(); return; }
    var btn = $("dcalPopSave");
    btn.disabled = true;
    var jobs = Promise.resolve();
    if (rem.length) jobs = jobs.then(function () {
      return sb.from("booking_cabanas").delete().eq("booking_id", r.id).in("cabana_id", rem).then(function (res) { if (res.error) throw res.error; });
    });
    if (add.length) jobs = jobs.then(function () {
      return sb.from("booking_cabanas").insert(add.map(function (id) { return { booking_id: r.id, cabana_id: id }; })).then(function (res) { if (res.error) throw res.error; });
    });
    jobs.then(function () {
      // cabana numbers are internal — emailed only when ticked on the booking (v33)
      if (!r.email_cabana_numbers || !EMAIL_RE.test(String(r.guest_email || "").trim())) return null;
      return sb.rpc("notify_booking_change", {
        p_booking_id: r.id,
        p_changes: [{ label: "Cabana no.", before: D.cabanaListText(before) || "—", after: D.cabanaListText(after) || "—" }],
        p_old_check_in: null,
      }).then(function (res) { return res.error ? res.error : null; });
    }).then(function (mailErr) {
      btn.disabled = false;
      closePop();
      if (mailErr) alert("Cabanas saved, but the guest email couldn't be queued: " + mailErr.message);
      D.reload();
    }).catch(function (err) {
      btn.disabled = false;
      alert("Couldn't save: " + (err && err.message ? err.message : err));
      D.reload();
    });
  });

  // ==========================================================================
  // Import from Sheet (booking-v30): the Day Trip Calendar .xlsx → bookings
  // ==========================================================================
  // Sheet columns (row 6 onwards, one block of rows per day):
  //  B Booker · C day · D Name of Guest · REGULAR DAY TRIP E Adult F Kids
  //  G PWD|Senior H PWD-Child I Pet J Dining K Lounge · ALL INCLUSIVE L Family
  //  M Barkada N Addtl cabana · FLASH SALE O Adult P Kids · HALF DAY Q Adult
  //  R Kids S PWD|Senior T PWD-Child U Pet V Dining W Lounge · X Others
  //  Y Total · Z Remarks
  var XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  function num(v) {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    var n = Number(String(v).replace(/[₱,\s]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function txt(v) { return v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim(); }
  // grids: { "JAN": [[row1 cells…], [row2…], …], … }  (index 0 = sheet row 1, cell 0 = column A)
  function parseSheet(grids, year, stock) {
    stock = stock || { dining: 43, lounge: 6 };
    var out = [], skipped = [], seen = 0;
    Object.keys(grids).forEach(function (tab) {
      var mi = MONTHS.indexOf(String(tab).trim().toUpperCase().slice(0, 3));
      if (mi < 0 || !/^[A-Za-z]+$/.test(String(tab).trim())) return; // JAN…DEC only (not "Copy of JULY")
      seen++;
      var rows = grids[tab] || [], day = null;
      var last = new Date(Date.UTC(year, mi + 1, 0)).getUTCDate();
      for (var i = 5; i < rows.length; i++) {
        var r = rows[i] || [];
        var c = txt(r[2]), mDay = /^(\d{1,2})(\D|$)/.exec(c);
        if (mDay && +mDay[1] >= 1 && +mDay[1] <= last) day = +mDay[1];
        var booker = txt(r[1]), name = txt(r[3]), rem = txt(r[25]);
        var n = []; for (var k = 4; k <= 23; k++) n.push(num(r[k]));
        var total = num(r[24]);
        var any = n.some(function (v) { return v !== 0; });
        if (!name && !any && !rem) continue;
        if (/^(sub)?total\b/i.test(name) && !booker) continue;
        var where = tab + " row " + (i + 1);
        if (!day) { skipped.push({ where: where, name: name, why: "no day" }); continue; }
        if (!name && !any) { skipped.push({ where: where, name: rem, why: "no guest or numbers" }); continue; }
        var reg = n[0] + n[1] + n[2] + n[3] + n[4], hd = n[12] + n[13] + n[14] + n[15] + n[16] + n[17] + n[18], flash = n[10] + n[11];
        var fam = n[7], bark = n[8];
        var type = fam > 0 ? "all_inclusive_family" : bark > 0 ? "all_inclusive_barkada" : flash > 0 ? "flash_sale" :
          hd > 0 && !(n[0] + n[1] + n[5] + n[6]) ? "half_day" : "day_trip";
        var seniors = n[2] + n[14];
        var adults = n[0] + n[2] + n[10] + n[12] + n[14];
        var kids = n[1] + n[3] + n[11] + n[13] + n[15];
        var pwdKids = n[3] + n[15];
        var dining = n[5] + n[17] + n[9], lounge = n[6] + n[18];
        var notes = [];
        if ((fam || bark) && !adults && !kids) {
          var px = /(\d+)\s*(adults?|pax|persons?)/i.exec(rem);
          adults = px ? +px[1] : fam * 4 + bark * 10;
        }
        if ((fam || bark) && !dining && !lounge) dining = fam + bark; // the package's own cabana
        var tod = /(\d+)\s*(toddlers?|infants?|bab(y|ies))/i.exec(rem);
        var k05 = tod ? +tod[1] : 0;
        // remarks as the first import wrote them: "<remarks> | Others: 1,000.00 | PWD child: 1"
        if (n[19]) notes.push("Others: " + Number(n[19]).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        if (pwdKids) notes.push("PWD child: " + pwdKids);
        var exclusive = /exclusive(ly)?\s*(booking|use|booked)|exclusively booked/i.test(name + " " + rem) && !dining && !lounge && !reg && !hd;
        if (exclusive) { dining = stock.dining; lounge = stock.lounge; }
        var phone = "";
        var pm = /(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/.exec(name);
        if (pm) { phone = pm[0].replace(/[\s-]/g, ""); name = txt(name.replace(pm[0], "").replace(/[|\/,-]\s*$/, "")); }
        if (type === "day_trip" && !Math.round(adults) && !Math.round(kids) && !k05) type = "other";
        out.push({
          sheet: MONTHS[mi], row: i + 1, date: year + "-" + pad(mi + 1) + "-" + pad(day),
          booker: booker, name: name, phone: phone, stay_type: type,
          adults: Math.round(adults), seniors: Math.round(Math.min(seniors, adults)), kids: Math.round(kids), kids05: k05,
          pets: Math.round(n[4] + n[16]), dining: Math.round(dining), lounge: Math.round(lounge),
          others: 0, total: Math.round(total * 100) / 100, remarks: [rem].concat(notes).filter(Boolean).join(" | "), notes: "", exclusive: exclusive,
        });
      }
    });
    return { rows: out, skipped: skipped, tabs: seen };
  }
  function gridsFromWorkbook(XLSX, wb) {
    var grids = {};
    wb.SheetNames.forEach(function (nm) {
      var ws = wb.Sheets[nm];
      if (!ws || !ws["!ref"]) { grids[nm] = []; return; }
      var rg = XLSX.utils.decode_range(ws["!ref"]), rows = [];
      for (var R = 0; R <= rg.e.r; R++) {
        var row = [];
        for (var C = 0; C <= Math.min(rg.e.c, 25); C++) {
          var cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          row.push(cell ? (cell.t === "n" ? cell.v : cell.w !== undefined && cell.t !== "s" ? cell.w : cell.v) : "");
        }
        rows.push(row);
      }
      grids[nm] = rows;
    });
    return grids;
  }
  var xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxLoading) return xlsxLoading;
    xlsxLoading = new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = XLSX_URL; s.async = true;
      s.onload = function () { window.XLSX ? ok(window.XLSX) : fail(new Error("The spreadsheet reader didn't load.")); };
      s.onerror = function () { xlsxLoading = null; fail(new Error("Couldn't load the spreadsheet reader — check the internet connection.")); };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }

  var imp = { rows: null, year: null, file: "" };
  var impBackdrop = $("dimpBackdrop");
  function impMsg(html, cls) { var el = $("dimpStatus"); el.className = "dimp-status" + (cls ? " " + cls : ""); el.innerHTML = html; }
  function openImport() {
    imp = { rows: null, year: st.year, file: "" };
    $("dimpFile").value = "";
    $("dimpYear").value = String(st.year);
    $("dimpResult").innerHTML = "";
    $("dimpApply").disabled = true;
    $("dimpApply").textContent = "Apply changes";
    impMsg("Pick the sheet file to see what would change. Nothing changes until you click <b>Apply changes</b>.");
    impBackdrop.classList.add("open");
  }
  function closeImport() { impBackdrop.classList.remove("open"); }
  if (impBackdrop) {
    $("dcalImport").addEventListener("click", openImport);
    $("dimpClose").addEventListener("click", closeImport);
    $("dimpCancel").addEventListener("click", closeImport);
    impBackdrop.addEventListener("click", function (e) { if (e.target === impBackdrop) closeImport(); });
    $("dimpFile").addEventListener("change", function () { if (this.files && this.files[0]) readFile(this.files[0]); });
    $("dimpYear").addEventListener("change", function () { var f = $("dimpFile").files; if (f && f[0]) readFile(f[0]); });
    $("dimpApply").addEventListener("click", function () { runSync(true); });
  }
  function readFile(file) {
    var year = +$("dimpYear").value;
    $("dimpApply").disabled = true;
    $("dimpResult").innerHTML = "";
    impMsg("Reading " + esc(file.name) + "…");
    loadXLSX().then(function (XLSX) {
      return file.arrayBuffer().then(function (buf) { return XLSX.read(buf, { type: "array", cellDates: false }); })
        .then(function (wb) { return parseSheet(gridsFromWorkbook(XLSX, wb), year, D.stock()); });
    }).then(function (p) {
      if (!p.tabs) throw new Error("No month tabs (JAN … DEC) in this file — is it the Day Trip Calendar?");
      if (!p.rows.length) throw new Error("No bookings found in the month tabs.");
      imp = { rows: p.rows, year: year, file: file.name, skipped: p.skipped };
      return runSync(false);
    }).catch(function (e) {
      impMsg(esc(e && e.message ? e.message : String(e)), "bad");
    });
  }
  function listHtml(title, items, fmt, cls, open) {
    if (!items || !items.length) return "";
    return '<details class="dimp-list ' + (cls || "") + '"' + (open ? " open" : "") + "><summary>" + esc(title) + " <b>" + items.length + "</b></summary><ul>" +
      items.slice(0, 400).map(function (x) { return "<li>" + fmt(x) + "</li>"; }).join("") + (items.length > 400 ? "<li>…</li>" : "") + "</ul></details>";
  }
  var FIELD = { name: "name", booker: "booker", package: "package", guests: "guests", cabanas: "cabanas", total: "total", remarks: "remarks", status: "status", phone: "contact no." };
  function runSync(apply) {
    if (!imp.rows) return Promise.resolve();
    var btn = $("dimpApply");
    btn.disabled = true;
    if (apply) btn.textContent = "Applying…";
    impMsg((apply ? "Applying " : "Checking ") + imp.rows.length.toLocaleString() + " sheet rows against the website…");
    return sb.rpc("daytrip_sheet_sync", { p_rows: imp.rows, p_year: imp.year, p_apply: apply }).then(function (res) {
      if (res.error) {
        var m = res.error.message || String(res.error);
        if (/daytrip_sheet_sync/.test(m) && /function|schema cache/i.test(m)) m = "The import isn't set up yet — run booking-v30-daytrip-sheet-sync.sql in Supabase first.";
        throw new Error(m);
      }
      var s = res.data || {}, dt = s.details || {};
      var fdate = function (d) { return esc(dayName(d)); };
      var head = (apply ? "<b>Done.</b> " : "<b>" + esc(imp.file) + "</b> — " + imp.rows.length.toLocaleString() + " rows read. ") +
        (apply ? "" : "If you apply it:");
      $("dimpResult").innerHTML =
        '<div class="dimp-tiles">' +
        '<div class="t add"><b>' + s.insert + "</b>" + (apply ? "added" : "new to add") + "</div>" +
        '<div class="t upd"><b>' + s.update + "</b>" + (apply ? "updated" : "to update") + "</div>" +
        '<div class="t same"><b>' + s.same + "</b>already the same</div>" +
        '<div class="t rem"><b>' + s.removed + "</b>" + (apply ? "cancelled (not on the sheet)" : "not on the sheet → cancel") + "</div>" +
        '<div class="t skip"><b>' + s.skip + "</b>already booked on the website</div></div>" +
        listHtml("New bookings", dt.insert, function (x) { return fdate(x.date) + " — <b>" + esc(x.name) + "</b>" + (x.booker ? ' <span class="muted">' + esc(x.booker) + "</span>" : ""); }, "", s.insert && s.insert <= 30) +
        listHtml("Updated", dt.update, function (x) { return fdate(x.date) + " — <b>" + esc(x.name) + '</b> <span class="muted">' + esc((x.fields || []).map(function (f) { return FIELD[f] || f; }).join(", ")) + "</span>"; }, "", s.update && s.update <= 30) +
        listHtml("Not on the sheet any more — set to Cancelled (with a note; you can undo it on the booking)", dt.removed, function (x) { return fdate(x.date) + " — <b>" + esc(x.name) + "</b>" + (x.booker ? ' <span class="muted">' + esc(x.booker) + "</span>" : ""); }, "rem", true) +
        listHtml("Skipped — the same guest already booked that day on the website / with staff", dt.skip, function (x) { return fdate(x.date) + " — <b>" + esc(x.name) + "</b>"; }, "skip", false) +
        listHtml("Rows on the sheet that couldn't be read", imp.skipped, function (x) { return esc(x.where) + " — " + esc(x.name || "") + ' <span class="muted">(' + esc(x.why) + ")</span>"; }, "skip", false);
      if (apply) {
        impMsg(head + " The calendar now has the sheet's bookings. Nobody was emailed.", "good");
        btn.textContent = "Applied";
        imp.rows = null;
        D.reload();
      } else {
        var nothing = !s.insert && !s.update && !s.removed;
        impMsg(head + (nothing ? " nothing changes — the website already matches the sheet." : " review below, then click <b>Apply changes</b>. Guests aren't emailed."), nothing ? "good" : "");
        btn.disabled = nothing;
        btn.textContent = "Apply changes";
      }
    }).catch(function (e) {
      btn.disabled = !imp.rows;
      btn.textContent = "Apply changes";
      impMsg(esc(e && e.message ? e.message : String(e)), "bad");
    });
  }

  window.VBRDayCal = { draw: draw, parseSheet: parseSheet, gridsFromWorkbook: gridsFromWorkbook, setMonth: setMonth, apply: applyView };
  applyView();
})();
