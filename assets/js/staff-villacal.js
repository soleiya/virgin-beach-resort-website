/* ==========================================================================
   Staff dashboard — Villa Calendar view (v73)
   --------------------------------------------------------------------------
   The Villas section gets the same month-by-month calendar as Day Trips
   (staff-daycal.js), close to identical so operations reads both the same way:
     * 📅 Calendar / ☰ List switch — Calendar is the default
     * month tabs (JAN … DEC), year, Today, search, Empty days, Cancelled, Print
     * the month in figures: stays, guests, casita-nights sold / occupancy,
       paid, not yet paid, sold-out nights
     * the month at a glance: casitas still free each night (green / amber /
       red), arrivals and guests in-house
     * every day a block in the sheet's columns (Booker, Guest, Adult, Kids,
       0–5, PWD | Sr, Pet, Casitas, Nights, Check-out, Total, Status, Remarks,
       Casita no.) for the guests ARRIVING that day, with a TOTAL row, who's
       in-house and who's leaving, and "+ Add" to start a villa booking that
       day
     * click a booking to open it
   Free casitas come from the casita holds (booking_villas: website and
   Cloudbeds reservations, staff and Cloudbeds blocks), the same data as the
   unit-by-unit "Villa Calendar" grid (still under the toolbar button).
   Uses the Day Trip calendar's styles (.dcal-*). Needs staff-dashboard.js and
   staff-villas.js loaded first.
   ========================================================================== */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc, peso = D.peso;
  var $ = function (id) { return document.getElementById(id); };
  var dash = $("dashScreen"), dtBar = $("dtViewBar"), dtPanel = $("dcalPanel");
  if (!dash || !dtBar || !dtPanel) return;

  var MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function int(v) { return Number(v) || 0; }
  function utc(ds) { return new Date(ds + "T00:00:00Z"); }
  function addDays(s, n) { var d = utc(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function nightsOf(r) { return r.check_in && r.check_out ? Math.max(1, Math.round((utc(r.check_out) - utc(r.check_in)) / 864e5)) : 1; }
  function dayHead(ds) {
    var d = utc(ds);
    return { wd: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }), day: d.getUTCDate(),
      mon: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), dow: d.getUTCDay() };
  }
  function dayName(ds) { return utc(ds).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); }
  function shortDate(ds) { return ds ? utc(ds).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""; }

  // ------------------------------------------------------------- markup (same structure and classes as the Day Trip calendar)
  var css = document.createElement("style");
  css.textContent =
    "#dashScreen.v-cal #filterPills,#dashScreen.v-cal #filtersRow,#dashScreen.v-cal #summaryBar,#dashScreen.v-cal #countLine," +
    "#dashScreen.v-cal .table-scroll,#dashScreen.v-cal #cbList{display:none!important}" +
    ".vcal-dep{font-size:.78rem;color:var(--ink-soft);padding:4px 10px 8px!important}.vcal-dep b{color:var(--ink)}" +
    ".vcal-units .cab-tag{margin:0 3px 3px 0}.dcal-cell .av b.blk{background:#eef1f4;color:#4a5563}" +
    "@media print{#vViewBar{display:none!important}}";
  document.head.appendChild(css);

  var bar = document.createElement("div");
  bar.className = "dt-viewbar";
  bar.id = "vViewBar";
  bar.setAttribute("data-section", "villas");
  bar.innerHTML = '<div class="view-switch" id="vViewSwitch" role="tablist" aria-label="Villa view">' +
    '<button type="button" role="tab" data-view="cal">&#128197; Calendar</button><button type="button" role="tab" data-view="list">&#9776; List</button></div>' +
    '<span class="hint">Calendar: casitas month by month, with casitas free each night and who arrives each day &middot; List: search and filter every booking</span>';
  dtBar.parentNode.insertBefore(bar, dtBar.nextSibling);

  var panel = document.createElement("section");
  panel.className = "dcal-panel";
  panel.id = "vcalPanel";
  panel.setAttribute("data-section", "villas");
  panel.hidden = true;
  panel.innerHTML =
    '<div class="dcal-top"><div class="dcal-tabs" id="vcalTabs" role="tablist" aria-label="Month"></div>' +
    '<div class="dcal-tools"><select id="vcalYear" aria-label="Year"></select>' +
    '<button type="button" class="btn-sm ghost" id="vcalToday">Today</button>' +
    '<input type="search" id="vcalSearch" placeholder="Find guest, booker, Cloudbeds #, remarks&hellip;">' +
    '<label class="dcal-chk"><input type="checkbox" id="vcalEmpty" checked> Empty days</label>' +
    '<label class="dcal-chk"><input type="checkbox" id="vcalCancelled"> Cancelled</label>' +
    '<button type="button" class="btn-sm ghost" id="vcalPrint">Print</button>' +
    '<button type="button" class="btn-sm ghost" id="vcalUnits" title="Every casita, night by night">Unit view</button></div></div>' +
    '<div class="dcal-kpis" id="vcalSum"></div>' +
    '<div class="dcal-grid-wrap"><div class="dcal-grid" id="vcalGrid"></div>' +
    '<div class="dcal-legend"><span><b>C</b> casitas still free that night:</span><span><i class="ok"></i>plenty</span><span><i class="low"></i>few left (&le; 25%)</span><span><i class="full"></i>full</span>' +
    '<span>Click a day to jump to it. Arrivals are listed under each day.</span></div></div>' +
    '<div class="dcal-scroll"><table class="dcal-table"><thead><tr>' +
    '<th>Booker</th><th>Guest</th><th class="num">Adult</th><th class="num">Kids</th><th class="num">0&ndash;5</th><th class="num">PWD | Sr</th><th class="num">Pet</th>' +
    '<th class="num cab-d">Casitas</th><th class="num">Nights</th><th>Check-out</th><th class="num">Total</th><th class="num">Paid</th><th>Status</th><th>Remarks</th><th>Casita no.</th>' +
    '</tr></thead><tbody id="vcalBody"></tbody></table></div>';
  dtPanel.parentNode.insertBefore(panel, dtPanel.nextSibling);

  // ------------------------------------------------------------- state
  var st = { view: store("vbr.vView") === "list" ? "list" : "cal", year: +today().slice(0, 4), month: +today().slice(5, 7), q: "" };
  var saved = store("vbr.vcalMonth");
  if (saved && /^\d{4}-\d{2}$/.test(saved)) { st.year = +saved.slice(0, 4); st.month = +saved.slice(5, 7); }
  function monthKey() { return st.year + "-" + pad(st.month); }
  var holds = { key: null, list: [], loading: false };

  // ------------------------------------------------------------- view switch
  function applyView() {
    var onVillas = (D.section ? D.section() : "") === "villas";
    var cal = onVillas && st.view === "cal";
    dash.classList.toggle("v-cal", cal);
    panel.hidden = !cal;
    Array.prototype.forEach.call($("vViewSwitch").querySelectorAll("button"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === st.view);
      b.setAttribute("aria-selected", b.getAttribute("data-view") === st.view ? "true" : "false");
    });
    if (cal) {
      load();
      if (!st.jumped && st.year === +today().slice(0, 4) && st.month === +today().slice(5, 7)) { st.jumped = "pending"; }
    } else st.jumped = false;
  }
  $("vViewSwitch").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (!b) return;
    st.view = b.getAttribute("data-view");
    store("vbr.vView", st.view);
    applyView();
  });
  var pending = null;
  function soon() { if (pending) return; pending = setTimeout(function () { pending = null; holds.key = null; applyView(); }, 0); }
  document.addEventListener("vbr:render", soon);
  document.addEventListener("vbr:list", soon);

  // ------------------------------------------------------------- toolbar
  function setMonth(y, m) { st.year = y; st.month = m; store("vbr.vcalMonth", monthKey()); load(); }
  $("vcalTabs").addEventListener("click", function (e) { var b = e.target.closest("button[data-m]"); if (b) setMonth(st.year, +b.getAttribute("data-m")); });
  $("vcalYear").addEventListener("change", function () { setMonth(+this.value, st.month); });
  $("vcalToday").addEventListener("click", function () { var t = today(); st.jumped = "pending"; setMonth(+t.slice(0, 4), +t.slice(5, 7)); });
  var qTimer = null;
  $("vcalSearch").addEventListener("input", function () {
    clearTimeout(qTimer);
    var v = this.value;
    qTimer = setTimeout(function () { st.q = v.trim().toLowerCase(); draw(); }, 150);
  });
  ["vcalEmpty", "vcalCancelled"].forEach(function (id) { $(id).addEventListener("change", draw); });
  $("vcalPrint").addEventListener("click", function () { window.print(); });
  $("vcalUnits").addEventListener("click", function () { var b = $("villaCalBtn"); if (b) b.click(); });

  function jumpTo(ds) {
    var t = panel.querySelector('.dcal-day[data-date="' + ds + '"]');
    if (!t) return;
    var sc = panel.querySelector(".dcal-scroll"), head = sc.querySelector("thead");
    sc.scrollTop = t.offsetTop - (head ? head.offsetHeight : 0);
    sc.scrollIntoView({ block: "start", behavior: "smooth" });
    t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash");
  }

  // ------------------------------------------------------------- data
  function villas() { return window.VBRVillas && window.VBRVillas.villas ? window.VBRVillas.villas() : []; }
  function isVilla(r) { return r.stay_type === "overnight" && r.check_in; }
  function off(r) { return D.releasesCabanas(r.status); }
  function guestsOf(r) { return int(r.adults) + int(r.children_6_12) + int(r.children_0_5); }
  function hay(r) {
    return [r.guest_name, r.booked_by, r.guest_phone, r.guest_email, r.order_code, r.staff_notes, r.notes, r.cb_reservation_id,
      window.VBRVillas ? window.VBRVillas.labelsFor(r).join(" ") : ""].join(" ").toLowerCase();
  }
  function matches(r) { return !st.q || hay(r).indexOf(st.q) >= 0; }
  function remarks(r) {
    var bits = [];
    if (r.staff_notes) bits.push(String(r.staff_notes).split("\n").map(function (l) { return l.replace(/^\[Imported from Cloudbeds #\d+\]\s*(·\s*)?/, ""); })
      .filter(function (l) { return l && !/^\[(Payment link sent|Payment deadline|Cancelled)/.test(l); }).join(" · "));
    if (r.notes) bits.push(r.notes);
    if (r.discount_code) bits.push("Code " + r.discount_code);
    return bits.filter(Boolean).join(" · ");
  }
  function level(left, stock) { return left <= 0 ? "full" : left <= Math.max(1, Math.floor(stock * 0.25)) ? "low" : "ok"; }
  function rowById(id) { return D.rows().filter(function (r) { return r.id === id; })[0]; }

  // casita holds (bookings + blocks) for the month, one query per month
  function load() {
    var month = monthKey(), first = month + "-01", next = addDays(addDays(first, 31).slice(0, 7) + "-01", 0);
    if (holds.key === month) { draw(); return; }
    if (holds.loading === month) return;
    holds.loading = month;
    draw();
    sb.from("booking_villas").select("villa_id,booking_id,check_in,check_out,block_reason").eq("active", true).lt("check_in", next).gt("check_out", first)
      .then(function (res) {
        holds.loading = false;
        holds.key = month;
        holds.list = res.error ? [] : (res.data || []);
        holds.err = res.error ? res.error.message : null;
        draw();
      });
  }

  // ------------------------------------------------------------- draw
  function drawTabs(counts, hits) {
    var years = {};
    years[+today().slice(0, 4)] = 1; years[+today().slice(0, 4) + 1] = 1; years[st.year] = 1;
    D.rows().forEach(function (r) { if (isVilla(r)) years[+r.check_in.slice(0, 4)] = 1; });
    $("vcalYear").innerHTML = Object.keys(years).sort().map(function (y) { return '<option value="' + y + '"' + (+y === st.year ? " selected" : "") + ">" + y + "</option>"; }).join("");
    $("vcalTabs").innerHTML = MONTHS.map(function (m, i) {
      var n = st.q ? hits[i + 1] : counts[i + 1];
      return '<button type="button" role="tab" data-m="' + (i + 1) + '" class="' + (i + 1 === st.month ? "active" : "") + (st.q && n ? " hit" : "") +
        '" aria-selected="' + (i + 1 === st.month) + '">' + m + (n ? '<span class="n">' + n + "</span>" : "") + "</button>";
    }).join("");
  }

  function draw() {
    if (panel.hidden) return;
    var month = monthKey(), y = st.year, m = st.month;
    var showEmpty = $("vcalEmpty").checked, showOff = $("vcalCancelled").checked;
    var units = villas(), stock = units.length || 18;
    var all = D.rows().filter(isVilla).filter(function (r) { return r.status !== "inquiry"; });
    var counts = {}, hits = {};
    all.forEach(function (r) {
      if (+r.check_in.slice(0, 4) !== y) return;
      var mi = +r.check_in.slice(5, 7);
      if (!off(r)) counts[mi] = (counts[mi] || 0) + 1;
      if (st.q && matches(r)) hits[mi] = (hits[mi] || 0) + 1;
    });
    drawTabs(counts, hits);

    var last = new Date(Date.UTC(y, m, 0)).getUTCDate(), t = today();
    var ready = holds.key === month;
    var days = [], mon = { stays: 0, guests: 0, sold: 0, cap: 0, paid: 0, unpaid: 0, full: 0 };
    for (var d = 1; d <= last; d++) {
      var ds = month + "-" + pad(d);
      var arriving = all.filter(function (r) { return r.check_in === ds; }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
      var active = arriving.filter(function (r) { return !off(r); });
      var inHouse = all.filter(function (r) { return !off(r) && r.check_in <= ds && r.check_out > ds; });
      var leaving = all.filter(function (r) { return !off(r) && r.check_out === ds; });
      var used = {}, blocked = {};
      holds.list.forEach(function (h) { if (h.check_in <= ds && h.check_out > ds) { used[h.villa_id] = 1; if (!h.booking_id) blocked[h.villa_id] = 1; } });
      var nUsed = Object.keys(used).length, nBlk = Object.keys(blocked).length;
      var free = stock - nUsed;
      var sum = { adults: 0, kids: 0, k05: 0, sr: 0, pets: 0, casitas: 0, total: 0, paid: 0, guests: 0 };
      active.forEach(function (r) {
        var sr = int(r.senior_count);
        sum.adults += Math.max(int(r.adults) - sr, 0); sum.sr += sr; sum.kids += int(r.children_6_12); sum.k05 += int(r.children_0_5);
        sum.pets += int(r.pet_count); sum.casitas += Math.max(1, (r.booking_villas || []).length); sum.total += int(r.total_amount);
        sum.paid += int(r.amount_paid); sum.guests += guestsOf(r);
        if (r.status === "confirmed" || r.status === "completed") mon.paid += int(r.total_amount); else mon.unpaid++;
      });
      var guestsIn = inHouse.reduce(function (a, r) { return a + guestsOf(r); }, 0);
      mon.stays += active.length; mon.guests += sum.guests;
      mon.sold += nUsed - nBlk; mon.cap += stock - nBlk;
      if (ready && free <= 0) mon.full++;
      days.push({ ds: ds, list: arriving, active: active, inHouse: inHouse, leaving: leaving, free: free, blocked: nBlk, sum: sum, guestsIn: guestsIn });
    }

    // the month in figures
    var mName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    var occ = mon.cap ? Math.round(mon.sold / mon.cap * 100) : 0;
    $("vcalSum").innerHTML =
      '<div class="dcal-kpi"><span>' + esc(mName) + "</span><b>" + mon.stays + "</b><small>stays arriving</small></div>" +
      '<div class="dcal-kpi"><span>Guests</span><b>' + mon.guests.toLocaleString() + "</b><small>arriving · excl. cancelled</small></div>" +
      '<div class="dcal-kpi"><span>Casita-nights sold</span><b>' + (ready ? mon.sold + " <i>of</i> " + mon.cap : "…") + "</b><small>" + (ready ? occ + "% occupancy" : "loading") + "</small></div>" +
      '<div class="dcal-kpi"><span>Paid</span><b>' + esc(peso(mon.paid)) + "</b><small>confirmed / completed</small></div>" +
      '<div class="dcal-kpi' + (mon.unpaid ? " warn" : "") + '"><span>Not yet paid</span><b>' + mon.unpaid + "</b><small>confirmation pending</small></div>" +
      '<div class="dcal-kpi"><span>Sold-out nights</span><b>' + (ready ? mon.full : "…") + "</b><small>no casitas left</small></div>";

    // availability grid
    var first = utc(month + "-01").getUTCDay();
    var g = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(function (w) { return '<div class="wd">' + w + "</div>"; });
    for (var b = 0; b < first; b++) g.push('<div class="dcal-cell blank"></div>');
    days.forEach(function (x) {
      var lv = level(x.free, stock), hit = st.q && x.list.some(matches), dow = utc(x.ds).getUTCDay();
      g.push('<button type="button" class="dcal-cell' + (x.ds < t ? " past" : "") + (x.ds === t ? " today" : "") + (dow === 5 || dow === 6 ? " wkend" : "") +
        (hit ? " hit" : "") + (st.q && !hit ? " dim" : "") + '" data-date="' + x.ds + '" title="' +
        esc(dayName(x.ds) + " — " + (ready ? Math.max(x.free, 0) + " of " + stock + " casitas free" + (x.blocked ? " (" + x.blocked + " blocked)" : "") : "loading") +
          " · " + x.active.length + " arriving, " + x.inHouse.length + " stays in-house (" + x.guestsIn + " guests)") + '">' +
        '<span class="dn">' + int(x.ds.slice(8)) + (x.inHouse.length ? "<span>" + x.guestsIn + " pax</span>" : "") + "</span>" +
        '<span class="av">' + (ready ? '<b class="' + lv + '">C ' + Math.max(x.free, 0) + "</b>" : "<b>…</b>") + "</span>" +
        (x.active.length ? '<span class="bk">' + x.active.length + " arriving</span>" : "") + "</button>");
    });
    $("vcalGrid").innerHTML = g.join("");

    // day blocks
    var html = [];
    days.forEach(function (x) {
      var shown = (showOff ? x.list : x.active).filter(matches);
      if (st.q && !shown.length) return;
      if (!shown.length && !showEmpty) return;
      var h = dayHead(x.ds), lv = level(x.free, stock);
      html.push('<tr class="dcal-day' + (x.ds === t ? " is-today" : "") + (h.dow === 5 || h.dow === 6 ? " is-wkend" : "") + '" data-date="' + x.ds + '"><td colspan="15"><div class="dcal-dayhead">' +
        '<span class="dcal-date"><b>' + h.day + "</b> " + esc(h.mon) + " <span>" + esc(h.wd) + "</span></span>" +
        (ready ? '<span class="pill-av ' + lv + '" title="' + stock + " casitas" + (x.blocked ? ", " + x.blocked + " blocked" : "") + '">Casitas <b>' +
          (x.free <= 0 ? (x.free < 0 ? "over by " + -x.free : "FULL") : x.free + " free") + "</b> / " + stock + "</span>" : "") +
        '<span class="dcal-cap">' + x.active.length + " arriving · " + x.inHouse.length + " in-house · " + x.leaving.length + " leaving · <b>" + x.guestsIn + "</b> guests tonight</span>" +
        '<button type="button" class="btn-sm ghost dcal-add vcal-add" data-date="' + x.ds + '">+ Add</button></div></td></tr>');
      shown.forEach(function (r) { html.push(rowHtml(r)); });
      if (!shown.length) html.push('<tr class="dcal-empty"><td colspan="15">No arrivals — <button type="button" class="linklike vcal-add" data-date="' + x.ds + '">add a booking</button></td></tr>');
      if (x.active.length > 1) {
        var s = x.sum;
        html.push('<tr class="dcal-tot"><td></td><td>TOTAL</td><td class="num">' + s.adults + '</td><td class="num">' + s.kids + '</td><td class="num">' + s.k05 +
          '</td><td class="num">' + s.sr + '</td><td class="num">' + s.pets + '</td><td class="num">' + s.casitas + '</td><td></td><td></td><td class="num">' +
          esc(peso(s.total)) + '</td><td class="num">' + esc(peso(s.paid)) + '</td><td colspan="3">' + s.guests + " guests arriving</td></tr>");
      }
      if (x.leaving.length) {
        html.push('<tr class="dcal-empty"><td colspan="15" class="vcal-dep">Leaving: ' + x.leaving.map(function (r) {
          var u = window.VBRVillas ? window.VBRVillas.labelsFor(r).join(", ") : "";
          return "<b>" + esc(r.guest_name || "—") + "</b>" + (u ? " (" + esc(u) + ")" : "");
        }).join(" · ") + "</td></tr>");
      }
    });
    $("vcalBody").innerHTML = html.join("") || '<tr class="dcal-empty"><td colspan="15">' +
      (st.q ? "No match for “" + esc(st.q) + "” in " + esc(mName) + (Object.keys(hits).length ? " — the highlighted month tabs have matches." : " this year.")
        : "No villa stays arriving this month" + (showEmpty ? "" : " (tick “Empty days” to see every day)") + ".") + "</td></tr>";
    if (holds.err) $("vcalBody").insertAdjacentHTML("afterbegin", '<tr class="dcal-empty"><td colspan="15">Couldn\'t load casita holds: ' + esc(holds.err) + "</td></tr>");

    if (st.jumped === "pending" && ready) {
      st.jumped = true;
      var td = today(), tEl = [].slice.call(panel.querySelectorAll(".dcal-day[data-date]")).filter(function (x) { return x.getAttribute("data-date") >= td; })[0],
        sc = panel.querySelector(".dcal-scroll");
      if (tEl && sc) { var head = sc.querySelector("thead"); sc.scrollTop = Math.max(0, tEl.offsetTop - (head ? head.offsetHeight : 0)); }
    }
  }

  function rowHtml(r) {
    var sr = int(r.senior_count), isOff = off(r);
    var vs = window.VBRVillas && window.VBRVillas.villasFor ? window.VBRVillas.villasFor(r) : [];
    var tags = vs.map(function (v) { return '<span class="cab-tag" title="' + esc(v.room_type_name || "") + '">' + esc(v.unit_label) + "</span>"; }).join("");
    var prov = (r.booking_villas || []).some(function (bv) { return bv.provisional; });
    var booker = r.booked_by || (r.cb_owned ? "Cloudbeds" : r.source === "website" ? "Website" : (D.SOURCE_LABELS && D.SOURCE_LABELS[r.source]) || r.source || "");
    return '<tr class="dcal-row' + (isOff ? " is-off" : "") + (st.q ? " hit" : "") + (r.source === "website" ? " is-web" : "") + '" data-id="' + esc(r.id) + '">' +
      "<td>" + esc(booker) + "</td>" +
      '<td class="dcal-guest"><b>' + esc(r.guest_name || "—") + "</b>" +
      '<span class="muted">' + esc([r.guest_phone, r.order_code, r.cb_reservation_id ? "CB #" + r.cb_reservation_id : ""].filter(Boolean).join(" · ")) + "</span></td>" +
      '<td class="num">' + (Math.max(int(r.adults) - sr, 0) || "") + "</td>" +
      '<td class="num">' + (int(r.children_6_12) || "") + "</td>" +
      '<td class="num">' + (int(r.children_0_5) || "") + "</td>" +
      '<td class="num">' + (sr || "") + "</td>" +
      '<td class="num">' + (int(r.pet_count) || "") + "</td>" +
      '<td class="num cab-d">' + Math.max(1, (r.booking_villas || []).length) + "</td>" +
      '<td class="num">' + nightsOf(r) + "</td>" +
      "<td>" + esc(shortDate(r.check_out)) + "</td>" +
      '<td class="num">' + (r.total_amount == null ? "—" : esc(peso(r.total_amount))) + "</td>" +
      '<td class="num">' + (int(r.amount_paid) ? esc(peso(r.amount_paid)) : "") + "</td>" +
      '<td><span class="status-badge readonly status-' + esc(r.status) + '">' + esc(D.statusLabel(r)) + "</span></td>" +
      '<td class="dcal-remarks">' + esc(remarks(r)) + "</td>" +
      '<td class="dcal-cabno vcal-units">' + (tags || '<span class="muted">—</span>') + (prov ? '<span class="muted">unassigned</span>' : "") + "</td></tr>";
  }

  // ------------------------------------------------------------- clicks
  $("vcalGrid").addEventListener("click", function (e) {
    var c = e.target.closest(".dcal-cell[data-date]");
    if (c) jumpTo(c.getAttribute("data-date"));
  });
  $("vcalBody").addEventListener("click", function (e) {
    var add = e.target.closest(".vcal-add");
    if (add && window.VBRVillas) { var ds = add.getAttribute("data-date"); window.VBRVillas.openBooking(null, { check_in: ds, check_out: addDays(ds, 1) }); return; }
    var tr = e.target.closest(".dcal-row");
    if (tr) { var r = rowById(tr.getAttribute("data-id")); if (r && window.VBRVillas) window.VBRVillas.openBooking(r); }
  });

  applyView();
})();
