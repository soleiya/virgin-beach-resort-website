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

  // Pricing — change these any time in Supabase (cabanas.price) for cabana
  // rentals; these three are the per-person rates, quoted by the resort.
  var ADULT_PRICE = 1250;
  var CHILD_612_PRICE = 825;
  var CHILD_05_PRICE = 0;
  var SENIOR_DISCOUNT_RATE = 0.2; // 20% off a senior's own per-person fee only

  var stayTypeEl = form.querySelector("#stayType");
  var checkInEl = form.querySelector("#checkIn");
  var checkInLabel = form.querySelector("#checkInLabel");
  var adultsEl = form.querySelector("#adults");
  var kids612El = form.querySelector("#kids612");
  var kids05El = form.querySelector("#kids05");
  var seniorCountEl = form.querySelector("#seniorCount");
  var seniorIdWrap = document.getElementById("seniorIdWrap");
  var seniorIdFilesEl = document.getElementById("seniorIdFiles");
  var seniorIdError = document.getElementById("seniorIdError");
  var billSummaryEl = document.getElementById("billSummary");
  var submitBtn = form.querySelector("#submitBtn");
  var statusEl = document.getElementById("bookingStatus");
  var formWrap = document.getElementById("bookingFormWrap");

  var cabanaStep = document.getElementById("cabanaStep");
  var cabanaMapStatus = document.getElementById("cabanaMapStatus");
  var cabanaMapEl = document.getElementById("cabanaMap");
  var cabanaSelectedNote = document.getElementById("cabanaSelectedNote");

  var TYPE_NAMES = {
    day_trip: "Day Trip (Full Day)",
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

  var cabanasLoaded = null;
  var selectedCabanas = [];
  var selectedForDate = null;

  function clearSelection() {
    selectedCabanas = [];
    renderSelectedList();
  }

  function toggleCabana(c, heldSet) {
    if (heldSet && heldSet.has(c.id)) return;
    var idx = -1;
    for (var i = 0; i < selectedCabanas.length; i++) {
      if (selectedCabanas[i].id === c.id) { idx = i; break; }
    }
    if (idx >= 0) selectedCabanas.splice(idx, 1);
    else selectedCabanas.push(c);
    renderSelectedList();
    renderBill();
  }

  function renderSelectedList() {
    if (!selectedCabanas.length) {
      cabanaSelectedNote.hidden = true;
      cabanaSelectedNote.innerHTML = "";
      return;
    }
    cabanaSelectedNote.hidden = false;
    var chips = selectedCabanas.map(function (c, i) {
      return (
        '<span class="cabana-chip">' + c.label + " — " + peso(c.price) +
        ' <button type="button" class="cabana-chip-remove" data-idx="' + i + '" aria-label="Remove ' + c.label + '">&times;</button></span>'
      );
    });
    cabanaSelectedNote.innerHTML =
      "<strong>Selected (" + selectedCabanas.length + "):</strong> " + chips.join(" ");
    Array.prototype.forEach.call(cabanaSelectedNote.querySelectorAll(".cabana-chip-remove"), function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-idx"), 10);
        selectedCabanas.splice(idx, 1);
        renderSelectedList();
        renderBill();
        renderMapFor(checkInEl.value);
      });
    });
  }

  function renderMapFor(dateStr) {
    if (!sb || !window.VBRCabanaMap) {
      cabanaMapStatus.textContent =
        "Live availability isn't connected yet — mention your preferred cabana(s) in the notes below and we'll confirm by hand.";
      return;
    }
    // The map itself (layout, numbering, dining vs. lounge) never depends on
    // a date, so it loads and is tappable right away. Only the held/taken
    // state is date-specific — until a date is picked we show every cabana
    // as open, then swap in real availability once loadHolds resolves.
    cabanaMapStatus.textContent = dateStr
      ? "Loading availability for " + dateStr + "…"
      : "Tap all the cabanas you'd like — pick a date above to check live availability for that day.";

    var loadCabanas = cabanasLoaded || window.VBRCabanaMap.loadCabanas(sb);
    cabanasLoaded = loadCabanas;
    var loadHolds = dateStr ? window.VBRCabanaMap.loadHolds(sb, dateStr) : Promise.resolve(new Set());

    Promise.all([loadCabanas, loadHolds])
      .then(function (results) {
        var cabanas = results[0];
        var heldSet = results[1];
        cabanaMapStatus.textContent = dateStr
          ? "Tap all the cabanas you'd like for " + dateStr + " — you can pick more than one."
          : "Tap all the cabanas you'd like — pick a date above to check live availability for that day.";
        window.VBRCabanaMap.render(cabanaMapEl, {
          cabanas: cabanas,
          heldSet: heldSet,
          selectedIds: selectedCabanas.map(function (c) { return c.id; }),
          onSelect: function (c) {
            toggleCabana(c, heldSet);
            renderMapFor(dateStr);
          },
        });
      })
      .catch(function () {
        cabanaMapStatus.textContent =
          "Couldn't load live availability right now — mention your preferred cabana(s) in the notes below and we'll confirm by hand.";
      });
  }

  function refreshCabanaStep() {
    if (!usesCabanaMap()) {
      cabanaStep.hidden = true;
      clearSelection();
      renderBill();
      return;
    }
    cabanaStep.hidden = false;
    var dateStr = checkInEl.value;
    if (selectedCabanas.length && selectedForDate !== dateStr) clearSelection();
    selectedForDate = dateStr;
    renderMapFor(dateStr);
    renderBill();
  }

  // ---------- live bill ----------
  function computeBill() {
    var adults = parseInt(adultsEl.value || "0", 10) || 0;
    var kids612 = parseInt(kids612El.value || "0", 10) || 0;
    var kids05 = parseInt(kids05El.value || "0", 10) || 0;
    var seniorsRaw = parseInt((seniorCountEl && seniorCountEl.value) || "0", 10) || 0;
    var seniors = Math.max(0, Math.min(seniorsRaw, adults));
    if (seniorCountEl && seniors !== seniorsRaw) seniorCountEl.value = seniors;
    var regularAdults = adults - seniors;
    var seniorRate = ADULT_PRICE * (1 - SENIOR_DISCOUNT_RATE);
    var subtotalPeople = regularAdults * ADULT_PRICE + seniors * seniorRate + kids612 * CHILD_612_PRICE + kids05 * CHILD_05_PRICE;
    var seniorDiscount = seniors * ADULT_PRICE * SENIOR_DISCOUNT_RATE;
    var cabanaTotal = selectedCabanas.reduce(function (sum, c) { return sum + (Number(c.price) || 0); }, 0);
    var totalCapacity = selectedCabanas.reduce(function (sum, c) { return sum + (Number(c.capacity) || 0); }, 0);
    var totalGuests = adults + kids612 + kids05;
    return {
      adults: adults, kids612: kids612, kids05: kids05, seniors: seniors, regularAdults: regularAdults,
      seniorRate: seniorRate, subtotalPeople: subtotalPeople, seniorDiscount: seniorDiscount,
      cabanaTotal: cabanaTotal, totalCapacity: totalCapacity, totalGuests: totalGuests,
      total: subtotalPeople + cabanaTotal,
    };
  }

  function renderBill() {
    if (!billSummaryEl) return;
    var bill = computeBill();

    if (seniorIdWrap) seniorIdWrap.hidden = bill.seniors <= 0;
    if (seniorIdFilesEl) seniorIdFilesEl.required = bill.seniors > 0;
    if (bill.seniors <= 0 && seniorIdError) seniorIdError.hidden = true;

    if (!usesCabanaMap()) {
      billSummaryEl.hidden = true;
      return;
    }
    billSummaryEl.hidden = false;

    var lines = [];
    if (bill.regularAdults > 0) {
      lines.push(
        '<div class="bill-row"><span>' + bill.regularAdults + " adult" + (bill.regularAdults === 1 ? "" : "s") +
        " × " + peso(ADULT_PRICE) + "</span><span>" + peso(bill.regularAdults * ADULT_PRICE) + "</span></div>"
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
        " (6–12) × " + peso(CHILD_612_PRICE) + "</span><span>" + peso(bill.kids612 * CHILD_612_PRICE) + "</span></div>"
      );
    }
    if (bill.kids05 > 0) {
      lines.push('<div class="bill-row"><span>' + bill.kids05 + " child" + (bill.kids05 === 1 ? "" : "ren") + " (0–5)</span><span>Free</span></div>");
    }
    selectedCabanas.forEach(function (c) {
      lines.push('<div class="bill-row"><span>' + c.label + "</span><span>" + peso(c.price) + "</span></div>");
    });

    var warning = "";
    if (selectedCabanas.length && bill.totalCapacity < bill.totalGuests) {
      warning =
        '<p class="bill-warning">Heads up — the cabana' + (selectedCabanas.length === 1 ? "" : "s") + " you picked seat" +
        (selectedCabanas.length === 1 ? "s" : "") + " up to " + bill.totalCapacity + ", and your party is " + bill.totalGuests +
        ". Feel free to add another cabana above, or we can help sort seating when we confirm.</p>";
    }

    billSummaryEl.innerHTML =
      '<div class="bill-lines">' + (lines.join("") || '<div class="bill-row"><span>Add your party size and cabana(s) above</span><span>—</span></div>') + "</div>" +
      warning +
      '<div class="bill-total"><span>Estimated Total</span><span>' + peso(bill.total) + "</span></div>" +
      '<p class="field-hint">This is an estimate for your reference — our team confirms the final amount when arranging payment.</p>';
  }

  [adultsEl, kids612El, kids05El, seniorCountEl].forEach(function (el) {
    if (el) el.addEventListener("input", renderBill);
  });

  // Pre-fill from query string, e.g. book/index.html?type=corporate
  var qType = params.get("type");
  if (qType && TYPE_NAMES[qType]) stayTypeEl.value = qType;
  checkInLabel.textContent = "Preferred Date";

  stayTypeEl.addEventListener("change", refreshCabanaStep);
  checkInEl.addEventListener("change", function () {
    clearSelection();
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
      subtotal_people: usesCabanaMap() ? bill.subtotalPeople : null,
      cabana_total: usesCabanaMap() ? bill.cabanaTotal : null,
      senior_discount: usesCabanaMap() ? bill.seniorDiscount : null,
      total_amount: usesCabanaMap() ? bill.total : null,
    };
  }

  function mailtoLink(payload, bill) {
    var subject = "Booking Request — " + (payload.stay_type_label || payload.stay_type) + " — " + payload.guest_name;
    var lines = [
      "New booking request from the website (booking isn't connected to the database yet):",
      "",
      "Type: " + (payload.stay_type_label || payload.stay_type),
      "Preferred Date: " + (payload.check_in || "—"),
      "Cabana(s): " + (selectedCabanas.length ? selectedCabanas.map(function (c) { return c.label; }).join(", ") : "—"),
      "Adults: " + payload.adults + (payload.senior_count ? " (incl. " + payload.senior_count + " senior citizen" + (payload.senior_count === 1 ? "" : "s") + ")" : ""),
      "Children (6–12): " + payload.children_6_12,
      "Children (0–5): " + payload.children_0_5,
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
      ? "<p>Your Order ID is <strong>" + orderCode + "</strong> — you'll need it if you upload a payment screenshot later. We've also sent it to " + payload.guest_email + ".</p>"
      : "";
    statusEl.innerHTML =
      "<h3>Request received.</h3><p>Thank you, " + firstName +
      " — our reservations team will confirm availability, then follow up with payment details, at " +
      payload.guest_email + " or " + payload.guest_phone + " within 24 hours.</p>" + orderLine + extra;
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

  function attachCabanas(bookingId) {
    if (!sb || !selectedCabanas.length) return Promise.resolve();
    var rows = selectedCabanas.map(function (c) { return { booking_id: bookingId, cabana_id: c.id }; });
    return sb.from("booking_cabanas").insert(rows).then(function (res) {
      if (res.error) throw res.error;
    });
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

    uploadSeniorIds(seniorFiles)
      .then(function (paths) {
        payload.senior_id_paths = paths.length ? paths : null;
        return fetch(cfg.url.replace(/\/$/, "") + "/rest/v1/booking_requests", {
          method: "POST",
          headers: {
            apikey: cfg.anonKey,
            Authorization: "Bearer " + cfg.anonKey,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(payload),
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error("Request failed: " + res.status);
        return res.json();
      })
      .then(function (rows) {
        var row = Array.isArray(rows) ? rows[0] : rows;
        return attachCabanas(row.id).then(function () { return row; });
      })
      .then(function (row) {
        showSuccess(payload, false, row && row.order_code);
      })
      .catch(function () {
        showError(payload, bill);
      });
  });

  renderBill();
})();
