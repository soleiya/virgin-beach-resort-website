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

  var stayTypeEl = form.querySelector("#stayType");
  var checkInLabel = form.querySelector("#checkInLabel");
  var submitBtn = form.querySelector("#submitBtn");
  var statusEl = document.getElementById("bookingStatus");
  var formWrap = document.getElementById("bookingFormWrap");

  var TYPE_NAMES = {
    day_trip: "Day Trip (Full Day)",
    half_day: "Half-day Tour",
    day_picnic: "Day Picnic",
    corporate: "Corporate Outing",
  };

  // Pre-fill from query string, e.g. book/index.html?type=corporate
  var qType = params.get("type");
  if (qType && TYPE_NAMES[qType]) stayTypeEl.value = qType;
  checkInLabel.textContent = "Preferred Date";

  function buildPayload() {
    var type = stayTypeEl.value;
    return {
      status: "pending",
      stay_type: type,
      stay_type_label: TYPE_NAMES[type] || type,
      check_in: form.querySelector("#checkIn").value || null,
      adults: parseInt(form.querySelector("#adults").value || "1", 10),
      children_6_12: parseInt(form.querySelector("#kids612").value || "0", 10),
      children_0_5: parseInt(form.querySelector("#kids05").value || "0", 10),
      guest_name: form.querySelector("#guestName").value,
      guest_email: form.querySelector("#guestEmail").value,
      guest_phone: form.querySelector("#guestPhone").value,
      country: form.querySelector("#country").value || null,
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

  function showSuccess(payload, viaEmail) {
    formWrap.hidden = true;
    statusEl.hidden = false;
    statusEl.className = "form-status form-status-success";
    var firstName = (payload.guest_name || "").split(" ")[0] || "there";
    var extra = viaEmail
      ? "<p>Your email app should have opened with the request pre-filled — just hit send.</p>"
      : "";
    statusEl.innerHTML =
      "<h3>Request received.</h3><p>Thank you, " + firstName +
      " — our reservations team will confirm availability, then follow up with payment details, at " +
      payload.guest_email + " or " + payload.guest_phone + " within 24 hours.</p>" + extra;
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
    if (!cfg.url || cfg.url.indexOf("YOUR-PROJECT-REF") !== -1) {
      window.location.href = mailtoLink(payload);
      showSuccess(payload, true);
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
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Request failed: " + res.status);
        showSuccess(payload, false);
      })
      .catch(function () {
        showError(payload);
      });
  });
})();
