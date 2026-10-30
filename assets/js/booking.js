(function () {
  var form = document.getElementById("bookingForm");
  if (!form) return;

  // This form handles Day Trip / Corporate requests only. Overnight casita
  // reservations go straight to Cloudbeds (see the
  // "Book an Overnight Stay" link on this page and the site's Book Now
  // buttons) — they never reach this script.

  var cfg = window.SUPABASE_CONFIG || {};
  var fallbackEmail = cfg.fallbackEmail || "reservations@virginbeachresort.com";
  var params = new URLSearchParams(location.search);
  var isConnected = cfg.url && cfg.url.indexOf("YOUR-PROJECT-REF") === -1;
  var sb = isConnected && window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

  // Pricing per package. Day Trip / Half-Day / Flash Sale are priced per
  // person plus whichever cabana(s) the guest picks off the live map. All
  // Inclusive (Family / Barkada) is a flat voucher-style package that
  // already includes a set number of guests and one cabana — extra guests,
  // pets, or cabanas beyond that are billed at the package's own add-on
  // rates. Every rate below matches the resort's 2026 Rate Sheet.
  // Rates and the bill calculation live in pricing.js (shared with the
  // staff dashboard so staff-made bookings are priced the same way).
  var P = window.VBRPricing;

  var stayTypeEl = form.querySelector("#stayType");
  var checkInEl = form.querySelector("#checkIn");
  var checkInLabel = form.querySelector("#checkInLabel");
  var adultsEl = form.querySelector("#adults");
  var kids612El = form.querySelector("#kids612");
  var kids05El = form.querySelector("#kids05");
  var seniorCountEl = form.querySelector("#seniorCount");
  var petCountEl = form.querySelector("#petCount");
  var seniorIdWrap = document.getElementById("seniorIdWrap");
  var seniorIdFilesEl = document.getElementById("seniorIdFiles");
  var seniorIdError = document.getElementById("seniorIdError");
  var petWrap = document.getElementById("petWrap");
  var petVaxFilesEl = document.getElementById("petVaxFiles");
  var petPolicyAgreeEl = document.getElementById("petPolicyAgree");
  var petError = document.getElementById("petError");
  var MAX_PETS = 2;
  var packageNoteEl = document.getElementById("packageNote");
  var billSummaryEl = document.getElementById("billSummary");
  var submitBtn = form.querySelector("#submitBtn");
  var statusEl = document.getElementById("bookingStatus");
  var formWrap = document.getElementById("bookingFormWrap");

  var cabanaStep = document.getElementById("cabanaStep");
  var cabanaStatus = document.getElementById("cabanaMapStatus");

  var TYPE_NAMES = {
    day_trip: "Day Trip (Full Day)",
    half_day: "Half-Day Trip",
    corporate: "Corporate Outing",
  };

  // Corporate groups are coordinated (and quoted) directly by the team — no
  // cabana picker or automatic pricing for those.
  function usesCabanaMap() {
    return stayTypeEl.value !== "corporate";
  }

  function peso(n) {
    n = Number(n) || 0;
    return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---------- cabanas by count (booking-v29) ----------
  // Guests choose HOW MANY dining / lounge cabanas; our team assigns the
  // numbers later. Availability = cabanas still free that day.
  var counts = { dining: 0, lounge: 0 };
  var left = null;            // { dining, lounge } for the chosen date, or null
  var availSeq = 0;
  var cabanaCards = {};
  Array.prototype.forEach.call(document.querySelectorAll(".cab-type"), function (card) {
    var k = card.getAttribute("data-kind");
    cabanaCards[k] = card;
    card.querySelector(".st-minus").addEventListener("click", function () { setCount(k, counts[k] - 1); });
    card.querySelector(".st-plus").addEventListener("click", function () { setCount(k, counts[k] + 1); });
  });
  function maxFor(k) { return left ? left[k] : 20; }
  function setCount(k, n) {
    counts[k] = Math.max(0, Math.min(n, maxFor(k), 20));
    renderCabanaCards();
    renderBill();
  }
  function renderCabanaCards() {
    var rate = (P.PRICING[stayTypeEl.value] || P.PRICING.day_trip);
    Object.keys(cabanaCards).forEach(function (k) {
      var card = cabanaCards[k];
      card.querySelector(".cab-price").textContent = peso(rate[k]).replace(/\.00$/, "");
      card.querySelector(".st-count").textContent = counts[k];
      card.querySelector(".st-minus").disabled = counts[k] <= 0;
      card.querySelector(".st-plus").disabled = counts[k] >= maxFor(k);
      card.classList.toggle("is-picked", counts[k] > 0);
      var full = !!left && left[k] <= 0;
      card.classList.toggle("is-full", full);
      card.querySelector(".vt-avail").textContent = !checkInEl.value ? "Pick a date to check availability"
        : !left ? "Checking availability…"
        : full ? "Fully booked on this date — try another date"
        : left[k] + " available on this date";
    });
  }
  function loadAvailability() {
    var dateStr = checkInEl.value, seq = ++availSeq;
    left = null;
    renderCabanaCards();
    if (!dateStr) return;
    if (!sb) { cabanaStatus.hidden = false; cabanaStatus.textContent = "Live availability isn't connected yet — we'll confirm your cabanas by hand."; return; }
    sb.rpc("daytrip_availability", { p_from: dateStr, p_to: dateStr }).then(function (res) {
      if (seq !== availSeq) return;
      var row = !res.error && res.data && res.data[0];
      if (!row) {
        cabanaStatus.hidden = false;
        cabanaStatus.textContent = "Couldn't check live availability just now — pick what you need and we'll confirm it.";
        left = { dining: 20, lounge: 20 };
      } else {
        cabanaStatus.hidden = true;
        left = { dining: row.dining_left, lounge: row.lounge_left };
      }
      var trimmed = false;
      ["dining", "lounge"].forEach(function (k) { if (counts[k] > left[k]) { counts[k] = left[k]; trimmed = true; } });
      if (trimmed) { cabanaStatus.hidden = false; cabanaStatus.textContent = "Fewer cabanas are free on this date — we've adjusted your choice."; }
      renderCabanaCards();
      renderBill();
    });
  }

  function refreshCabanaStep() {
    if (!usesCabanaMap()) {
      cabanaStep.hidden = true;
      counts.dining = counts.lounge = 0;
      renderBill();
      return;
    }
    cabanaStep.hidden = false;
    loadAvailability();
    renderBill();
  }

  // ---------- discount code (booking-v28) ----------
  // The server checks the code (quote_daytrip_code) and works out the peso
  // discount from the cabana rental or the whole day trip; it's re-checked
  // when the booking is sent (submit_daytrip_booking).
  var codeRow = document.getElementById("dtCodeRow");
  var codeEl = document.getElementById("dtCode");
  var codeMsg = document.getElementById("dtCodeMsg");
  var appliedCode = "", codeResult = null, codeSeq = 0, codeTimer = null;
  function showCodeMsg(ok, text) {
    if (!codeMsg) return;
    codeMsg.hidden = !text;
    codeMsg.className = "code-msg " + (ok ? "is-ok" : "is-bad");
    codeMsg.textContent = text || "";
  }
  function checkCode() {
    if (!appliedCode) { codeResult = null; showCodeMsg(true, ""); renderBill(true); return; }
    if (!sb) { showCodeMsg(false, "Codes can't be checked right now — mention it in the notes and we'll apply it."); return; }
    var bill = computeBill(), seq = ++codeSeq;
    sb.rpc("quote_daytrip_code", {
      p_code: appliedCode, p_check_in: checkInEl.value || null,
      p_cabana_total: bill.isPackage ? bill.extraCabanaCost : bill.cabanaTotal, p_total: bill.total,
    }).then(function (res) {
      if (seq !== codeSeq) return;
      var r = res.error ? { ok: false, error: /quote_daytrip_code/.test(res.error.message) ? "Discount codes aren't available for day trips yet." : res.error.message } : res.data;
      codeResult = r && r.ok ? r : null;
      showCodeMsg(!!codeResult, codeResult ? "Code " + r.code + " applied — you save " + peso(r.discount) + "." : (r && r.error) || "That discount code isn't valid.");
      renderBill(true);
    });
  }
  function recheckCode() { if (!appliedCode) return; clearTimeout(codeTimer); codeTimer = setTimeout(checkCode, 350); }
  if (codeEl) {
    document.getElementById("dtCodeApply").addEventListener("click", function () {
      appliedCode = (codeEl.value || "").trim().toUpperCase().replace(/\s+/g, "");
      codeEl.value = appliedCode;
      checkCode();
    });
    codeEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); document.getElementById("dtCodeApply").click(); } });
    codeEl.addEventListener("input", function () { if (!codeEl.value.trim() && appliedCode) { appliedCode = ""; checkCode(); } });
  }

  // ---------- live bill ----------
  function computeBill() {
    var adults = parseInt(adultsEl.value || "0", 10) || 0;
    var seniorsRaw = parseInt((seniorCountEl && seniorCountEl.value) || "0", 10) || 0;
    var seniors = Math.max(0, Math.min(seniorsRaw, adults));
    if (seniorCountEl && seniors !== seniorsRaw) seniorCountEl.value = seniors;
    return P.compute({
      type: stayTypeEl.value,
      adults: adults,
      kids612: kids612El.value,
      kids05: kids05El.value,
      seniors: seniors,
      pets: petCountEl && petCountEl.value,
      dining: usesCabanaMap() ? counts.dining : 0,
      lounge: usesCabanaMap() ? counts.lounge : 0,
    });
  }

  function renderPackageNote(bill) {
    if (!packageNoteEl) return;
    if (!bill.isPackage) {
      packageNoteEl.hidden = true;
      return;
    }
    packageNoteEl.hidden = false;
    packageNoteEl.innerHTML =
      "This package is a flat " + peso(bill.base) + " covering up to " + bill.includedPax +
      " guests and " + bill.includedCabanas + " cabana. Extra guests, pets, and cabanas beyond that are billed at the add-on rates below.";
  }

  function renderBill(fromCode) {
    if (!billSummaryEl) return;
    if (fromCode !== true) recheckCode();
    var bill = computeBill();
    if (codeRow) codeRow.hidden = !usesCabanaMap();
    renderPackageNote(bill);

    if (seniorIdWrap) seniorIdWrap.hidden = bill.seniors <= 0;
    if (seniorIdFilesEl) seniorIdFilesEl.required = bill.seniors > 0;
    if (bill.seniors <= 0 && seniorIdError) seniorIdError.hidden = true;

    if (!usesCabanaMap()) {
      billSummaryEl.hidden = true;
      return;
    }
    billSummaryEl.hidden = false;

    var lines = [];

    if (bill.isPackage) {
      lines.push('<div class="bill-row"><span>Package (up to ' + bill.includedPax + ' guests, ' + bill.includedCabanas + ' cabana)</span><span>' + peso(bill.base) + "</span></div>");
      if (bill.extraPax > 0) {
        lines.push('<div class="bill-row"><span>' + bill.extraPax + " extra guest" + (bill.extraPax === 1 ? "" : "s") + "</span><span>" + peso(bill.extraPaxCost) + "</span></div>");
      }
      if (bill.pets > 0) {
        lines.push('<div class="bill-row"><span>' + bill.pets + " pet" + (bill.pets === 1 ? "" : "s") + "</span><span>" + peso(bill.extraPetCost) + "</span></div>");
      }
      if (bill.extraCabanas > 0) {
        lines.push('<div class="bill-row"><span>' + bill.extraCabanas + " extra cabana" + (bill.extraCabanas === 1 ? "" : "s") + "</span><span>" + peso(bill.extraCabanaCost) + "</span></div>");
      }
    } else {
      if (bill.regularAdults > 0) {
        lines.push(
          '<div class="bill-row"><span>' + bill.regularAdults + " adult" + (bill.regularAdults === 1 ? "" : "s") +
          " × " + peso(bill.rate.adult) + "</span><span>" + peso(bill.regularAdults * bill.rate.adult) + "</span></div>"
        );
      }
      if (bill.seniors > 0) {
        lines.push(
          '<div class="bill-row"><span>' + bill.seniors + " senior citizen" + (bill.seniors === 1 ? "" : "s") +
          " × " + peso(bill.seniorRate) + " <em>(20% off)</em></span><span>" + peso(bill.seniors * bill.seniorRate) + "</span></div>"
        );
      }
      if (bill.kids612 > 0) {
        lines.push(
          '<div class="bill-row"><span>' + bill.kids612 + " child" + (bill.kids612 === 1 ? "" : "ren") +
          " (6–12) × " + peso(bill.rate.child612) + "</span><span>" + peso(bill.kids612 * bill.rate.child612) + "</span></div>"
        );
      }
      if (bill.kids05 > 0) {
        lines.push('<div class="bill-row"><span>' + bill.kids05 + " child" + (bill.kids05 === 1 ? "" : "ren") + " (0–5)</span><span>Free</span></div>");
      }
      if (bill.pets > 0) {
        lines.push('<div class="bill-row"><span>' + bill.pets + " pet" + (bill.pets === 1 ? "" : "s") + " × " + peso(bill.rate.pet) + "</span><span>" + peso(bill.petCost) + "</span></div>");
      }
    }
    if (!bill.isPackage) {
      bill.cabanaLines.forEach(function (l) {
        lines.push('<div class="bill-row"><span>' + l.qty + " × " + l.label + (l.qty === 1 ? "" : "s") + " @ " + peso(l.rate) + "</span><span>" + peso(l.amount) + "</span></div>");
      });
    }

    var warning = "";
    if (bill.cabanaCount && bill.totalCapacity < bill.totalGuests) {
      warning =
        '<p class="bill-warning">Heads up — ' + (bill.cabanaCount === 1 ? "that cabana seats" : "those cabanas seat") +
        " up to " + bill.totalCapacity + ", and your party is " + bill.totalGuests +
        ". Feel free to add another cabana above, or we can help sort seating when we confirm.</p>";
    }

    var codeDisc = codeResult ? Math.min(Number(codeResult.discount) || 0, bill.total) : 0;
    if (codeDisc > 0) lines.push('<div class="bill-row is-discount"><span>' + codeResult.desc.replace(/[<>&]/g, "") + "</span><span>−" + peso(codeDisc) + "</span></div>");
    billSummaryEl.innerHTML =
      '<div class="bill-lines">' + (lines.join("") || '<div class="bill-row"><span>Add your party size and cabana(s) above</span><span>—</span></div>') + "</div>" +
      warning +
      '<div class="bill-total"><span>Estimated Total</span><span>' + peso(bill.total - codeDisc) + "</span></div>" +
      '<p class="field-hint">This is an estimate for your reference — our team confirms the final amount when arranging payment.</p>';
  }

  [adultsEl, kids612El, kids05El, seniorCountEl, petCountEl].forEach(function (el) {
    if (el) el.addEventListener("input", renderBill);
  });
  function refreshPets() {
    if (!petCountEl || !petWrap) return;
    var n = parseInt(petCountEl.value || "0", 10) || 0;
    if (n > MAX_PETS) { petCountEl.value = MAX_PETS; n = MAX_PETS; }
    if (n < 0) { petCountEl.value = 0; n = 0; }
    petWrap.hidden = n === 0;
  }
  if (petCountEl) {
    petCountEl.addEventListener("input", refreshPets);
    petCountEl.addEventListener("change", function () { refreshPets(); renderBill(); });
  }
  refreshPets();

  // ---------- Half-Day = same-day walk-ins only ----------
  // The guest picks the date FIRST. The "Full Day or Half Day?" question only
  // appears when that date is TODAY (Philippine time); for any other date the
  // booking is a full Day Trip and the Half-Day option isn't in the list at
  // all (removed from the DOM — some browsers, e.g. Safari, ignore "hidden"
  // on <option>). The server enforces the same rule.
  function todayManila() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  }
  var stayTypeField = document.getElementById("stayTypeField");
  var halfDayOpt = stayTypeEl.querySelector('option[value="half_day"]');
  var halfDayNote = document.createElement("p");
  halfDayNote.className = "field-hint";
  halfDayNote.textContent = "Visiting today? Same-day walk-ins can choose a Half-Day Trip (1:00 PM – 5:00 PM), afternoon snacks included.";
  if (stayTypeField) stayTypeField.appendChild(halfDayNote);
  function refreshHalfDay() {
    if (!halfDayOpt) return;
    var isToday = !!checkInEl.value && checkInEl.value === todayManila();
    if (isToday) {
      if (!halfDayOpt.parentNode) stayTypeEl.appendChild(halfDayOpt);
    } else {
      if (stayTypeEl.value === "half_day") stayTypeEl.value = "day_trip";
      if (halfDayOpt.parentNode) halfDayOpt.parentNode.removeChild(halfDayOpt);
    }
    if (stayTypeField) stayTypeField.hidden = !isToday;
  }
  checkInEl.min = todayManila();

  // Pre-fill from query string, e.g. book/index.html?type=half_day (only
  // honoured for today's date — see refreshHalfDay).
  var qType = params.get("type");
  if (qType === "half_day") checkInEl.value = todayManila();
  // From the home page booking box: ?date=YYYY-MM-DD&adults=2&kids=1
  var qDate = params.get("date");
  if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate) && qDate >= todayManila() && qType !== "half_day") checkInEl.value = qDate;
  var qAdults = parseInt(params.get("adults") || "", 10), qKids = parseInt(params.get("kids") || "", 10);
  if (qAdults >= 1 && qAdults <= 200) adultsEl.value = qAdults;
  if (qKids >= 0 && qKids <= 200) kids612El.value = qKids;
  if (qAdults || qKids) { try { renderBill(); } catch (e) {} }
  checkInLabel.textContent = "Preferred Date";
  refreshHalfDay();
  if (qType === "half_day" && halfDayOpt && halfDayOpt.parentNode) stayTypeEl.value = "half_day";

  stayTypeEl.addEventListener("change", refreshCabanaStep);
  checkInEl.addEventListener("change", function () {
    refreshHalfDay();
    refreshCabanaStep();
  });
  refreshCabanaStep();

  function buildPayload(bill) {
    var type = stayTypeEl.value;
    return {
      status: "pending",
      source: "website",
      stay_type: type,
      stay_type_label: TYPE_NAMES[type] || type,
      check_in: checkInEl.value || null,
      adults: bill.adults,
      children_6_12: bill.kids612,
      children_0_5: bill.kids05,
      guest_name: form.querySelector("#guestName").value,
      guest_names: form.querySelector("#guestNames").value || null,
      guest_email: form.querySelector("#guestEmail").value,
      guest_phone: form.querySelector("#guestPhone").value,
      country: form.querySelector("#country").value || null,
      how_heard: form.querySelector("#hearAbout").value || null,
      occasion: form.querySelector("#occasion").value || null,
      marketing_opt_in: !!form.querySelector("#marketingOptIn").checked,
      notes: form.querySelector("#notes").value || null,
      senior_count: bill.seniors,
      pet_count: bill.pets,
      subtotal_people: usesCabanaMap() ? bill.subtotalPeople : null,
      cabana_total: usesCabanaMap() ? (bill.isPackage ? bill.extraCabanaCost : bill.cabanaTotal) : null,
      senior_discount: usesCabanaMap() ? bill.seniorDiscount : null,
      total_amount: usesCabanaMap() ? bill.total : null,
      discount_code: usesCabanaMap() && codeResult ? codeResult.code : null,
      dining_cabanas: usesCabanaMap() ? bill.dining : 0,
      lounge_cabanas: usesCabanaMap() ? bill.lounge : 0,
    };
  }

  function mailtoLink(payload, bill) {
    var subject = "Booking Request — " + (payload.stay_type_label || payload.stay_type) + " — " + payload.guest_name;
    var lines = [
      "New booking request from the website (booking isn't connected to the database yet):",
      "",
      "Type: " + (payload.stay_type_label || payload.stay_type),
      "Preferred Date: " + (payload.check_in || "—"),
      "Cabanas: " + ((payload.dining_cabanas || 0) + " dining, " + (payload.lounge_cabanas || 0) + " lounge"),
      "Adults: " + payload.adults + (payload.senior_count ? " (incl. " + payload.senior_count + " senior citizen" + (payload.senior_count === 1 ? "" : "s") + ")" : ""),
      "Children (6–12): " + payload.children_6_12,
      "Children (0–5): " + payload.children_0_5,
      "Pets: " + (payload.pet_count || 0),
      "Guest Names: " + (payload.guest_names || "—"),
      "Estimated Total: " + (bill && usesCabanaMap() ? peso(bill.total) : "—"),
      "",
      "Guest: " + payload.guest_name,
      "Email: " + payload.guest_email,
      "Phone: " + payload.guest_phone,
      "Country: " + (payload.country || "—"),
      "",
      "Notes: " + (payload.notes || "—"),
    ];
    return (
      "mailto:" + fallbackEmail +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\n"))
    );
  }

  function showSuccess(payload, viaEmail, orderCode) {
    formWrap.hidden = true;
    statusEl.hidden = false;
    statusEl.className = "form-status form-status-success";
    var firstName = (payload.guest_name || "").split(" ")[0] || "there";
    var extra = viaEmail
      ? "<p>Your email app should have opened with the request pre-filled — just hit send.</p>"
      : "";
    var orderLine = orderCode
      ? "<p>Your Booking ID is <strong>" + orderCode + "</strong>" + (payload.total_amount ? " · Total <strong>" + peso(payload.total_amount) + "</strong>" : "") + ".</p>"
      : "";
    // Pay online right away (Xendit) when the booking has a price
    var canPay = !viaEmail && orderCode && payload.total_amount > 0 && window.VBRPay;
    var bal = new Date(payload.check_in + "T00:00:00Z"); bal.setUTCDate(bal.getUTCDate() - 15);
    var half = canPay && bal.toISOString().slice(0, 10) > todayManila();
    var body = viaEmail
      ? " — our reservations team will follow up with your quotation and payment details at " +
        payload.guest_email + " or " + payload.guest_phone + ".</p>"
      : canPay
        ? " — your cabana is on hold for <strong>24 hours</strong>. <strong>Pay online now to confirm it</strong> — by card, GCash, Maya and more, through our secure payment partner Xendit" +
          (half ? "; 50% secures it and the balance is due 15 days before your visit" : "") + ".</p>"
        : " — we've just emailed your request details to <strong>" + payload.guest_email +
          "</strong>. Our team will get back to you with your quotation and a payment link. " +
          "Can't find the email? Check your Spam or Promotions folder, or call us at +63 917 792 0712.</p>";
    var payRow = canPay
      ? '<div class="pay-now-row">' +
        (half ? '<button type="button" class="btn btn-primary" data-pay="deposit">Pay 50% now · ' + peso(Math.round(payload.total_amount * 50) / 100) + "</button>" : "") +
        '<button type="button" class="btn ' + (half ? "btn-ghost" : "btn-primary") + '" data-pay="full">Pay in full · ' + peso(payload.total_amount) + "</button>" +
        '</div><p class="pay-now-error" hidden></p>' +
        "<p>Your quotation is on its way to <strong>" + payload.guest_email + "</strong> with the same payment button. " +
        "Can't find it? Check Spam or Promotions, or call us at +63 917 792 0712.</p>"
      : "";
    statusEl.innerHTML = "<h3>Request received.</h3><p>Thank you, " + firstName + body + orderLine + payRow + extra;
    Array.prototype.forEach.call(statusEl.querySelectorAll("[data-pay]"), function (b) {
      b.addEventListener("click", function () {
        var err = statusEl.querySelector(".pay-now-error");
        err.hidden = true;
        window.VBRPay.start(sb, orderCode, payload.guest_email, b.getAttribute("data-pay"), b, function (m) {
          err.textContent = m; err.hidden = false;
        });
      });
    });
  }

  function showError(payload, bill) {
    statusEl.hidden = false;
    statusEl.className = "form-status form-status-error";
    statusEl.innerHTML =
      "Something went wrong sending your request. Please email us directly at " +
      '<a class="text-link" href="' + mailtoLink(payload, bill) + '">' + fallbackEmail + "</a>, " +
      "or try again.";
    submitBtn.disabled = false;
    submitBtn.textContent = "Send Request";
  }

  function uploadSeniorIds(files) {
    if (!sb || !files || !files.length) return Promise.resolve([]);
    var uploads = files.map(function (file, i) {
      var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      var path = "guest/" + Date.now() + "-" + i + "." + ext;
      return sb.storage.from("senior-ids").upload(path, file, { contentType: file.type || "image/jpeg" }).then(function (res) {
        if (res.error) throw res.error;
        return path;
      });
    });
    return Promise.all(uploads);
  }

  function uploadPetCards(files) {
    if (!sb || !files || !files.length) return Promise.resolve([]);
    return Promise.all(files.map(function (file, i) {
      var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      var path = "guest/" + Date.now() + "-" + i + "." + ext;
      return sb.storage.from("pet-vaccinations").upload(path, file, { contentType: file.type || "image/jpeg" }).then(function (res) {
        if (res.error) throw res.error;
        return path;
      });
    }));
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var bill = computeBill();

    if (bill.seniors > 0) {
      var files = seniorIdFilesEl && seniorIdFilesEl.files ? seniorIdFilesEl.files.length : 0;
      if (!files) {
        if (seniorIdError) seniorIdError.hidden = false;
        seniorIdFilesEl && seniorIdFilesEl.focus();
        return;
      }
    }
    if (seniorIdError) seniorIdError.hidden = true;

    if (bill.pets > 0) {
      var petFiles = petVaxFilesEl && petVaxFilesEl.files ? petVaxFilesEl.files.length : 0;
      var msg = null;
      if (bill.pets > MAX_PETS) msg = "A maximum of two pets are permitted per reservation.";
      else if (!petFiles) msg = "Please attach a photo of your pet's vaccination card" + (bill.pets > 1 ? "s" : "") + ".";
      else if (!petPolicyAgreeEl || !petPolicyAgreeEl.checked) msg = "Please read and agree to the Pet Policy.";
      if (msg) {
        if (petError) { petError.textContent = msg; petError.hidden = false; }
        (petFiles ? petPolicyAgreeEl : petVaxFilesEl).focus();
        return;
      }
    }
    if (petError) petError.hidden = true;

    var payload = buildPayload(bill);

    // Not connected yet — fall back straight to a pre-filled email so no
    // request is ever lost, and still show the guest a confirmation.
    if (!isConnected) {
      window.location.href = mailtoLink(payload, bill);
      showSuccess(payload, true, null);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    var seniorFiles = seniorIdFilesEl && seniorIdFilesEl.files ? Array.prototype.slice.call(seniorIdFilesEl.files) : [];

    var petCardFiles = bill.pets > 0 && petVaxFilesEl && petVaxFilesEl.files ? Array.prototype.slice.call(petVaxFilesEl.files) : [];

    Promise.all([uploadSeniorIds(seniorFiles), uploadPetCards(petCardFiles)])
      .then(function (all) {
        var paths = all[0], petPaths = all[1];
        payload.senior_id_paths = paths.length ? paths : null;
        payload.pet_vaccination_paths = petPaths.length ? petPaths : null;
        payload.pet_policy_agreed = bill.pets > 0 && !!(petPolicyAgreeEl && petPolicyAgreeEl.checked);
        // v29: always through submit_daytrip_booking (counts, availability, code)
        return sb.rpc("submit_daytrip_booking", { payload: payload, cabana_ids: null });
      })
      .then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data;
        var row = Array.isArray(rows) ? rows[0] : rows;
        showSuccess(payload, false, row && row.order_code);
      })
      .catch(function (err) {
        // Cabanas can sell out between loading the page and sending — say so
        // plainly and refresh availability instead of "something went wrong".
        var m = err && err.message ? String(err.message) : "";
        if (/cabanas? (is|are) left|Cabana not available/i.test(m)) {
          statusEl.hidden = false;
          statusEl.className = "form-status form-status-error";
          statusEl.textContent = m.replace(/^Cabana not available.*$/i, "Sorry — those cabanas are no longer available on that date. Please check the numbers above and send again.");
          submitBtn.disabled = false;
          submitBtn.textContent = "Send Request";
          refreshCabanaStep();
          return;
        }
        if (/discount code|code [A-Z0-9_-]+ |fully redeemed|once per guest|taking bookings up to/i.test(m)) {
          statusEl.hidden = false;
          statusEl.className = "form-status form-status-error";
          statusEl.textContent = m;
          submitBtn.disabled = false;
          submitBtn.textContent = "Send Request";
          if (/code/i.test(m)) { codeResult = null; showCodeMsg(false, m); renderBill(true); }
          return;
        }
        showError(payload, bill);
      });
  });

  renderBill();
})();
