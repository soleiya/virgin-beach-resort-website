// =============================================================================
// Staff dashboard: records what staff do (beyond the booking change log) into
// site_events as staff_* events, tagged with the signed-in staff email:
// opening bookings, views/sections, searches used, exports, tools opened,
// payments / breakdown / calendar, filters, quick-find, summary.
// Nothing here ever blocks the dashboard.
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var last = {};
  function track(kind, data, code) {
    // the same action within 3 seconds counts once
    var key = kind + "|" + (code || "") + "|" + JSON.stringify(data || {});
    if (last[key] && Date.now() - last[key] < 3000) return;
    last[key] = Date.now();
    try {
      sb.rpc("track_event", { p: { kind: "staff_" + kind, sid: sid, path: "/staff/", order_code: code || null, data: data || null,
        device: window.innerWidth < 760 ? "mobile" : "desktop" } }).then(function () {}, function () {});
    } catch (e) {}
  }
  window.VBRStaffTrack = track;

  var started = false;
  document.addEventListener("vbr:render", function () { if (!started) { started = true; track("session", { view: (localStorage.getItem("vbr.view") || "new") }); } });

  var TOOLS = { exportBtn: "export_csv", logBtn: "open_activity_log", teamBtn: "open_team_activity", webBtn: "open_website_bookings",
    codesBtn: "open_discount_codes", windowBtn: "open_booking_window", plannerBtn: "open_cabana_map", villaCalBtn: "open_villa_calendar",
    addBtn: "new_daytrip_form", addVillaBtn: "new_villa_form", dcalImport: "open_sheet_import", dcalPrint: "print_calendar", insightsBtn: "open_insights" };
  function rowCode(el) { var tr = el.closest("tr"); var oc = tr && tr.querySelector(".order-code"); return oc ? oc.textContent.trim() : null; }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var b = t.closest("button, a, [role=button], .sum-card, .find-hit, td.col-total, td.col-notes2, .cal-bk");
    if (!b) return;
    if (b.id && TOOLS[b.id]) return track(TOOLS[b.id]);
    if (b.matches(".view-toggle button[data-view]")) return track("view", { view: b.getAttribute("data-view") });
    if (b.matches("#sectionTabs .sec-tab")) return track("section", { section: b.getAttribute("data-section") });
    if (b.matches("#dtViewSwitch button")) return track("list_view", { view: b.getAttribute("data-view") });
    if (b.matches("#filterPills .pill")) return track("filter", { pill: b.getAttribute("data-filter") });
    if (b.matches("#sumView [data-m]")) return track("summary_mode", { mode: b.getAttribute("data-m") });
    if (b.matches("#sumView [data-k]")) return track("summary_kind", { kind: b.getAttribute("data-k") });
    if (b.matches(".sum-card")) return track("open_booking", { from: "summary" }, (b.querySelector(".sum-code") || {}).textContent);
    if (b.matches(".find-hit")) return track("open_booking", { from: "find" }, ((b.querySelector(".fh-main small") || {}).textContent || "").trim());
    if (b.matches(".log-btn") && /Edit/.test(b.title || "")) return track("open_booking", { from: "list" }, rowCode(b));
    if (b.matches(".log-btn") && /activity/i.test(b.title || "")) return track("open_booking_log", null, rowCode(b));
    if (b.matches(".pay-open")) return track("open_payments", null, rowCode(b));
    if (b.matches("td.col-total")) return track("open_breakdown", null, rowCode(b));
    if (b.matches("td.col-notes2")) return track("open_notes", null, rowCode(b));
    if (b.matches("#nmSave")) return track("save_notes");
    if (b.matches("a.cb-link")) return track("open_in_cloudbeds", null, b.getAttribute("data-cb"));
    if (b.matches(".cal-bk")) return track("open_booking", { from: "calendar" });
    if (b.matches("#vSave, #saveBookingBtn, #cdSave")) return track("save_click", { form: (b.closest("form") || {}).id || null });
  }, true);

  // searches (length only — not what was typed)
  var timers = {};
  document.addEventListener("input", function (e) {
    var id = e.target && e.target.id;
    if (!/^(findInput|searchBox|dcalSearch|cbSearch)$/.test(id || "")) return;
    clearTimeout(timers[id]);
    timers[id] = setTimeout(function () {
      var v = String(e.target.value || "").trim();
      if (v.length >= 2) track("search", { box: id, chars: v.length, kind: /^vbr-|^\d{6,}$/i.test(v) ? "booking id" : /\d{7,}/.test(v.replace(/\D/g, "")) ? "phone" : /@/.test(v) ? "email" : "name/text" });
    }, 1500);
  }, true);
  document.addEventListener("change", function (e) {
    var id = e.target && e.target.id;
    if (/^filter(Status|Source|Origin|BookedBy|Type|DateField|DateFrom|DateTo|LoadFrom)$/.test(id || "")) track("filter", { field: id, value: String(e.target.value || "").slice(0, 40) });
  }, true);
})();
