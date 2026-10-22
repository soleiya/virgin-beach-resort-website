/* ==========================================================================
   Staff dashboard — Day Trip Calendar (booking-v29)
   --------------------------------------------------------------------------
   The 2026 Day Trip Calendar sheet, live: pick a month and every day is a
   block with its bookings in the sheet's columns (Booker, Guest, Adult,
   Kids, PWD | Senior, Pet, Dining, Lounge, Total, Remarks) plus the cabanas
   still free that day and the assigned cabana numbers. Click a booking to
   edit it; "Assign" picks cabana numbers (the guest is emailed them).
   ========================================================================== */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc, peso = D.peso;
  var $ = function (id) { return document.getElementById(id); };
  var backdrop = $("dcalBackdrop");
  if (!backdrop || !$("dcalBtn")) return;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PKG = {
    day_trip: "Day Trip", half_day: "Half Day", flash_sale: "Flash Sale", all_inclusive_family: "Family",
    all_inclusive_barkada: "Barkada", corporate: "Corporate", other: "Other",
  };
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function dayName(ds) {
    return new Date(ds + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }
  function int(v) { return Number(v) || 0; }

  // ------------------------------------------------------------- open / nav
  function open(month) {
    $("dcalMonth").value = month || today().slice(0, 7);
    backdrop.classList.add("open");
    draw();
  }
  function close() { backdrop.classList.remove("open"); closePop(); }
  function shift(n) {
    var m = ($("dcalMonth").value || today().slice(0, 7)).split("-");
    var d = new Date(Date.UTC(+m[0], +m[1] - 1 + n, 1));
    $("dcalMonth").value = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1);
    draw();
  }
  $("dcalBtn").addEventListener("click", function () { open(); });
  $("dcalClose").addEventListener("click", close);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  $("dcalPrev").addEventListener("click", function () { shift(-1); });
  $("dcalNext").addEventListener("click", function () { shift(1); });
  $("dcalToday").addEventListener("click", function () {
    $("dcalMonth").value = today().slice(0, 7); draw();
    var t = document.querySelector('.dcal-day[data-date="' + today() + '"]');
    if (t) t.scrollIntoView({ block: "start" });
  });
  ["dcalMonth", "dcalEmpty", "dcalCancelled"].forEach(function (id) { $(id).addEventListener("change", draw); });
  // the dashboard reloaded its bookings (after a save) → redraw
  document.addEventListener("vbr:render", function () { if (backdrop.classList.contains("open")) draw(); });

  // ------------------------------------------------------------- data
  function dayTrips(month) {
    return D.rows().filter(function (r) {
      return r.check_in && r.check_in.slice(0, 7) === month && !D.isVillaRow(r);
    });
  }
  function assignedIds(r) { return (r.booking_cabanas || []).map(function (bc) { return bc.cabana_id; }); }
  function remarks(r) {
    var bits = [];
    var sn = String(r.staff_notes || "").replace(/^\[Imported from 2026 Day Trip Calendar\]\s*/, "");
    if (sn) bits.push(sn);
    if (r.notes) bits.push(r.notes);
    if (int(r.children_0_5)) bits.push(int(r.children_0_5) + " kid(s) 0–5");
    if (r.discount_code) bits.push("Code " + r.discount_code);
    return bits.join(" · ");
  }

  // ------------------------------------------------------------- draw
  function draw() {
    closePop();
    var month = $("dcalMonth").value || today().slice(0, 7);
    var showEmpty = $("dcalEmpty").checked, showOff = $("dcalCancelled").checked;
    var rows = dayTrips(month);
    var byDay = {};
    rows.forEach(function (r) { (byDay[r.check_in] = byDay[r.check_in] || []).push(r); });
    var y = +month.slice(0, 4), m = +month.slice(5, 7);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var html = [], tGuests = 0, tBookings = 0, tTotal = 0, tD = 0, tL = 0;
    for (var d = 1; d <= last; d++) {
      var ds = month + "-" + pad(d);
      var list = (byDay[ds] || []).slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
      var active = list.filter(function (r) { return !D.releasesCabanas(r.status); });
      var shown = showOff ? list : active;
      if (!shown.length && !showEmpty) continue;
      var free = D.cabanasFreeOn(ds) || { dining: 0, lounge: 0, stock: D.stock(), blocked: { dining: 0, lounge: 0 } };
      var guests = 0, dn = 0, ln = 0;
      active.forEach(function (r) {
        guests += int(r.adults) + int(r.children_6_12) + int(r.children_0_5);
        var n = D.countsOf(r); dn += n.dining; ln += n.lounge;
        tTotal += int(r.total_amount);
      });
      tGuests += guests; tBookings += active.length; tD += dn; tL += ln;
      var cap = function (label, used, left, stock, blocked) {
        return '<span class="dcal-cap">' + label + " <b>" + used + "</b>/" + stock +
          (left <= 0 ? ' <span class="full">full</span>' : " · " + left + " left") + (blocked ? " · " + blocked + " blocked" : "") + "</span>";
      };
      html.push('<tr class="dcal-day' + (ds === today() ? " is-today" : "") + '" data-date="' + ds + '"><td colspan="14">' + esc(dayName(ds)) +
        '<span class="dcal-cap">' + active.length + " booking" + (active.length === 1 ? "" : "s") + " · <b>" + guests + "</b> guests</span>" +
        cap("Dining", dn, free.dining, free.stock.dining, free.blocked.dining) + cap("Lounge", ln, free.lounge, free.stock.lounge, free.blocked.lounge) +
        '<button type="button" class="btn-sm ghost dcal-add" data-date="' + ds + '">+ Add</button></td></tr>');
      if (!shown.length) html.push('<tr class="dcal-empty"><td colspan="14">No bookings</td></tr>');
      shown.forEach(function (r) {
        var n = D.countsOf(r), off = D.releasesCabanas(r.status);
        var seniors = int(r.senior_count);
        var ids = assignedIds(r);
        var tags = ids.map(function (id) {
          var c = D.cabanaById(id);
          return c ? '<span class="cab-tag' + (D.cabKind(c) === "lounge" ? " lounge" : "") + '" title="' + esc(c.label) + '">' + esc(D.cabShort(c)) + "</span>" : "";
        }).join("");
        var needs = n.dining + n.lounge;
        html.push('<tr class="dcal-row' + (off ? " is-off" : "") + '" data-id="' + esc(r.id) + '">' +
          "<td>" + esc(r.booked_by || (r.source === "website" ? "Website" : r.source || "")) + "</td>" +
          "<td><b>" + esc(r.guest_name || "—") + "</b>" + (r.order_code ? '<br><span class="muted">' + esc(r.order_code) + "</span>" : "") + "</td>" +
          '<td class="num">' + Math.max(int(r.adults) - seniors, 0) + "</td>" +
          '<td class="num">' + int(r.children_6_12) + "</td>" +
          '<td class="num">' + int(r.children_0_5) + "</td>" +
          '<td class="num">' + seniors + "</td>" +
          '<td class="num">' + int(r.pet_count) + "</td>" +
          '<td class="num">' + (n.dining || "") + "</td>" +
          '<td class="num">' + (n.lounge || "") + "</td>" +
          "<td>" + esc(PKG[r.stay_type] || r.stay_type_label || r.stay_type || "") + "</td>" +
          '<td class="num">' + (r.total_amount == null ? "—" : esc(peso(r.total_amount))) + "</td>" +
          '<td><span class="status-badge readonly status-' + esc(r.status) + '">' + esc(D.statusLabel(r)) + "</span></td>" +
          '<td class="dcal-remarks">' + esc(remarks(r)) + "</td>" +
          '<td class="dcal-cabno">' + tags + (off || !needs ? "" :
            ' <button type="button" class="btn-sm ghost dcal-assign" data-id="' + esc(r.id) + '">' + (ids.length ? "Change" : "Assign") + "</button>") +
          (!off && needs && ids.length < needs ? '<br><span class="muted">' + (needs - ids.length) + " to assign</span>" : "") + "</td></tr>");
      });
    }
    $("dcalBody").innerHTML = html.join("") || '<tr class="dcal-empty"><td colspan="14">No day trips this month' + (showEmpty ? "" : " (tick “Show days with no bookings” to see every day)") + ".</td></tr>";
    var s = D.stock();
    $("dcalSum").textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) +
      ": " + tBookings + " booking" + (tBookings === 1 ? "" : "s") + " · " + tGuests + " guests · " + tD + " dining + " + tL + " lounge cabanas · " +
      peso(tTotal) + " — stock per day: " + s.dining + " dining, " + s.lounge + " lounge (change it under Booking Window).";
  }

  $("dcalBody").addEventListener("click", function (e) {
    var add = e.target.closest(".dcal-add");
    if (add) {
      D.openModal(null);
      var el = $("addDate");
      if (el) { el.value = add.getAttribute("data-date"); el.dispatchEvent(new Event("change", { bubbles: true })); }
      return;
    }
    var as = e.target.closest(".dcal-assign");
    if (as) { e.stopPropagation(); openPop(rowById(as.getAttribute("data-id")), as); return; }
    var tr = e.target.closest(".dcal-row");
    if (tr) { var r = rowById(tr.getAttribute("data-id")); if (r) D.openModal(r); }
  });
  function rowById(id) { return D.rows().filter(function (r) { return r.id === id; })[0]; }

  // ------------------------------------------------------------- assign popover
  var pop = $("dcalPop"), popRow = null, popPicked = [];
  function closePop() { pop.hidden = true; popRow = null; }
  $("dcalPopCancel").addEventListener("click", closePop);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pop.hidden) closePop(); });

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
    if (!r) return;
    popRow = r;
    popPicked = assignedIds(r).slice();
    var n = D.countsOf(r);
    $("dcalPopTitle").textContent = "Cabana no. — " + (r.guest_name || "") + (r.order_code ? " · " + r.order_code : "");
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

  $("dcalPopSave").addEventListener("click", function () {
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
      if (!EMAIL_RE.test(String(r.guest_email || "").trim())) return null;
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
})();
