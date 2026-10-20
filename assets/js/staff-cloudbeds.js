// =============================================================================
// Staff dashboard: "Cloudbeds view" / "New version" interface switch.
//
// Purely an interface layer. Both views use the same data, the same forms and
// the same buttons (this file only adds a Cloudbeds-style top bar, side menu,
// front-desk dashboard and calendar styling, and clicks the existing
// controls). Each person's choice is remembered in this browser.
// Styles: assets/css/staff-cloudbeds.css (everything scoped to body.cbv).
// =============================================================================
(function () {
  "use strict";
  var KEY = "vbr.view", PAGE_KEY = "vbr.cbpage";
  var D = window.VBRDash, V = function () { return window.VBRVillas; };
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  if (!D) return;
  var esc = D.esc;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dmy(s) { if (!s) return "—"; var p = s.slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  function isVilla(r) { return r.stay_type === "overnight"; }
  function active(r) { return r.status !== "declined" && r.status !== "expired"; }
  function initials(n) { return String(n || "?").replace(/[^A-Za-zÀ-ž ]/g, " ").trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase() || "?"; }

  // ---------------------------------------------------------------- icons
  var I = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    home: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
    log: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/>',
    team: '<circle cx="9" cy="9" r="3"/><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5"/><circle cx="17" cy="8" r="2.4"/><path d="M16 14c2.8 0 5 1.4 5 4"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    chevL: '<path d="M14 6l-6 6 6 6"/>',
    chevR: '<path d="M10 6l6 6-6 6"/>',
    chevD: '<path d="M6 9l6 6 6-6"/>',
    sort: '<path d="M8 10l4-4 4 4M8 14l4 4 4-4"/>',
    check: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    user: '<circle cx="12" cy="9" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5"/>',
  };
  function ico(n) { return '<svg class="cb-ico" viewBox="0 0 24 24" aria-hidden="true">' + I[n] + "</svg>"; }

  // ---------------------------------------------------------------- toggle
  var toggle = document.createElement("div");
  toggle.className = "view-toggle";
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Dashboard view");
  toggle.innerHTML = '<button type="button" data-view="cloudbeds">Cloudbeds view</button><button type="button" data-view="new">New version</button>';
  toggle.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (b) setView(b.getAttribute("data-view"));
  });
  var head = document.querySelector(".dash-head");
  if (head) head.insertBefore(toggle, $("logoutBtn"));

  // ---------------------------------------------------------------- top bar
  var top = document.createElement("header");
  top.id = "cbTop";
  top.innerHTML =
    '<button type="button" class="cb-iconbtn" id="cbMenuBtn" title="Menu" aria-label="Menu">' + ico("menu") + "</button>" +
    '<div class="cb-brand"><img src="../assets/brand/logo-mark.png" alt=""><span>Virgin Beach Resort</span></div>' +
    '<label class="cb-search">' + ico("search") + '<input id="cbSearch" type="search" placeholder="Search reservations, guests, and more" autocomplete="off"></label>' +
    '<div class="cb-top-right">' +
    '<div class="cb-new"><button type="button" class="cb-iconbtn cb-plus" id="cbNewBtn" title="New reservation" aria-label="New reservation">' + ico("plus") + "</button>" +
    '<div class="cb-pop" id="cbNewPop"><button type="button" data-new="villa">' + ico("bed") + "New villa reservation</button>" +
    '<button type="button" data-new="daytrip">' + ico("sun") + "New day trip booking</button></div></div>" +
    '<button type="button" class="cb-iconbtn" data-go="calendar" title="Calendar" aria-label="Calendar">' + ico("cal") + "</button>" +
    '<button type="button" class="cb-iconbtn" data-go="reservations" title="Reservations" aria-label="Reservations">' + ico("bed") + "</button>" +
    '<button type="button" class="cb-iconbtn" data-go="daytrips" title="Day Trips" aria-label="Day Trips">' + ico("sun") + "</button>" +
    '<span class="cb-toggle-slot"></span>' +
    '<button type="button" class="cb-iconbtn" id="cbUserBtn" title="Sign out" aria-label="Sign out">' + ico("out") + "</button>" +
    "</div>";
  body.insertBefore(top, body.firstChild);

  var menu = document.createElement("nav");
  menu.id = "cbMenu";
  var NAV = [
    ["dashboard", "home", "Dashboard"], ["calendar", "cal", "Calendar"], ["reservations", "bed", "Reservations"], ["daytrips", "sun", "Day Trips"], null,
    ["#plannerBtn", "map", "Cabana Map"], ["#logBtn", "log", "Activity Log"], ["#teamBtn", "team", "Team Activity"], ["#exportBtn", "dl", "Export CSV"], null,
    ["#logoutBtn", "out", "Sign out"],
  ];
  menu.innerHTML = NAV.map(function (n) {
    if (!n) return "<hr>";
    var attr = n[0].charAt(0) === "#" ? 'data-click="' + n[0].slice(1) + '"' : 'data-go="' + n[0] + '"';
    return '<button type="button" ' + attr + ">" + ico(n[1]) + "<span>" + n[2] + "</span></button>";
  }).join("");
  body.insertBefore(menu, top.nextSibling);
  var scrim = document.createElement("div");
  scrim.id = "cbScrim";
  body.insertBefore(scrim, menu.nextSibling);

  function openMenu(on) { body.classList.toggle("cb-menu-open", on); $("cbMenuBtn").innerHTML = ico(on ? "close" : "menu"); }
  $("cbMenuBtn").addEventListener("click", function () { openMenu(!body.classList.contains("cb-menu-open")); });
  scrim.addEventListener("click", function () { openMenu(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { openMenu(false); $("cbNewPop").classList.remove("open"); } });

  document.addEventListener("click", function (e) {
    if (!body.classList.contains("cbv")) return;
    var go = e.target.closest("[data-go]");
    if (go && (go.closest("#cbTop") || go.closest("#cbMenu") || go.closest("#cbDash"))) { openMenu(false); goPage(go.getAttribute("data-go")); return; }
    var ck = e.target.closest("#cbMenu [data-click]");
    if (ck) { openMenu(false); var t = $(ck.getAttribute("data-click")); if (t) t.click(); return; }
    var nb = e.target.closest("#cbNewBtn");
    var pop = $("cbNewPop");
    if (nb) { pop.classList.toggle("open"); return; }
    var nw = e.target.closest("#cbNewPop [data-new]");
    if (nw) { pop.classList.remove("open"); $(nw.getAttribute("data-new") === "villa" ? "addVillaBtn" : "addBtn").click(); return; }
    if (!e.target.closest(".cb-new")) pop.classList.remove("open");
  });
  $("cbUserBtn").addEventListener("click", function () { $("logoutBtn").click(); });

  // Top search drives the existing search box.
  var cbSearch = $("cbSearch"), searchBox = $("searchBox");
  cbSearch.addEventListener("input", function () {
    if (page === "dashboard" || page === "calendar") goPage(section() === "villas" ? "reservations" : "daytrips", true);
    searchBox.value = cbSearch.value;
    searchBox.dispatchEvent(new Event("input"));
  });
  searchBox.addEventListener("input", function () { if (cbSearch.value !== searchBox.value) cbSearch.value = searchBox.value; });

  // ---------------------------------------------------------------- pages
  var dash = document.createElement("section");
  dash.id = "cbDash";
  var pageHead = document.createElement("div");
  pageHead.id = "cbPageHead";
  var dashScreen = $("dashScreen");
  dashScreen.insertBefore(dash, dashScreen.firstChild);
  dashScreen.insertBefore(pageHead, dash.nextSibling);

  var page = store(PAGE_KEY) || "dashboard";
  function section() { var t = document.querySelector("#sectionTabs .sec-tab.active"); return t ? t.getAttribute("data-section") : "daytrip"; }
  function setSection(s) {
    if (section() === s) return;
    var t = document.querySelector('#sectionTabs .sec-tab[data-section="' + s + '"]');
    if (t) t.click();
  }
  var calBackdrop = $("villaCalBackdrop");
  var prevPage = "dashboard";
  function goPage(p, keepSearch) {
    if (p === "calendar" && page !== "calendar") prevPage = page;
    page = p;
    store(PAGE_KEY, p);
    body.setAttribute("data-cbpage", p);
    if (p === "reservations") setSection("villas");
    if (p === "daytrips") setSection("daytrip");
    if (p === "calendar") { if (!calBackdrop.classList.contains("open")) $("villaCalBtn").click(); }
    else if (calBackdrop.classList.contains("open")) calBackdrop.classList.remove("open");
    Array.prototype.forEach.call(document.querySelectorAll("#cbMenu [data-go], #cbTop [data-go]"), function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-go") === p);
    });
    if (!keepSearch && (p === "dashboard" || p === "calendar") && cbSearch.value) { cbSearch.value = ""; searchBox.value = ""; searchBox.dispatchEvent(new Event("input")); }
    pageHead.innerHTML = p === "reservations" ? "<h1>Reservations</h1><p>Overnight stays in the 18 casitas &middot; synced with Cloudbeds</p>"
      : p === "daytrips" ? "<h1>Day Trips</h1><p>Day Trip, Half-day, Flash Sale, All-Inclusive and Corporate bookings</p>" : "";
    if (p === "dashboard") drawDash();
    window.scrollTo(0, 0);
  }
  // The calendar can be closed with its own buttons — follow it.
  new MutationObserver(function () {
    if (!body.classList.contains("cbv")) return;
    var open = calBackdrop.classList.contains("open");
    if (!open && page === "calendar") goPage(prevPage === "calendar" ? "dashboard" : prevPage);
    if (open && page !== "calendar") { page = "calendar"; body.setAttribute("data-cbpage", "calendar"); }
  }).observe(calBackdrop, { attributes: true, attributeFilter: ["class"] });

  // ---------------------------------------------------------------- dashboard
  var dashFrom = today(), dashTo = dashFrom, dashTab = "arrivals";
  function stayLine(r) {
    if (isVilla(r)) {
      var n = r.check_out ? Math.round((new Date(r.check_out + "T00:00:00Z") - new Date(r.check_in + "T00:00:00Z")) / 864e5) : 0;
      return dmy(r.check_in) + " – " + dmy(r.check_out) + ' <span class="cb-dim">' + n + " night" + (n === 1 ? "" : "s") + "</span>";
    }
    return dmy(r.check_in);
  }
  function accomLine(r) {
    if (isVilla(r)) {
      var v = V() && V().villasFor ? V().villasFor(r) : [];
      var names = v.map(function (x) { return x.unit_label; }).join(", ");
      return esc(names || r.room_name || "Not assigned");
    }
    return esc((D.TYPE_LABELS && D.TYPE_LABELS[r.stay_type]) || r.stay_type_label || r.stay_type || "");
  }
  function pax(r) { return (r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0); }
  function statusKey(r) {
    var cbs = r.cb_info && r.cb_info.status;
    if (isVilla(r) && cbs === "checked_in" && r.status === "confirmed") return "checked_in";
    if (isVilla(r) && cbs === "no_show") return "no_show";
    return r.status;
  }
  function statusHtml(r) {
    var lbl = D.statusLabel ? D.statusLabel(r) : r.status;
    return '<span class="cb-st cb-st-' + statusKey(r) + '"><i></i>' + esc(lbl) + "</span>";
  }
  // Activity for one day or a date range (inclusive): arrivals / departures on
  // those dates, stays in-house on any of those nights, stayovers staying
  // through the whole range, day trips, bookings made and cancellations.
  function lists(from, to) {
    var rows = D.rows() || [], L = { arrivals: [], departures: [], inhouse: [], stayovers: [], daytrips: [], bookings: [], cancellations: [] };
    var inR = function (d) { return d && d >= from && d <= to; };
    rows.forEach(function (r) {
      var made = r.created_at ? new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) : "";
      if (inR(made)) L.bookings.push(r);
      if (!active(r)) {
        var mod = ((r.cb_info && r.cb_info.modified) || "").slice(0, 10);
        if ((inR(mod) || inR(made)) && r.check_in && r.check_in >= from) L.cancellations.push(r);
        return;
      }
      if (isVilla(r)) {
        if (inR(r.check_in)) L.arrivals.push(r);
        if (inR(r.check_out)) L.departures.push(r);
        if (r.check_in <= to && r.check_out > from) L.inhouse.push(r);
        if (r.check_in < from && r.check_out > to) L.stayovers.push(r);
      } else if (inR(r.check_in)) L.daytrips.push(r);
    });
    return L;
  }
  function spanDays(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5) + 1; }
  function rangeLabel(a, b) {
    if (a === b) return a === today() ? "Today" : dmy(a);
    return dmy(a) + " – " + dmy(b);
  }

  // ---------------------------------------------------------------- date picker
  // Cloudbeds-style calendar popover: pick one day, or click a start and an end.
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var pick = null; // { key, from, to, start, view: "YYYY-MM", anchor }
  function pickerHtml() {
    var y = Number(pick.view.slice(0, 4)), m = Number(pick.view.slice(5, 7)) - 1;
    var first = new Date(Date.UTC(y, m, 1)), startDow = first.getUTCDay();
    var days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var lo = pick.start || pick.from, hi = pick.start ? pick.start : pick.to;
    var cells = "";
    for (var i = 0; i < startDow; i++) cells += "<span></span>";
    for (var d = 1; d <= days; d++) {
      var ds = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      var cls = (ds >= lo && ds <= hi ? " in" : "") + (ds === lo ? " lo" : "") + (ds === hi ? " hi" : "") + (ds === today() ? " now" : "");
      cells += '<button type="button" class="cb-dp-d' + cls + '" data-day="' + ds + '">' + d + "</button>";
    }
    var yrs = "";
    for (var yy = y - 3; yy <= y + 2; yy++) yrs += '<option value="' + yy + '"' + (yy === y ? " selected" : "") + ">" + yy + "</option>";
    return '<div class="cb-dp-head"><button type="button" class="cb-dp-nav" data-dpm="-1" aria-label="Previous month">' + ico("chevL") + "</button>" +
      '<select data-dp="m">' + MONTHS.map(function (n, i) { return '<option value="' + i + '"' + (i === m ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select>" +
      '<select data-dp="y">' + yrs + "</select>" +
      '<button type="button" class="cb-dp-nav" data-dpm="1" aria-label="Next month">' + ico("chevR") + "</button></div>" +
      '<div class="cb-dp-dow"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>' +
      '<div class="cb-dp-grid">' + cells + "</div>" +
      '<p class="cb-dp-hint">' + (pick.start ? "Now click the last date (or the same date again for one day)." : "Click a date, or a start and an end date for a range.") + "</p>" +
      '<div class="cb-dp-quick"><button type="button" data-dpq="today">Today</button><button type="button" data-dpq="tomorrow">Tomorrow</button>' +
      '<button type="button" data-dpq="week">This week</button><button type="button" data-dpq="next7">Next 7 days</button><button type="button" data-dpq="month">This month</button></div>';
  }
  var pop = document.createElement("div");
  pop.className = "cb-dp";
  pop.hidden = true;
  body.appendChild(pop);
  function openPicker(anchor, key, from, to, onPick) {
    pick = { key: key, from: from, to: to, start: null, view: from.slice(0, 7), onPick: onPick };
    pop.innerHTML = pickerHtml();
    pop.hidden = false;
    var r = anchor.getBoundingClientRect(), w = 300;
    pop.style.top = (r.bottom + window.scrollY + 6) + "px";
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w + window.scrollX)) + "px";
  }
  function closePicker() { pop.hidden = true; pick = null; }
  function applyPick(a, b) { var f = pick.onPick; closePicker(); f(a <= b ? a : b, a <= b ? b : a); }
  pop.addEventListener("click", function (e) {
    e.stopPropagation();
    var d = e.target.closest("[data-day]"), nav = e.target.closest("[data-dpm]"), q = e.target.closest("[data-dpq]");
    if (nav) {
      var y = Number(pick.view.slice(0, 4)), m = Number(pick.view.slice(5, 7)) - 1 + Number(nav.getAttribute("data-dpm"));
      var dt = new Date(Date.UTC(y, m, 1));
      pick.view = dt.toISOString().slice(0, 7);
      pop.innerHTML = pickerHtml();
      return;
    }
    if (q) {
      var t = today(), k = q.getAttribute("data-dpq"), dow = new Date(t + "T00:00:00Z").getUTCDay();
      if (k === "today") applyPick(t, t);
      if (k === "tomorrow") applyPick(addDays(t, 1), addDays(t, 1));
      if (k === "week") applyPick(addDays(t, -dow), addDays(t, 6 - dow));
      if (k === "next7") applyPick(t, addDays(t, 6));
      if (k === "month") { var ms = t.slice(0, 8) + "01"; var nx = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0)); applyPick(ms, nx.toISOString().slice(0, 10)); }
      return;
    }
    if (d) {
      var ds = d.getAttribute("data-day");
      if (!pick.start) { pick.start = ds; pop.innerHTML = pickerHtml(); return; }
      applyPick(pick.start, ds);
    }
  });
  pop.addEventListener("change", function (e) {
    var s2 = e.target.getAttribute("data-dp");
    if (!s2) return;
    var y = Number(pick.view.slice(0, 4)), m = Number(pick.view.slice(5, 7)) - 1;
    if (s2 === "m") m = Number(e.target.value); else y = Number(e.target.value);
    pick.view = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    pop.innerHTML = pickerHtml();
  });
  document.addEventListener("click", function (e) { if (pick && !e.target.closest(".cb-dp") && !e.target.closest("[data-dpopen]")) closePicker(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && pick) closePicker(); });
  window.addEventListener("resize", function () { if (pick) closePicker(); });

  var TABS = [["arrivals", "Arrivals"], ["departures", "Departures"], ["inhouse", "In-house"], ["stayovers", "Stayovers"], ["daytrips", "Day Trips"], ["bookings", "Bookings"], ["cancellations", "Cancelations"]];
  var EMPTY = { arrivals: "There are no arrivals", departures: "There are no departures", inhouse: "Nobody is in-house", stayovers: "There are no stayovers", daytrips: "There are no day trip guests", bookings: "No bookings were made", cancellations: "There are no cancelations" };
  var fcFrom = null, fcTo = null, blocksFor = {}, blocksBusy = {};
  function money(n) { return "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function loadBlocks(day) {
    if (blocksFor[day] !== undefined || blocksBusy[day]) return;
    blocksBusy[day] = 1;
    D.sb.from("booking_villas").select("villa_id").is("booking_id", null).eq("active", true).lte("check_in", day).gt("check_out", day).then(function (res) {
      blocksFor[day] = res && !res.error ? (res.data || []).length : 0;
      delete blocksBusy[day];
      drawDash();
    });
  }
  function remaining(r, kind) {
    var c = r.cb_info && r.cb_info.status;
    return kind === "arrivals" ? c !== "checked_in" && c !== "checked_out" : c !== "checked_out";
  }
  function forecast(start, days, units) {
    var end = addDays(start, days), roomNights = 0, revenue = 0, dtGuests = 0, dtRevenue = 0;
    (D.rows() || []).forEach(function (r) {
      if (!active(r) || !r.check_in) return;
      if (!isVilla(r)) {
        if (r.check_in >= start && r.check_in < end) { dtGuests += pax(r); dtRevenue += Number(r.total_amount) || 0; }
        return;
      }
      if (!r.check_out || r.check_out <= start || r.check_in >= end) return;
      var n = Math.max(1, Math.round((new Date(r.check_out + "T00:00:00Z") - new Date(r.check_in + "T00:00:00Z")) / 864e5));
      var a = r.check_in > start ? r.check_in : start, b2 = r.check_out < end ? r.check_out : end;
      var inRange = Math.round((new Date(b2 + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
      var rooms = Math.max(1, (r.booking_villas || []).length);
      roomNights += inRange * rooms;
      revenue += (Number(r.total_amount) || 0) / n * inRange;
    });
    var cap = units * days;
    return { occ: cap ? roomNights / cap * 100 : 0, roomNights: roomNights, adr: roomNights ? revenue / roomNights : 0, revpar: cap ? revenue / cap : 0, revenue: revenue, dtGuests: dtGuests, dtRevenue: dtRevenue };
  }

  function drawDash() {
    if (!body.classList.contains("cbv") || page !== "dashboard") return;
    var day = dashFrom, L = lists(dashFrom, dashTo), nDays = spanDays(dashFrom, dashTo), isRange = nDays > 1;
    var units = V() && V().villas ? V().villas().length || 18 : 18;
    var occ = {}, unitNights = 0;
    L.inhouse.forEach(function (r) {
      var a = r.check_in > dashFrom ? r.check_in : dashFrom, z = r.check_out <= dashTo ? r.check_out : addDays(dashTo, 1);
      var n = Math.max(0, spanDays(a, z) - 1);
      (r.booking_villas || []).forEach(function (bv) { occ[bv.villa_id] = 1; unitNights += n; });
    });
    var booked = Object.keys(occ).length, pct = units ? (isRange ? unitNights / (units * nDays) : booked / units) * 100 : 0;
    loadBlocks(day);
    var oos = blocksFor[day] || 0;
    var dt = new Date(day + "T00:00:00Z");
    var dtGuests = L.daytrips.reduce(function (s, r) { return s + pax(r); }, 0);
    if (!fcFrom) { fcFrom = day; fcTo = addDays(day, 13); }
    var F = forecast(fcFrom, spanDays(fcFrom, fcTo), units);
    var list = L[dashTab] || [];
    var dtTab = dashTab === "daytrips";
    var cols = dtTab ? ["Guest", "Booking", "Guests", "Status"] : ["Guest", "Accommodation", "Stay", "Status"];
    var badge = function (k) {
      if (k !== "arrivals" && k !== "departures") return "";
      var n = L[k].filter(function (r) { return remaining(r, k); }).length;
      return n ? '<em class="cb-rem">' + n + " Remaining</em>" : "";
    };
    dash.innerHTML =
      '<div class="cb-dash-head"><h1>Dashboard</h1>' +
      '<div class="cb-dash-nav"><button type="button" class="cb-round" data-dd="r" aria-label="Refresh" title="Refresh">' + ico("refresh") + "</button>" +
      '<button type="button" class="cb-round" data-dd="-1" aria-label="' + (isRange ? "Previous period" : "Previous day") + '">' + ico("chevL") + "</button>" +
      '<button type="button" class="cb-pill" data-dpopen="dash" aria-haspopup="dialog">' + ico("cal") + esc(rangeLabel(dashFrom, dashTo)) + "</button>" +
      '<button type="button" class="cb-round" data-dd="1" aria-label="' + (isRange ? "Next period" : "Next day") + '">' + ico("chevR") + "</button></div></div>" +
      '<div class="cb-dash-grid">' +
      '<div class="cb-col">' +
      (isRange
        ? '<div class="cb-card cb-date cb-date-range"><div>' + nDays + ' days</div><b>' + dt.getUTCDate() + "<small>–</small>" + new Date(dashTo + "T00:00:00Z").getUTCDate() + "</b><div>" +
          dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }) + (dashTo.slice(0, 7) !== dashFrom.slice(0, 7) ? " – " + new Date(dashTo + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }) : "") + "</div></div>"
        : '<div class="cb-card cb-date"><div>' + dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" }) + "</div><b>" + dt.getUTCDate() + "</b><div>" +
          dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" }) + "</div></div>") +
      '<div class="cb-card cb-occ"><div class="cb-donut" style="--p:' + pct.toFixed(2) + '"><div><b>' + pct.toFixed(2) + "%</b><span>Occupancy</span></div></div>" +
      "<ul><li><b>" + Math.max(0, units - oos) + "</b> Available units</li><li><b>" + booked + "</b> Booked units" + (isRange ? " (any night)" : "") + "</li><li><b>" + oos + "</b> Out of service" + (isRange ? " (first day)" : "") + "</li><li><b>" + dtGuests + "</b> Day trip guests</li></ul></div>" +
      "</div>" +
      '<div class="cb-card cb-activity"><div class="cb-act-head"><h2>Activity</h2></div><div class="cb-tabs">' +
      TABS.map(function (t) {
        return '<button type="button" class="cb-tab' + (t[0] === dashTab ? " is-on" : "") + '" data-tab="' + t[0] + '"><b>' + L[t[0]].length + badge(t[0]) + "</b><span>" + t[1] + "</span></button>";
      }).join("") + "</div>" +
      '<div class="cb-table-wrap"><table class="cb-table"><thead><tr>' + cols.map(function (c) { return "<th>" + c + ico("sort") + "</th>"; }).join("") + "</tr></thead><tbody>" +
      (list.length ? list.slice().sort(function (a, b) { return String(a.guest_name).localeCompare(String(b.guest_name)); }).map(function (r) {
        return '<tr data-id="' + esc(r.id) + '"><td><a href="#" class="cb-link" data-open="' + esc(r.id) + '">' + esc(r.guest_name || "—") + "</a>" +
          '<small class="cb-dim">' + esc(r.cb_reservation_id || r.order_code || "") + "</small></td><td>" + accomLine(r) + "</td><td>" + (dtTab ? pax(r) : stayLine(r)) + "</td><td>" + statusHtml(r) + "</td></tr>";
      }).join("") : '<tr class="cb-empty"><td colspan="4">' + ico("check") + "<div>" + EMPTY[dashTab] + (isRange ? " on these dates" : day === today() ? " today" : " on this day") + "</div></td></tr>") +
      "</tbody></table></div></div></div>" +
      '<div class="cb-card cb-forecast"><div class="cb-fc-head"><h2>Forecast</h2><div class="cb-dash-nav">' +
      '<button type="button" class="cb-round sm" data-fc="-1" aria-label="Previous period">' + ico("chevL") + "</button>" +
      '<span class="cb-pill cb-fc-pill"><button type="button" class="cb-fc-open" data-dpopen="fc" aria-haspopup="dialog">' + ico("cal") + dmy(fcFrom) + " – " + dmy(fcTo) + "</button>" +
      (fcFrom !== day || fcTo !== addDays(day, 13) ? '<button type="button" class="cb-x" data-fc="0" aria-label="Reset to the next two weeks">×</button>' : "") + "</span>" +
      '<button type="button" class="cb-round sm" data-fc="1" aria-label="Next period">' + ico("chevR") + "</button></div></div>" +
      '<div class="cb-kpis">' +
      "<div><b>" + F.occ.toFixed(2) + "%</b><span>Occupancy</span></div>" +
      "<div><b>" + F.roomNights + "</b><span>Room nights</span></div>" +
      "<div><b>" + money(F.adr) + "</b><span>Adr</span></div>" +
      "<div><b>" + money(F.revpar) + "</b><span>Revpar</span></div>" +
      "<div><b>" + money(F.revenue) + "</b><span>Revenue</span></div>" +
      '<div class="cb-kpi-vbr"><b>' + F.dtGuests.toLocaleString() + "</b><span>Day trip guests</span></div>" +
      '<div class="cb-kpi-vbr"><b>' + money(F.dtRevenue) + "</b><span>Day trip revenue</span></div></div>" +
      '<p class="cb-dim cb-fc-note">Villa revenue is each stay\'s total spread evenly over its nights (cancelled stays excluded).</p></div>';
  }
  function setDash(a, b) { dashFrom = a; dashTo = b; fcFrom = a; fcTo = addDays(a, 13); drawDash(); }
  dash.addEventListener("click", function (e) {
    var t = e.target.closest("[data-tab]");
    if (t) { dashTab = t.getAttribute("data-tab"); drawDash(); return; }
    var op = e.target.closest("[data-dpopen]");
    if (op) {
      if (pick) { closePicker(); return; }
      if (op.getAttribute("data-dpopen") === "dash") openPicker(op, "dash", dashFrom, dashTo, setDash);
      else openPicker(op, "fc", fcFrom, fcTo, function (a, b) { fcFrom = a; fcTo = b; drawDash(); });
      return;
    }
    var dd = e.target.closest("[data-dd]");
    if (dd) {
      var v = dd.getAttribute("data-dd");
      if (v === "r") { blocksFor = {}; D.reload(); return; }
      var len = spanDays(dashFrom, dashTo) * Number(v);
      setDash(addDays(dashFrom, len), addDays(dashTo, len));
      return;
    }
    var fc = e.target.closest("[data-fc]");
    if (fc) {
      var k = Number(fc.getAttribute("data-fc"));
      if (!k) { fcFrom = dashFrom; fcTo = addDays(dashFrom, 13); }
      else { var l2 = spanDays(fcFrom, fcTo) * k; fcFrom = addDays(fcFrom, l2); fcTo = addDays(fcTo, l2); }
      drawDash();
      return;
    }
    var o = e.target.closest("[data-open]");
    if (o) { e.preventDefault(); openRow(o.getAttribute("data-open")); }
  });
  function openRow(id) {
    if (window.VBRPanel) { window.VBRPanel.openById(id); return; }
    var r = (D.rows() || []).filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (isVilla(r) && V()) V().openBooking(r);
    else if (D.openModal) D.openModal(r);
  }
  document.addEventListener("vbr:render", function () { if (page === "dashboard") setTimeout(drawDash, 0); });

  // Guest names in the reservations list open the booking, like Cloudbeds.
  $("bookingsBody").addEventListener("click", function (e) {
    if (!body.classList.contains("cbv")) return;
    var g = e.target.closest("td.col-guest");
    if (!g) return;
    var b = g.parentElement.querySelector(".row-actions .log-btn");
    if (b) b.click();
  });

  // ---------------------------------------------------------------- calendar
  var calTable = $("calTable");
  var legend = document.createElement("div");
  legend.className = "cb-legend";
  legend.innerHTML = [["confirmed", "Confirmed"], ["pending", "Confirmation Pending"], ["checked_in", "Checked In"], ["completed", "Checked Out"], ["hold", "Blocked / On hold"]]
    .map(function (x) { return '<span><i class="lg-' + x[0] + '"></i>' + x[1] + "</span>"; }).join("");
  var oldLegend = calBackdrop.querySelector(".cal-legend");
  if (oldLegend) oldLegend.parentNode.insertBefore(legend, oldLegend.nextSibling);

  var calBusy = false, collapsed = {};
  calTable.addEventListener("click", function (e) {
    var g = e.target.closest("tr.cb-grp");
    if (!g || !body.classList.contains("cbv")) return;
    var t = g.getAttribute("data-grp");
    collapsed[t] = !collapsed[t];
    g.classList.toggle("is-collapsed", !!collapsed[t]);
    Array.prototype.forEach.call(calTable.querySelectorAll("tr[data-of]"), function (r) { if (r.getAttribute("data-of") === t) r.hidden = !!collapsed[t]; });
  });
  function decorateCal() {
    if (!body.classList.contains("cbv") || calBusy) return;
    var head = calTable.querySelector("thead tr");
    var bodyRows = Array.prototype.slice.call(calTable.querySelectorAll("tbody tr:not(.cb-grp)"));
    if (!head || !bodyRows.length || calTable.querySelector(".cb-grp")) return;
    calBusy = true;
    var ths = Array.prototype.slice.call(head.children).slice(1), n = ths.length;
    // occupancy per night, overall and per room type
    var occAll = new Array(n).fill(0), groups = [], cur = null;
    bodyRows.forEach(function (tr) {
      var unit = tr.querySelector("th.unit"), type = unit && unit.querySelector("small") ? unit.querySelector("small").textContent : "";
      if (!cur || cur.type !== type) { cur = { type: type, first: tr, rows: 0, free: new Array(n).fill(0) }; groups.push(cur); }
      cur.rows++;
      var col = 0;
      Array.prototype.forEach.call(tr.children, function (td) {
        if (td.tagName !== "TD") return;
        var span = td.colSpan || 1;
        for (var k = 0; k < span && col + k < n; k++) {
          if (td.classList.contains("free")) cur.free[col + k]++; else occAll[col + k]++;
        }
        col += span;
      });
      Array.prototype.forEach.call(tr.querySelectorAll(".cal-bk"), function (b) {
        if (b.querySelector(".cb-in")) return;
        b.innerHTML = '<span class="cb-in">' + b.innerHTML + "</span>";
      });
      if (unit && !unit.querySelector(".cb-unit")) unit.innerHTML = '<span class="cb-unit">' + esc(unit.firstChild ? unit.firstChild.textContent : "") + "</span>";
    });
    var total = bodyRows.length;
    calTable.classList.add("cb-fixed");
    calTable.style.width = (224 + n * 86) + "px";
    Array.prototype.forEach.call(head.children, function (th, i) { th.style.width = (i ? 86 : 224) + "px"; });
    ths.forEach(function (th, i) {
      var b = th.querySelector("b"), dname = (th.firstChild && th.firstChild.textContent) || "";
      var num = b ? b.textContent.replace(/[^0-9]/g, "") : "";
      th.innerHTML = '<span class="cb-dow">' + esc(dname) + '</span><span class="cb-dnum">' + esc(num) + '</span><span class="cb-dpct">' + (total ? (occAll[i] / total * 100).toFixed(2) : "0.00") + "%</span>";
    });
    // nightly rate per room type (weekday / weekend & peak), from the villa rate sheet
    var rates = {};
    (V() && V().villas ? V().villas() : []).forEach(function (v) {
      var t = v.room_type_name, x = rates[t] || (rates[t] = { wd: Infinity, we: Infinity });
      x.wd = Math.min(x.wd, Number(v.weekday_rate) || Infinity);
      x.we = Math.min(x.we, Number(v.weekend_rate) || Infinity);
    });
    groups.forEach(function (g) {
      var tr = document.createElement("tr");
      tr.className = "cb-grp" + (collapsed[g.type] ? " is-collapsed" : "");
      tr.setAttribute("data-grp", g.type);
      var rt = rates[g.type];
      tr.innerHTML = '<th class="unit"><button type="button" class="cb-grp-tg" aria-label="Show or hide ' + esc(g.type) + '">' + ico("chevD") + "</button>" + esc(g.type || "Casitas") + "</th>" + g.free.map(function (f, i) {
        var we = /\b(we|peak)\b/.test(ths[i].className || "");
        var rate = rt ? (we ? rt.we : rt.wd) : Infinity;
        return '<td class="' + (ths[i].className || "") + '"><span class="cb-avail' + (f ? "" : " is-full") + '">' + ico("bed") + f + "</span>" +
          (isFinite(rate) ? '<span class="cb-rate">₱' + Number(rate).toLocaleString("en-PH", { minimumFractionDigits: 2 }) + "</span>" : "") + "</td>";
      }).join("");
      g.first.parentNode.insertBefore(tr, g.first);
      var el = g.first;
      for (var k = 0; k < g.rows && el; k++, el = el.nextElementSibling) { el.setAttribute("data-of", g.type); el.hidden = !!collapsed[g.type]; }
    });
    calBusy = false;
  }
  new MutationObserver(function () { setTimeout(decorateCal, 0); }).observe(calTable, { childList: true });

  // ---------------------------------------------------------------- drawers
  // Booking forms open as a Cloudbeds-style side drawer with the guest's initials.
  [["addModalBackdrop", "addName"], ["villaModalBackdrop", "vName"]].forEach(function (p) {
    var bd = $(p[0]);
    if (!bd) return;
    var m = bd.querySelector(".modal"), h2 = m && m.querySelector("h2");
    if (!h2) return;
    var who = document.createElement("div");
    who.className = "cb-drawer-who";
    h2.parentNode.insertBefore(who, h2);
    var x = document.createElement("button");
    x.type = "button";
    x.className = "cb-drawer-x";
    x.setAttribute("aria-label", "Close");
    x.innerHTML = ico("close");
    x.addEventListener("click", function () { bd.classList.remove("open"); });
    m.insertBefore(x, m.firstChild);
    function sync() {
      var name = ($(p[1]) && $(p[1]).value) || "";
      who.innerHTML = name ? '<span class="cb-avatar">' + esc(initials(name)) + "</span>" : "";
    }
    new MutationObserver(function () { if (bd.classList.contains("open")) setTimeout(sync, 30); }).observe(bd, { attributes: true, attributeFilter: ["class"] });
    var inp = $(p[1]);
    if (inp) inp.addEventListener("input", sync);
  });

  // ---------------------------------------------------------------- switching
  function signedIn() { return dashScreen.style.display === "block"; }
  function syncAuth() { body.classList.toggle("cb-signed-in", signedIn()); if (signedIn() && page === "dashboard") drawDash(); }
  new MutationObserver(syncAuth).observe(dashScreen, { attributes: true, attributeFilter: ["style"] });

  function setView(v) {
    store(KEY, v);
    var cb = v === "cloudbeds";
    body.classList.toggle("cbv", cb);
    Array.prototype.forEach.call(toggle.querySelectorAll("button"), function (b) {
      var on = b.getAttribute("data-view") === v;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var slot = cb ? top.querySelector(".cb-toggle-slot") : head;
    if (slot && toggle.parentNode !== slot) { if (cb) slot.appendChild(toggle); else head.insertBefore(toggle, $("logoutBtn")); }
    openMenu(false);
    if (cb) {
      goPage(page === "calendar" ? "dashboard" : page);
    } else {
      body.removeAttribute("data-cbpage");
      if (calBackdrop.classList.contains("open")) calBackdrop.classList.remove("open");
    }
    syncAuth();
    if (ready && D.rows && (D.rows() || []).length) D.render();
    try { document.dispatchEvent(new CustomEvent("vbr:view")); } catch (e) {}
  }
  var ready = false;
  setView(store(KEY) === "cloudbeds" ? "cloudbeds" : "new");
  ready = true;
  window.VBRView = { set: setView, go: goPage, page: function () { return page; } };
})();
