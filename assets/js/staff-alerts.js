// =============================================================================
// Staff dashboard: "Action needed" — critical alerts with the next step, built
// from the bookings already loaded (no extra queries). Each line opens the
// booking. Shown above the section tabs; collapsible; refreshes on every render.
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D) return;
  var esc = D.esc, peso = D.peso, fmtDate = D.fmtDate;
  var V = function () { return window.VBRVillas; };
  var tabs = document.getElementById("sectionTabs");
  if (!tabs) return;

  var box = document.createElement("section");
  box.className = "alerts-box";
  box.id = "alertsBox";
  box.hidden = true;
  tabs.parentNode.insertBefore(box, tabs);
  var open = true;
  try { open = localStorage.getItem("vbr.alertsOpen") !== "0"; } catch (e) {}

  function manilaNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })); }
  function todayStr() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function madeDate(r) { return new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function daysAhead(r) { return Math.round((new Date(r.check_in + "T00:00:00Z") - new Date(madeDate(r) + "T00:00:00Z")) / 86400000); }
  var ACTIVE = { pending: 1, pending_payment: 1, confirmed: 1 };

  function owe(r) { return (Number(r.total_amount) || 0) - (Number(r.amount_paid) || 0); }
  function proofWaiting(r) {
    return r.status === "pending_payment" || (r.booking_payments || []).some(function (p) { return p.status === "pending"; });
  }

  function build() {
    var rows = (D.rows && D.rows()) || [];
    var today = todayStr(), now = manilaNow(), hour = now.getHours() + now.getMinutes() / 60;
    var groups = [
      { key: "proof", level: "high", title: "Payment proofs to check", step: "Open → check the screenshot against GCash / the bank → Verify (or Reject).", items: [] },
      { key: "today", level: "high", title: "Day trips today not fully paid", step: "Collect at the gate and click Record payment in the booking. Online bookings still unpaid at 5:00 PM are cancelled automatically; staff-entered bookings are not.", items: [] },
      { key: "cb", level: "high", title: "Website villas not in Cloudbeds", step: "Add the booking in Cloudbeds by hand (or ask Claude to resend it).", items: [] },
      { key: "villa14", level: "med", title: "Villas booked within 14 days — not paid in full", step: "Full payment is required. The guest was reminded at 24 h; call or message, then record the payment or use “Cancel booking — not paid”.", items: [] },
      { key: "balance", level: "med", title: "Villa balances overdue", step: "Balance was due 15 days before arrival. Follow up, record the payment, or cancel under the policy.", items: [] },
      { key: "tomorrow", level: "low", title: "Day trips tomorrow not fully paid", step: "They get an “expecting you” email at 8 AM tomorrow. A quick message today helps.", items: [] },
      { key: "nocab", level: "low", title: "Upcoming day trips without a cabana", step: "Add a Dining / Lounge cabana, or tick “Entrance only” with a reason.", items: [] },
    ];
    var G = {}; groups.forEach(function (g) { G[g.key] = g; });
    rows.forEach(function (r) {
      if (!ACTIVE[r.status] || r.cb_owned || !r.check_in || r.check_in < today) return;
      var villa = r.stay_type === "overnight";
      if (proofWaiting(r)) G.proof.items.push(r);
      if (villa) {
        if (r.cb_push_state === "error" && !r.cb_reservation_id) G.cb.items.push(r);
        var due = addDays(r.check_in, -15);
        if (owe(r) > 0.5 && !proofWaiting(r)) {
          if (daysAhead(r) <= 14 && Date.now() - new Date(r.created_at).getTime() > 24 * 3600e3) G.villa14.items.push(r);
          else if (Number(r.amount_paid) > 0 && today > due) G.balance.items.push(r);
        }
      } else {
        if (owe(r) > 0.5 && !proofWaiting(r) && r.source !== "sheet_import") {
          if (r.check_in === today) G.today.items.push(r);
          else if (r.check_in === addDays(today, 1)) G.tomorrow.items.push(r);
        }
        var cabs = (Number(r.dining_cabanas) || 0) + (Number(r.lounge_cabanas) || 0);
        if (!cabs && r.source !== "sheet_import" && /^(day_trip|half_day)$/.test(r.stay_type || "") && r.check_in <= addDays(today, 7) && !/\[No cabana/.test(r.staff_notes || "")) G.nocab.items.push(r);
      }
    });
    return groups.filter(function (g) { return g.items.length; });
  }

  function line(r) {
    var o = owe(r), paid = Number(r.amount_paid) || 0;
    var money = o > 0.5 ? (paid > 0 ? "balance " + peso(o) : "unpaid " + peso(r.total_amount)) : "";
    return '<button type="button" class="al-item" data-id="' + esc(r.id) + '"><b>' + esc(r.guest_name || "Guest") + "</b>" +
      '<span class="al-meta">' + esc(r.order_code || "") + " · " + esc(fmtDate(r.check_in)) + (money ? " · " + esc(money) : "") + "</span></button>";
  }

  function render() {
    var groups = build();
    var n = groups.reduce(function (a, g) { return a + g.items.length; }, 0);
    box.hidden = !n;
    if (!n) return;
    var high = groups.some(function (g) { return g.level === "high"; });
    box.className = "alerts-box" + (high ? " is-high" : "");
    box.innerHTML = '<button type="button" class="al-toggle" aria-expanded="' + open + '"><span class="al-dot"></span><b>Action needed</b> · ' + n + " item" + (n === 1 ? "" : "s") +
      '<span class="al-sum">' + groups.map(function (g) { return esc(g.title) + " (" + g.items.length + ")"; }).join(" · ") + "</span>" +
      '<span class="al-chev">' + (open ? "Hide" : "Show") + "</span></button>" +
      (open ? '<div class="al-groups">' + groups.map(function (g) {
        var shown = g.items.slice(0, 8);
        return '<div class="al-group lv-' + g.level + '"><div class="al-title">' + esc(g.title) + ' <span class="al-n">' + g.items.length + "</span></div>" +
          '<div class="al-step">' + esc(g.step) + "</div>" +
          '<div class="al-items">' + shown.map(line).join("") + (g.items.length > shown.length ? '<span class="al-more">+' + (g.items.length - shown.length) + " more — use the search</span>" : "") + "</div></div>";
      }).join("") + "</div>" : "");
  }

  box.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest(".al-toggle")) {
      open = !open;
      try { localStorage.setItem("vbr.alertsOpen", open ? "1" : "0"); } catch (x) {}
      render();
      return;
    }
    var it = t.closest(".al-item");
    if (!it) return;
    var id = it.getAttribute("data-id");
    var r = ((D.rows && D.rows()) || []).filter(function (x) { return String(x.id) === id; })[0];
    if (!r) return;
    if (window.VBRStaffTrack) window.VBRStaffTrack("open_booking", { from: "alerts" }, r.order_code);
    if (r.stay_type === "overnight" && V()) V().openBooking(r); else D.openModal(r);
  });

  document.addEventListener("vbr:render", render);
  setInterval(render, 5 * 60e3); // the 5 PM / tomorrow lines move with the clock
})();
