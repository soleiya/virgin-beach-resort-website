/* Upload Payment & Documents (/pay).
   1. Find your booking (Booking ID + email) → summary: total, paid, being
      verified, remaining balance and the date to pay by.
   2. Choose partial (50%) or full — or the remaining balance.
   3. Upload the proof (+ Senior/PWD IDs, pet vaccination cards if needed).
   Rules: booking-v16-payments.sql / booking-v17-pay-lookup.sql. */
(function () {
  var form = document.getElementById("payForm");
  if (!form) return;

  var cfg = window.SUPABASE_CONFIG || {};
  var isConnected = cfg.url && cfg.url.indexOf("YOUR-PROJECT-REF") === -1;
  var sb = isConnected && window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

  var $ = function (id) { return document.getElementById(id); };
  var formWrap = $("payFormWrap");
  var statusEl = $("payStatus");
  var submitBtn = $("paySubmitBtn");
  var fileInput = $("payFile");
  var fileHint = $("payFileHint");
  var preview = $("payPreview");
  var orderEl = form.querySelector("#orderCode");
  var emailEl = form.querySelector("#payEmail");
  var findBtn = $("payFindBtn");
  var lookupEl = $("payLookup");
  var uploadPart = $("payUploadPart");
  var seniorWrap = $("docSeniorWrap"), seniorFiles = $("docSeniorFiles"), seniorHint = $("docSeniorHint");
  var petWrap = $("docPetWrap"), petFiles = $("docPetFiles"), petHint = $("docPetHint");
  var petPolicy = $("docPetPolicy"), petAgree = $("docPetAgree");
  var kindWrap = $("payKindWrap"), kindOpts = $("payKindOpts"), kindHint = $("payKindHint");

  // The booking found (from get_booking_uploads), or null.
  var needs = null;

  // Links in the quotation email pre-fill the Booking ID and email.
  var qs = new URLSearchParams(location.search);
  if (qs.get("order")) orderEl.value = qs.get("order");
  if (qs.get("email")) emailEl.value = qs.get("email");

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) { preview.style.display = "none"; return; }
    var reader = new FileReader();
    reader.onload = function (e) { preview.src = e.target.result; preview.style.display = "block"; };
    reader.readAsDataURL(file);
  });

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function peso(n) { return "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDay(s) { return s ? new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : ""; }
  function fmtWhen(ts) {
    return ts ? new Date(ts).toLocaleString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function andList(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

  // ------------------------------------------------------------- figures
  function money() {
    var p = (needs && needs.pay) || {};
    var total = Number(p.total) || 0, paid = Number(p.paid) || 0, claimed = Number(p.claimed) || 0;
    var verifying = Math.max(0, claimed - paid);
    var remaining = Math.max(0, total - Math.max(claimed, paid));
    return { p: p, total: total, paid: paid, claimed: claimed, verifying: verifying, remaining: remaining };
  }
  var CLOSED = { declined: "cancelled", expired: "cancelled (it wasn't paid in time)", completed: "completed" };

  // ------------------------------------------------------------- summary
  // Returns true when the booking can still take uploads.
  function renderSummary() {
    var n = needs;
    if (!n) return false;
    var m = money(), p = m.p;
    var when = n.stay_type === "overnight" && n.check_out ? fmtDay(n.check_in) + " → " + fmtDay(n.check_out) : fmtDay(n.check_in);
    var html = '<div class="pl-head"><b>' + (n.first_name ? "Hi " + esc(n.first_name) + " — " : "") + esc(n.order_code) + "</b>" +
      "<span>" + esc(n.stay_label || "") + (when ? " · " + esc(when) : "") + "</span></div>";

    if (CLOSED[n.status]) {
      lookupEl.innerHTML = html + '<p class="pl-msg pl-warn">This booking is ' + CLOSED[n.status] + ". If you need help, email us at " +
        '<a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.</p>';
      return false;
    }
    if (!m.total) {
      lookupEl.innerHTML = html + '<p class="pl-msg">Your quotation is still being prepared by our team &mdash; you\'ll receive the amount and payment details by email. You can upload documents below.</p>';
      return true;
    }
    html += '<div class="pl-figs">' +
      "<div><small>Total</small><b>" + peso(m.total) + "</b></div>" +
      "<div><small>Paid</small><b>" + peso(m.paid) + "</b></div>" +
      (m.verifying > 0.5 ? "<div><small>Being verified</small><b>" + peso(m.verifying) + "</b></div>" : "") +
      '<div class="pl-bal"><small>Remaining balance</small><b>' + peso(m.remaining) + "</b></div></div>";

    var msg;
    if (m.remaining <= 0.5) {
      msg = m.verifying > 0.5
        ? '<p class="pl-msg pl-ok">We\'ve received proof of the full amount &mdash; our team is verifying it. Nothing more to pay.</p>'
        : '<p class="pl-msg pl-ok">Fully paid &mdash; thank you! You can still upload documents below.</p>';
    } else if (m.claimed <= 0.5) {
      var by = n.secure_by ? " by <strong>" + esc(fmtWhen(n.secure_by)) + "</strong>" : "";
      msg = p.half_allowed
        ? '<p class="pl-msg pl-due">To secure your booking, pay <strong>at least 50% (' + peso(p.deposit) + ")</strong> or the <strong>full " + peso(m.total) + "</strong>" + by + "." +
          (p.balance_due ? " If you pay 50% now, the balance is due by <strong>" + esc(fmtDay(p.balance_due)) + "</strong>." : "") + "</p>"
        : '<p class="pl-msg pl-due">To secure your booking, pay the <strong>full ' + peso(m.total) + "</strong>" + by + " &mdash; your " +
          (n.stay_type === "overnight" ? "stay" : "visit") + " is less than 15 days away.</p>";
    } else {
      var late = p.balance_due && String(p.balance_due) < new Date().toISOString().slice(0, 10);
      msg = '<p class="pl-msg ' + (late ? "pl-warn" : "pl-due") + '">Remaining balance <strong>' + peso(m.remaining) + "</strong> " +
        (p.balance_due ? (late ? "was due on " : "is due by ") + "<strong>" + esc(fmtDay(p.balance_due)) + "</strong>" : "") +
        (late ? " &mdash; please pay as soon as possible." : ".") + "</p>";
    }
    if (Number(n.online_discount) > 0 && m.remaining > 0.5) {
      msg += '<p class="pl-note">Your 5% Convenience Discount applies when you pay by bank or e-wallet transfer.</p>';
    }
    lookupEl.innerHTML = html + msg;
    return true;
  }

  // ------------------------------------------------------------- choice
  function renderKinds() {
    var m = money(), p = m.p, opts = [];
    if (!needs || !m.total) { kindWrap.hidden = true; kindOpts.innerHTML = ""; return; }
    if (m.claimed <= 0.5) {
      if (p.half_allowed) opts.push(["deposit", "Partial — 50% down payment", Number(p.deposit)]);
      opts.push(["full", "Full payment", m.total]);
    } else if (m.remaining > 0.5) {
      opts.push(["balance", "Remaining balance", m.remaining]);
    }
    if (!opts.length) { kindWrap.hidden = true; kindOpts.innerHTML = ""; return; }
    kindWrap.hidden = false;
    kindOpts.innerHTML = opts.map(function (o, i) {
      return '<label class="pay-kind-opt"><input type="radio" name="payKind" value="' + o[0] + '"' + (i === 0 ? " checked" : "") +
        "><span><strong>" + o[1] + "</strong></span><b>" + peso(o[2]) + "</b></label>";
    }).join("");
    var hint = [];
    if (m.claimed <= 0.5 && p.half_allowed && p.balance_due) hint.push("With a partial payment, the remaining 50% is due by " + fmtDay(p.balance_due) + ".");
    if (m.claimed <= 0.5 && !p.half_allowed) hint.push("Partial payment isn't available within 15 days of arrival.");
    kindHint.textContent = hint.join(" ");
  }
  function chosenKind() {
    var r = kindOpts.querySelector("input[name=payKind]:checked");
    return r ? r.value : "full";
  }

  // ------------------------------------------------------------- documents
  function renderDocs() {
    var n = needs;
    var seniors = n && n.senior_count > 0, pets = n && n.pet_count > 0;
    seniorWrap.hidden = !seniors;
    petWrap.hidden = !pets;
    fileHint.hidden = !(seniors || pets) || money().remaining <= 0.5;
    if (seniors) {
      seniorHint.textContent = n.senior_ids
        ? "We already have " + plural(n.senior_ids, "ID photo") + " on file — add more only if some are missing."
        : "One photo per senior citizen / PWD (or one photo with all IDs) — needed for the 20% discount. Please bring the ID(s) on the day too.";
    }
    if (pets) {
      petHint.textContent = n.pet_cards
        ? "We already have " + plural(n.pet_cards, "vaccination card") + " on file — add more only if some are missing."
        : "A clear photo of each pet's vaccination card, showing the pet's details and a current anti-rabies vaccination. Please bring the card(s) on the day too.";
      petPolicy.hidden = !!n.pet_policy_agreed;
    }
  }

  // ------------------------------------------------------------- lookup
  var seq = 0;
  function lookup(show) {
    var code = orderEl.value.trim(), email = emailEl.value.trim();
    statusEl.hidden = true;
    if (!sb) { if (show) showFormError("Uploads aren't connected right now. Please email your proof and Booking ID to reservations@virginbeachresort.com."); return; }
    if (!code || !validEmail(email)) {
      needs = null; uploadPart.hidden = true; lookupEl.hidden = true;
      if (show) showFormError("Enter your Booking ID and the email you booked with.");
      return;
    }
    var my = ++seq;
    findBtn.disabled = true;
    findBtn.textContent = "Finding…";
    sb.rpc("get_booking_uploads", { p_order_code: code, p_guest_email: email }).then(function (res) {
      if (my !== seq) return;
      findBtn.disabled = false;
      findBtn.textContent = "Find my booking";
      needs = !res.error && res.data ? res.data : null;
      if (!needs) {
        uploadPart.hidden = true;
        lookupEl.hidden = !show;
        lookupEl.innerHTML = '<p class="pl-msg pl-warn">We couldn\'t find a booking with that Booking ID and email. Please check both (they\'re in your quotation email), or email us at ' +
          '<a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.</p>';
        return;
      }
      lookupEl.hidden = false;
      var open = renderSummary();
      renderKinds();
      renderDocs();
      uploadPart.hidden = !open;
    });
  }
  findBtn.addEventListener("click", function () { lookup(true); });
  [orderEl, emailEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); lookup(true); } });
    el.addEventListener("change", function () { if (orderEl.value.trim() && validEmail(emailEl.value.trim())) lookup(false); });
  });
  if (orderEl.value.trim() && validEmail(emailEl.value.trim())) lookup(false);

  // ------------------------------------------------------------- submit
  function showResult(message, ok) {
    formWrap.hidden = true;
    statusEl.hidden = false;
    statusEl.className = "form-status " + (ok ? "form-status-success" : "form-status-error");
    statusEl.innerHTML = message;
  }
  function showFormError(message) {
    statusEl.hidden = false;
    statusEl.className = "form-status form-status-error";
    statusEl.textContent = message;
  }
  function resetBtn() { submitBtn.disabled = false; submitBtn.textContent = "Upload"; }
  function extOf(file) { return (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"; }
  function uploadAll(bucket, files, prefix) {
    return Promise.all(files.map(function (file, i) {
      var path = "guest/" + prefix + "-" + Date.now() + "-" + i + "." + extOf(file);
      return sb.storage.from(bucket).upload(path, file, { contentType: file.type || "image/jpeg" }).then(function (res) {
        if (res.error) throw res.error;
        return path;
      });
    }));
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    statusEl.hidden = true;
    if (!sb) {
      showResult("Uploads aren't connected right now. Please email your files and Booking ID to " +
        '<a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.', false);
      return;
    }
    if (!needs) { lookup(true); return; }

    // the booking's current Booking ID (a villa booking's number changes to
    // VBR-<Cloudbeds no.> once it reaches Cloudbeds; the old one still finds it)
    var orderCode = needs.order_code || orderEl.value.trim();
    var email = emailEl.value.trim();
    var payFile = fileInput.files && fileInput.files[0];
    var sFiles = !seniorWrap.hidden && seniorFiles.files ? Array.prototype.slice.call(seniorFiles.files) : [];
    var pFiles = !petWrap.hidden && petFiles.files ? Array.prototype.slice.call(petFiles.files) : [];
    if (!payFile && !sFiles.length && !pFiles.length) {
      showFormError(seniorWrap.hidden && petWrap.hidden ? "Please choose your payment screenshot." : "Please choose at least one file to upload.");
      return;
    }
    if (sFiles.length > 10 || pFiles.length > 6) { showFormError("That's a lot of files — please choose fewer photos."); return; }
    if (pFiles.length && !needs.pet_policy_agreed && !petAgree.checked) {
      showFormError("Please agree to the Pet Policy before uploading the vaccination card(s).");
      petAgree.focus();
      return;
    }

    var kind = chosenKind();
    var m = money(), p = m.p;
    var paying = kind === "deposit" ? Number(p.deposit) : kind === "balance" ? m.remaining : Math.max(0, m.total - m.claimed);
    var inCloudbeds = !!(needs && needs.in_cloudbeds && needs.stay_type === "overnight");
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    var safeCode = orderCode.replace(/[^A-Za-z0-9-]/g, "");
    var did = [];

    // Documents first, so the team's "payment proof" email already shows them as on file.
    var docs = sFiles.length || pFiles.length
      ? Promise.all([uploadAll("senior-ids", sFiles, safeCode), uploadAll("pet-vaccinations", pFiles, safeCode)]).then(function (paths) {
          return sb.rpc("submit_booking_documents", {
            p_order_code: orderCode, p_guest_email: email,
            p_senior_paths: paths[0].length ? paths[0] : null,
            p_pet_paths: paths[1].length ? paths[1] : null,
            p_pet_policy_agreed: !!petAgree.checked,
            p_notify: !payFile,
          }).then(function (res) {
            if (res.error) throw new Error(res.error.message);
            if (res.data !== true) throw new Error("nomatch");
            if (sFiles.length) did.push(plural(sFiles.length, "Senior/PWD ID photo"));
            if (pFiles.length) did.push(plural(pFiles.length, "pet vaccination card"));
          });
        })
      : Promise.resolve();

    docs
      .then(function () {
        if (!payFile) return;
        var path = "guest/" + safeCode + "-" + Date.now() + "." + extOf(payFile);
        return sb.storage.from("payment-proofs").upload(path, payFile, { contentType: payFile.type || "image/jpeg" })
          .then(function (res) {
            if (res.error) throw res.error;
            return sb.rpc("submit_payment_proof", { p_order_code: orderCode, p_guest_email: email, p_storage_path: path, p_kind: kind });
          })
          .then(function (res) {
            if (res.error) throw res.error;
            if (res.data !== true) throw new Error("nomatch");
            did.unshift(kind === "deposit" ? "50% payment screenshot" : kind === "balance" ? "balance payment screenshot" : "payment screenshot");
          });
      })
      .then(function () {
        var after = "";
        if (payFile && kind === "deposit" && p.balance_due) {
          after = "<p>The remaining <strong>" + peso(m.total - paying) + "</strong> is due by <strong>" + esc(fmtDay(p.balance_due)) + "</strong> &mdash; upload it here the same way.</p>";
        }
        showResult(
          "<h3>Thank you!</h3><p>We've received your " + andList(did) + " for booking <strong>" + esc(orderCode.toUpperCase()) + "</strong>" +
            (payFile ? (paying > 0 ? " (" + peso(paying) + ")" : " &mdash; added to your payment of " + peso(m.verifying || m.claimed) + " that we're already checking") : "") + "." +
            (payFile
              ? (inCloudbeds
                  // villa stays are handled in our reservations system, which emails the confirmation
                  ? " We've emailed you an acknowledgement, and you'll receive your booking confirmation by email once our reservations team has verified the payment"
                  : " We've emailed you an acknowledgement, and our reservations team will " + (kind === "balance" ? "email you once it's verified" : "send your confirmation once the payment is verified")) +
                " (office hours 9:00 AM–4:00 PM, Monday–Friday)."
              : " Our reservations team will check " + (did.length > 1 || /s$/.test(did[0] || "") ? "them" : "it") + " — please remember to upload your payment screenshot too, if you haven't yet.") +
            "</p>" + after,
          true
        );
      })
      .catch(function (err) {
        resetBtn();
        var msg = err && err.message;
        if (msg === "nomatch") {
          showFormError("We couldn't match that Booking ID and email to a booking. Please double-check both, or email us directly at reservations@virginbeachresort.com.");
        } else if (msg && /Pet Policy|no longer open|no senior|no pets|Too many/i.test(msg)) {
          showFormError(msg + ".");
        } else {
          showFormError((did.length ? "Your " + andList(did) + " uploaded, but something went wrong with the rest. " : "Something went wrong uploading your files. ") +
            "Please try again, or email them to reservations@virginbeachresort.com.");
        }
      });
  });
})();
