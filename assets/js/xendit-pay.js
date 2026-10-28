/* ==========================================================================
   Online payment (Xendit) for villa bookings — shared by the booking page
   and the Upload / Pay page.
   VBRPay.start(sb, orderCode, email, kind, button, onError)
     kind: "deposit" (50%) | "full" | "balance"
   Asks the xendit-pay Edge Function for a Xendit checkout link (the amount
   is worked out on the server) and sends the guest there. After paying,
   Xendit brings them back to pay/index.html?…&paid=1.
   ========================================================================== */
(function () {
  "use strict";
  function start(sb, orderCode, email, kind, btn, onError) {
    if (!sb) { onError("Online payment isn't available right now — please email reservations@virginbeachresort.com."); return; }
    var label = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.textContent = "Opening secure payment…"; }
    sb.functions.invoke("xendit-pay", { body: { action: "create", order_code: orderCode, email: email, kind: kind } })
      .then(function (res) {
        var d = res && res.data;
        if (d && d.url) { window.location.href = d.url; return; }
        var msg = (d && d.error) || "";
        if (!msg && res && res.error && res.error.context && typeof res.error.context.json === "function") {
          return res.error.context.json().then(function (j) { throw new Error((j && j.error) || ""); });
        }
        throw new Error(msg);
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
        onError((e && e.message) || "The payment page couldn't be opened just now — please try again in a moment.");
      });
  }
  window.VBRPay = { start: start };
})();
