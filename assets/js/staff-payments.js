/* ==========================================================================
   Staff dashboard — Payments window (booking-v16-payments.sql)
   --------------------------------------------------------------------------
   Guests pay 50% or 100% within 24 hours (balance 15 days before arrival)
   and upload each proof on the /pay page. Each upload is a row here:
     Verify  → counts it as paid (the first one confirms the booking and
               emails the confirmation; the one that completes the total
               emails "fully paid").
     Reject  → doesn't count (e.g. wrong amount / not in the bank).
   "Record a payment" adds one taken another way (cash, card link, a
   transfer seen in the bank without an upload) — it counts straight away.
   ========================================================================== */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb;
  var $ = function (id) { return document.getElementById(id); };
  var backdrop = $("payModalBackdrop");
  if (!backdrop) return;
  var current = null;
  var KIND = { deposit: "50% down payment", full: "Full payment", balance: "Balance", other: "Payment" };
  var METHOD = { transfer: "Bank / e-wallet transfer", xendit: "Online · Xendit", link: "Payment link (card / e-wallet)", cash: "Cash", card: "Card at the resort", other: "Other" };
  var esc = D.esc, peso = D.peso;

  function close() { backdrop.classList.remove("open"); current = null; }
  $("payClose").addEventListener("click", close);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });

  function err(m) { var e = $("payError"); e.textContent = m || ""; e.style.display = m ? "block" : "none"; }

  function open(r) {
    current = r;
    err("");
    $("payTitle").textContent = "Payments · " + (r.order_code || "");
    $("paySub").textContent = (r.guest_name || "") + " · " + (r.stay_type === "overnight" ? D.fmtDate(r.check_in) + " → " + D.fmtDate(r.check_out) : D.fmtDate(r.check_in));
    $("payRecAmount").value = "";
    $("payRecNote").value = "";
    $("payRecKind").value = "balance";
    $("payRecMethod").value = "transfer";
    backdrop.classList.add("open");
    load();
  }

  function load() {
    var r = current;
    if (!r) return;
    $("paySummary").innerHTML = '<span class="muted">Loading…</span>';
    $("payRows").innerHTML = "";
    Promise.all([
      sb.rpc("booking_payment_summary", { p_booking_id: r.id }),
      sb.from("booking_payments").select("*").eq("booking_id", r.id).order("created_at"),
    ]).then(function (res) {
      if (res[0].error || res[1].error) {
        var m = (res[0].error || res[1].error).message || "";
        $("paySummary").innerHTML = /booking_payment|does not exist/i.test(m)
          ? '<span class="cb-warn">Payments need a one-time database update (booking-v16-payments.sql).</span>'
          : '<span class="cb-warn">Couldn\'t load payments: ' + esc(m) + "</span>";
        return;
      }
      var s = res[0].data || {}, rows = res[1].data || [];
      var total = Number(s.total) || 0, paid = Number(s.paid) || 0;
      var pct = total ? Math.min(100, Math.round(paid / total * 100)) : 0;
      var due = s.balance_due ? D.fmtDate(s.balance_due) : "";
      var overdue = s.balance_due && !s.fully_paid && paid > 0 && s.balance_due < new Date().toISOString().slice(0, 10);
      $("paySummary").innerHTML =
        '<div class="pay-bar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="pay-figs"><div><small>Total</small><b>' + esc(peso(total)) + "</b></div>" +
        "<div><small>Verified paid</small><b>" + esc(peso(paid)) + "</b></div>" +
        "<div><small>Balance</small><b" + (overdue ? ' class="cb-warn"' : "") + ">" + esc(peso(s.balance)) + "</b>" +
        (s.fully_paid ? '<em class="pay-ok">Fully paid</em>' : due ? "<em" + (overdue ? ' class="cb-warn"' : "") + ">due " + esc(due) + (overdue ? " — overdue" : "") + "</em>" : "") + "</div>" +
        (Number(s.pending) ? '<div><small>Waiting to verify</small><b class="cb-warn">' + esc(peso(s.pending)) + "</b></div>" : "") +
        "</div>";
      if (!rows.length) {
        $("payRows").innerHTML = '<tr><td colspan="6" class="muted" style="padding:14px;">No payments yet.</td></tr>';
        return;
      }
      $("payRows").innerHTML = "";
      rows.forEach(function (p) {
        var tr = document.createElement("tr");
        tr.className = "pay-" + p.status;
        tr.innerHTML =
          "<td>" + esc(D.fmtDateTime(p.created_at)) + '<span class="rel">' + esc(p.created_by ? "recorded by " + (D.staffLabel ? D.staffLabel(p.created_by) : p.created_by) : "uploaded by guest") + "</span></td>" +
          "<td>" + esc(KIND[p.kind] || p.kind) + '<span class="rel">' + esc(METHOD[p.method] || p.method) + "</span></td>" +
          '<td class="num">' + (p.status === "pending" ? '<input type="number" step="0.01" min="0" class="pay-amt" value="' + Number(p.amount) + '">' : esc(peso(p.amount))) + "</td>" +
          "<td>" + (p.proof_path ? '<a href="#" class="pay-proof">View proof</a>' : '<span class="muted">—</span>') + (p.note ? '<span class="rel">' + esc(p.note) + "</span>" : "") + "</td>" +
          '<td><span class="pay-st pay-st-' + p.status + '">' + (p.status === "pending" ? "To verify" : p.status === "verified" ? "Verified" : "Rejected") + "</span>" +
            (p.verified_by ? '<span class="rel">' + esc((D.staffLabel ? D.staffLabel(p.verified_by) : p.verified_by) + " · " + D.fmtDateTime(p.verified_at)) + "</span>" : "") + "</td>" +
          "<td>" + (p.status === "pending" ? '<button type="button" class="btn-sm primary pay-verify">Verify</button> <button type="button" class="btn-sm ghost pay-reject">Reject</button>' : "") + "</td>";
        var proof = tr.querySelector(".pay-proof");
        if (proof) proof.addEventListener("click", function (e) { e.preventDefault(); D.openSignedUrl("payment-proofs", p.proof_path); });
        var v = tr.querySelector(".pay-verify");
        if (v) v.addEventListener("click", function () { act(p, false, tr); });
        var x = tr.querySelector(".pay-reject");
        if (x) x.addEventListener("click", function () {
          var why = prompt("Reject this payment? It won't count as paid.\nReason (shown to staff only):", "");
          if (why === null) return;
          act(p, true, tr, why);
        });
        $("payRows").appendChild(tr);
      });
    });
  }

  function act(p, reject, tr, note) {
    err("");
    var amt = tr.querySelector(".pay-amt");
    var amount = amt ? Number(amt.value) : null;
    if (!reject && !(amount > 0)) return err("Enter the amount that actually reached the bank.");
    Array.prototype.forEach.call(tr.querySelectorAll("button"), function (b) { b.disabled = true; });
    sb.rpc("staff_verify_payment", { p_payment_id: p.id, p_amount: reject ? null : amount, p_reject: !!reject, p_note: note || null }).then(function (res) {
      if (res.error) { err("Couldn't save: " + res.error.message); load(); return; }
      load();
      D.reload();
    });
  }

  $("payRecSave").addEventListener("click", function () {
    err("");
    var amount = Number($("payRecAmount").value);
    if (!(amount > 0)) return err("Enter the amount received.");
    var btn = $("payRecSave");
    btn.disabled = true;
    sb.rpc("staff_record_payment", {
      p_booking_id: current.id, p_amount: amount, p_kind: $("payRecKind").value,
      p_method: $("payRecMethod").value, p_note: $("payRecNote").value || null,
    }).then(function (res) {
      btn.disabled = false;
      if (res.error) return err("Couldn't save: " + res.error.message);
      $("payRecAmount").value = ""; $("payRecNote").value = "";
      load();
      D.reload();
    });
  });

  window.VBRPayments = { open: open };
})();
