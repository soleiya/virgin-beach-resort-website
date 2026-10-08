/* ==========================================================================
   Staff dashboard — overnight villa bookings
   --------------------------------------------------------------------------
   * Villa booking modal: create / edit an overnight stay (dates, villas,
     guest list, pets, discount, payment proof, guest email).
     Saved through staff_save_overnight() — one atomic step, priced with
     quote_overnight(), so it always matches the website and the emails.
   * Villa Calendar: all 18 units across 2–8 weeks; click a booking to open
     it, click an empty night to start one; staff blocks; peak dates.
   Needs staff-dashboard.js (window.VBRDash) loaded first.
   ========================================================================== */
(function () {
  var D = window.VBRDash;
  if (!D) return;
  var sb = D.sb, esc = D.esc, peso = D.peso, fmtDate = D.fmtDate;
  function $(id) { return document.getElementById(id); }

  var villas = [], villasById = {};
  var addOns = [], addonQty = {};
  var AGE = [["adult", "Adult (13+)"], ["senior", "Senior / PWD"], ["child_6_12", "Child 6–12"], ["child_0_5", "Child 0–5 (free)"]];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function todayStr() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }
  function dow(s) { return new Date(s + "T00:00:00Z").getUTCDay(); }

  function init() {
    sb.from("add_ons").select("*").eq("active", true).not("price", "is", null).order("sort").then(function (res) { addOns = res.error ? [] : (res.data || []); });
    return sb.from("villas").select("*").eq("active", true).order("sort").then(function (res) {
      if (res.error) throw res.error;
      villas = res.data || [];
      villasById = {};
      villas.forEach(function (v) { villasById[v.id] = v; });
      fillBlockSelect();
    });
  }
  function labelsFor(r) {
    return (r.booking_villas || []).map(function (bv) { return villasById[bv.villa_id]; }).filter(Boolean)
      .sort(function (a, b) { return a.sort - b.sort; })
      .map(function (v) { return v.unit_label + " · " + v.room_type_name.replace(" Casita", ""); });
  }

  // ======================================================================
  // Booking modal
  // ======================================================================
  var backdrop = $("villaModalBackdrop"), form = $("villaForm"), errEl = $("vError"), saveBtn = $("vSave");
  var editing = null;          // the row being edited, or null
  var picked = [];             // villa ids
  var guests = [];             // companions [{name, age_group}]
  var holds = [];              // active booking_villas overlapping the chosen dates
  var lastQuote = null, quoteSeq = 0, quoteTimer = null;

  function showErr(m) { errEl.textContent = m; errEl.style.display = "block"; saveBtn.disabled = false; }

  function openBooking(row, preset) {
    form.reset();
    errEl.style.display = "none";
    editing = row && row.id ? row : null;
    preset = preset || {};
    var r = editing || {};
    $("villaModalTitle").textContent = editing ? "Edit Villa Booking" + (r.order_code ? " · " + r.order_code : "") : "New Villa Booking";
    $("villaModalSub").textContent = editing ? "Changes are saved to the activity log under your name." : "Overnight stay in one or more casitas. Priced from the same rate sheet as the website.";
    saveBtn.textContent = editing ? "Save Changes" : "Save Booking";
    $("vChannel").value = r.source || "phone";
    $("vStatus").value = r.status || "pending";
    $("vBookedBy").value = editing ? (r.booked_by || "—") : (D.staffName() || "");
    $("vName").value = r.guest_name || "";
    $("vName").readOnly = !!editing;
    $("vNameLock").hidden = !editing;
    $("vPhone").value = r.guest_phone || "";
    $("vEmail").value = r.guest_email || "";
    $("vCountry").value = r.country || "Philippines";
    $("vIn").value = r.check_in || preset.check_in || "";
    $("vOut").value = r.check_out || preset.check_out || ($("vIn").value ? addDays($("vIn").value, 1) : "");
    $("vPrimarySenior").checked = !!r.primary_is_senior;
    $("vPets").value = r.pet_count || 0;
    $("vDiscType").value = r.discount_type || "";
    $("vDiscValue").value = r.discount_value != null ? r.discount_value : "";
    $("vDiscReason").value = r.discount_reason || "";
    $("vNotes").value = r.notes || "";
    $("vStaffNotes").value = r.staff_notes || "";
    $("vOverCap").checked = false;
    picked = editing ? (r.booking_villas || []).map(function (bv) { return bv.villa_id; }) : (preset.villa_id ? [preset.villa_id] : []);
    addonQty = {};
    (Array.isArray(r.add_ons) ? r.add_ons : []).forEach(function (a) { addonQty[a.slug] = a.qty; });
    $("vOnline").checked = editing ? Number(r.online_discount) > 0 : false;
    renderAddOns();
    guests = Array.isArray(r.companions) ? r.companions.map(function (c) { return { name: c.name || "", age_group: c.age_group || "adult" }; }) : [];
    // Older / imported bookings may have head-counts but no names: fill blank rows.
    if (editing) {
      var known = guests.length + 1, total = (r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0);
      var extraA = Math.max(0, (r.adults || 0) - 1 - guests.filter(function (g) { return g.age_group === "adult" || g.age_group === "senior"; }).length);
      var extra612 = Math.max(0, (r.children_6_12 || 0) - guests.filter(function (g) { return g.age_group === "child_6_12"; }).length);
      var extra05 = Math.max(0, (r.children_0_5 || 0) - guests.filter(function (g) { return g.age_group === "child_0_5"; }).length);
      if (total > known) {
        for (var i = 0; i < extraA; i++) guests.push({ name: "", age_group: "adult" });
        for (i = 0; i < extra612; i++) guests.push({ name: "", age_group: "child_6_12" });
        for (i = 0; i < extra05; i++) guests.push({ name: "", age_group: "child_0_5" });
      }
    }
    // A price agreed elsewhere (Cloudbeds / OTA import) can be kept.
    var imported = editing && ["cloudbeds", "booking_com", "agoda"].indexOf(r.source) !== -1;
    $("vKeepWrap").hidden = !imported;
    $("vKeepTotal").checked = imported && r.total_amount != null;
    $("vKeepAmount").value = r.total_amount != null ? r.total_amount : "";
    $("vPayField").style.display = editing ? "block" : "none";
    $("vLogBtn").hidden = !editing;
    renderPayExisting(r);
    $("vNotify").checked = !editing ? false : true;
    renderGuests();
    onDates();
    backdrop.classList.add("open");
  }
  function close() { backdrop.classList.remove("open"); editing = null; }
  $("vCancel").addEventListener("click", close);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  $("addVillaBtn").addEventListener("click", function () { openBooking(null); });
  $("vLogBtn").addEventListener("click", function () { if (editing) D.openLog(editing.id, editing.guest_name + " (" + editing.order_code + ")"); });

  function renderPayExisting(r) {
    var el = $("vPayExisting");
    el.innerHTML = "";
    var links = editing ? D.proofLinks(r) : [];
    if (!links.length) { el.innerHTML = '<span class="muted">No payment proof uploaded yet.</span>'; return; }
    links.forEach(function (l) {
      var a = document.createElement("a");
      a.href = "#"; a.textContent = l.text;
      a.addEventListener("click", function (e) { e.preventDefault(); D.openSignedUrl(l.bucket, l.path); });
      el.appendChild(a);
    });
  }

  // ---------------- dates & villa availability ----------------
  function onDates() {
    var a = $("vIn").value, b = $("vOut").value;
    if (a && (!b || b <= a)) { b = addDays(a, 1); $("vOut").value = b; }
    var n = a && b ? diffDays(a, b) : 0;
    $("vNights").value = n > 0 ? n + " night" + (n === 1 ? "" : "s") : "";
    if (!(n > 0)) { holds = []; renderPick(); requestQuote(); return; }
    $("vAvailNote").textContent = "Checking availability…";
    sb.from("booking_villas").select("id,villa_id,booking_id,check_in,check_out,block_reason").eq("active", true)
      .lt("check_in", b).gt("check_out", a)
      .then(function (res) {
        holds = res.error ? [] : (res.data || []).filter(function (h) { return !(editing && h.booking_id === editing.id); });
        $("vAvailNote").textContent = res.error ? "Couldn't check availability: " + res.error.message : "Tick the villa(s) for this stay. Greyed-out units are taken for some of these nights.";
        renderPick();
        requestQuote();
      });
  }
  $("vIn").addEventListener("change", onDates);
  $("vOut").addEventListener("change", onDates);

  function whoHolds(villaId) {
    var h = holds.filter(function (x) { return x.villa_id === villaId; })[0];
    if (!h) return null;
    if (!h.booking_id) return "Blocked: " + (h.block_reason || "");
    var row = D.rows().filter(function (r) { return r.id === h.booking_id; })[0];
    return (row ? row.guest_name + " (" + row.order_code + ")" : "another booking") + " " + fmtDate(h.check_in) + "→" + fmtDate(h.check_out);
  }

  function renderPick() {
    var el = $("vPick");
    el.innerHTML = "";
    var lastType = null;
    villas.forEach(function (v) {
      if (v.room_type !== lastType) {
        lastType = v.room_type;
        var g = document.createElement("div");
        g.className = "villa-pick-group";
        g.textContent = v.room_type_name + " · ₱" + Number(v.weekday_rate).toLocaleString() + " / ₱" + Number(v.weekend_rate).toLocaleString();
        el.appendChild(g);
      }
      var taken = whoHolds(v.id);
      var on = picked.indexOf(v.id) !== -1;
      var lab = document.createElement("label");
      lab.className = "villa-opt" + (taken ? " is-taken" : "") + (on ? " is-on" : "");
      lab.title = taken || "";
      lab.innerHTML = '<input type="checkbox"' + (on ? " checked" : "") + (taken && !on ? " disabled" : "") + "><span>" + esc(v.unit_label) +
        "<small>" + (taken ? esc(taken) : "Sleeps " + v.base_occupancy + (v.max_extra ? " +" + v.max_extra : "")) + "</small></span>";
      lab.querySelector("input").addEventListener("change", function (e) {
        if (e.target.checked) { if (picked.indexOf(v.id) === -1) picked.push(v.id); }
        else picked = picked.filter(function (x) { return x !== v.id; });
        renderPick();
        requestQuote();
      });
      el.appendChild(lab);
    });
  }

  // ---------------- add-ons ----------------
  function renderAddOns() {
    var el = $("vAddons");
    el.innerHTML = "";
    if (!addOns.length) { el.innerHTML = '<span class="muted">No add-ons set up (add rows with a price to the add_ons table).</span>'; return; }
    addOns.forEach(function (a) {
      var lab = document.createElement("label");
      lab.className = "villa-opt" + (addonQty[a.slug] ? " is-on" : "");
      lab.innerHTML = '<span style="flex:1;">' + esc(a.name) + "<small>" + peso(a.price) + (a.unit ? " " + esc(a.unit) : "") + '</small></span><input type="number" min="0" max="20" value="' + (addonQty[a.slug] || 0) + '" style="width:64px !important;">';
      lab.querySelector("input").addEventListener("input", function (e) {
        addonQty[a.slug] = Math.max(0, Math.min(20, parseInt(e.target.value || "0", 10) || 0));
        lab.classList.toggle("is-on", addonQty[a.slug] > 0);
        requestQuote();
      });
      el.appendChild(lab);
    });
  }
  function addOnPayload() {
    return Object.keys(addonQty).filter(function (k) { return addonQty[k] > 0; }).map(function (k) { return { slug: k, qty: addonQty[k] }; });
  }

  // ---------------- guests ----------------
  function renderGuests() {
    var el = $("vGuests");
    el.innerHTML = "";
    var head = document.createElement("div");
    head.className = "vg-row";
    head.innerHTML = '<span class="vg-n">1</span><input type="text" readonly tabindex="-1" value="' + esc($("vName").value || "Primary guest") + '"><input type="text" readonly tabindex="-1" value="' + ($("vPrimarySenior").checked ? "Senior / PWD" : "Adult (13+)") + '"><span></span>';
    el.appendChild(head);
    guests.forEach(function (g, i) {
      var row = document.createElement("div");
      row.className = "vg-row" + (g.name.trim() ? "" : " vg-missing");
      row.innerHTML = '<span class="vg-n">' + (i + 2) + '</span><input type="text" placeholder="Full name (ask the guest)" value="' + esc(g.name) + '"><select>' +
        AGE.map(function (a) { return '<option value="' + a[0] + '"' + (a[0] === g.age_group ? " selected" : "") + ">" + a[1] + "</option>"; }).join("") +
        '</select><button type="button" title="Remove">×</button>';
      row.querySelector("input").addEventListener("input", function (e) { g.name = e.target.value; row.classList.toggle("vg-missing", !g.name.trim()); });
      row.querySelector("select").addEventListener("change", function (e) { g.age_group = e.target.value; requestQuote(); });
      row.querySelector("button").addEventListener("click", function () { guests.splice(i, 1); renderGuests(); requestQuote(); });
      el.appendChild(row);
    });
  }
  $("vAddGuest").addEventListener("click", function () { guests.push({ name: "", age_group: "adult" }); renderGuests(); requestQuote(); var ins = $("vGuests").querySelectorAll("input:not([readonly])"); if (ins.length) ins[ins.length - 1].focus(); });
  $("vPrimarySenior").addEventListener("change", function () { renderGuests(); requestQuote(); });
  $("vName").addEventListener("input", function () { var f = $("vGuests").querySelector("input[readonly]"); if (f) f.value = $("vName").value || "Primary guest"; });
  ["vPets", "vDiscValue", "vDiscReason", "vKeepAmount"].forEach(function (id) { $(id).addEventListener("input", requestQuote); });
  ["vDiscType", "vKeepTotal", "vOverCap", "vOnline"].forEach(function (id) { $(id).addEventListener("change", requestQuote); });
  $("vEmail").addEventListener("input", updateNotify);
  $("vStatus").addEventListener("change", updateNotify);

  function counts() {
    var c = { adults: 1, seniors: $("vPrimarySenior").checked ? 1 : 0, k612: 0, k05: 0 };
    guests.forEach(function (g) {
      if (g.age_group === "senior") { c.adults++; c.seniors++; }
      else if (g.age_group === "child_6_12") c.k612++;
      else if (g.age_group === "child_0_5") c.k05++;
      else c.adults++;
    });
    return c;
  }

  // ---------------- price ----------------
  function requestQuote() { clearTimeout(quoteTimer); quoteTimer = setTimeout(fetchQuote, 200); }
  function fetchQuote() {
    var a = $("vIn").value, b = $("vOut").value, c = counts();
    var bill = $("vBill");
    $("vDiscValue").disabled = $("vDiscReason").disabled = !$("vDiscType").value;
    if (!a || !b || !picked.length) {
      lastQuote = null;
      bill.innerHTML = '<div class="bill-lines"><div class="bill-row"><span>Set the dates and tick at least one villa</span><span>—</span></div></div>';
      $("vCap").hidden = true;
      updateNotify();
      return;
    }
    var seq = ++quoteSeq;
    sb.rpc("quote_overnight", { p_check_in: a, p_check_out: b, p_villa_ids: picked, p_adults: c.adults, p_seniors: c.seniors, p_kids612: c.k612, p_kids05: c.k05, p_pets: parseInt($("vPets").value || "0", 10) || 0, p_add_ons: addOnPayload(), p_online_bank: $("vOnline").checked })
      .then(function (res) {
        if (seq !== quoteSeq) return;
        if (res.error) { bill.innerHTML = '<p class="bill-note" style="color:#9b2c2c;">' + esc(res.error.message) + "</p>"; return; }
        lastQuote = res.data;
        renderBill(res.data);
      });
  }
  function discount(total) {
    var t = $("vDiscType").value, v = Number($("vDiscValue").value) || 0;
    if (!t || v <= 0) return 0;
    if (t === "percent") return Math.round(total * Math.min(v, 100)) / 100;
    return Math.min(v, total);
  }
  function renderBill(q) {
    var L = (q.lines || []).map(function (l) {
      return '<div class="bill-row' + (Number(l.amount) < 0 ? " discount" : "") + '"><span>' + esc(l.desc) + (l.kind !== "senior_room" ? ' <span class="muted">× ' + l.qty + "</span>" : "") +
        "</span><span>" + (Number(l.amount) === 0 ? "Free" : peso(l.amount)) + "</span></div>";
    });
    var d = discount(Number(q.total));
    if (d > 0) L.push('<div class="bill-row discount"><span>Discount' + ($("vDiscReason").value.trim() ? " — " + esc($("vDiscReason").value.trim()) : "") + "</span><span>−" + peso(d) + "</span></div>");
    var total = Number(q.total) - d;
    var keep = !$("vKeepWrap").hidden && $("vKeepTotal").checked;
    $("vBill").innerHTML = '<div class="bill-lines">' + L.join("") + "</div>" +
      '<div class="bill-total"><span>Total</span><span>' + peso(keep ? Number($("vKeepAmount").value || 0) : total) + "</span></div>" +
      (keep ? '<p class="bill-note">Keeping the agreed price (rate sheet gives ' + peso(total) + ").</p>" : "") +
      '<p class="bill-note">' + q.nights + " night(s) · " + q.weekday_nights + " weekday, " + q.weekend_nights + " weekend/peak · " + q.guests + " guest(s)</p>";
    var cap = $("vCap");
    cap.hidden = false;
    cap.className = "cap-line" + (q.guests > q.max_capacity ? " over" : "");
    cap.textContent = q.guests > q.max_capacity
      ? q.guests + " guests but the villa(s) take " + q.max_capacity + " max (incl. mattresses) — add a villa" + ($("vOverCap").checked ? " (override ticked)" : "")
      : q.guests + " guest(s) · sleeps " + q.base_capacity + (q.extra_beds ? " · " + q.extra_beds + " extra mattress(es)" : "") + " · max " + q.max_capacity;
    updateNotify();
  }

  function updateNotify() {
    var email = $("vEmail").value.trim(), wrap = $("vNotifyWrap"), box = $("vNotify"), txt = $("vNotifyText");
    var ok = EMAIL_RE.test(email);
    if (!editing) {
      var why = !ok ? "Add the guest's email to send the quotation" : ["pending", "pending_payment"].indexOf($("vStatus").value) === -1 ? "Only Pending bookings can be sent as a quotation" : "";
      box.disabled = !!why;
      if (why) box.checked = false;
      wrap.classList.toggle("is-disabled", !!why);
      txt.textContent = why || "Send this booking to the guest (" + email + ") as a quotation — same email as a website booking";
      return;
    }
    box.disabled = !ok;
    if (!ok) box.checked = false;
    wrap.classList.toggle("is-disabled", !ok);
    txt.textContent = ok ? "Email the guest (" + email + ") a summary of these changes" : "No guest email on this booking — the guest won't be emailed";
  }

  // ---------------- save ----------------
  function villaText(ids) {
    return ids.map(function (id) { return villasById[id]; }).filter(Boolean).sort(function (a, b) { return a.sort - b.sort; })
      .map(function (v) { return v.room_type_name + " (" + v.unit_label + ")"; }).join(", ") || "—";
  }
  function partyText(c) {
    var bits = [c.adults + " adult" + (c.adults === 1 ? "" : "s")];
    if (c.seniors) bits.push("incl. " + c.seniors + " senior/PWD");
    if (c.k612) bits.push(c.k612 + " child (6–12)");
    if (c.k05) bits.push(c.k05 + " child (0–5)");
    return bits.join(", ");
  }
  function longDate(s) { return s ? new Date(s + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—"; }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errEl.style.display = "none";
    var a = $("vIn").value, b = $("vOut").value;
    if (!$("vName").value.trim()) return showErr("Primary guest name is required.");
    if (!a || !b || b <= a) return showErr("Set a check-out date after the check-in date.");
    if (!picked.length) return showErr("Tick at least one villa.");
    if ((parseInt($("vPets").value || "0", 10) || 0) > 2) return showErr("A maximum of two pets are permitted per reservation.");
    if (lastQuote && lastQuote.guests > lastQuote.max_capacity && !$("vOverCap").checked) return showErr("Too many guests for the villa(s) picked — add a villa, or tick “Allow over capacity”.");
    if ($("vDiscType").value === "percent" && Number($("vDiscValue").value) > 100) return showErr("A percentage discount can't be more than 100%.");
    var c = counts();
    var payload = {
      source: $("vChannel").value, status: $("vStatus").value,
      guest_name: $("vName").value.trim(), booked_by: editing ? undefined : (D.staffName() || null),
      guest_phone: $("vPhone").value.trim(), guest_email: $("vEmail").value.trim(), country: $("vCountry").value.trim(),
      check_in: a, check_out: b, primary_is_senior: $("vPrimarySenior").checked,
      companions: guests.map(function (g) { return { name: g.name.trim(), age_group: g.age_group }; }),
      pet_count: parseInt($("vPets").value || "0", 10) || 0,
      discount_type: $("vDiscType").value, discount_value: $("vDiscValue").value, discount_reason: $("vDiscReason").value,
      notes: $("vNotes").value, staff_notes: $("vStaffNotes").value,
      keep_total: !$("vKeepWrap").hidden && $("vKeepTotal").checked, total_amount: $("vKeepAmount").value,
      allow_over_capacity: $("vOverCap").checked,
      add_ons: addOnPayload(), online_bank: $("vOnline").checked,
    };
    var file = $("vPayFile").files && $("vPayFile").files[0];
    var r = editing;
    var beforeVillas = r ? (r.booking_villas || []).map(function (x) { return x.villa_id; }) : [];
    var notify = $("vNotify").checked && !$("vNotify").disabled;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    sb.rpc("staff_save_overnight", { p_id: r ? r.id : null, payload: payload, p_villa_ids: picked })
      .then(function (res) {
        if (res.error) throw res.error;
        var saved = Array.isArray(res.data) ? res.data[0] : res.data;
        var jobs = Promise.resolve();
        if (file) {
          jobs = jobs.then(function () { return D.uploadProof({ id: saved.id }, file); }).then(function (path) {
            var patch = { payment_screenshot_path: path, payment_uploaded_at: new Date().toISOString() };
            if (["pending", "pending_payment"].indexOf(payload.status) !== -1) patch.status = "confirmed";
            return sb.from("booking_requests").update(patch).eq("id", saved.id).then(function (u) { if (u.error) throw u.error; });
          });
        }
        if (!r && notify) {
          jobs = jobs.then(function () { return sb.from("booking_requests").update({ email_guest: true }).eq("id", saved.id).then(function (u) { if (u.error) throw u.error; }); });
        }
        if (r && notify) {
          var changes = [];
          var push = function (label, before, after) { if (before !== after) changes.push({ label: label, before: before || "—", after: after || "—" }); };
          push("Check-in", longDate(r.check_in), longDate(a));
          push("Check-out", longDate(r.check_out), longDate(b));
          push("Casita(s)", villaText(beforeVillas), villaText(picked));
          push("Guests", partyText({ adults: r.adults || 0, seniors: r.senior_count || 0, k612: r.children_6_12 || 0, k05: r.children_0_5 || 0 }), partyText(c));
          var namesNow = [payload.guest_name].concat(payload.companions.map(function (g) { return g.name || "(name to follow)"; })).join(", ");
          push("Guest names", r.guest_names || "", namesNow);
          push("Pets", String(r.pet_count || 0), String(payload.pet_count));
          var aoText = function (list) { return (list || []).map(function (x) { var a = addOns.filter(function (o) { return o.slug === x.slug; })[0]; return x.qty + " × " + (a ? a.name : x.slug); }).join(", ") || "None"; };
          push("Add-ons", aoText(r.add_ons), aoText(payload.add_ons));
          push("Total", r.total_amount != null ? peso(r.total_amount) : "", saved.total != null ? peso(saved.total) : "");
          push("Phone", r.guest_phone || "", payload.guest_phone);
          push("Email", r.guest_email || "", payload.guest_email);
          push("Your requests", r.notes || "", payload.notes.trim());
          if (changes.length) {
            jobs = jobs.then(function () {
              return sb.rpc("notify_booking_change", { p_booking_id: r.id, p_changes: changes, p_old_check_in: r.check_in !== a ? r.check_in : null });
            });
          }
        }
        return jobs.then(function () { return saved; });
      })
      .then(function () {
        saveBtn.disabled = false;
        close();
        return D.reload().then(function () { if (calOpen()) renderCal(); });
      })
      .catch(function (err) {
        saveBtn.textContent = editing ? "Save Changes" : "Save Booking";
        showErr("Couldn't save: " + (err && err.message ? err.message : err));
      });
  });

  // ======================================================================
  // Villa Calendar
  // ======================================================================
  var calBackdrop = $("villaCalBackdrop"), calTable = $("calTable");
  var calHolds = [], peaks = [];
  function calOpen() { return calBackdrop.classList.contains("open"); }

  $("villaCalBtn").addEventListener("click", function () {
    if (!$("calStart").value) $("calStart").value = addDays(todayStr(), -1);
    calBackdrop.classList.add("open");
    renderCal();
  });
  $("calClose").addEventListener("click", function () { calBackdrop.classList.remove("open"); });
  calBackdrop.addEventListener("click", function (e) { if (e.target === calBackdrop) calBackdrop.classList.remove("open"); });
  $("calStart").addEventListener("change", renderCal);
  $("calDays").addEventListener("change", renderCal);
  $("calPrev").addEventListener("click", function () { $("calStart").value = addDays($("calStart").value, -7); renderCal(); });
  $("calNext").addEventListener("click", function () { $("calStart").value = addDays($("calStart").value, 7); renderCal(); });
  $("calToday").addEventListener("click", function () { $("calStart").value = addDays(todayStr(), -1); renderCal(); });

  function renderCal() {
    var start = $("calStart").value || todayStr();
    var n = parseInt($("calDays").value, 10) || 21;
    var end = addDays(start, n);
    $("calStatus").textContent = "Loading…";
    Promise.all([
      sb.from("booking_villas").select("id,villa_id,booking_id,check_in,check_out,block_reason").eq("active", true).lt("check_in", end).gt("check_out", start),
      sb.from("peak_dates").select("*").order("night"),
    ]).then(function (res) {
      if (res[0].error) { $("calStatus").textContent = "Couldn't load: " + res[0].error.message; return; }
      calHolds = res[0].data || [];
      peaks = res[1].data || [];
      drawCal(start, n);
      drawPeaks();
    });
  }

  function drawCal(start, n) {
    var rowsById = {};
    D.rows().forEach(function (r) { rowsById[r.id] = r; });
    var peakSet = {};
    peaks.forEach(function (p) { peakSet[p.night] = p.label || "Peak"; });
    var days = [];
    for (var i = 0; i < n; i++) days.push(addDays(start, i));
    var today = todayStr();
    var html = '<thead><tr><th class="unit">Villa</th>' + days.map(function (d) {
      var w = dow(d), we = w === 5 || w === 6;
      var dt = new Date(d + "T00:00:00Z");
      return '<th class="' + (we ? "we " : "") + (peakSet[d] ? "peak " : "") + (d === today ? "today" : "") + '" title="' + esc(peakSet[d] || "") + '">' +
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w] + "<br><b>" + dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) + "</b></th>";
    }).join("") + "</tr></thead><tbody>";
    var occupied = 0;
    villas.forEach(function (v) {
      html += '<tr><th class="unit">' + esc(v.unit_label) + "<small>" + esc(v.room_type_name) + "</small></th>";
      var mine = calHolds.filter(function (h) { return h.villa_id === v.id; });
      for (var i = 0; i < n; ) {
        var d = days[i];
        var h = mine.filter(function (x) { return x.check_in <= d && x.check_out > d; })[0];
        if (!h) {
          var w = dow(d);
          html += '<td class="free' + (w === 5 || w === 6 || peakSet[d] ? " we" : "") + '" data-villa="' + v.id + '" data-night="' + d + '"></td>';
          i++;
          continue;
        }
        var span = Math.min(diffDays(d, h.check_out), n - i);
        occupied += span;
        var r = h.booking_id ? rowsById[h.booking_id] : null;
        var cls = h.booking_id ? "st-" + (r ? r.status : "pending") : "st-block";
        if (h.check_in < d) cls += " cont-l";
        if (h.check_out > addDays(start, n)) cls += " cont-r";
        var title = h.booking_id
          ? (r ? r.guest_name + " · " + r.order_code + " · " + (D.STATUS_LABELS[r.status] || r.status) + " · " + ((r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0)) + " pax · " + (D.SOURCE_LABELS[r.source] || r.source) : "Booking")
          : "Blocked: " + (h.block_reason || "");
        var label = h.booking_id ? (r ? r.guest_name : "Booking") : "Blocked — " + (h.block_reason || "");
        var sub = h.booking_id && r ? r.order_code + " · " + ((r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0)) + " pax" : fmtDate(h.check_in) + "→" + fmtDate(h.check_out);
        html += '<td colspan="' + span + '"><div class="cal-bk ' + cls + '" data-hold="' + h.id + '" title="' + esc(title) + '">' + esc(label) + "<small>" + esc(sub) + "</small></div></td>";
        i += span;
      }
      html += "</tr>";
    });
    calTable.innerHTML = html + "</tbody>";
    $("calStatus").textContent = Math.round(occupied / (villas.length * n) * 100) + "% occupied in this view";
  }

  calTable.addEventListener("click", function (e) {
    var bk = e.target.closest(".cal-bk");
    if (bk) {
      var h = calHolds.filter(function (x) { return x.id === bk.getAttribute("data-hold"); })[0];
      if (!h) return;
      if (h.booking_id) {
        var r = D.rows().filter(function (x) { return x.id === h.booking_id; })[0];
        if (r) openBooking(r);
        return;
      }
      var v = villasById[h.villa_id];
      if (confirm("Remove the block on " + (v ? v.unit_label : "this villa") + " (" + fmtDate(h.check_in) + " → " + fmtDate(h.check_out) + ")?\n\n" + (h.block_reason || ""))) {
        sb.from("booking_villas").delete().eq("id", h.id).then(function (res) {
          if (res.error) alert("Couldn't remove the block: " + res.error.message);
          renderCal();
        });
      }
      return;
    }
    var td = e.target.closest("td.free");
    if (td) openBooking(null, { villa_id: td.getAttribute("data-villa"), check_in: td.getAttribute("data-night"), check_out: addDays(td.getAttribute("data-night"), 1) });
  });

  // ---------------- blocks ----------------
  function fillBlockSelect() {
    var sel = $("blkVilla");
    if (!sel) return;
    sel.innerHTML = villas.map(function (v) { return '<option value="' + v.id + '">' + esc(v.unit_label + " — " + v.room_type_name) + "</option>"; }).join("");
  }
  $("blkSave").addEventListener("click", function () {
    var err = $("blkError");
    err.style.display = "none";
    var a = $("blkIn").value, b = $("blkOut").value, reason = $("blkReason").value.trim();
    var fail = function (m) { err.textContent = m; err.style.display = "block"; };
    if (!a || !b || b <= a) return fail("Set the first night and the day the villa is free again (after the first night).");
    if (!reason) return fail("Add a reason (shown on the calendar and in the activity log).");
    sb.from("booking_villas").insert([{ villa_id: $("blkVilla").value, check_in: a, check_out: b, block_reason: reason }]).then(function (res) {
      if (res.error) return fail(/overlap|exclusion|conflict/i.test(res.error.message) ? "That villa already has a booking or block on some of those nights." : res.error.message);
      $("blkReason").value = "";
      renderCal();
    });
  });
  $("blkIn").addEventListener("change", function () { if ($("blkIn").value && (!$("blkOut").value || $("blkOut").value <= $("blkIn").value)) $("blkOut").value = addDays($("blkIn").value, 1); });

  // ---------------- peak dates ----------------
  function drawPeaks() {
    var ul = $("peakList");
    var upcoming = peaks.filter(function (p) { return p.night >= addDays(todayStr(), -1); });
    ul.innerHTML = upcoming.length ? "" : '<li class="muted">No upcoming peak nights. Fridays &amp; Saturdays are always weekend rate.</li>';
    upcoming.forEach(function (p) {
      var li = document.createElement("li");
      li.innerHTML = "<span><b>" + esc(fmtDate(p.night)) + "</b> " + esc(p.label || "") + '</span><button type="button" title="Remove">Remove</button>';
      li.querySelector("button").addEventListener("click", function () {
        sb.from("peak_dates").delete().eq("night", p.night).then(function (res) { if (res.error) alert(res.error.message); renderCal(); });
      });
      ul.appendChild(li);
    });
  }
  $("peakAdd").addEventListener("click", function () {
    var d = $("peakDate").value;
    if (!d) return;
    sb.from("peak_dates").insert([{ night: d, label: $("peakLabel").value.trim() || null }]).then(function (res) {
      if (res.error) alert(/duplicate/i.test(res.error.message) ? "That night is already a peak night." : res.error.message);
      $("peakLabel").value = "";
      renderCal();
    });
  });

  window.VBRVillas = { init: init, labelsFor: labelsFor, openBooking: openBooking };
})();
