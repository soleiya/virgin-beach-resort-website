/* ==========================================================================
   Book Your Stay — overnight casita booking (book-stay/index.html)
   --------------------------------------------------------------------------
   1. Dates → live availability per unit (public_villa_holds, no guest data)
   2. Guest picks HOW MANY of each casita type; we hold the first free units
      (staff can move a guest to another unit of the same type later).
   3. Guest list is mandatory: every companion's full name + age group. The
      meal package is per person per night, so the head-count comes from
      this list — the server recounts it and ignores anything else.
   4. The bill is the server's quote_overnight() — the same calculation the
      quotation email and the staff dashboard use.
   5. submit_overnight_booking() saves it; a database constraint makes a
      double booking impossible even if two guests click at the same time.
   ========================================================================== */
(function () {
  var form = document.getElementById("stayForm");
  if (!form) return;

  var cfg = window.SUPABASE_CONFIG || {};
  var sb = cfg.url && window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;
  var params = new URLSearchParams(location.search);

  function $(id) { return document.getElementById(id); }
  var checkInEl = $("checkIn"), checkOutEl = $("checkOut"), nightsLine = $("nightsLine");
  var availStatus = $("availStatus"), pickedNote = $("pickedNote");
  var guestList = $("guestList"), partySizeEl = $("partySize"), capacityMeter = $("capacityMeter");
  var primarySeniorEl = $("primarySenior"), seniorIdWrap = $("seniorIdWrap"), seniorIdFilesEl = $("seniorIdFiles");
  var petCountEl = $("petCount"), petWrap = $("petWrap"), petVaxFilesEl = $("petVaxFiles"), petAgreeEl = $("petPolicyAgree");
  var billEl = $("billSummary"), formError = $("formError"), submitBtn = $("submitBtn");

  var AGE_GROUPS = [
    ["", "Age group…"],
    ["adult", "Adult (13+)"],
    ["senior", "Senior Citizen / PWD"],
    ["child_6_12", "Child (6–12)"],
    ["child_0_5", "Child (0–5) — meals free"],
  ];
  var MAX_PARTY = 30;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var villas = [];            // active units, in sort order
  var heldIds = new Set();    // units taken for the chosen dates
  var counts = {};            // room_type -> how many the guest wants
  var companions = [{ name: "", age: "adult" }]; // everyone except the primary guest
  var lastQuote = null;
  var quoteSeq = 0;

  function peso(n) {
    var v = Number(n) || 0;
    return (v < 0 ? "−₱" : "₱") + Math.abs(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function todayManila() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function addDays(s, n) {
    var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function nights() {
    if (!checkInEl.value || !checkOutEl.value) return 0;
    return Math.round((new Date(checkOutEl.value + "T00:00:00Z") - new Date(checkInEl.value + "T00:00:00Z")) / 86400000);
  }
  function fmtDay(s) {
    return new Date(s + "T00:00:00+08:00").toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });
  }

  // ---------------------------------------------------------------- dates
  checkInEl.min = todayManila();
  checkOutEl.min = addDays(todayManila(), 1);
  function onDates() {
    if (checkInEl.value) {
      checkOutEl.min = addDays(checkInEl.value, 1);
      if (!checkOutEl.value || checkOutEl.value <= checkInEl.value) checkOutEl.value = addDays(checkInEl.value, 1);
    }
    var n = nights();
    nightsLine.textContent = n > 0 ? n + " night" + (n === 1 ? "" : "s") + " · " + fmtDay(checkInEl.value) + " → " + fmtDay(checkOutEl.value) : "";
    loadAvailability();
  }
  checkInEl.addEventListener("change", onDates);
  checkOutEl.addEventListener("change", onDates);

  // ---------------------------------------------------------------- casitas
  var typeCards = {};
  Array.prototype.forEach.call(document.querySelectorAll(".villa-type"), function (card) {
    var t = card.getAttribute("data-type");
    typeCards[t] = card;
    counts[t] = 0;
    card.querySelector(".st-minus").addEventListener("click", function () { setCount(t, counts[t] - 1); });
    card.querySelector(".st-plus").addEventListener("click", function () { setCount(t, counts[t] + 1); });
  });

  function unitsOfType(t) { return villas.filter(function (v) { return v.room_type === t; }); }
  function freeUnitsOfType(t) { return unitsOfType(t).filter(function (v) { return !heldIds.has(v.id); }); }
  function datesReady() { return nights() > 0; }

  function setCount(t, n) {
    var max = datesReady() ? freeUnitsOfType(t).length : 0;
    counts[t] = Math.max(0, Math.min(n, max));
    renderTypes();
    renderCapacity();
    requestQuote();
  }

  function pickedVillas() {
    var out = [];
    Object.keys(counts).forEach(function (t) {
      out = out.concat(freeUnitsOfType(t).slice(0, counts[t]));
    });
    return out;
  }

  function renderTypes() {
    Object.keys(typeCards).forEach(function (t) {
      var card = typeCards[t];
      var all = unitsOfType(t), free = freeUnitsOfType(t);
      if (all.length) {
        var v = all[0];
        card.querySelector(".vt-occ").textContent = "Sleeps " + v.base_occupancy + (v.max_extra ? " (+" + v.max_extra + " on a mattress)" : "");
      }
      var availEl = card.querySelector(".vt-avail");
      if (!datesReady()) availEl.textContent = "Pick your dates to check availability";
      else if (!all.length) availEl.textContent = "Not bookable online — please call us";
      else if (!free.length) availEl.textContent = "Fully booked for these dates";
      else availEl.textContent = free.length === 1 ? "1 casita left for these dates" : free.length + " available for these dates";
      card.classList.toggle("is-full", datesReady() && !free.length);
      card.classList.toggle("is-picked", counts[t] > 0);
      card.querySelector(".st-count").textContent = counts[t];
      card.querySelector(".st-minus").disabled = counts[t] <= 0;
      card.querySelector(".st-plus").disabled = !datesReady() || counts[t] >= free.length;
    });
    var picked = pickedVillas();
    pickedNote.hidden = !picked.length;
    if (picked.length) {
      pickedNote.innerHTML = "<strong>Holding:</strong> " + picked.map(function (v) { return esc(v.room_type_name) + " (" + esc(v.unit_label) + ")"; }).join(", ") +
        '<br><span class="muted" style="font-size:0.8rem;">Unit numbers are a preference — the resort may move you to an identical casita if needed, and will always let you know.</span>';
    }
  }

  function loadVillas() {
    if (!sb) {
      availStatus.textContent = "Online booking isn't available right now — please call or email us to book.";
      return Promise.resolve();
    }
    return sb.from("villas").select("id,unit_label,room_type,room_type_name,base_occupancy,max_extra,sort").eq("active", true).order("sort")
      .then(function (res) {
        if (res.error) throw res.error;
        villas = res.data || [];
        renderTypes();
      })
      .catch(function () {
        availStatus.textContent = "We couldn't load our casitas just now — please refresh, or call us to book.";
      });
  }

  var availSeq = 0;
  function loadAvailability() {
    if (!sb || !datesReady()) { heldIds = new Set(); renderTypes(); renderCapacity(); requestQuote(); return Promise.resolve(); }
    var seq = ++availSeq;
    availStatus.textContent = "Checking availability…";
    return sb.from("public_villa_holds").select("villa_id")
      .lt("check_in", checkOutEl.value).gt("check_out", checkInEl.value)
      .then(function (res) {
        if (seq !== availSeq) return;
        if (res.error) throw res.error;
        heldIds = new Set((res.data || []).map(function (h) { return h.villa_id; }));
        var free = villas.filter(function (v) { return !heldIds.has(v.id); }).length;
        availStatus.textContent = free
          ? free + " of " + villas.length + " casitas are free for " + nights() + " night" + (nights() === 1 ? "" : "s") + " from " + fmtDay(checkInEl.value) + "."
          : "Sorry — every casita is booked for these dates. Try other dates, or call us to join the waitlist.";
        // keep the guest's picks where still possible
        Object.keys(counts).forEach(function (t) { counts[t] = Math.min(counts[t], freeUnitsOfType(t).length); });
        var pre = params.get("casita");
        if (pre && counts[pre] === 0 && pickedVillas().length === 0 && freeUnitsOfType(pre).length) counts[pre] = 1;
        renderTypes();
        renderCapacity();
        requestQuote();
      })
      .catch(function () {
        if (seq !== availSeq) return;
        availStatus.textContent = "Couldn't check availability just now — please try again in a moment.";
      });
  }

  // ---------------------------------------------------------------- guests
  function partySize() { return companions.length + 1; }

  function renderGuests() {
    partySizeEl.textContent = partySize();
    $("partyMinus").disabled = partySize() <= 1;
    $("partyPlus").disabled = partySize() >= MAX_PARTY;
    guestList.innerHTML = "";
    var primary = document.createElement("div");
    primary.className = "guest-row is-primary";
    primary.innerHTML = '<span class="gr-num">1</span><div class="gr-primary-name" id="primaryEcho"></div><div class="gr-primary-name">' +
      (primarySeniorEl.checked ? "Senior Citizen / PWD" : "Adult (13+)") + "</div>";
    guestList.appendChild(primary);
    updatePrimaryEcho();
    if (!companions.length) {
      var solo = document.createElement("p");
      solo.className = "field-hint";
      solo.style.margin = "4px 0 0";
      solo.textContent = "Just you — use + above to add the people staying with you.";
      guestList.appendChild(solo);
    }
    companions.forEach(function (c, i) {
      var row = document.createElement("div");
      row.className = "guest-row";
      var opts = AGE_GROUPS.map(function (g) {
        return '<option value="' + g[0] + '"' + (g[0] === c.age ? " selected" : "") + (g[0] === "" ? " disabled" : "") + ">" + g[1] + "</option>";
      }).join("");
      row.innerHTML = '<span class="gr-num">' + (i + 2) + '</span>' +
        '<input type="text" class="gr-name" autocomplete="off" placeholder="Guest ' + (i + 2) + ' — full name" aria-label="Guest ' + (i + 2) + ' full name" value="' + esc(c.name) + '">' +
        '<select class="gr-age" aria-label="Guest ' + (i + 2) + ' age group">' + opts + "</select>";
      row.querySelector(".gr-name").addEventListener("input", function (e) { c.name = e.target.value; row.classList.remove("is-invalid"); });
      row.querySelector(".gr-age").addEventListener("change", function (e) { c.age = e.target.value; row.classList.remove("is-invalid"); onPartyChanged(); });
      guestList.appendChild(row);
    });
  }
  function updatePrimaryEcho() {
    var el = $("primaryEcho");
    if (el) el.textContent = $("guestName").value.trim() || "You (primary guest)";
  }
  $("guestName").addEventListener("input", updatePrimaryEcho);
  $("partyMinus").addEventListener("click", function () { if (companions.length) { companions.pop(); renderGuests(); onPartyChanged(); } });
  $("partyPlus").addEventListener("click", function () {
    if (partySize() >= MAX_PARTY) return;
    companions.push({ name: "", age: "adult" });
    renderGuests();
    onPartyChanged();
    var inputs = guestList.querySelectorAll(".gr-name");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  primarySeniorEl.addEventListener("change", function () { renderGuests(); onPartyChanged(); });

  function party() {
    var p = { adults: 1, seniors: primarySeniorEl.checked ? 1 : 0, kids612: 0, kids05: 0 };
    companions.forEach(function (c) {
      if (c.age === "senior") { p.adults++; p.seniors++; }
      else if (c.age === "child_6_12") p.kids612++;
      else if (c.age === "child_0_5") p.kids05++;
      else p.adults++;
    });
    p.total = p.adults + p.kids612 + p.kids05;
    return p;
  }

  function onPartyChanged() {
    var p = party();
    seniorIdWrap.hidden = p.seniors === 0;
    renderCapacity();
    requestQuote();
  }

  function capacity() {
    var picked = pickedVillas();
    return picked.reduce(function (a, v) { a.base += v.base_occupancy; a.max += v.base_occupancy + v.max_extra; return a; }, { base: 0, max: 0, n: picked.length });
  }
  function renderCapacity() {
    var cap = capacity(), p = party();
    if (!cap.n) { capacityMeter.hidden = true; return; }
    capacityMeter.hidden = false;
    capacityMeter.className = "capacity-meter";
    if (p.total > cap.max) {
      capacityMeter.classList.add("is-over");
      capacityMeter.textContent = "Your " + p.total + " guests won't fit — the casita" + (cap.n === 1 ? "" : "s") + " you picked sleep" + (cap.n === 1 ? "s" : "") +
        " up to " + cap.max + " (with extra mattresses). Please add another casita in step 2.";
    } else if (p.total > cap.base) {
      capacityMeter.classList.add("is-ok");
      var extra = p.total - cap.base;
      capacityMeter.textContent = p.total + " guests — " + extra + " on an extra floor mattress (₱1,500 per night each). Every guest counts toward room capacity, whatever their age.";
    } else {
      capacityMeter.classList.add("is-ok");
      capacityMeter.textContent = p.total + " guest" + (p.total === 1 ? "" : "s") + " · your casita" + (cap.n === 1 ? "" : "s") + " sleep" + (cap.n === 1 ? "s" : "") + " " + cap.base + ".";
    }
  }

  // ---------------------------------------------------------------- pets
  function refreshPets() {
    var n = parseInt(petCountEl.value || "0", 10) || 0;
    if (n > 2) { n = 2; petCountEl.value = 2; }
    if (n < 0) { n = 0; petCountEl.value = 0; }
    petWrap.hidden = n === 0;
    requestQuote();
  }
  petCountEl.addEventListener("input", refreshPets);
  petCountEl.addEventListener("change", refreshPets);
  function pets() { return Math.min(2, Math.max(0, parseInt(petCountEl.value || "0", 10) || 0)); }

  // ---------------------------------------------------------------- bill
  var quoteTimer = null;
  function requestQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(fetchQuote, 220);
  }
  function fetchQuote() {
    var picked = pickedVillas();
    if (!sb || !datesReady() || !picked.length) {
      lastQuote = null;
      billEl.innerHTML = '<div class="bill-lines"><div class="bill-row"><span>' +
        (!datesReady() ? "Choose your dates to see your total" : "Choose at least one casita to see your total") + "</span><span>—</span></div></div>";
      return;
    }
    var p = party(), seq = ++quoteSeq;
    sb.rpc("quote_overnight", {
      p_check_in: checkInEl.value, p_check_out: checkOutEl.value, p_villa_ids: picked.map(function (v) { return v.id; }),
      p_adults: p.adults, p_seniors: p.seniors, p_kids612: p.kids612, p_kids05: p.kids05, p_pets: pets(),
    }).then(function (res) {
      if (seq !== quoteSeq) return;
      if (res.error) throw res.error;
      lastQuote = res.data;
      renderBill(res.data);
    }).catch(function () {
      if (seq !== quoteSeq) return;
      billEl.innerHTML = '<div class="bill-lines"><div class="bill-row"><span>Couldn\'t calculate the total just now — it will be in your quotation email.</span><span>—</span></div></div>';
    });
  }

  function renderBill(q) {
    var rows = (q.lines || []).map(function (l) {
      var qty = Number(l.qty) || 0;
      var label = esc(l.desc);
      if (l.kind !== "senior_room") label += ' <span class="muted">' + (Number(l.rate) ? "× " + qty + " @ " + peso(l.rate) : "× " + qty) + "</span>";
      var amt = Number(l.amount) === 0 ? "Free" : peso(l.amount);
      return '<div class="bill-row' + (Number(l.amount) < 0 ? " is-discount" : "") + '"><span>' + label + "</span><span>" + amt + "</span></div>";
    }).join("");
    var nightsTxt = q.nights + " night" + (q.nights === 1 ? "" : "s") +
      (q.weekend_nights ? " (" + q.weekday_nights + " weekday, " + q.weekend_nights + " weekend/peak)" : "");
    billEl.innerHTML =
      '<div class="bill-lines">' + rows + "</div>" +
      (q.error ? '<p class="bill-warning">' + esc(q.error) + "</p>" : "") +
      '<div class="bill-total"><span>Total</span><span>' + peso(q.total) + "</span></div>" +
      '<p class="bill-sub">' + esc(nightsTxt) + " · " + q.guests + " guest" + (q.guests === 1 ? "" : "s") + " · full-board meals included. Payable in full to confirm.</p>";
  }

  // ---------------------------------------------------------------- submit
  function showError(msg, focusEl) {
    formError.innerHTML = msg;
    formError.hidden = false;
    if (focusEl && focusEl.focus) focusEl.focus();
    formError.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function validate() {
    if (!datesReady()) return ["Please choose your check-in and check-out dates.", checkInEl];
    if (!pickedVillas().length) return ["Please choose at least one casita (step 2).", document.querySelector(".st-plus:not(:disabled)")];
    var name = $("guestName").value.trim();
    if (!/\S+\s+\S+/.test(name)) return ["Please enter your full name (first and last).", $("guestName")];
    if (!$("guestPhone").value.trim()) return ["Please enter your mobile number.", $("guestPhone")];
    if (!EMAIL_RE.test($("guestEmail").value.trim())) return ["Please enter a valid email address — your quotation is sent there.", $("guestEmail")];
    var rows = guestList.querySelectorAll(".guest-row:not(.is-primary)");
    var bad = null;
    companions.forEach(function (c, i) {
      var ok = /\S+\s+\S+/.test(c.name.trim()) && !!c.age;
      rows[i].classList.toggle("is-invalid", !ok);
      if (!ok && !bad) bad = rows[i];
    });
    if (bad) return ["Please enter the full name (first and last) and age group of every guest — meals are prepared and charged per person.", bad.querySelector(c0(bad))];
    var cap = capacity(), p = party();
    if (p.total > cap.max) return ["Your group is bigger than the casita(s) you picked can take — please add another casita.", document.querySelector(".st-plus:not(:disabled)")];
    if (p.seniors > 0 && !(seniorIdFilesEl.files && seniorIdFilesEl.files.length)) return ["Please attach a photo of the Senior Citizen / PWD ID(s) for the 20% discount.", seniorIdFilesEl];
    if (pets() > 0) {
      if (!(petVaxFilesEl.files && petVaxFilesEl.files.length)) return ["Please attach your pet's vaccination card.", petVaxFilesEl];
      if (!petAgreeEl.checked) return ["Please read and agree to the Pet Policy.", petAgreeEl];
    }
    if (!$("agreeTerms").checked) return ["Please confirm the meal package and Reservations Agreement.", $("agreeTerms")];
    return null;
  }
  function c0(row) { return row.querySelector(".gr-name").value.trim().split(/\s+/).length < 2 ? ".gr-name" : ".gr-age"; }

  function upload(bucket, files) {
    if (!files || !files.length) return Promise.resolve([]);
    return Promise.all(Array.prototype.map.call(files, function (file, i) {
      var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      var path = "guest/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "-" + i + "." + ext;
      return sb.storage.from(bucket).upload(path, file, { contentType: file.type || "image/jpeg" }).then(function (res) {
        if (res.error) throw res.error;
        return path;
      });
    }));
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    formError.hidden = true;
    if (!sb) return showError("Online booking isn't available right now — please email reservations@virginbeachresort.com.");
    var problem = validate();
    if (problem) return showError(esc(problem[0]), problem[1]);

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    var picked = pickedVillas();
    var p = party();
    var payload = {
      check_in: checkInEl.value,
      check_out: checkOutEl.value,
      guest_name: $("guestName").value.trim().replace(/\s+/g, " "),
      guest_email: $("guestEmail").value.trim(),
      guest_phone: $("guestPhone").value.trim(),
      country: $("country").value || null,
      primary_is_senior: primarySeniorEl.checked,
      companions: companions.map(function (c) { return { name: c.name.trim().replace(/\s+/g, " "), age_group: c.age }; }),
      pet_count: pets(),
      pet_policy_agreed: pets() > 0 && petAgreeEl.checked,
      how_heard: $("hearAbout").value || null,
      occasion: $("occasion").value || null,
      notes: $("notes").value.trim() || null,
      marketing_opt_in: $("marketingOptIn").checked,
    };
    Promise.all([
      p.seniors > 0 ? upload("senior-ids", seniorIdFilesEl.files) : Promise.resolve([]),
      pets() > 0 ? upload("pet-vaccinations", petVaxFilesEl.files) : Promise.resolve([]),
    ]).then(function (paths) {
      if (paths[0].length) payload.senior_id_paths = paths[0];
      if (paths[1].length) payload.pet_vaccination_paths = paths[1];
      return sb.rpc("submit_overnight_booking", { payload: payload, villa_ids: picked.map(function (v) { return v.id; }) });
    }).then(function (res) {
      if (res.error) throw res.error;
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      showSuccess(payload, row, picked);
    }).catch(function (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Request Booking";
      var msg = err && err.message ? err.message : "";
      if (/just booked|already booked/i.test(msg)) {
        loadAvailability();
        return showError(esc(msg));
      }
      showError(msg && msg.length < 220 && !/fetch|network|JWT|permission|violates/i.test(msg)
        ? esc(msg)
        : 'Something went wrong sending your request. Please try again, or email <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.');
    });
  });

  function showSuccess(payload, row, picked) {
    $("stayFormWrap").hidden = true;
    var st = $("stayStatus");
    st.hidden = false;
    st.className = "form-status form-status-success";
    var first = esc(payload.guest_name.split(" ")[0]);
    st.innerHTML = "<h3>Request received — thank you, " + first + "!</h3>" +
      "<p>Your Order ID is <strong>" + esc(row && row.order_code || "—") + "</strong>" + (row && row.total != null ? " · Total <strong>" + peso(row.total) + "</strong>" : "") + ".</p>" +
      "<p>We're holding " + esc(picked.map(function (v) { return v.room_type_name + " (" + v.unit_label + ")"; }).join(", ")) +
      " for " + fmtDay(payload.check_in) + " → " + fmtDay(payload.check_out) + ". Your quotation, bank details and next steps are on their way to <strong>" + esc(payload.guest_email) +
      "</strong> — full payment within 24 hours confirms the booking.</p>" +
      "<p>Can't find the email? Check Spam or Promotions, or call us at +63 917 792 0712.</p>" +
      '<p><a class="btn btn-ghost" href="../pay/index.html?order=' + encodeURIComponent(row && row.order_code || "") + "&email=" + encodeURIComponent(payload.guest_email) + '">Upload payment proof</a></p>';
    window.scrollTo({ top: st.getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
  }

  // ---------------------------------------------------------------- start
  var qIn = params.get("in"), qOut = params.get("out");
  if (qIn && qIn >= todayManila()) checkInEl.value = qIn;
  if (qOut && checkInEl.value && qOut > checkInEl.value) checkOutEl.value = qOut;
  var pre = params.get("casita");
  if (pre && typeCards[pre]) typeCards[pre].classList.add("is-picked");
  renderGuests();
  onPartyChanged();
  loadVillas().then(onDates);
})();
