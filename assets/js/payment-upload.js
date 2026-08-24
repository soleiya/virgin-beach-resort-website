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
  var preview = document.getElementById("payPreview");

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

  function showResult(message, ok) {
    formWrap.hidden = true;
    statusEl.hidden = false;
    statusEl.className = "form-status " + (ok ? "form-status-success" : "form-status-error");
    statusEl.innerHTML = message;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    if (!sb) {
      showResult(
        "Uploads aren't connected right now. Please email your screenshot and Order ID to " +
          '<a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.',
        false
      );
      return;
    }

    var orderCode = form.querySelector("#orderCode").value.trim();
    var email = form.querySelector("#payEmail").value.trim();
    var file = fileInput.files && fileInput.files[0];
    if (!orderCode || !email || !file) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";

    var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    var safeCode = orderCode.replace(/[^A-Za-z0-9-]/g, "");
    var path = "guest/" + safeCode + "-" + Date.now() + "." + ext;

    sb.storage
      .from("payment-proofs")
      .upload(path, file, { contentType: file.type || "image/jpeg" })
      .then(function (res) {
        if (res.error) throw res.error;
        return sb.rpc("submit_payment_proof", {
          p_order_code: orderCode,
          p_guest_email: email,
          p_storage_path: path,
        });
      })
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data === true) {
          showResult(
            "<h3>Thank you!</h3><p>Your payment screenshot for order <strong>" +
              orderCode +
              "</strong> has been received. Our reservations team will confirm within 24 hours.</p>",
            true
          );
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = "Upload Payment Proof";
          showFormError(
            "We couldn't match that Order ID and email to a booking. Please double-check both, or email us directly at reservations@virginbeachresort.com."
          );
        }
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Upload Payment Proof";
        showFormError(
          "Something went wrong uploading your screenshot. Please try again, or email it to reservations@virginbeachresort.com."
        );
      });
  });

  function showFormError(message) {
    statusEl.hidden = false;
    statusEl.className = "form-status form-status-error";
    statusEl.textContent = message;
  }
})();
