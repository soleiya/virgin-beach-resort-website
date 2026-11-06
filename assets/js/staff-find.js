// =============================================================================
// Staff dashboard: one big "Find a booking" search across Day Trips AND Villas.
// Type a name (guest or anyone in the party), booking ID, phone, email or
// Cloudbeds # — matches appear instantly; Enter / click opens the booking.
// Press "/" anywhere to jump to it. Uses the bookings already loaded.
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D) return;
  var esc = D.esc, V = function () { return window.VBRVillas; };
  var tabs = document.getElementById("sectionTabs");
  if (!tabs) return;

  var wrap = document.createElement("div");
  wrap.id = "findBar";
  wrap.innerHTML =
    '<label class="find-box"><span class="find-ico" aria-hidden="true">&#9906;</span>' +
    '<input id="findInput" type="search" autocomplete="off" spellcheck="false" placeholder="Find a booking — guest name, booking ID, phone, email or Cloudbeds #" aria-label="Find a booking">' +
    '<kbd>/</kbd></label><div class="find-results" id="findResults" hidden></div>';
  tabs.parentNode.insertBefore(wrap, tabs.nextSibling);
  var input = document.getElementById("findInput"), box = document.getElementById("findResults");
  var hits = [], sel = 0;

  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function hay(r) {
    if (r._findHay) return r._findHay;
    var comp = Array.isArray(r.companions) ? r.companions.map(function (c) { return c.name; }).join(" ") : "";
    r._findHay = norm([r.guest_name, r.guest_names, comp, r.order_code, r.guest_email, r.booked_by,
      r.cb_reservation_id, r.cb_info && r.cb_info.ota_ref].join(" "));
    r._findDigits = digits(r.guest_phone);
    return r._findHay;
  }
  function fmt(s) { return s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—"; }
  function search(q) {
    var words = norm(q).split(/\s+/).filter(Boolean), qd = digits(q);
    if (!words.length) return [];
    var today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    var out = (D.rows() || []).filter(function (r) {
      var h = hay(r);
      if (words.every(function (w) { return h.indexOf(w) !== -1; })) return true;
      return qd.length >= 5 && r._findDigits && r._findDigits.indexOf(qd.replace(/^63/, "").replace(/^0/, "")) !== -1;
    });
    // upcoming first (soonest), then past (most recent), cancelled last
    out.sort(function (a, b) {
      var ca = a.status === "declined" || a.status === "expired", cbb = b.status === "declined" || b.status === "expired";
      if (ca !== cbb) return ca ? 1 : -1;
      var fa = (a.check_in || "") >= today, fb = (b.check_in || "") >= today;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? String(a.check_in).localeCompare(String(b.check_in)) : String(b.check_in).localeCompare(String(a.check_in));
    });
    return out;
  }
  function render() {
    var q = input.value.trim();
    hits = q ? search(q) : [];
    sel = 0;
    if (!q) { box.hidden = true; return; }
    if (!hits.length) { box.innerHTML = '<div class="find-none">No booking matches “' + esc(q) + '”.</div>'; box.hidden = false; return; }
    var shown = hits.slice(0, 12);
    box.innerHTML = shown.map(function (r, i) {
      var villa = r.stay_type === "overnight";
      var where = villa ? ((V() && V().labelsFor ? V().labelsFor(r) : []).join(", ") || "Casita to assign")
        : ((D.TYPE_LABELS && D.TYPE_LABELS[r.stay_type]) || r.stay_type_label || "Day Trip");
      var when = fmt(r.check_in) + (villa && r.check_out ? " → " + fmt(r.check_out) : "");
      var party = (r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0);
      var off = r.status === "declined" || r.status === "expired";
      return '<button type="button" class="find-hit' + (i === 0 ? " on" : "") + (off ? " off" : "") + '" data-i="' + i + '">' +
        '<span class="fh-kind ' + (villa ? "v" : "d") + '">' + (villa ? "Villa" : "Day Trip") + "</span>" +
        '<span class="fh-main"><b>' + esc(r.guest_name || "—") + '</b> <small>' + esc(r.order_code || "") + "</small>" +
        '<span class="fh-sub">' + esc(when) + " · " + esc(where) + " · " + party + " guest" + (party === 1 ? "" : "s") + "</span></span>" +
        '<span class="fh-st">' + esc(D.statusLabel ? D.statusLabel(r) : r.status) + "</span></button>";
    }).join("") + (hits.length > 12 ? '<div class="find-more">' + (hits.length - 12) + " more — keep typing to narrow it down</div>" : "");
    box.hidden = false;
  }
  function open(i) {
    var r = hits[i];
    if (!r) return;
    box.hidden = true;
    if (r.stay_type === "overnight" && V()) V().openBooking(r); else D.openModal(r);
  }
  function mark() { Array.prototype.forEach.call(box.querySelectorAll(".find-hit"), function (b, i) { b.classList.toggle("on", i === sel); if (i === sel) b.scrollIntoView({ block: "nearest" }); }); }

  input.addEventListener("input", render);
  input.addEventListener("focus", function () { if (input.value.trim()) render(); });
  input.addEventListener("keydown", function (e) {
    var n = Math.min(hits.length, 12);
    if (e.key === "ArrowDown" && n) { e.preventDefault(); sel = (sel + 1) % n; mark(); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); sel = (sel - 1 + n) % n; mark(); }
    else if (e.key === "Enter") { e.preventDefault(); open(sel); }
    else if (e.key === "Escape") { input.value = ""; box.hidden = true; input.blur(); }
  });
  box.addEventListener("click", function (e) { var b = e.target.closest(".find-hit"); if (b) open(+b.getAttribute("data-i")); });
  document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) box.hidden = true; });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    e.preventDefault(); input.focus(); input.select();
  });
  // ---- Villas get the same Calendar / List switch as Day Trips ----------
  var bar = document.getElementById("dtViewBar"), sw = document.getElementById("dtViewSwitch");
  if (bar && sw) {
    bar.removeAttribute("data-section");
    var hint = bar.querySelector(".hint");
    var HINT_D = hint ? hint.innerHTML : "";
    var HINT_V = "Calendar: every casita, night by night (opens on top) &middot; List: search and filter every villa booking";
    var villasNow = function () { return (D.section ? D.section() : "daytrip") === "villas"; };
    var sync = function () {
      bar.style.display = "";
      if (!villasNow()) { if (hint) hint.innerHTML = HINT_D; return; }
      if (hint) hint.innerHTML = HINT_V;
      Array.prototype.forEach.call(sw.querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-view") === "list"); });
    };
    // capture phase: on Villas, "Calendar" opens the villa calendar and leaves the Day Trip view alone
    sw.addEventListener("click", function (e) {
      if (!villasNow()) return;
      var b = e.target.closest("button[data-view]");
      e.stopPropagation();
      if (b && b.getAttribute("data-view") === "cal") { var vc = document.getElementById("villaCalBtn"); if (vc) vc.click(); }
      sync();
    }, true);
    document.addEventListener("vbr:render", function () { setTimeout(sync, 0); });
    document.getElementById("sectionTabs").addEventListener("click", function () { setTimeout(sync, 0); });
    sync();
  }

  // bookings reloaded → forget cached search text
  document.addEventListener("vbr:render", function () { (D.rows() || []).forEach(function (r) { r._findHay = null; }); if (!box.hidden) render(); });
})();
