// =============================================================================
// Staff dashboard: "Cancel booking…" for EVERY booking (v67) — villas and day
// trips, made by the guest on the website, by staff, or in Cloudbeds.
// A button in the booking window opens a small dialog: why (reason + note for
// the team) and, optionally, an email to the guest that opens with the
// staff's own message. staff_cancel_booking() (booking-v67) cancels it,
// releases the casita / cabana, cancels it in Cloudbeds when it's there, and
// send-booking-email sends the message. View-only accounts never see it.
// The booking window is found from its title ("Edit Booking · VBR-…").
// v71: "Send payment link…" next to it — the quotation with the Pay now button
// again, to the email on the booking now (staff_resend_payment_link).
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc, peso = D.peso || function (n) { return "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 }); };
  var $ = function (id) { return document.getElementById(id); };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var REASONS = [
    ["guest_cancelled", "Guest asked to cancel", true],
    ["not_paid", "Not paid", true],
    ["resort", "Cancelled by the resort (weather, closure, overbooking…)", true],
    ["duplicate", "Duplicate / correction", false],
    ["test", "Test booking", false],
    ["other", "Other (add a note)", true],
  ];
  var TEMPLATES = {
    guest_cancelled: "Hi {first},\n\nAs you requested, your reservation {order} for {date} has been cancelled.",
    not_paid: "Hi {first},\n\nWe didn't receive your payment for reservation {order} for {date}, so it has been cancelled and released.",
    resort: "Hi {first},\n\nWe're very sorry — we have to cancel your reservation {order} for {date}.",
    duplicate: "Hi {first},\n\nYour reservation {order} for {date} was a duplicate, so we've cancelled it. Your other reservation is not affected.",
    test: "Hi {first},\n\nThis is to let you know that your reservation {order} for {date} has been cancelled.",
    other: "Hi {first},\n\nThis is to let you know that your reservation {order} for {date} has been cancelled.",
  };
  var ACTIVE = ["pending", "pending_payment", "confirmed"];

  // ---------------------------------------------------------------- styles
  var css = document.createElement("style");
  css.textContent =
    ".scx-btn{background:#fbe9e7;color:#9b2c2c;border:1px solid #f1c4bd;margin-right:8px}.scx-auto{margin-right:auto;font-size:.78rem;line-height:1.35;color:var(--ink-soft);max-width:440px;align-self:center}.scx-auto b{color:#9b2c2c}.scx-auto.none b{color:var(--ink)}.scx-btn:hover{background:#f6d9d3}" +
    "body.ro-staff .scx-btn,body.ro-staff .scx-auto,body.ro-staff .spl-btn{display:none!important}" +
    ".spl-btn{background:var(--lagoon-tint,#e4f2ef);color:var(--lagoon-deep,#0f6f68);border:1px solid #bfe0d9;margin-right:8px}.spl-btn:hover{filter:brightness(.97)}" +
    ".spl-go{background:var(--lagoon,#1f7a72)!important;color:#fff!important;border:0}.spl-go:disabled{opacity:.6}" +
    "#vCxOpen{display:none!important}" + // v61's villa-only button: this one replaces it
    ".scx-back{position:fixed;inset:0;background:rgba(20,28,27,.5);z-index:2000;display:none;align-items:flex-start;justify-content:center;overflow:auto;padding:5vh 12px}" +
    ".scx-back.open{display:flex}.scx-box{background:var(--surface,#fffdf8);border-radius:14px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:18px 20px}" +
    ".scx-box h3{margin:0 0 4px;font-family:var(--font-display);font-weight:600;font-size:1.2rem}.scx-sub{font-size:.84rem;color:var(--ink-soft);margin:0 0 12px}" +
    ".scx-f{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}.scx-f label,.scx-lbl{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft)}" +
    ".scx-f select,.scx-f input,.scx-f textarea{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--sand);color:var(--ink);font:inherit;font-size:.9rem;width:100%;box-sizing:border-box}" +
    ".scx-f textarea{min-height:130px;line-height:1.5}.scx-chk{display:flex;gap:8px;align-items:flex-start;font-size:.88rem;margin:0 0 10px;cursor:pointer}.scx-chk input{margin-top:3px}" +
    ".scx-warn{background:#fdf1dc;color:#7f5200;border-radius:10px;padding:8px 10px;font-size:.82rem;margin:0 0 10px}.scx-info{background:var(--lagoon-tint,#e4f2ef);color:var(--lagoon-deep,#0f6f68);border-radius:10px;padding:8px 10px;font-size:.82rem;margin:0 0 10px}" +
    ".scx-err{color:#b3261e;font-size:.84rem;font-weight:600;min-height:1em;margin:0 0 8px}.scx-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}" +
    ".scx-go{background:#b3261e!important;color:#fff!important;border:0}.scx-go:disabled{opacity:.6}.scx-hint{font-size:.74rem;color:var(--ink-soft)}";
  document.head.appendChild(css);

  var back = document.createElement("div");
  back.className = "scx-back";
  back.innerHTML = '<div class="scx-box" role="dialog" aria-modal="true" aria-labelledby="scxTitle"><h3 id="scxTitle">Cancel booking</h3><p class="scx-sub" id="scxSub"></p><div id="scxBody"></div></div>';
  document.body.appendChild(back);

  // ---------------------------------------------------------------- which booking is open
  function codeIn(backdropId) {
    var bd = $(backdropId);
    if (!bd || !bd.classList.contains("open")) return null;
    var h = bd.querySelector("h2");
    var m = h && h.textContent.match(/\b(VBR-[A-Z0-9-]+)/i);
    return m ? m[1].toUpperCase() : null;
  }
  function rowByCode(code) {
    if (!code) return null;
    var all = (D.rows() || []).concat(D.villaRows ? (D.villaRows() || []) : []);
    for (var i = 0; i < all.length; i++) if (String(all[i].order_code || "").toUpperCase() === code) return all[i];
    return null;
  }
  function fetchRow(code) {
    return sb.from("booking_requests").select("id,order_code,guest_name,guest_email,stay_type,stay_type_label,status,check_in,check_out,total_amount,amount_paid,cb_reservation_id,cb_owned,cb_info,booking_origin")
      .eq("order_code", code).limit(1).then(function (res) { return res.data && res.data[0] ? res.data[0] : null; });
  }

  // ---------------------------------------------------------------- when would it cancel automatically? (v68)
  function fmtAt(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" }) + " · " +
      d.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
  }
  function autoHtml(a) {
    if (!a) return "";
    if (a.at) {
      return a.past
        ? "⏱ <b>Due to cancel automatically since " + esc(fmtAt(a.at)) + "</b> " + esc(a.rule || "") + " — the next check (every 10 min) will close it."
        : "⏱ <b>Cancels automatically " + esc(fmtAt(a.at)) + "</b> " + esc(a.rule || "") + ".";
    }
    return "<b>No automatic cancellation</b> — " + esc(a.note || "");
  }
  var autoSeq = 0;
  function loadAuto(code, el, cls) {
    var seq = ++autoSeq;
    el.innerHTML = '<span class="scx-hint">Checking automatic cancellation…</span>';
    var known = rowByCode(code);
    (known && known.id ? Promise.resolve(known) : fetchRow(code)).then(function (r) {
      if (!r) { el.innerHTML = ""; return; }
      return sb.rpc("booking_auto_cancel", { p_booking_id: r.id }).then(function (res) {
        if (seq !== autoSeq && cls === "scx-auto") return;
        if (res.error) { el.innerHTML = ""; return; }
        el.className = cls + (res.data && res.data.at ? "" : " none");
        el.innerHTML = autoHtml(res.data);
      });
    });
  }

  // ---------------------------------------------------------------- the button in each booking window
  var WINDOWS = [["addModalBackdrop", "saveBookingBtn"], ["villaModalBackdrop", "vSave"]];
  function place() {
    WINDOWS.forEach(function (w) {
      var bd = $(w[0]), save = $(w[1]);
      if (!bd || !save) return;
      var btn = bd.querySelector(".scx-btn");
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-sm scx-btn";
        btn.textContent = "Cancel booking…";
        btn.addEventListener("click", function () { openFor(w[0]); });
        save.parentElement.insertBefore(btn, save.parentElement.firstChild);
      }
      var code = codeIn(w[0]), r = rowByCode(code);
      btn.hidden = !code || (r && ACTIVE.indexOf(String(r.status)) === -1);
      // v71: send the payment link again (to the email on the booking now)
      var pb = bd.querySelector(".spl-btn");
      if (!pb) {
        pb = document.createElement("button");
        pb.type = "button";
        pb.className = "btn-sm spl-btn";
        pb.textContent = "Send payment link…";
        pb.addEventListener("click", function () { openPay(codeIn(w[0]), w[0]); });
        btn.parentElement.insertBefore(pb, btn);
      }
      pb.hidden = !code || !payable(r);
      // v68: when it would be cancelled automatically, right next to the button
      var info = bd.querySelector(".scx-auto");
      if (!info) { info = document.createElement("span"); info.className = "scx-auto"; btn.parentElement.insertBefore(info, btn.nextSibling); }
      info.hidden = btn.hidden;
      if (!btn.hidden && info.getAttribute("data-code") !== code) { info.setAttribute("data-code", code); loadAuto(code, info, "scx-auto"); }
      if (btn.hidden) info.removeAttribute("data-code");
    });
  }
  WINDOWS.forEach(function (w) {
    var bd = $(w[0]);
    if (bd) new MutationObserver(function () { setTimeout(place, 60); }).observe(bd, { attributes: true, attributeFilter: ["class"], subtree: false });
  });
  setTimeout(place, 500);

  // ---------------------------------------------------------------- Cloudbeds view: the booking side panel
  // Bookings open in #cbPanel there (staff-cloudbeds-pages.js), not in the
  // booking windows — put the same button + automatic-cancellation line under
  // the status row. The panel re-renders itself, so re-add it when it's gone.
  css.textContent += ".scx-panel{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:8px 0 2px}.scx-panel .scx-auto{margin-right:0;max-width:none;flex:1 1 200px}";
  function placePanel() {
    var p = $("cbPanel");
    if (!p) return;
    var codeEl = p.querySelector(".cbp-who .cb-dim"), row = p.querySelector(".cbp-statusrow");
    var m = codeEl && codeEl.textContent.match(/\b(VBR-[A-Z0-9-]+)/i);
    var box = p.querySelector(".scx-panel");
    if (!m || !row) { if (box) box.remove(); return; }
    var code = m[1].toUpperCase();
    if (box && box.getAttribute("data-code") === code) return;
    if (box) box.remove();
    box = document.createElement("div");
    box.className = "scx-panel";
    box.setAttribute("data-code", code);
    box.innerHTML = '<button type="button" class="btn-sm spl-btn">Send payment link…</button><button type="button" class="btn-sm scx-btn">Cancel booking…</button><span class="scx-auto"></span>';
    row.parentNode.insertBefore(box, row.nextSibling);
    box.querySelector(".scx-btn").addEventListener("click", function () { openCode(code, null); });
    box.querySelector(".spl-btn").addEventListener("click", function () { openPay(code, null); });
    var r = rowByCode(code);
    box.querySelector(".spl-btn").hidden = !payable(r);
    if (r && ACTIVE.indexOf(String(r.status)) === -1) { box.hidden = true; return; }
    loadAuto(code, box.querySelector(".scx-auto"), "scx-auto");
  }
  var panelTimer = null;
  function watchPanel() {
    var p = $("cbPanel");
    if (!p) { setTimeout(watchPanel, 500); return; }
    new MutationObserver(function () { clearTimeout(panelTimer); panelTimer = setTimeout(placePanel, 80); }).observe(p, { childList: true, subtree: true, characterData: true });
    placePanel();
  }
  watchPanel();

  // ---------------------------------------------------------------- v71: send the payment link again
  // Waiting for payment, nothing paid, not made in Cloudbeds. Unknown row
  // (not loaded in the lists) → show the button; the dialog checks the latest.
  function payable(r) {
    if (!r) return true;
    return ["pending", "pending_payment"].indexOf(String(r.status)) > -1 && !(Number(r.amount_paid) >= 0.5) && r.cb_owned !== true;
  }
  var payCur = null;
  function openPay(code, backdropId) {
    if (!code) return;
    fetchRow(code).then(function (r) {
      if (!r) { alert("Couldn't find " + code + ". Reload the page and try again."); return; }
      payCur = { row: r, backdrop: backdropId };
      cur = null;
      var hasEmail = EMAIL_RE.test(String(r.guest_email || "").trim());
      $("scxTitle").textContent = "Send payment link — " + (r.order_code || "");
      $("scxSub").textContent = (r.guest_name || "Guest") + " · " + (r.stay_type === "overnight" ? "Villa stay" : (r.stay_type_label || "Day trip")) + " · " + dateText(r) + " · " + peso(r.total_amount);
      var problem = !payable(r) ? (Number(r.amount_paid) >= 0.5 ? "A payment is already recorded on this booking — the balance reminder handles the rest." :
        r.cb_owned === true ? "This booking was made in Cloudbeds — send the payment request from Cloudbeds." :
        "This booking is " + (D.statusLabel ? D.statusLabel(r) : r.status) + " — only bookings waiting for payment can get a payment link.") :
        !hasEmail ? "There's no valid email on this booking. Correct it in the booking and save first." : "";
      if (problem) {
        $("scxBody").innerHTML = '<p class="scx-warn">' + esc(problem) + '</p><div class="scx-acts"><button type="button" class="btn-sm ghost" data-x="close">Close</button></div>';
        back.classList.add("open");
        return;
      }
      $("scxBody").innerHTML =
        '<p class="scx-info">The guest gets the quotation again with the <b>Pay now</b> button, sent to <b>' + esc(r.guest_email) + '</b> — the email saved on the booking now. If you just corrected it, save the booking first.</p>' +
        '<div class="scx-f"><label for="splMsg">Message to the guest</label><textarea id="splMsg">' + esc("Hi {first},\n\nAs requested, here is the payment link for your reservation {order} for {date}. Your booking details are below.") + '</textarea>' +
        '<span class="scx-hint">Opens the email; the amount, the deadline and the Pay now button follow. {first} = first name, {order} = booking ID, {date} = date(s).</span></div>' +
        '<p class="scx-info" id="splAuto"></p><p class="scx-err" id="splErr"></p>' +
        '<div class="scx-acts"><button type="button" class="btn-sm ghost" data-x="close">Close</button><button type="button" class="btn-sm spl-go" id="splGo">Send payment link</button></div>';
      back.classList.add("open");
      loadAuto(r.order_code, $("splAuto"), "scx-info");
    });
  }
  back.addEventListener("click", function (e) {
    if (!e.target.closest("#splGo") || !payCur) return;
    var r = payCur.row, btn = $("splGo");
    btn.disabled = true; btn.textContent = "Sending…"; $("splErr").textContent = "";
    sb.rpc("staff_resend_payment_link", { p_booking_id: r.id, p_message: ($("splMsg").value || "").trim() || null }).then(function (res) {
      if (res.error) { btn.disabled = false; btn.textContent = "Send payment link"; $("splErr").textContent = res.error.message; return; }
      payCur = null;
      back.classList.remove("open");
      alert("Payment link sent to " + ((res.data && res.data.to) || r.guest_email) + ". It's noted in the staff notes.");
      if (D.reload) D.reload();
    });
  });

  // ---------------------------------------------------------------- the dialog
  var cur = null; // { row, backdrop }
  function close() { back.classList.remove("open"); cur = null; payCur = null; }
  back.addEventListener("click", function (e) { if (e.target === back) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && back.classList.contains("open")) { e.stopPropagation(); close(); } }, true);

  function dateText(r) {
    var f = function (s) { return s ? new Date(String(s).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—"; };
    return r.stay_type === "overnight" && r.check_out ? f(r.check_in) + " – " + f(r.check_out) : f(r.check_in);
  }
  function openFor(backdropId) { openCode(codeIn(backdropId), backdropId); }
  function openCode(code, backdropId) {
    if (!code) return;
    var known = rowByCode(code);
    (known && known.id ? Promise.resolve(known) : fetchRow(code)).then(function (r) {
      if (!r) { alert("Couldn't find " + code + ". Reload the page and try again."); return; }
      // always check the latest state
      return fetchRow(code).then(function (fresh) { show(fresh || r, backdropId); });
    });
  }
  function show(r, backdropId) {
    cur = { row: r, backdrop: backdropId };
    payCur = null;
    msgTouched = false;
    var villa = r.stay_type === "overnight";
    var paid = Number(r.amount_paid) || 0;
    var hasEmail = EMAIL_RE.test(String(r.guest_email || "").trim());
    var inCb = !!r.cb_reservation_id;
    $("scxTitle").textContent = "Cancel " + (r.order_code || "booking");
    $("scxSub").textContent = (r.guest_name || "Guest") + " · " + (villa ? "Villa stay" : (r.stay_type_label || "Day trip")) + " · " + dateText(r) +
      " · " + peso(r.total_amount) + (paid ? " (paid " + peso(paid) + ")" : "");
    if (ACTIVE.indexOf(String(r.status)) === -1) {
      $("scxBody").innerHTML = '<p class="scx-warn">This booking is ' + esc(D.statusLabel ? D.statusLabel(r) : r.status) + ' — there is nothing to cancel.</p><div class="scx-acts"><button type="button" class="btn-sm ghost" data-x="close">Close</button></div>';
      back.classList.add("open");
      return;
    }
    $("scxBody").innerHTML =
      '<div class="scx-f"><label for="scxReason">Why</label><select id="scxReason"><option value="">Choose a reason…</option>' +
      REASONS.map(function (x) { return '<option value="' + x[0] + '">' + esc(x[1]) + "</option>"; }).join("") + "</select></div>" +
      '<div class="scx-f"><label for="scxNote">Note for the team <span class="scx-hint">(not sent to the guest)</span></label><input id="scxNote" maxlength="300" placeholder="e.g. Guest moved to Dec 12 (VBR-27501)"></div>' +
      (paid ? '<p class="scx-warn"><b>' + esc(peso(paid)) + " has been paid.</b> Cancelling doesn't refund it. Handle the refund or credit separately, as the Reservations Agreement says; the email tells the guest the team will contact them about it.</p>" : "") +
      (villa && inCb ? '<p class="scx-info">This stay is also cancelled in <b>Cloudbeds</b> (#' + esc(r.cb_reservation_id) + "). Cloudbeds won't send its own email; the guest only gets yours below.</p>" : "") +
      '<label class="scx-chk"><input type="checkbox" id="scxEmail"' + (hasEmail ? " checked" : " disabled") + "><span><b>Email the guest</b>" +
      (hasEmail ? " at " + esc(r.guest_email) : " — <i>no valid email on this booking</i>") + "</span></label>" +
      '<div class="scx-f" id="scxMsgWrap"' + (hasEmail ? "" : " hidden") + '><label for="scxMsg">Message to the guest</label><textarea id="scxMsg"></textarea>' +
      '<span class="scx-hint">Opens the cancellation email; the booking details and our contact details are added below it. {first} = guest\'s first name, {order} = booking ID, {date} = date(s).</span></div>' +
      '<p class="scx-info" id="scxAuto"></p>' +
      '<p class="scx-err" id="scxErr"></p>' +
      '<div class="scx-acts"><button type="button" class="btn-sm ghost" data-x="close">Keep the booking</button><button type="button" class="btn-sm scx-go" id="scxGo">Cancel booking</button></div>';
    back.classList.add("open");
    loadAuto(r.order_code, $("scxAuto"), "scx-info");
    $("scxReason").focus();
  }
  var msgTouched = false;
  back.addEventListener("input", function (e) { if (e.target.id === "scxMsg") msgTouched = true; });
  back.addEventListener("change", function (e) {
    if (e.target.id === "scxReason") {
      var r = REASONS.filter(function (x) { return x[0] === e.target.value; })[0];
      if ($("scxMsg") && (!msgTouched || !$("scxMsg").value.trim())) { $("scxMsg").value = TEMPLATES[e.target.value] || ""; msgTouched = false; }
      if (r && $("scxEmail") && !$("scxEmail").disabled) { $("scxEmail").checked = r[2]; $("scxMsgWrap").hidden = !r[2]; }
    }
    if (e.target.id === "scxEmail") $("scxMsgWrap").hidden = !e.target.checked;
  });
  back.addEventListener("click", function (e) {
    if (e.target.closest("[data-x=close]")) { close(); return; }
    if (!e.target.closest("#scxGo") || !cur) return;
    var r = cur.row, reason = $("scxReason").value, note = $("scxNote").value.trim();
    var email = $("scxEmail") && $("scxEmail").checked, msg = $("scxMsg") ? $("scxMsg").value.trim() : "";
    if (!reason) { $("scxErr").textContent = "Choose why the booking is cancelled."; return; }
    if (reason === "other" && !note) { $("scxErr").textContent = "Add a short note for “Other”."; $("scxNote").focus(); return; }
    if (email && !msg) { $("scxErr").textContent = "Write the message to the guest, or untick “Email the guest”."; return; }
    if (!confirm("Cancel " + (r.order_code || "this booking") + (email ? " and email the guest" : " without emailing the guest") + "?")) return;
    var btn = $("scxGo"); btn.disabled = true; btn.textContent = "Cancelling…"; $("scxErr").textContent = "";
    sb.rpc("staff_cancel_booking", { p_booking_id: r.id, p_reason: reason, p_message: email ? msg : null, p_email_guest: !!email, p_note: note || null }).then(function (res) {
      if (res.error) { btn.disabled = false; btn.textContent = "Cancel booking"; $("scxErr").textContent = res.error.message; return; }
      var bd = cur.backdrop ? $(cur.backdrop) : null;
      close();
      if (bd) bd.classList.remove("open");
      if (!bd && window.VBRPanel && window.VBRPanel.close) window.VBRPanel.close();
      document.body.style.overflow = "";
      alert(r.order_code + " is cancelled." + (email ? " The guest is being emailed." : " The guest was not emailed.") +
        (res.data && res.data.cloudbeds ? " Cloudbeds is updated within a few minutes." : ""));
      if (D.reload) D.reload();
    });
  });
})();
