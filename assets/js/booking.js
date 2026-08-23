(function () {
  var form = document.getElementById("bookingForm");
  if (!form) return;

  var cfg = window.SUPABASE_CONFIG || {};
  var fallbackEmail = cfg.fallbackEmail || "reservations@virginbeachresort.com";
  var params = new URLSearchParams(location.search);

  var stayTypeEl = form.querySelector("#stayType");
  var roomWrap = form.querySelector("#roomWrap");
  var roomEl = form.querySelector("#roomSlug");
  var checkoutWrap = form.querySelector("#checkoutWrap");
  var checkInLabel = form.querySelector("#checkInLabel");
  var submitBtn = form.querySelector("#submitBtn");
  var statusEl = document.getElementById("bookingStatus");
  var formWrap = document.getElementById("bookingFormWrap");

  var LABELS = {
    overnight: "Check-in Date",
    day_trip: "Preferred Date",
    half_day: "Preferred Date",
    day_picnic: "Preferred Date",
    corporate: "Preferred Date",
  };
  var TYPE_NAMES = {
    overnight: "Overnight Stay",
    day_trip: "Day Trip (Full Day)",
    half_day: "Half-day Tour",
    day_picnic: "Day Picnic",
    corporate: "Corporate Outing",
  };

  function updateVisibility() {
    var type = stayTypeEl.value;
    var isOvernight = type === "overnight";
    roomWrap.style.display = isOvernight ? "" : "none";
    checkoutWrap.style.display = isOvernight ? "" : "none";
    roomEl.required = isOvernight;
    checkInLabel.textContent = LABELS[type] || "Preferred Date";
  }

  stayTypeEl.addEventListener("change", updateVisibility);

  // Pre-fill from query string, e.g. book/index.html?type=overnight&room=deluxe-king-casita
  var qType = params.get("type");
  var qRoom = params.get("room");
  if (qType && LABELS[qType]) stayTypeEl.value = qType;
  if (qRoom) roomEl.value = qRoom;
  updateVisibility();

  function buildPayload() {
    var type = stayTypeEl.value;
    var isOvernight = type === "overnight";
    return {
      status: "pending",
      stay_type: type,
      stay_type_label: TYPE_NAMES[type] || type,
      room_slug: isOvernight ? roomEl.value : null,
      room_name: isOvernight ? roomEl.options[roomEl.selectedIndex].text : null,
      check_in: form.querySelector("#checkIn").value || null,
      check_out: isOvernight ? form.querySelector("#checkOut").value || null : null,
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
      "Room / Package: " + (payload.room_name || "—"),
      "Check-in / Date: " + (payload.check_in || "—"),
      "Check-out: " + (payload.check_out || "—"),
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
