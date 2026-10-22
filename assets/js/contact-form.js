// Contact page form → send-contact-email Edge Function (saves the message and
// emails it to reservations@, or events@ for Weddings / Corporate).
// If anything fails, the guest gets a one-click email fallback so no message
// is lost.
(function () {
  var form = document.getElementById("contactForm");
  if (!form) return;
  var cfg = window.SUPABASE_CONFIG || {};
  var status = document.getElementById("contactStatus");
  var btn = form.querySelector("button[type=submit]");

  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }

  function mailtoFallback(d) {
    var to = (d.inquiry_type === "Weddings" || d.inquiry_type === "Corporate") ? "events@virginbeachresort.com" : (cfg.fallbackEmail || "reservations@virginbeachresort.com");
    var body = d.message + "\n\n" + d.first_name + " " + d.last_name + "\n" + d.phone + "\n" + d.country;
    return "mailto:" + to + "?subject=" + encodeURIComponent("Website inquiry — " + d.inquiry_type) + "&body=" + encodeURIComponent(body);
  }

  function show(kind, html) {
    status.className = "form-status form-status-" + kind;
    status.innerHTML = html;
    status.hidden = false;
    status.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!form.reportValidity()) return;
    var d = {
      first_name: val("fname"), last_name: val("lname"), phone: val("cnum"), email: val("email"),
      country: val("country"), inquiry_type: val("inquiry"), message: val("msg"),
      website: val("website"), page: location.href,
    };
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = "Sending…";
    status.hidden = true;

    fetch(cfg.url + "/functions/v1/send-contact-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey },
      body: JSON.stringify(d),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error((res.j && res.j.error) || "send failed");
        form.hidden = true;
        form.style.display = "none";
        show("success", "<h3>Thank you, " + d.first_name.replace(/[<>&"]/g, "") + " — your message is on its way.</h3>" +
          "<p>Our team will get back to you at " + d.email.replace(/[<>&"]/g, "") + " within office hours (9:00 AM–4:00 PM, Monday–Friday).</p>");
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = label;
        show("error", "<p><strong>Sorry, we couldn't send your message.</strong> " + String(err.message || "").replace(/[<>&"]/g, "") +
          '</p><p style="margin-top:8px;"><a class="text-link" href="' + mailtoFallback(d) + '">Email it to us instead</a> or call +63 917 792 0712.</p>');
      });
  });
})();
