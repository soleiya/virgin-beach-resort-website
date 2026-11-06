// =============================================================================
// Staff dashboard: "Summary" view — a simple, read-only list of who's coming
// and what they booked, by day / week / month. Names and booking details only
// (no amounts). Uses the bookings the dashboard has already loaded; tap a
// booking to open it. Switched on from the view toggle (staff-cloudbeds.js).
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D) return;
  var esc = D.esc, V = function () { return window.VBRVillas; };
  var dashScreen = document.getElementById("dashScreen");
  var KEY = "vbr.sumMode";
  var mode = "day", anchor = todayStr(), shown = false;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function todayStr() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function d(s) { return new Date(s + "T00:00:00Z"); }
  function iso(x) { return x.toISOString().slice(0, 10); }
  function addDays(s, n) { var x = d(s); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
  function fmt(s, o) { o.timeZone = "UTC"; return d(s).toLocaleDateString("en-PH", o); }
  function plural(n, a, b) { return n + " " + (n === 1 ? a : (b || a + "s")); }
  var m = store(KEY); if (m === "week" || m === "month") mode = m;

  var el = document.createElement("section");
  el.id = "sumView";
  el.innerHTML =
    '<div class="sum-ctl"><div class="sum-seg"><button type="button" data-m="day">Day</button><button type="button" data-m="week">Week</button><button type="button" data-m="month">Month</button></div>' +
    '<h2 class="sum-range" id="sumRange"></h2>' +
    '<div class="sum-nav"><button type="button" data-step="-1" aria-label="Previous">&lsaquo;</button><button type="button" data-step="0">Today</button><button type="button" data-step="1" aria-label="Next">&rsaquo;</button></div></div>' +
    '<div class="sum-tiles" id="sumTiles"></div><div id="sumList"></div>' +
    '<p class="sum-foot">Cancelled and expired bookings aren\'t shown. Tap a booking to open it.</p>';
  dashScreen.insertBefore(el, dashScreen.firstChild);

  el.addEventListener("click", function (e) {
    var b = e.target.closest("[data-m]");
    if (b) { mode = b.getAttribute("data-m"); store(KEY, mode); render(); return; }
    var s = e.target.closest("[data-step]");
    if (s) { step(+s.getAttribute("data-step")); return; }
    var c = e.target.closest(".sum-card[data-id]");
    if (c) {
      var r = (D.rows() || []).filter(function (x) { return x.id === c.getAttribute("data-id"); })[0];
      if (!r) return;
      if (r.stay_type === "overnight" && V()) V().openBooking(r); else D.openModal(r);
    }
  });
  document.addEventListener("keydown", function (e) {
    if (!shown || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector(".modal-backdrop.open")) return;
    if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
  });
  function step(k) {
    if (k === 0) anchor = todayStr();
    else if (mode === "day") anchor = addDays(anchor, k);
    else if (mode === "week") anchor = addDays(anchor, 7 * k);
    else { var x = d(anchor); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + k); anchor = iso(x); }
    render();
  }
  function range() {
    if (mode === "day") return { from: anchor, to: anchor };
    if (mode === "week") { var wd = (d(anchor).getUTCDay() + 6) % 7, f = addDays(anchor, -wd); return { from: f, to: addDays(f, 6) }; }
    var x = d(anchor); x.setUTCDate(1); var f2 = iso(x); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0);
    return { from: f2, to: iso(x) };
  }
  function rangeLabel(r) {
    if (mode === "day") return fmt(r.from, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (mode === "week") return fmt(r.from, { month: "short", day: "numeric" }) + " – " + fmt(r.to, { month: "short", day: "numeric", year: "numeric" });
    return fmt(r.from, { month: "long", year: "numeric" });
  }

  // ---------------------------------------------------------------- booking bits
  var TYPE = { overnight: "Overnight", day_trip: "Day Trip", half_day: "Half-Day Trip", corporate: "Corporate" };
  function live(r) { return r.status !== "declined" && r.status !== "expired"; }
  function party(r) { return (r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0); }
  function nights(r) { return r.check_out ? Math.round((d(r.check_out) - d(r.check_in)) / 864e5) : 1; }
  function partyText(r) {
    var t = [plural(r.adults || 0, "adult")];
    if (r.children_6_12) t.push(plural(r.children_6_12, "kid") + " 6–12");
    if (r.children_0_5) t.push(plural(r.children_0_5, "kid") + " 0–5");
    var sp = [];
    if (r.senior_count) sp.push(r.senior_count + " senior/PWD");
    if (r.pwd_kid_count) sp.push(r.pwd_kid_count + " PWD kid" + (r.pwd_kid_count === 1 ? "" : "s"));
    return t.join(", ") + (sp.length ? " (incl. " + sp.join(", ") + ")" : "");
  }
  function companions(r) {
    var list = Array.isArray(r.companions) ? r.companions.map(function (c) { return (c.name || "").trim(); }).filter(Boolean) : [];
    if (!list.length && r.guest_names) list = String(r.guest_names).split(/\s*,\s*/).filter(function (n) { return n && n !== r.guest_name; });
    return list;
  }
  function statusText(r) {
    if (r.stay_type === "overnight" && r.cb_info && r.cb_info.status === "checked_in") return ["In-house", "in"];
    var t = D.statusLabel ? D.statusLabel(r) : r.status;
    var k = r.status === "confirmed" || r.status === "completed" ? "ok" : "wait";
    return [t, k];
  }
  function chips(r) {
    var c = [];
    if (r.stay_type === "overnight") {
      var labels = V() && V().labelsFor ? V().labelsFor(r) : [];
      if (labels.length) labels.forEach(function (l) { c.push('<span class="k">' + esc(l) + "</span>"); });
      else c.push('<span class="k">Casita to assign</span>');
      c.push("<span>" + plural(nights(r), "night") + " · " + fmt(r.check_in, { month: "short", day: "numeric" }) + " → " + fmt(r.check_out || r.check_in, { month: "short", day: "numeric" }) + "</span>");
      c.push("<span>Full-board meals</span>");
      if (r.extra_beds) c.push("<span>" + plural(r.extra_beds, "extra bed") + "</span>");
      (Array.isArray(r.add_ons) ? r.add_ons : []).forEach(function (a) { var nm = String(a.name || a.slug || "").replace(/[-_]/g, " "); c.push("<span>" + esc(nm.charAt(0).toUpperCase() + nm.slice(1)) + (a.qty > 1 ? " ×" + a.qty : "") + "</span>"); });
    } else {
      var n = D.countsOf ? D.countsOf(r) : { dining: r.dining_cabanas || 0, lounge: r.lounge_cabanas || 0 };
      if (n.dining) c.push('<span class="k">' + plural(n.dining, "Dining Cabana") + "</span>");
      if (n.lounge) c.push('<span class="k">' + plural(n.lounge, "Lounge Cabana") + "</span>");
      if (!n.dining && !n.lounge && r.stay_type !== "corporate") c.push('<span class="warn">No cabana</span>');
      var nos = (r.booking_cabanas || []).map(function (bc) { return D.cabanaLabel ? D.cabanaLabel(bc.cabana_id) : ""; }).filter(Boolean);
      if (nos.length) c.push("<span>Cabana no. " + esc(nos.map(function (l) { return String(l).replace(/^Section /, ""); }).join(", ")) + "</span>");
      c.push("<span>" + (r.stay_type === "half_day" ? "Afternoon snacks" : r.stay_type === "corporate" ? "Corporate" : "Lunch") + "</span>");
    }
    if (r.pet_count) c.push("<span>" + plural(r.pet_count, "pet") + "</span>");
    if (r.occasion) c.push("<span>" + esc(r.occasion) + "</span>");
    return '<div class="sum-chips">' + c.join("") + "</div>";
  }
  function card(r, tag) {
    var st = statusText(r), comp = companions(r);
    return '<div class="sum-card" data-id="' + esc(r.id) + '" role="button" tabindex="0">' +
      '<div class="sum-l1"><b>' + esc(r.guest_name || "—") + '</b><span class="sum-code">' + esc(r.order_code || "") + "</span>" +
      '<span class="sum-pill ' + st[1] + '">' + esc(st[0]) + "</span>" + (tag ? '<span class="sum-pill">' + esc(tag) + "</span>" : "") + "</div>" +
      '<div class="sum-l2">' + esc(TYPE[r.stay_type] || r.stay_type_label || "") + " · " + esc(partyText(r)) + "</div>" +
      (comp.length ? '<div class="sum-l3">With ' + esc(comp.join(", ")) + "</div>" : "") +
      chips(r) + "</div>";
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!shown) return;
    var r = range();
    document.getElementById("sumRange").textContent = rangeLabel(r);
    Array.prototype.forEach.call(el.querySelectorAll("[data-m]"), function (b) { b.classList.toggle("on", b.getAttribute("data-m") === mode); });
    var rows = (D.rows() || []).filter(live);
    var days = [];
    for (var s = r.from; s <= r.to; s = addDays(s, 1)) days.push(s);

    var dayGuests = 0, cabs = 0, arrGuests = 0, inhouseNights = 0, bookings = 0;
    var html = "";
    days.forEach(function (s) {
      var arr = [], stay = [], dt = [];
      rows.forEach(function (x) {
        if (!x.check_in) return;
        if (x.stay_type === "overnight") {
          var out = x.check_out || addDays(x.check_in, 1);
          if (x.check_in === s) arr.push(x);
          else if (x.check_in < s && out > s) stay.push(x);
        } else if (x.check_in === s) dt.push(x);
      });
      var byName = function (a, b) { return String(a.guest_name || "").localeCompare(String(b.guest_name || "")); };
      arr.sort(byName); stay.sort(byName); dt.sort(byName);
      var dg = dt.reduce(function (t, x) { return t + party(x); }, 0);
      var og = arr.concat(stay).reduce(function (t, x) { return t + party(x); }, 0);
      dayGuests += dg; arrGuests += arr.reduce(function (t, x) { return t + party(x); }, 0);
      cabs += dt.reduce(function (t, x) { var n = D.countsOf ? D.countsOf(x) : { dining: x.dining_cabanas || 0, lounge: x.lounge_cabanas || 0 }; return t + (n.dining || 0) + (n.lounge || 0); }, 0);
      inhouseNights += arr.length + stay.length; bookings += arr.length + dt.length;
      if (mode !== "day" && !arr.length && !stay.length && !dt.length) return;
      var h = '<div class="sum-day"><div class="sum-dh"><h3>' + esc(fmt(s, { weekday: "short", month: "short", day: "numeric" })) + "</h3>" +
        '<span>' + [dg ? plural(dg, "day-trip guest") : "", og ? plural(og, "overnight guest") : ""].filter(Boolean).join(" · ") + "</span></div>";
      if (arr.length) h += '<div class="sum-grp">Arriving · overnight</div>' + arr.map(function (x) { return card(x); }).join("");
      if (stay.length && mode === "day") h += '<div class="sum-grp">Staying over</div>' + stay.map(function (x) { return card(x, "night " + (Math.round((d(s) - d(x.check_in)) / 864e5) + 1) + " of " + nights(x)); }).join("");
      else if (stay.length) h += '<div class="sum-grp">Staying over: ' + esc(stay.map(function (x) { return x.guest_name; }).join(", ")) + "</div>";
      if (dt.length) h += '<div class="sum-grp">Day trips</div>' + dt.map(function (x) { return card(x); }).join("");
      if (!arr.length && !stay.length && !dt.length) h += '<div class="sum-empty">No bookings on this day.</div>';
      html += h + "</div>";
    });
    document.getElementById("sumTiles").innerHTML = [
      ["Day-trip guests", dayGuests, plural(cabs, "cabana")],
      ["Overnight arrivals", arrGuests, "guests"],
      ["Overnight stays", inhouseNights, mode === "day" ? "in-house tonight" : "stay-nights"],
      ["Bookings", bookings, "arriving"],
    ].map(function (k) { return '<div class="sum-tile"><span>' + k[0] + "</span><b>" + k[1] + "</b><em>" + k[2] + "</em></div>"; }).join("");
    var list = document.getElementById("sumList");
    list.className = mode === "month" ? "compact" : "";
    list.innerHTML = html || '<div class="sum-empty">No bookings this ' + mode + ".</div>";
  }

  // re-draw when the dashboard reloads its bookings
  var cl = document.getElementById("countLine");
  if (cl && window.MutationObserver) new MutationObserver(function () { render(); }).observe(cl, { childList: true, characterData: true, subtree: true });

  window.VBRSummary = {
    show: function (on) { shown = !!on; document.body.classList.toggle("sumv", shown); if (shown) render(); },
    render: render,
  };
})();
