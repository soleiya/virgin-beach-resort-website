/* ==========================================================================
   Staff dashboard — Discount Codes (booking-v24-discount-codes.sql)
   --------------------------------------------------------------------------
   Create / edit / switch off the codes guests can enter when booking a villa
   (the staff villa form takes them too). Each code takes a % off
     rooms    the casita nightly rates
     add_ons  the add-ons (optionally only when casita charges are over a minimum)
     all      the whole stay
   and can start / expire on a date. Usage counts come from the bookings.
   ========================================================================== */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc, peso = D.peso;
  var $ = function (id) { return document.getElementById(id); };
  var backdrop = $("codesModalBackdrop");
  if (!backdrop || !$("codesBtn")) return;

  var codes = [], usage = {}, editingCode = null;
  var APPLIES = { rooms: "off casita rates", add_ons: "off add-ons", all: "off the whole stay" };

  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function status(c) {
    var t = today();
    if (!c.active) return ["off", "Switched off"];
    if (c.starts_on && t < c.starts_on) return ["later", "Starts " + D.fmtDate(c.starts_on)];
    if (c.expires_on && t > c.expires_on) return ["expired", "Expired"];
    return ["on", "Active"];
  }
  function err(m) { var e = $("cdError"); e.textContent = m || ""; e.style.display = m ? "block" : "none"; }

  function close() { backdrop.classList.remove("open"); }
  $("codesClose").addEventListener("click", close);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  $("codesBtn").addEventListener("click", function () { backdrop.classList.add("open"); resetForm(); load(); });
  $("cdNew").addEventListener("click", resetForm);

  function resetForm() {
    editingCode = null;
    err("");
    $("codesForm").reset();
    $("cdActive").checked = true;
    $("cdCode").disabled = false;
    $("cdSave").textContent = "Add code";
    $("cdNew").hidden = true;
  }
  function fill(c) {
    editingCode = c.code;
    err("");
    $("cdCode").value = c.code; $("cdCode").disabled = true;
    $("cdApplies").value = c.applies_to;
    $("cdPercent").value = Number(c.percent);
    $("cdMin").value = Number(c.min_room_total) || "";
    $("cdStart").value = c.starts_on || "";
    $("cdEnd").value = c.expires_on || "";
    $("cdLabel").value = c.label || "";
    $("cdActive").checked = !!c.active;
    $("cdSave").textContent = "Save changes to " + c.code;
    $("cdNew").hidden = false;
    $("codesForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function load() {
    $("codesBody").innerHTML = '<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading&hellip;</td></tr>';
    Promise.all([
      sb.from("discount_codes").select("*").order("created_at"),
      sb.rpc("discount_code_usage"),
    ]).then(function (res) {
      if (res[0].error) {
        $("codesBody").innerHTML = '<tr><td colspan="8" class="cb-warn" style="padding:16px;">' +
          (/discount_codes/.test(res[0].error.message) ? "Needs the database update booking-v24-discount-codes.sql." : "Couldn't load: " + esc(res[0].error.message)) + "</td></tr>";
        return;
      }
      codes = res[0].data || [];
      usage = {};
      (res[1].data || []).forEach(function (u) { usage[u.code] = u; });
      draw();
    });
  }

  function draw() {
    if (!codes.length) { $("codesBody").innerHTML = '<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--ink-soft);">No codes yet.</td></tr>'; return; }
    $("codesBody").innerHTML = codes.map(function (c) {
      var st = status(c), u = usage[c.code] || {};
      var valid = (c.starts_on ? D.fmtDate(c.starts_on) : "Now") + " → " + (c.expires_on ? D.fmtDate(c.expires_on) : "no expiry");
      return '<tr data-code="' + esc(c.code) + '">' +
        "<td><b>" + esc(c.code) + "</b>" + (c.label ? '<span class="web-sub">' + esc(c.label) + "</span>" : "") + "</td>" +
        "<td>" + esc(Number(c.percent) + "% " + (APPLIES[c.applies_to] || c.applies_to)) + "</td>" +
        "<td>" + (Number(c.min_room_total) > 0 ? "Casitas over " + esc(peso(c.min_room_total)) : '<span class="muted">—</span>') + "</td>" +
        "<td>" + esc(valid) + "</td>" +
        '<td><span class="code-st ' + st[0] + '">' + esc(st[1]) + "</span></td>" +
        '<td class="num">' + (u.bookings || 0) + "</td>" +
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
    var pct = Number($("cdPercent").value);
    var row = {
      applies_to: $("cdApplies").value,
      percent: pct,
      min_room_total: Number($("cdMin").value) || 0,
      starts_on: $("cdStart").value || null,
      expires_on: $("cdEnd").value || null,
      label: $("cdLabel").value.trim() || null,
      active: $("cdActive").checked,
    };
    if (!editingCode && !/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(code)) return err("Codes are 2–30 letters, numbers, - or _ (no spaces).");
    if (!(pct > 0 && pct <= 100)) return err("Percent off must be between 1 and 100.");
    if (row.starts_on && row.expires_on && row.expires_on < row.starts_on) return err("The expiry date is before the start date.");
    $("cdSave").disabled = true;
    var q = editingCode
      ? sb.from("discount_codes").update(row).eq("code", editingCode)
      : sb.from("discount_codes").insert([Object.assign({ code: code }, row)]);
    q.then(function (res) {
      $("cdSave").disabled = false;
      if (res.error) return err(/duplicate|already exists|unique/i.test(res.error.message) ? "There's already a code " + code + "." : "Couldn't save: " + res.error.message);
      resetForm();
      load();
    });
  });
})();
