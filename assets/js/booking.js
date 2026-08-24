(function () {
  var form = document.getElementById("bookingForm");
  if (!form) return;

  // This form handles Day Trip / Half-day / Day Picnic / Corporate requests
  // only. Overnight casita reservations go straight to Cloudbeds (see the
  // "Book an Overnight Stay" link on this page and the site's Book Now
  // buttons) — they never reach this script.

  var cfg = window.SUPABASE_CONFIG || {};
  var fallbackEmail = cfg.fallbackEmail || "reservations@virginbeachresort.com";
  var params = new URLSearchParams(location.search);
  var isConnected = cfg.url && cfg.url.indexOf("YOUR-PROJECT-REF") === -1;
  var sb = isConnected && window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

  var stayTypeEl = form.querySelector("#stayType");
  var checkInEl = form.querySelector("#checkIn");
  var checkInLabel = form.querySelector("#checkInLabel");
  var submitBtn = form.querySelector("#submitBtn");
  var statusEl = document.getElementById("bookingStatus");
  var formWrap = document.getElementById("bookingFormWrap");

  var cabanaStep = document.getElementById("cabanaStep");
  var cabanaHint = document.getElementById("cabanaHint");
  var cabanaMapStatus = document.getElementById("cabanaMapStatus");
  var cabanaMapEl = document.getElementById("cabanaMap");
  var cabanaSelectedNote = document.getElementById("cabanaSelectedNote");
  var cabanaIdInput = document.getElementById("cabanaId");

  var TYPE_NAMES = {
    day_trip: "Day Trip (Full Day)",
    half_day: "Half-day Tour",
    day_picnic: "Day Picnic",
    corporate: "Corporate Outing",
  };

  // Corporate groups are coordinated directly by the team — no single-cabana
  // pick needed for those.
  function usesCabanaMap() {
    return stayTypeEl.value !== "corporate";
  }

  var cabanasLoaded = null;
  var selectedCabana = null;

  function clearSelection() {
    selectedCabana = null;
    cabanaIdInput.value = "";
    cabanaSelectedNote.hidden = true;
  }

  function renderMapFor(dateStr) {
    if (!sb || !window.VBRCabanaMap) {
      cabanaMapStatus.textContent =
        "Live availability isn't connected yet — mention your preferred cabana in the notes below and we'll confirm by hand.";
      return;
    }
    if (!dateStr) {
      cabanaMapStatus.textContent = "Pick a date above to see availability.";
      cabanaMapEl.innerHTML = "";
      return;
    }
    cabanaMapStatus.textContent = "Loading availability for " + dateStr + "…";

    var loadCabanas = cabanasLoaded || window.VBRCabanaMap.loadCabanas(sb);
    cabanasLoaded = loadCabanas;

    Promise.all([loadCabanas, window.VBRCabanaMap.loadHolds(sb, dateStr)])
      .then(function (results) {
        var cabanas = results[0];
        var heldSet = results[1];
        cabanaMapStatus.textContent = "Tap an available cabana to select it for " + dateStr + ".";
        window.VBRCabanaMap.render(cabanaMapEl, {
          cabanas: cabanas,
          heldSet: heldSet,
          selectedId: selectedCabana ? selectedCabana.id : null,
          onSelect: function (c) {
            if (heldSet.has(c.id)) return;
            selectedCabana = c;
            selectedCabana.__forDate = dateStr;
            cabanaIdInput.value = c.id;
            cabanaSelectedNote.hidden = false;
            cabanaSelectedNote.textContent = "Selected: " + c.label + ".";
            // Re-render so the tile highlight and click handlers stay in sync.
            renderMapFor(dateStr);
          },
        });
      })
      .catch(function () {
        cabanaMapStatus.textContent =
          "Couldn't load live availability right now — mention your preferred cabana in the notes below and we'll confirm by hand.";
      });
  }

  function refreshCabanaStep() {
    if (!usesCabanaMap()) {
      cabanaStep.hidden = true;
      clearSelection();
      return;
    }
    cabanaStep.hidden = false;
    var dateStr = checkInEl.value;
    if (selectedCabana && selectedCabana.__forDate !== dateStr) clearSelection();
    renderMapFor(dateStr);
  }

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

  function buildPayload() {
    var type = stayTypeEl.value;
    return {
      status: "pending",
      source: "website",
      stay_type: type,
      stay_type_label: TYPE_NAMES[type] || type,
      cabana_id: usesCabanaMap() && cabanaIdInput.value ? cabanaIdInput.value : null,
      check_in: checkInEl.value || null,
      adults: parseInt(form.querySelector("#adults").value || "1", 10),
      children_6_12: parseInt(form.querySelector("#kids612").value || "0", 10),
      children_0_5: parseInt(form.querySelector("#kids05").value || "0", 10),
      guest_name: form.querySelector("#guestName").value,
      guest_email: form.querySelector("#guestEmail").value,
      guest_phone: form.querySelector("#guestPhone").value,
      country: form.querySelector("#country").value || null,
      how_heard: form.querySelector("#hearAbout").value || null,
      occasion: form.querySelector("#occasion").value || null,
      marketing_opt_in: !!form.querySelector("#marketingOptIn").checked,
      notes: form.querySelector("#notes").value || null,
    };
  }

  function mailtoLink(payload) {
    var subject = "Booking Request — " + (payload.stay_type_label || payload.stay_type) + " — " + payload.guest_name;
    var lines = [
      "New booking request from the website (booking isn't connected to the database yet):",
      "",
      "Type: " + (payload.stay_type_label || payload.stay_type),
      "Preferred Date: " + (payload.check_in || "—"),
      "Cabana: " + (selectedCabana ? selectedCabana.label : "—"),
      "Adults: " + payload.adults,
      "Children (6–12): " + payload.children_6_12,
      "Children (0–5): " + payload.children_0_5,
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

  function showError(payload) {
    statusEl.hidden = false;
    statusEl.className = "form-status form-status-error";
    statusEl.innerHTML =
      "Something went wrong sending your request. Please email us directly at " +
      '<a class="text-link" href="' + mailtoLink(payload) + '">' + fallbackEmail + "</a>, " +
      "or try again.";
    submitBtn.disabled = false;
    submitBtn.textContent = "Send Request";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var payload = buildPayload();

    // Not connected yet — fall back straight to a pre-filled email so no
    // request is ever lost, and still show the guest a confirmation.
    if (!isConnected) {
      window.location.href = mailtoLink(payload);
      showSuccess(payload, true, null);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    fetch(cfg.url.replace(/\/$/, "") + "/rest/v1/booking_requests", {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        Authorization: "Bearer " + cfg.anonKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Request failed: " + res.status);
        return res.json();
      })
      .then(function (rows) {
        var row = Array.isArray(rows) ? rows[0] : rows;
        showSuccess(payload, false, row && row.order_code);
      })
      .catch(function () {
        showError(payload);
      });
  });
})();
