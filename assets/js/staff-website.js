/* ==========================================================================
   Staff dashboard — Website Bookings
   --------------------------------------------------------------------------
   The latest bookings made on the new website (booking_origin site_guest /
   site_staff, booking-v18), newest first, with how they're going: who made
   them, status, payment, and for villas whether they reached Cloudbeds.
   Opened from the toolbar ("Website Bookings") or the Cloudbeds view menu.
   ========================================================================== */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc, peso = D.peso;
  var $ = function (id) { return document.getElementById(id); };
  var backdrop = $("webModalBackdrop");
  if (!backdrop || !$("webBtn")) return;

  var who = "", kind = "", rows = [];

  function close() { backdrop.classList.remove("open"); }
  $("webClose").addEventListener("click", close);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  $("webBtn").addEventListener("click", function () { backdrop.classList.add("open"); load(); });
  $("webRefresh").addEventListener("click", load);
  $("webDays").addEventListener("change", load);
  function chips(id, attr, set) {
    $(id).addEventListener("click", function (e) {
      var b = e.target.closest("[" + attr + "]");
      if (!b) return;
      Array.prototype.forEach.call($(id).querySelectorAll(".pill"), function (x) { x.classList.toggle("active", x === b); });
      set(b.getAttribute(attr));
      draw();
    });
  }
  chips("webWho", "data-who", function (v) { who = v; });
  chips("webKind", "data-kind", function (v) { kind = v; });

  var COLS = "id,order_code,guest_name,guest_email,booked_by,booking_origin,source,stay_type,stay_type_label,check_in,check_out," +
    "adults,children_6_12,children_0_5,total_amount,amount_paid,amount_pending,status,created_at,cb_reservation_id,cb_owned," +
    "cb_push_state,cb_push_error,cb_folio_state,cb_folio_note,cb_info";

  function load() {
    var days = Number($("webDays").value) || 30;
    var since = new Date(Date.now() - days * 86400000).toISOString();
    $("webBody").innerHTML = '<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading&hellip;</td></tr>';
    sb.from("booking_requests").select(COLS)
      .in("booking_origin", ["site_guest", "site_staff"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(function (res) {
        if (res.error) {
          $("webBody").innerHTML = '<tr><td colspan="8" class="cb-warn" style="padding:16px;">' +
            (/booking_origin/.test(res.error.message) ? "Needs the database update booking-v18-cloudbeds-first.sql." : "Couldn't load: " + esc(res.error.message)) + "</td></tr>";
          return;
        }
        rows = res.data || [];
        draw();
      });
  }

  function isVilla(r) { return r.stay_type === "overnight"; }
  function live(r) { return r.status !== "declined" && r.status !== "expired"; }
  function shown() {
    return rows.filter(function (r) {
      if (who && r.booking_origin !== who) return false;
      if (kind === "villa" && !isVilla(r)) return false;
      if (kind === "daytrip" && isVilla(r)) return false;
      return true;
    });
  }

  function stats(list) {
    var today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    var n = { all: list.length, guest: 0, staff: 0, villa: 0, day: 0, today: 0, value: 0, paid: 0, cancelled: 0 };
    list.forEach(function (r) {
      if (r.booking_origin === "site_guest") n.guest++; else n.staff++;
      if (isVilla(r)) n.villa++; else n.day++;
      if (new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) === today) n.today++;
      if (live(r)) { n.value += Number(r.total_amount) || 0; n.paid += Number(r.amount_paid) || 0; } else n.cancelled++;
    });
    function box(label, big, sub) { return '<div class="web-stat"><small>' + esc(label) + "</small><b>" + esc(big) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</div>"; }
    $("webStats").innerHTML =
      box("Bookings", n.all.toLocaleString(), n.today + " today") +
      box("By guests", n.guest.toLocaleString(), n.all ? Math.round(n.guest / n.all * 100) + "% of bookings" : "") +
      box("By staff", n.staff.toLocaleString(), n.all ? Math.round(n.staff / n.all * 100) + "% of bookings" : "") +
      box("Villas · Day trips", n.villa + " · " + n.day, "") +
      box("Booked value", peso(n.value), "excl. " + n.cancelled + " cancelled") +
      box("Paid so far", peso(n.paid), n.value ? Math.round(n.paid / n.value * 100) + "% of booked value" : "");
  }

  function madeBy(r) {
    return r.booking_origin === "site_guest"
      ? "Guest <span class=\"web-sub\">website booking page</span>"
      : "Staff <span class=\"web-sub\">" + esc(r.booked_by || "dashboard") + "</span>";
  }
  function stay(r) {
    var t = isVilla(r) ? "Villa" : (D.TYPE_LABELS && D.TYPE_LABELS[r.stay_type]) || r.stay_type_label || "Day trip";
    var d = isVilla(r) ? D.fmtDate(r.check_in) + " → " + D.fmtDate(r.check_out) : D.fmtDate(r.check_in);
    var pax = (r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0);
    return esc(t) + '<span class="web-sub">' + esc(d) + " · " + pax + " pax</span>";
  }
  function pay(r) {
    var total = Number(r.total_amount) || 0, paid = Number(r.amount_paid) || 0, pend = Number(r.amount_pending) || 0;
    var s = paid >= total - 0.5 && total > 0 ? "Paid in full" : paid > 0 ? "Paid " + peso(paid) : "Not paid";
    return esc(s) + (pend > 0 ? '<span class="web-sub cb-warn">' + esc(peso(pend)) + " to verify</span>" : "");
  }
  var CB_NAMES = { not_confirmed: "Confirmation Pending", confirmed: "Confirmed", checked_in: "In-House", checked_out: "Checked Out", canceled: "Canceled", no_show: "No-Show" };
  function cloudbeds(r) {
    if (!isVilla(r)) return '<span class="muted">— day trip</span>';
    if (r.cb_reservation_id) {
      var note = r.cb_folio_state === "partial" ? '<span class="web-sub web-cb-err">Folio needs a look: ' + esc(String(r.cb_folio_note || "").slice(0, 140)) + "</span>" : "";
      var st = r.cb_info && r.cb_info.status ? '<span class="web-sub">Cloudbeds: ' + esc(CB_NAMES[r.cb_info.status] || r.cb_info.status) + "</span>" : "";
      return '<span class="web-cb-ok">✓ In Cloudbeds</span><span class="web-sub">#' + esc(r.cb_reservation_id) + "</span>" + st + note;
    }
    if (r.cb_push_state === "error") return '<span class="web-cb-err">Not sent — error</span><span class="web-sub">' + esc(String(r.cb_push_error || "").slice(0, 160)) + "</span>";
    if (r.cb_push_state === "pushing") return '<span class="web-cb-wait">Sending…</span>';
    if (!live(r)) return '<span class="muted">Not sent (cancelled)</span>';
    return '<span class="muted">Website only</span><span class="web-sub">made before go-live / test mode</span>';
  }

  function draw() {
    var list = shown();
    stats(list);
    if (!list.length) {
      $("webBody").innerHTML = '<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--ink-soft);">No website bookings in this period.</td></tr>';
      return;
    }
    $("webBody").innerHTML = list.map(function (r) {
      return '<tr data-id="' + esc(r.id) + '">' +
        "<td>" + esc(D.fmtDateTime(r.created_at)) + "</td>" +
        "<td><b>" + esc(r.order_code || "—") + "</b><span class=\"web-sub\">" + esc(r.guest_name || "") + "</span></td>" +
        "<td>" + madeBy(r) + "</td>" +
        "<td>" + stay(r) + "</td>" +
        '<td class="num">' + esc(peso(r.total_amount)) + "</td>" +
        "<td>" + esc(D.statusLabel ? D.statusLabel(r) : r.status) + "</td>" +
        "<td>" + pay(r) + "</td>" +
        "<td>" + cloudbeds(r) + "</td></tr>";
    }).join("");
  }

  // open the booking itself (from the loaded dashboard rows, which carry everything the forms need)
  $("webBody").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    var id = tr.getAttribute("data-id");
    var r = (D.rows() || []).filter(function (x) { return x.id === id; })[0];
    if (!r) { alert("This booking isn't in the loaded list — set \"Bookings loaded\" to an earlier year, then try again."); return; }
    close();
    if (isVilla(r) && window.VBRVillas && window.VBRVillas.openBooking) window.VBRVillas.openBooking(r);
    else if (D.openModal) D.openModal(r);
  });
})();
