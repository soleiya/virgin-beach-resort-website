/* ==========================================================================
   Staff dashboard — Discount Codes + Booking Window
   (booking-v24-discount-codes.sql, extended in booking-v28)
   --------------------------------------------------------------------------
   A code takes a % or a fixed ₱ amount off
     rooms    the casita nightly rates (stays) / the cabana rental (day trips)
     add_ons  the add-ons (stays only)
     all      the whole booking
   for overnight stays and/or day trips, with optional conditions: the date
   the booking is made (from / expires), stay or visit dates, minimum nights,
   casita types, minimum spend, maximum uses and once per guest email.
   Usage counts come from the bookings. The database re-checks everything.
   ========================================================================== */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc, peso = D.peso;
  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------- codes
  var backdrop = $("codesModalBackdrop");
  if (backdrop && $("codesBtn")) (function () {
    var codes = [], usage = {}, editingCode = null, roomTypes = null;
    var APPLIES_STAY = { rooms: "off casita rates", add_ons: "off add-ons", all: "off the whole stay" };
    var APPLIES_DAY = { rooms: "off the cabana rental", add_ons: "off add-ons", all: "off the day trip" };

    function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
    function status(c) {
      var t = today(), u = usage[c.code] || {};
      if (!c.active) return ["off", "Switched off"];
      if (c.starts_on && t < c.starts_on) return ["later", "Starts " + D.fmtDate(c.starts_on)];
      if (c.expires_on && t > c.expires_on) return ["expired", "Expired"];
      if (c.max_uses && (u.bookings || 0) >= c.max_uses) return ["expired", "Fully used"];
      return ["on", "Active"];
    }
    function err(m) { var e = $("cdError"); e.textContent = m || ""; e.style.display = m ? "block" : "none"; }
    function amountText(c) {
      return c.discount_kind === "fixed" ? peso(c.amount_off).replace(/\.00$/, "") : Number(c.percent) + "%";
    }
    function kindsOf(c) { return c.booking_kinds && c.booking_kinds.length ? c.booking_kinds : ["overnight"]; }

    function close() { backdrop.classList.remove("open"); }
    $("codesClose").addEventListener("click", close);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    $("codesBtn").addEventListener("click", function () { backdrop.classList.add("open"); resetForm(); load(); });
    $("cdNew").addEventListener("click", resetForm);

    function syncForm() {
      var fixed = $("cdKind").value === "fixed";
      $("cdAmountLabel").textContent = fixed ? "Amount off (₱)" : "Percent off";
      $("cdAmount").max = fixed ? "" : "100";
      $("cdAmount").step = fixed ? "1" : "0.01";
      $("cdAmount").placeholder = fixed ? "1000" : "50";
      var stays = $("cdKOvernight").checked;
      var addOn = $("cdApplies").querySelector('option[value="add_ons"]');
      addOn.disabled = $("cdKDay").checked;
      if (addOn.disabled && $("cdApplies").value === "add_ons") $("cdApplies").value = "rooms";
      $("cdTypesWrap").style.opacity = stays ? "1" : "0.45";
      $("cdMinNights").disabled = !stays;
    }
    ["cdKind", "cdKOvernight", "cdKDay", "cdApplies"].forEach(function (id) { $(id).addEventListener("change", syncForm); });

    function drawTypes(selected) {
      var wrap = $("cdTypes");
      if (!roomTypes) { wrap.innerHTML = '<span class="muted">Loading&hellip;</span>'; return; }
      var sel = selected || [];
      wrap.innerHTML = roomTypes.map(function (t) {
        return '<label class="modal-check"><input type="checkbox" value="' + esc(t.room_type) + '"' + (sel.indexOf(t.room_type) >= 0 ? " checked" : "") + "> " + esc(t.room_type_name) + "</label>";
      }).join("") || '<span class="muted">No casitas found.</span>';
    }
    function pickedTypes() {
      return Array.prototype.map.call($("cdTypes").querySelectorAll("input:checked"), function (i) { return i.value; });
    }

    function resetForm() {
      editingCode = null;
      err("");
      $("codesForm").reset();
      $("cdActive").checked = true;
      $("cdKOvernight").checked = true;
      $("cdKDay").checked = false;
      $("cdCode").disabled = false;
      $("cdSave").textContent = "Add code";
      $("cdNew").hidden = true;
      drawTypes([]);
      syncForm();
    }
    function fill(c) {
      editingCode = c.code;
      err("");
      $("cdCode").value = c.code; $("cdCode").disabled = true;
      $("cdKind").value = c.discount_kind || "percent";
      $("cdAmount").value = c.discount_kind === "fixed" ? Number(c.amount_off) : Number(c.percent);
      $("cdApplies").value = c.applies_to;
      var k = kindsOf(c);
      $("cdKOvernight").checked = k.indexOf("overnight") >= 0;
      $("cdKDay").checked = k.indexOf("day_trip") >= 0;
      $("cdMin").value = Number(c.min_room_total) || "";
      $("cdStart").value = c.starts_on || "";
      $("cdEnd").value = c.expires_on || "";
      $("cdStayFrom").value = c.stay_from || "";
      $("cdStayTo").value = c.stay_to || "";
      $("cdMinNights").value = Number(c.min_nights) > 1 ? c.min_nights : "";
      $("cdMaxUses").value = c.max_uses || "";
      $("cdOnce").checked = !!c.once_per_guest;
      $("cdLabel").value = c.label || "";
      $("cdActive").checked = !!c.active;
      drawTypes(c.room_types || []);
      syncForm();
      $("cdSave").textContent = "Save changes to " + c.code;
      $("cdNew").hidden = false;
      $("codesForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function load() {
      $("codesBody").innerHTML = '<tr><td colspan="9" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading&hellip;</td></tr>';
      Promise.all([
        sb.from("discount_codes").select("*").order("created_at"),
        sb.rpc("discount_code_usage"),
        roomTypes ? Promise.resolve(null) : sb.from("villas").select("room_type, room_type_name, sort").order("sort"),
      ]).then(function (res) {
        if (res[2] && !res[2].error) {
          var seen = {};
          roomTypes = (res[2].data || []).filter(function (v) { if (seen[v.room_type]) return false; seen[v.room_type] = 1; return true; });
          drawTypes(editingCode ? (codes.filter(function (x) { return x.code === editingCode; })[0] || {}).room_types : pickedTypes());
        }
        if (res[0].error) {
          $("codesBody").innerHTML = '<tr><td colspan="9" class="cb-warn" style="padding:16px;">' +
            (/discount_codes/.test(res[0].error.message) ? "Needs the database update booking-v24-discount-codes.sql." : "Couldn't load: " + esc(res[0].error.message)) + "</td></tr>";
          return;
        }
        codes = res[0].data || [];
        usage = {};
        (res[1].data || []).forEach(function (u) { usage[u.code] = u; });
        if (codes.length && !("discount_kind" in codes[0])) err("Needs the database update booking-v28-discounts-and-booking-window.sql for fixed amounts, day trips and conditions.");
        draw();
      });
    }

    function typeName(t) {
      var m = (roomTypes || []).filter(function (x) { return x.room_type === t; })[0];
      return m ? m.room_type_name : t;
    }
    function conditions(c) {
      var out = [];
      if (Number(c.min_room_total) > 0) out.push("Min. spend " + peso(c.min_room_total).replace(/\.00$/, ""));
      if (c.stay_from || c.stay_to) out.push("Dates " + (c.stay_from ? D.fmtDate(c.stay_from) : "any") + " – " + (c.stay_to ? D.fmtDate(c.stay_to) : "any"));
      if (Number(c.min_nights) > 1) out.push(c.min_nights + "+ nights");
      if (c.room_types && c.room_types.length) out.push(c.room_types.map(typeName).join(", "));
      if (c.max_uses) out.push("Max " + c.max_uses + " use" + (c.max_uses === 1 ? "" : "s"));
      if (c.once_per_guest) out.push("Once per guest");
      return out.length ? '<span class="cd-cond">' + out.map(esc).join("<br>") + "</span>" : '<span class="muted">—</span>';
    }

    function draw() {
      if (!codes.length) { $("codesBody").innerHTML = '<tr><td colspan="9" style="padding:24px;text-align:center;color:var(--ink-soft);">No codes yet.</td></tr>'; return; }
      $("codesBody").innerHTML = codes.map(function (c) {
        var st = status(c), u = usage[c.code] || {}, k = kindsOf(c);
        var applies = (k.length === 1 && k[0] === "day_trip" ? APPLIES_DAY : APPLIES_STAY)[c.applies_to] || c.applies_to;
        var valid = (c.starts_on ? D.fmtDate(c.starts_on) : "Now") + " → " + (c.expires_on ? D.fmtDate(c.expires_on) : "no expiry");
        var forTxt = k.map(function (x) { return x === "day_trip" ? "Day trips" : "Stays"; }).join(" + ");
        return '<tr data-code="' + esc(c.code) + '">' +
          "<td><b>" + esc(c.code) + "</b>" + (c.label ? '<span class="web-sub">' + esc(c.label) + "</span>" : "") + "</td>" +
          "<td>" + esc(amountText(c) + " " + applies) + "</td>" +
          "<td>" + esc(forTxt) + "</td>" +
          "<td>" + conditions(c) + "</td>" +
          "<td>" + esc(valid) + "</td>" +
          '<td><span class="code-st ' + st[0] + '">' + esc(st[1]) + "</span></td>" +
          '<td class="num">' + (u.bookings || 0) + (c.max_uses ? " / " + c.max_uses : "") + "</td>" +
          '<td class="num">' + esc(peso(u.discount || 0)) + "</td>" +
          '<td><button type="button" class="btn-sm ghost cd-edit">Edit</button> <button type="button" class="btn-sm ghost cd-toggle">' + (c.active ? "Switch off" : "Switch on") + "</button></td></tr>";
      }).join("");
    }

    $("codesBody").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-code]");
      if (!tr) return;
      var c = codes.filter(function (x) { return x.code === tr.getAttribute("data-code"); })[0];
      if (!c) return;
      if (e.target.closest(".cd-toggle")) {
        e.target.disabled = true;
        sb.from("discount_codes").update({ active: !c.active }).eq("code", c.code).then(function (res) {
          if (res.error) alert("Couldn't save: " + res.error.message);
          load();
        });
        return;
      }
      fill(c);
    });

    $("codesForm").addEventListener("submit", function (e) {
      e.preventDefault();
      err("");
      var code = ($("cdCode").value || "").trim().toUpperCase().replace(/\s+/g, "");
      var kind = $("cdKind").value;
      var amt = Number($("cdAmount").value);
      var kinds = [];
      if ($("cdKOvernight").checked) kinds.push("overnight");
      if ($("cdKDay").checked) kinds.push("day_trip");
      var stays = kinds.indexOf("overnight") >= 0;
      var types = stays ? pickedTypes() : [];
      var row = {
        discount_kind: kind,
        percent: kind === "percent" ? amt : null,
        amount_off: kind === "fixed" ? amt : null,
        applies_to: $("cdApplies").value,
        booking_kinds: kinds,
        min_room_total: Number($("cdMin").value) || 0,
        starts_on: $("cdStart").value || null,
        expires_on: $("cdEnd").value || null,
        stay_from: $("cdStayFrom").value || null,
        stay_to: $("cdStayTo").value || null,
        min_nights: stays ? (parseInt($("cdMinNights").value, 10) || 0) : 0,
        room_types: types.length && roomTypes && types.length < roomTypes.length ? types : null,
        max_uses: parseInt($("cdMaxUses").value, 10) || null,
        once_per_guest: $("cdOnce").checked,
        label: $("cdLabel").value.trim() || null,
        active: $("cdActive").checked,
      };
      if (!editingCode && !/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(code)) return err("Codes are 2–30 letters, numbers, - or _ (no spaces).");
      if (kind === "percent" && !(amt > 0 && amt <= 100)) return err("Percent off must be between 1 and 100.");
      if (kind === "fixed" && !(amt > 0)) return err("Enter the peso amount off.");
      if (!kinds.length) return err("Tick Overnight stays, Day trips, or both.");
      if (row.applies_to === "add_ons" && kinds.indexOf("day_trip") >= 0) return err("Add-ons are only on overnight stays — untick Day trips or pick another option.");
      if (row.starts_on && row.expires_on && row.expires_on < row.starts_on) return err("The expiry date is before the start date.");
      if (row.stay_from && row.stay_to && row.stay_to < row.stay_from) return err("The stay dates end before they start.");
      if (row.max_uses !== null && row.max_uses < 1) return err("Maximum uses must be at least 1 (or blank for unlimited).");
      $("cdSave").disabled = true;
      var q = editingCode
        ? sb.from("discount_codes").update(row).eq("code", editingCode)
        : sb.from("discount_codes").insert([Object.assign({ code: code }, row)]);
      q.then(function (res) {
        $("cdSave").disabled = false;
        if (res.error) {
          return err(/duplicate|already exists|unique/i.test(res.error.message) ? "There's already a code " + code + "."
            : /column .* does not exist|discount_kind|booking_kinds/i.test(res.error.message) ? "Needs the database update booking-v28-discounts-and-booking-window.sql first."
            : "Couldn't save: " + res.error.message);
        }
        resetForm();
        load();
      });
    });
  })();

  // ---------------------------------------------------------------- booking window
  var wb = $("windowModalBackdrop");
  if (wb && $("windowBtn")) (function () {
    function werr(m) { var e = $("bwError"); e.textContent = m || ""; e.style.display = m ? "block" : "none"; }
    function close() { wb.classList.remove("open"); }
    $("bwClose").addEventListener("click", close);
    wb.addEventListener("click", function (e) { if (e.target === wb) close(); });
    $("windowBtn").addEventListener("click", function () {
      wb.classList.add("open"); werr(""); $("bwInfo").textContent = "Loading…";
      sb.from("booking_settings").select("*").eq("id", 1).maybeSingle().then(function (res) {
        if (res.error) { $("bwInfo").textContent = ""; return werr(/booking_settings/.test(res.error.message) ? "Needs the database update booking-v28-discounts-and-booking-window.sql." : "Couldn't load: " + res.error.message); }
        var s = res.data || {};
        $("bwUntil").value = s.bookings_open_until || "";
        $("bwDining").value = s.dining_cabanas_per_day != null ? s.dining_cabanas_per_day : 43;
        $("bwLounge").value = s.lounge_cabanas_per_day != null ? s.lounge_cabanas_per_day : 6;
        $("bwInfo").textContent = s.updated_by ? "Last changed by " + s.updated_by + " on " + D.fmtDate(String(s.updated_at).slice(0, 10)) + "." : "";
      });
    });
    $("bwSave").addEventListener("click", function () {
      werr("");
      var v = $("bwUntil").value || null;
      if (!v && !confirm("Leave the date blank? Guests will be able to book any future date.")) return;
      var dn = parseInt($("bwDining").value, 10), ln = parseInt($("bwLounge").value, 10);
      if (!(dn >= 0) || !(ln >= 0)) return werr("Enter how many dining and lounge cabanas there are per day.");
      $("bwSave").disabled = true;
      sb.from("booking_settings").update({ bookings_open_until: v, dining_cabanas_per_day: dn, lounge_cabanas_per_day: ln }).eq("id", 1).then(function (res) {
        $("bwSave").disabled = false;
        if (res.error) return werr(/dining_cabanas_per_day/.test(res.error.message) ? "Needs the database update booking-v29-cabanas-by-count.sql." : "Couldn't save: " + res.error.message);
        if (D.setStock) D.setStock({ dining: dn, lounge: ln });
        $("bwInfo").textContent = (v ? "Saved — guests can book up to " + D.fmtDate(v) : "Saved — no date limit") + "; " + dn + " dining / " + ln + " lounge cabanas per day.";
      });
    });
  })();
})();
