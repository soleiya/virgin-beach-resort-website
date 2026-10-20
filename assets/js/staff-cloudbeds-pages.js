// =============================================================================
// Cloudbeds view, part 2: the Reservations list (Cloudbeds columns, filter
// chips, pages of 10/25/50/100), the reservation side panel (Overview, Folio,
// Notes, Guest, Accommodations, Activity) and the calendar toolbar.
// Interface only — data, filters, sorting and saving are the dashboard's own;
// "Edit" and "+" open our own booking forms.
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash, VV = window.VBRView;
  if (!D || !VV) return;
  var esc = D.esc, peso = D.peso, body = document.body;
  var $ = function (id) { return document.getElementById(id); };
  var Vil = function () { return window.VBRVillas; };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function on() { return body.classList.contains("cbv"); }
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function dmy(s) { if (!s) return "—"; var p = String(s).slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  function localDay(ts) { return ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) : ""; }
  function nights(r) { return r.check_in && r.check_out ? Math.round((new Date(r.check_out + "T00:00:00Z") - new Date(r.check_in + "T00:00:00Z")) / 864e5) : 0; }
  function isVilla(r) { return r.stay_type === "overnight"; }
  function pax(r) { return (r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0); }
  function splitName(n) { var p = String(n || "").trim().split(/\s+/); return p.length < 2 ? [p[0] || "—", ""] : [p.slice(0, -1).join(" "), p[p.length - 1]]; }
  function initials(n) { return String(n || "?").replace(/[^A-Za-zÀ-ž ]/g, " ").trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase() || "?"; }
  function statusKey(r) {
    var c = r.cb_info && r.cb_info.status;
    if (isVilla(r) && c === "checked_in" && r.status === "confirmed") return "checked_in";
    if (isVilla(r) && c === "no_show") return "no_show";
    return r.status;
  }
  function statusHtml(r) { return '<span class="cb-st cb-st-' + statusKey(r) + '"><i></i>' + esc(D.statusLabel ? D.statusLabel(r) : r.status) + "</span>"; }
  function srcLabel(r) { return (D.SOURCE_LABELS && D.SOURCE_LABELS[r.source]) || (r.cb_info && r.cb_info.source) || r.source || "—"; }
  function typeLabel(r) { return (D.TYPE_LABELS && D.TYPE_LABELS[r.stay_type]) || r.stay_type_label || r.stay_type || ""; }
  function villasOf(r) { return Vil() && Vil().villasFor ? Vil().villasFor(r) : []; }
  function unitText(r) { var v = villasOf(r); return v.length ? v.map(function (x) { return x.unit_label; }).join(", ") : (r.room_name || "N/A"); }
  function typeText(r) {
    var v = villasOf(r), seen = {};
    return v.length ? v.map(function (x) { return x.room_type_name; }).filter(function (t) { return !seen[t] && (seen[t] = 1); }).join(", ") : "—";
  }
  function cabanaText(r) {
    var c = (r.booking_cabanas || []).map(function (bc) { return D.cabanaLabel ? D.cabanaLabel(bc.cabana_id) : ""; }).filter(Boolean);
    if (c.length) return c.join(", ");
    var L = [];
    if (r.legacy_dining_cabanas) L.push(r.legacy_dining_cabanas + " dining");
    if (r.legacy_lounge_cabanas) L.push(r.legacy_lounge_cabanas + " lounge");
    return L.join(", ") || "—";
  }
  function balanceOf(r) {
    if (r.cb_owned && r.cb_info && r.cb_info.balance != null) return Number(r.cb_info.balance);
    if (r.total_amount == null) return null;
    return Math.max(0, Number(r.total_amount) - Number(r.amount_paid || 0));
  }
  var I = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><rect x="7" y="14" width="10" height="6" rx="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>',
    globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    user: '<circle cx="12" cy="9" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
    kid: '<circle cx="12" cy="8" r="2.6"/><path d="M8 20v-5l-2-3 4-1h4l4 1-2 3v5"/>',
    paw: '<circle cx="8" cy="9" r="1.6"/><circle cx="16" cy="9" r="1.6"/><circle cx="5.5" cy="13" r="1.4"/><circle cx="18.5" cy="13" r="1.4"/><path d="M12 13c-3 0-4.5 3-4 5 1 1 3 .5 4 .5s3 .5 4-.5c.5-2-1-5-4-5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    chevL: '<path d="M14 6l-6 6 6 6"/>', chevR: '<path d="M10 6l6 6-6 6"/>', chevD: '<path d="M6 9l6 6 6-6"/>',
    sort: '<path d="M8 10l4-4 4 4M8 14l4 4 4-4"/>',
  };
  function ico(n) { return '<svg class="cb-ico" viewBox="0 0 24 24" aria-hidden="true">' + I[n] + "</svg>"; }

  // ======================================================================
  // Reservations list
  // ======================================================================
  var list = document.createElement("div");
  list.id = "cbList";
  list.innerHTML =
    '<div class="cb-list-top">' +
    '<label class="cb-lsearch">' + ico("search") + '<input id="cbListSearch" type="search" placeholder="Search by Guest name, email, or phone" autocomplete="off"></label>' +
    '<button type="button" class="cb-sq" id="cbFilterBtn" title="Filters" aria-label="Filters">' + ico("filter") + "</button>" +
    '<div class="cb-list-actions"><button type="button" class="cb-sq" data-act="export" title="Export CSV" aria-label="Export CSV">' + ico("dl") + "</button>" +
    '<button type="button" class="cb-sq" data-act="print" title="Print" aria-label="Print">' + ico("print") + "</button>" +
    '<button type="button" class="cb-newres" data-act="new">' + ico("plus") + '<span id="cbNewLabel">New reservation</span></button></div></div>' +
    '<div class="cb-list-meta"><div class="cb-count" id="cbCount"></div><div class="cb-chips" id="cbChips"></div></div>' +
    '<div class="cb-rscroll"><table class="cb-rtable"><thead id="cbHead"></thead><tbody id="cbBody"></tbody></table></div>' +
    '<div class="cb-pager" id="cbPager"></div>';
  var dashScreen = $("dashScreen"), countLine = $("countLine");
  countLine.parentNode.insertBefore(list, countLine.nextSibling);

  var searchBox = $("searchBox"), lsearch = $("cbListSearch");
  lsearch.addEventListener("input", function () { searchBox.value = lsearch.value; searchBox.dispatchEvent(new Event("input")); });
  searchBox.addEventListener("input", function () { if (lsearch.value !== searchBox.value) lsearch.value = searchBox.value; });
  $("cbFilterBtn").addEventListener("click", function () { body.classList.toggle("cb-filters-open"); $("cbFilterBtn").classList.toggle("is-on", body.classList.contains("cb-filters-open")); });
  list.addEventListener("click", function (e) {
    var a = e.target.closest("[data-act]");
    if (a) {
      var act = a.getAttribute("data-act");
      if (act === "export") $("exportBtn").click();
      if (act === "print") window.print();
      if (act === "new") $(D.section() === "villas" ? "addVillaBtn" : "addBtn").click();
      return;
    }
    var chip = e.target.closest("[data-chip]");
    if (chip) { clearChip(chip.getAttribute("data-chip")); return; }
    var th = e.target.closest("th[data-sort]");
    if (th) { var h = document.querySelector('#bookingsBody') && document.querySelector('th.sortable[data-sort="' + th.getAttribute("data-sort") + '"]'); if (h) h.click(); return; }
    var pg = e.target.closest("[data-page]");
    if (pg && !pg.disabled) { page = Number(pg.getAttribute("data-page")); drawList(); list.scrollIntoView({ block: "start" }); return; }
    var o = e.target.closest("[data-open]");
    if (o) { e.preventDefault(); openPanelById(o.getAttribute("data-open")); }
  });
  list.addEventListener("change", function (e) {
    if (e.target.id === "cbPageSize") { size = Number(e.target.value) || 10; store("vbr.cbpagesize", String(size)); page = 1; drawList(); }
  });

  var FILTERS = [
    ["filterStatus", "Status"], ["filterType", "Booking Type"], ["filterBookedBy", "Booked by"], ["filterSource", "Source"],
  ];
  function selText(el) { return el && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : ""; }
  function chipsHtml() {
    var c = [], villas = D.section() === "villas";
    var pill = document.querySelector("#filterPills .pill.active");
    var pf = pill ? pill.getAttribute("data-filter") : "all";
    c.push(chip("pill", villas ? "Stay Date" : "Trip Date", pf === "all" ? "All" : pill.textContent.trim(), pf !== "all"));
    var fld = $("filterDateField"), f = $("filterDateFrom").value, t = $("filterDateTo").value;
    var dl = fld && fld.value === "created_at" ? "Booking Date" : villas ? "Check In Date" : "Trip Date range";
    c.push(chip("dates", dl, f || t ? (f ? dmy(f) : "…") + " – " + (t ? dmy(t) : "…") : "All", !!(f || t)));
    FILTERS.forEach(function (x) {
      var el = $(x[0]);
      if (!el || (x[0] === "filterType" && villas)) return;
      c.push(chip(x[0], x[1], el.value ? selText(el) : "All", !!el.value));
    });
    var lf = $("filterLoadFrom");
    if (lf) c.push('<span class="cb-chip cb-chip-static">Loaded: <b>' + esc(selText(lf)) + "</b></span>");
    c.push('<button type="button" class="cb-chip cb-chip-reset" data-chip="reset">Reset Filters</button>');
    return c.join("");
  }
  function chip(key, label, value, active) {
    return '<span class="cb-chip' + (active ? " is-on" : "") + '">' + esc(label) + ": <b>" + esc(value) + "</b>" +
      (active ? '<button type="button" data-chip="' + key + '" aria-label="Clear ' + esc(label) + '">' + ico("x") + "</button>" : "") + "</span>";
  }
  function clearChip(k) {
    if (k === "reset") { $("clearFiltersBtn").click(); return; }
    if (k === "pill") { var a = document.querySelector('#filterPills .pill[data-filter="all"]'); if (a) a.click(); return; }
    if (k === "dates") { $("filterDateFrom").value = ""; $("filterDateTo").value = ""; $("filterDateFrom").dispatchEvent(new Event("change")); return; }
    var el = $(k);
    if (el) { el.value = ""; el.dispatchEvent(new Event("change")); }
  }

  var page = 1, size = Number(store("vbr.cbpagesize")) || 10, lastKey = "";
  var COLS = {
    villas: [["order_code", "Reservation"], ["guest_name", "Name"], [null, "Surname"], ["created_at", "Date Booked"], [null, "Room Number(s)"], [null, "Room Type"],
      ["check_in", "Check-In"], [null, "Check-Out"], [null, "Nights"], ["total_amount", "Total Price"], ["status", "Status"], ["source", "Source"]],
    daytrip: [["order_code", "Booking"], ["guest_name", "Name"], [null, "Surname"], ["created_at", "Date Booked"], ["stay_type", "Booking Type"],
      ["check_in", "Trip Date"], ["party", "Guests"], [null, "Cabana(s)"], ["booked_by", "Booked By"], ["total_amount", "Total Price"], ["status", "Status"], ["source", "Source"]],
  };
  function cells(r, villas) {
    var n = splitName(r.guest_name);
    var link = function (t) { return '<a href="#" class="cb-link" data-open="' + esc(r.id) + '">' + esc(t) + "</a>"; };
    var total = r.total_amount != null ? esc(peso(r.total_amount)) : "—";
    if (villas) {
      return [esc(r.cb_reservation_id || r.order_code || "—") + (r.cb_reservation_id && r.order_code && !r.cb_owned ? '<small class="cb-dim">' + esc(r.order_code) + "</small>" : ""),
        link(n[0]), n[1] ? link(n[1]) : "", dmy(localDay(r.created_at)), esc(unitText(r)), esc(typeText(r)),
        dmy(r.check_in), dmy(r.check_out), nights(r), total, statusHtml(r), esc(srcLabel(r))];
    }
    return [esc(r.order_code || "—"), link(n[0]), n[1] ? link(n[1]) : "", dmy(localDay(r.created_at)), esc(typeLabel(r)),
      dmy(r.check_in), pax(r), esc(cabanaText(r)), esc(r.booked_by || "—"), total, statusHtml(r), esc(srcLabel(r))];
  }
  function drawList() {
    if (!on()) return;
    var villas = D.section() === "villas";
    var rows = D.listRows() || [];
    var key = D.section() + "|" + searchBox.value + "|" + chipsHtml();
    if (key !== lastKey) { page = 1; lastKey = key; }
    var pages = Math.max(1, Math.ceil(rows.length / size));
    if (page > pages) page = pages;
    var from = (page - 1) * size, slice = rows.slice(from, from + size);
    $("cbNewLabel").textContent = villas ? "New reservation" : "New day trip";
    lsearch.placeholder = villas ? "Search by Guest name, email, phone or Cloudbeds #" : "Search by Guest name, email, or phone";
    if (lsearch.value !== searchBox.value) lsearch.value = searchBox.value;
    $("cbCount").innerHTML = "<b>" + rows.length.toLocaleString() + "</b> " + (villas ? "reservations" : "day trip bookings");
    $("cbChips").innerHTML = chipsHtml();
    var st = D.sort ? D.sort() : {};
    $("cbHead").innerHTML = "<tr>" + COLS[villas ? "villas" : "daytrip"].map(function (c) {
      return c[0] ? '<th data-sort="' + c[0] + '" class="' + (st.field === c[0] ? "is-sorted " + st.dir : "") + '">' + c[1] + ico("sort") + "</th>" : "<th>" + c[1] + "</th>";
    }).join("") + "</tr>";
    $("cbBody").innerHTML = slice.length ? slice.map(function (r) {
      return '<tr data-id="' + esc(r.id) + '">' + cells(r, villas).map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
    }).join("") : '<tr class="cb-empty"><td colspan="12">No reservations match these filters.</td></tr>';
    // pager
    var btn = function (p, label, dis, cur) { return '<button type="button" data-page="' + p + '"' + (dis ? " disabled" : "") + (cur ? ' class="is-on"' : "") + ">" + label + "</button>"; };
    var nums = [], lo = Math.max(1, page - 2), hi = Math.min(pages, lo + 4);
    lo = Math.max(1, hi - 4);
    for (var p = lo; p <= hi; p++) nums.push(btn(p, p, false, p === page));
    $("cbPager").innerHTML = '<span class="cb-showing">Showing ' + (rows.length ? from + 1 : 0).toLocaleString() + " to " + Math.min(from + size, rows.length).toLocaleString() +
      " of " + rows.length.toLocaleString() + ' entries &bull; View up to <select id="cbPageSize">' + [10, 25, 50, 100].map(function (n) {
        return '<option value="' + n + '"' + (n === size ? " selected" : "") + ">" + n + "</option>";
      }).join("") + "</select></span>" +
      '<span class="cb-pages">' + btn(1, "«", page === 1) + btn(page - 1, "‹", page === 1) + nums.join("") + btn(page + 1, "›", page === pages) + btn(pages, "»", page === pages) + "</span>";
  }
  document.addEventListener("vbr:list", function () { setTimeout(drawList, 0); });

  // ======================================================================
  // Reservation side panel
  // ======================================================================
  var panel = document.createElement("aside");
  panel.id = "cbPanel";
  panel.setAttribute("aria-hidden", "true");
  var pscrim = document.createElement("div");
  pscrim.id = "cbPanelScrim";
  body.appendChild(pscrim);
  body.appendChild(panel);
  var cur = null, tab = "overview";
  function closePanel() { body.classList.remove("cb-panel-open"); panel.setAttribute("aria-hidden", "true"); cur = null; }
  pscrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && cur && !document.querySelector(".modal-backdrop.open")) closePanel(); });
  function openPanelById(id) {
    var r = (D.rows() || []).filter(function (x) { return x.id === id; })[0];
    if (r) openPanel(r);
  }
  function openPanel(r, t) {
    cur = r;
    tab = t || "overview";
    drawPanel();
    body.classList.add("cb-panel-open");
    panel.setAttribute("aria-hidden", "false");
  }
  var TABS = [["overview", "Overview"], ["folio", "Folio"], ["notes", "Notes"], ["guest", "Guest"], ["rooms", "Accommodations"], ["activity", "Activity"]];
  function drawPanel() {
    var r = cur;
    if (!r) return;
    var villas = isVilla(r), num = r.cb_reservation_id || r.order_code || "";
    var url = D.cbUrl ? D.cbUrl(r) : null;
    var nNotes = (r.notes ? 1 : 0) + (r.staff_notes ? 1 : 0);
    panel.innerHTML =
      '<div class="cbp-head"><div class="cbp-tools">' +
      (url ? '<a class="cbp-ib cb-link" data-cb="' + esc(r.cb_reservation_id) + '" href="' + url + '" target="_blank" rel="noopener" title="Open in Cloudbeds">' + ico("ext") + "</a>" : "") +
      '<button type="button" class="cbp-ib" data-p="close" aria-label="Close">' + ico("x") + "</button></div>" +
      '<div class="cbp-who"><span class="cb-avatar">' + esc(initials(r.guest_name)) + "</span><div><h2>" + esc(r.guest_name || "—") + "</h2><div class=\"cb-dim\">" + esc(num) +
      (r.cb_reservation_id && r.order_code && !r.cb_owned ? " · " + esc(r.order_code) : "") + "</div></div></div>" +
      '<div class="cbp-statusrow"><span class="cbp-status">' + statusHtml(r) + "</span>" +
      '<button type="button" class="cbp-ib" data-p="edit" title="' + (r.cb_reservation_id ? "Open (changes are made in Cloudbeds)" : "Edit booking") + '">' + ico("pen") + "</button>" +
      (villas ? '<button type="button" class="cbp-ib" data-p="cal" title="View on calendar">' + ico("bed") + "</button>" : "") +
      '<button type="button" class="cbp-ib" data-p="pay" title="Payments">' + ico("cash") + "</button>" +
      '<button type="button" class="cbp-ib" data-p="log" title="Activity log">' + ico("clock") + "</button></div>" +
      '<div class="cbp-tabs" role="tablist">' + TABS.map(function (t) {
        if (t[0] === "rooms" && !villas) t = ["rooms", "Cabanas"];
        return '<button type="button" role="tab" data-tab="' + t[0] + '" class="' + (tab === t[0] ? "is-on" : "") + '">' + t[1] +
          (t[0] === "notes" && nNotes ? '<sup>' + nNotes + "</sup>" : "") + "</button>";
      }).join("") + "</div></div>" +
      '<div class="cbp-body" id="cbpBody">' + tabHtml(r, tab) + "</div>";
    if (tab === "folio") loadFolio(r);
  }
  function timeline(r) {
    var b = localDay(r.created_at), a = r.check_in, d = r.check_out || r.check_in, t = today();
    var pct = t <= b ? 0 : t >= d ? 100 : t < a ? 25 * Math.min(1, (new Date(t) - new Date(b)) / Math.max(1, new Date(a) - new Date(b))) : 50 + 50 * ((new Date(t) - new Date(a)) / Math.max(1, new Date(d) - new Date(a)));
    var dot = function (x) { return '<i class="' + (pct >= x ? "is-done" : "") + '" style="left:' + x + '%"></i>'; };
    return '<div class="cbp-tl"><div class="cbp-tl-bar"><span style="width:' + pct.toFixed(0) + '%"></span>' + dot(0) + dot(50) + dot(100) + "</div>" +
      '<div class="cbp-tl-lbl"><div><b>' + dmy(b) + "</b>Booked</div><div><b>" + dmy(a) + "</b>" + (villas(r) ? "Check-in" : "Trip date") + "</div><div><b>" + dmy(d) + "</b>" + (villas(r) ? "Check-out" : "") + "</div></div></div>";
  }
  function villas(r) { return isVilla(r); }
  function card(iconName, inner, action) {
    return '<div class="cbp-card"><div class="cbp-card-h">' + ico(iconName) + (action || "") + "</div>" + inner + "</div>";
  }
  function counts(r) {
    var c = '<span class="cbp-counts">';
    if (isVilla(r)) c += "<span>" + nights(r) + ico("moon") + "</span>";
    c += "<span>" + (r.adults || 0) + ico("user") + "</span><span>" + ((r.children_6_12 || 0) + (r.children_0_5 || 0)) + ico("kid") + "</span>";
    if (r.pet_count) c += "<span>" + r.pet_count + ico("paw") + "</span>";
    return c + "</span>";
  }
  function tabHtml(r, t) {
    var bal = balanceOf(r);
    if (t === "overview") {
      var html = timeline(r);
      html += card("globe", "<h3>" + esc(srcLabel(r)) + "</h3>" + (r.booked_by ? '<span class="cbp-tag">Booked by ' + esc(r.booked_by) + "</span>" : "") +
        (!isVilla(r) ? '<span class="cbp-tag">' + esc(typeLabel(r)) + "</span>" : ""), counts(r));
      html += card("cash", "<h3>" + (bal == null ? "—" : esc(peso(bal))) + '</h3><div class="cb-dim">Balance due' + (r.total_amount != null ? " · total " + esc(peso(r.total_amount)) : "") + "</div>",
        '<button type="button" class="cbp-pill" data-p="pay">' + ico("plus") + "Add payment</button>");
      if (r.notes || r.staff_notes) {
        html += card("note", '<p class="cbp-clip">' + esc(r.staff_notes || r.notes) + "</p>", '<button type="button" class="cbp-pill" data-tab="notes">View all ›</button>');
      }
      if (isVilla(r)) {
        var vs = villasOf(r);
        (vs.length ? vs : [null]).forEach(function (v) {
          html += card("bed", "<h3>" + esc(v ? v.unit_label : r.room_name || "Not assigned") + "</h3><div>" + esc(v ? v.room_type_name : "") + "</div>" +
            '<div class="cb-dim">' + dmy(r.check_in) + " – " + dmy(r.check_out) + " · " + nights(r) + " night" + (nights(r) === 1 ? "" : "s") + "</div>",
            '<button type="button" class="cbp-pill" data-p="cal">View on Calendar ›</button>');
        });
      } else {
        html += card("sun", "<h3>" + esc(typeLabel(r)) + "</h3><div>" + esc(cabanaText(r)) + '</div><div class="cb-dim">' + dmy(r.check_in) + " · " + pax(r) + " guest" + (pax(r) === 1 ? "" : "s") + "</div>");
      }
      return html;
    }
    if (t === "folio") {
      return '<div class="cbp-folio" id="cbpFolio"><div class="cbp-figs">' +
        "<div><small>Total</small><b>" + esc(peso(r.total_amount)) + "</b></div>" +
        "<div><small>Paid</small><b>" + esc(peso(r.cb_owned && r.cb_info && r.cb_info.paid != null ? r.cb_info.paid : r.amount_paid || 0)) + "</b></div>" +
        "<div><small>Balance</small><b>" + (bal == null ? "—" : esc(peso(bal))) + "</b></div></div>" +
        '<div class="cbp-actions"><button type="button" class="cb-btn" data-p="breakdown">Price breakdown</button><button type="button" class="cb-btn" data-p="pay">' + ico("cash") + "Payments</button></div>" +
        '<table class="cbp-table"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody id="cbpPays"><tr><td colspan="4" class="cb-dim">Loading…</td></tr></tbody></table>' +
        (r.cb_owned ? '<p class="cb-dim">This stay was booked in Cloudbeds — its folio (charges and payments) is kept in Cloudbeds.</p>' : "") +
        (r.cb_folio_note ? '<p class="cbp-warn">Cloudbeds folio: ' + esc(r.cb_folio_note) + "</p>" : r.cb_folio_state === "done" ? '<p class="cb-dim">Meals, add-ons and discounts are on the Cloudbeds folio.</p>' : "") + "</div>";
    }
    if (t === "notes") {
      return '<div class="cbp-notes"><h4>Guest requests</h4><p class="cbp-box">' + (r.notes ? esc(r.notes) : '<span class="cb-dim">None</span>') + "</p>" +
        '<h4>Staff notes</h4><textarea id="cbpStaffNotes" rows="6">' + esc(r.staff_notes || "") + "</textarea>" +
        '<div class="cbp-actions"><button type="button" class="cb-btn cb-btn-solid" data-p="savenotes">Save notes</button><span class="cb-dim" id="cbpNoteMsg"></span></div></div>';
    }
    if (t === "guest") {
      var row = function (k, v) { return v ? "<tr><th>" + k + "</th><td>" + v + "</td></tr>" : ""; };
      var comp = Array.isArray(r.companions) ? r.companions.map(function (c) { return esc(c.name || c.full_name || "") + (c.age_group ? ' <span class="cb-dim">' + esc(c.age_group) + "</span>" : ""); }).filter(Boolean) : [];
      return '<table class="cbp-kv">' + row("Name", esc(r.guest_name || "")) + row("Email", r.guest_email ? '<a href="mailto:' + esc(r.guest_email) + '">' + esc(r.guest_email) + "</a>" : "") +
        row("Phone", esc(r.guest_phone || "")) + row("Country", esc(r.country || "")) + row("Adults", String(r.adults || 0)) +
        row("Kids 6–12", String(r.children_6_12 || 0)) + row("Kids 0–5", String(r.children_0_5 || 0)) + row("Seniors / PWD", r.senior_count ? String(r.senior_count) : "") +
        row("Pets", r.pet_count ? String(r.pet_count) : "") + row("How they heard", esc(r.how_heard || "")) + row("Occasion", esc(r.occasion || "")) +
        row("Marketing emails", r.marketing_opt_in ? "Opted in" : "") + "</table>" +
        (comp.length ? "<h4>Guest list</h4><ol class=\"cbp-list\"><li>" + comp.join("</li><li>") + "</li></ol>" : r.guest_names ? "<h4>Guest list</h4><p>" + esc(r.guest_names) + "</p>" : "");
    }
    if (t === "rooms") {
      if (!isVilla(r)) {
        return '<table class="cbp-table"><thead><tr><th>Booking type</th><th>Date</th><th>Cabana(s)</th><th>Guests</th></tr></thead><tbody><tr><td>' + esc(typeLabel(r)) + "</td><td>" + dmy(r.check_in) + "</td><td>" + esc(cabanaText(r)) + "</td><td>" + pax(r) + "</td></tr></tbody></table>";
      }
      var vs2 = villasOf(r);
      return '<table class="cbp-table"><thead><tr><th>Room</th><th>Room type</th><th>Arrival</th><th>Departure</th><th class="num">Nights</th></tr></thead><tbody>' +
        (vs2.length ? vs2.map(function (v) { return "<tr><td>" + esc(v.unit_label) + "</td><td>" + esc(v.room_type_name) + "</td><td>" + dmy(r.check_in) + "</td><td>" + dmy(r.check_out) + '</td><td class="num">' + nights(r) + "</td></tr>"; }).join("")
          : '<tr><td colspan="5" class="cb-dim">' + esc(r.room_name || "No casita assigned yet") + "</td></tr>") + "</tbody></table>" +
        (r.cb_reservation_id ? '<p class="cb-dim">Casitas and dates are changed in Cloudbeds — this page follows within a few minutes.</p>' : "");
    }
    if (t === "activity") {
      return '<p>Every change to this booking — by staff, guests, or Cloudbeds — is in the activity log.</p><button type="button" class="cb-btn cb-btn-solid" data-p="log">' + ico("clock") + "Open activity log</button>";
    }
    return "";
  }
  function loadFolio(r) {
    D.sb.from("booking_payments").select("created_at,kind,method,amount,status,note").eq("booking_id", r.id).order("created_at").then(function (res) {
      var tb = $("cbpPays");
      if (!tb || cur !== r) return;
      var rows = (res && res.data) || [];
      tb.innerHTML = rows.length ? rows.map(function (p) {
        return "<tr><td>" + dmy(localDay(p.created_at)) + "</td><td>" + esc((p.kind || "payment") + (p.method ? " · " + p.method : "") + (p.note ? " · " + p.note : "")) +
          '</td><td class="num">' + esc(peso(p.amount)) + '</td><td><span class="cb-st cb-st-' + (p.status === "verified" ? "confirmed" : p.status === "rejected" ? "declined" : "pending") + '"><i></i>' + esc(p.status || "") + "</span></td></tr>";
      }).join("") : '<tr><td colspan="4" class="cb-dim">No payments recorded on the website.</td></tr>';
    });
  }
  panel.addEventListener("click", function (e) {
    var t = e.target.closest("[data-tab]");
    if (t) { tab = t.getAttribute("data-tab"); drawPanel(); return; }
    var a = e.target.closest("[data-p]");
    if (!a || !cur) return;
    var r = cur, act = a.getAttribute("data-p");
    if (act === "close") closePanel();
    if (act === "edit") { closePanel(); if (isVilla(r) && Vil()) Vil().openBooking(r); else if (D.openModal) D.openModal(r); }
    if (act === "pay" && window.VBRPayments) window.VBRPayments.open(r);
    if (act === "breakdown" && D.openBreakdown) D.openBreakdown(r);
    if (act === "log" && D.openLog) D.openLog(r.id, (r.guest_name || "This booking") + (r.order_code ? " (" + r.order_code + ")" : ""));
    if (act === "cal") {
      closePanel();
      var s = new Date(r.check_in + "T00:00:00Z"); s.setUTCDate(s.getUTCDate() - 2);
      $("calStart").value = s.toISOString().slice(0, 10);
      VV.go("calendar");
      $("calStart").dispatchEvent(new Event("change"));
    }
    if (act === "savenotes") {
      var v = $("cbpStaffNotes").value;
      a.disabled = true;
      D.sb.from("booking_requests").update({ staff_notes: v }).eq("id", r.id).then(function (u) {
        a.disabled = false;
        $("cbpNoteMsg").textContent = u.error ? "Couldn't save: " + u.error.message : "Saved";
        if (!u.error) { r.staff_notes = v; D.reload(); }
      });
    }
  });
  // after a reload, keep the open panel showing fresh data
  document.addEventListener("vbr:list", function () {
    if (!cur) return;
    var fresh = (D.rows() || []).filter(function (x) { return x.id === cur.id; })[0];
    if (fresh && fresh !== cur && tab !== "notes") { cur = fresh; drawPanel(); }
  });
  window.VBRPanel = { open: openPanel, openById: openPanelById, close: closePanel };

  // Calendar bars open the panel, like Cloudbeds (empty nights still start a booking).
  var calTable = $("calTable");
  calTable.addEventListener("click", function (e) {
    if (!on()) return;
    var bk = e.target.closest(".cal-bk");
    if (!bk) return;
    var id = bk.getAttribute("data-booking");
    var r = id ? (D.rows() || []).filter(function (x) { return x.id === id; })[0] : null;
    if (r) { e.stopPropagation(); e.preventDefault(); openPanel(r); }
  }, true);

  // ======================================================================
  // Calendar toolbar
  // ======================================================================
  var calModal = document.querySelector(".modal-cal");
  var cbar = document.createElement("div");
  cbar.id = "cbCalBar";
  cbar.innerHTML =
    '<button type="button" class="cb-round sm" data-c="prev" aria-label="Back a week">' + ico("chevL") + "</button>" +
    '<label class="cb-month">' + ico("cal") + '<span id="cbMonthLbl"></span>' + ico("chevD") + '<input type="month" id="cbMonth" aria-label="Month"></label>' +
    '<button type="button" class="cb-round sm" data-c="next" aria-label="Forward a week">' + ico("chevR") + "</button>" +
    '<label class="cb-span"><select id="cbSpan" aria-label="Days shown"><option value="14">2w</option><option value="21">3w</option><option value="31">1m</option><option value="62">2m</option></select>' + ico("chevD") + "</label>" +
    '<button type="button" class="cb-pill sm" data-c="today">Today</button>' +
    '<span class="cb-cal-occ" id="cbCalOcc"></span>' +
    '<button type="button" class="cb-btn" data-c="side">Blocks &amp; peak dates</button>' +
    '<button type="button" class="cb-plus-btn" data-c="new" title="New reservation" aria-label="New reservation">' + ico("plus") + "</button>" +
    '<button type="button" class="cb-round sm" data-c="close" aria-label="Close calendar">' + ico("x") + "</button>";
  if (calModal) calModal.insertBefore(cbar, calModal.firstChild);
  function syncCalBar() {
    var s = $("calStart").value || today();
    var d = new Date(s + "T00:00:00Z");
    $("cbMonthLbl").textContent = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
    $("cbMonth").value = s.slice(0, 7);
    $("cbSpan").value = $("calDays").value;
    $("cbCalOcc").textContent = $("calStatus").textContent;
  }
  cbar.addEventListener("click", function (e) {
    var b = e.target.closest("[data-c]");
    if (!b) return;
    var c = b.getAttribute("data-c");
    if (c === "prev") $("calPrev").click();
    if (c === "next") $("calNext").click();
    if (c === "today") $("calToday").click();
    if (c === "close") $("calClose").click();
    if (c === "new") $("addVillaBtn").click();
    if (c === "side") { body.classList.toggle("cb-cal-side"); b.classList.toggle("is-on", body.classList.contains("cb-cal-side")); }
    setTimeout(syncCalBar, 50);
  });
  $("cbMonth").addEventListener("change", function () {
    if (!this.value) return;
    $("calStart").value = this.value + "-01";
    $("calStart").dispatchEvent(new Event("change"));
    syncCalBar();
  });
  $("cbSpan").addEventListener("change", function () { $("calDays").value = this.value; $("calDays").dispatchEvent(new Event("change")); syncCalBar(); });
  new MutationObserver(syncCalBar).observe($("calStatus"), { childList: true, characterData: true, subtree: true });
  ["calStart", "calDays"].forEach(function (id) { $(id).addEventListener("change", syncCalBar); });

  // ======================================================================
  // view hooks
  // ======================================================================
  document.addEventListener("vbr:view", function () {
    if (!on()) { closePanel(); body.classList.remove("cb-filters-open", "cb-cal-side"); }
    drawList();
  });
  drawList();
})();
