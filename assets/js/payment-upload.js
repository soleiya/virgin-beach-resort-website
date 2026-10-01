(function () {
  var form = document.getElementById("payForm");
  if (!form) return;

  var cfg = window.SUPABASE_CONFIG || {};
  var isConnected = cfg.url && cfg.url.indexOf("YOUR-PROJECT-REF") === -1;
  var sb = isConnected && window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

  var formWrap = document.getElementById("payFormWrap");
  var statusEl = document.getElementById("payStatus");
  var submitBtn = document.getElementById("paySubmitBtn");
  var fileInput = document.getElementById("payFile");
  var fileHint = document.getElementById("payFileHint");
  var preview = document.getElementById("payPreview");
  var orderEl = form.querySelector("#orderCode");
  var emailEl = form.querySelector("#payEmail");
  var lookupEl = document.getElementById("payLookup");
  var seniorWrap = document.getElementById("docSeniorWrap");
  var seniorFiles = document.getElementById("docSeniorFiles");
  var seniorHint = document.getElementById("docSeniorHint");
  var petWrap = document.getElementById("docPetWrap");
  var petFiles = document.getElementById("docPetFiles");
  var petHint = document.getElementById("docPetHint");
  var petPolicy = document.getElementById("docPetPolicy");
  var petAgree = document.getElementById("docPetAgree");

  // What this booking still needs (from get_booking_uploads), or null.
  var needs = null;

  // Links in the quotation email pre-fill the Order ID and email.
  var qs = new URLSearchParams(location.search);
  if (qs.get("order")) orderEl.value = qs.get("order");
  if (qs.get("email")) emailEl.value = qs.get("email");

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) {
      preview.style.display = "none";
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      preview.src = e.target.result;
      preview.style.display = "block";
    };
    reader.readAsDataURL(file);
  });

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function andList(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }

  function renderNeeds() {
    var n = needs;
    var seniors = n && n.senior_count > 0;
    var pets = n && n.pet_count > 0;
    seniorWrap.hidden = !seniors;
    petWrap.hidden = !pets;
    fileHint.hidden = !(seniors || pets) || (n && n.payment_uploaded);
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
    if (!n) { lookupEl.hidden = true; return; }
    var todo = [];
    if (!n.payment_uploaded) todo.push("payment screenshot");
    if (seniors && !n.senior_ids) todo.push("Senior Citizen / PWD ID(s)");
    if (pets && !n.pet_cards) todo.push("pet vaccination card(s)");
    lookupEl.hidden = false;
    lookupEl.textContent = "Booking " + n.order_code + " found. " +
      (todo.length ? "Still needed: " + todo.join(", ") + "." : "We have everything we need — you can still add files below.");
  }

  var lookupTimer = null;
  function lookup() {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(function () {
      var code = orderEl.value.trim(), email = emailEl.value.trim();
      if (!sb || !code || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { needs = null; renderNeeds(); return; }
      sb.rpc("get_booking_uploads", { p_order_code: code, p_guest_email: email }).then(function (res) {
        needs = !res.error && res.data ? res.data : null;
        renderNeeds();
      });
    }, 350);
  }
  orderEl.addEventListener("input", lookup);
  emailEl.addEventListener("input", lookup);
  lookup();

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

  function resetBtn() {
    submitBtn.disabled = false;
    submitBtn.textContent = "Upload";
  }

  function extOf(file) {
    return (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  }

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
      showResult(
        "Uploads aren't connected right now. Please email your files and Order ID to " +
          '<a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.',
        false
      );
      return;
    }

    var orderCode = orderEl.value.trim();
    var email = emailEl.value.trim();
    var payFile = fileInput.files && fileInput.files[0];
    var sFiles = !seniorWrap.hidden && seniorFiles.files ? Array.prototype.slice.call(seniorFiles.files) : [];
    var pFiles = !petWrap.hidden && petFiles.files ? Array.prototype.slice.call(petFiles.files) : [];
    if (!orderCode || !email) return;
    if (!payFile && !sFiles.length && !pFiles.length) {
      showFormError(seniorWrap.hidden && petWrap.hidden
        ? "Please choose your payment screenshot."
        : "Please choose at least one file to upload.");
      return;
    }
    if (sFiles.length > 10 || pFiles.length > 6) { showFormError("That's a lot of files — please choose fewer photos."); return; }
    var needAgree = pFiles.length && !(needs && needs.pet_policy_agreed);
    if (needAgree && !petAgree.checked) {
      showFormError("Please agree to the Pet Policy before uploading the vaccination card(s).");
      petAgree.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    var safeCode = orderCode.replace(/[^A-Za-z0-9-]/g, "");
    var did = [];

    // Documents first, so the team's "payment proof" email (sent when the
    // screenshot lands) already shows them as on file.
    var docs = sFiles.length || pFiles.length
      ? Promise.all([uploadAll("senior-ids", sFiles, safeCode), uploadAll("pet-vaccinations", pFiles, safeCode)]).then(function (paths) {
          return sb.rpc("submit_booking_documents", {
            p_order_code: orderCode,
            p_guest_email: email,
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
            return sb.rpc("submit_payment_proof", { p_order_code: orderCode, p_guest_email: email, p_storage_path: path });
          })
          .then(function (res) {
            if (res.error) throw res.error;
            if (res.data !== true) throw new Error("nomatch");
            did.unshift("payment screenshot");
          });
      })
      .then(function () {
        showResult(
          "<h3>Thank you!</h3><p>We've received your " + andList(did) + " for order <strong>" + orderCode + "</strong>." +
            (payFile
              ? " We've emailed you an acknowledgement, and our reservations team will send your confirmation once the payment is verified (office hours 9:00 AM–6:00 PM daily)."
              : " Our reservations team will check " + (did.length > 1 || /s$/.test(did[0] || "") ? "them" : "it") + " — please remember to upload your payment screenshot too, if you haven't yet.") +
            "</p>",
          true
        );
      })
      .catch(function (err) {
        resetBtn();
        var msg = err && err.message;
        if (msg === "nomatch") {
          showFormError("We couldn't match that Order ID and email to a booking. Please double-check both, or email us directly at reservations@virginbeachresort.com.");
        } else if (msg && /Pet Policy|no longer open|no senior|no pets|Too many/i.test(msg)) {
          showFormError(msg + ".");
        } else {
          showFormError((did.length ? "Your " + andList(did) + " uploaded, but something went wrong with the rest. " : "Something went wrong uploading your files. ") +
            "Please try again, or email them to reservations@virginbeachresort.com.");
        }
      });
  });
})();
