// =============================================================================
// Staff dashboard: "Cancel booking…" for EVERY booking (v67) — villas and day
// trips, made by the guest on the website, by staff, or in Cloudbeds.
// A button in the booking window opens a small dialog: why (reason + note for
// the team) and, optionally, an email to the guest that opens with the
// staff's own message. staff_cancel_booking() (booking-v67) cancels it,
// releases the casita / cabana, cancels it in Cloudbeds when it's there, and
// send-booking-email sends the message. View-only accounts never see it.
// The booking window is found from its title ("Edit Booking · VBR-…").
// v72: "Payment deadline…" — staff choose how long an unpaid booking is held
// (a date & time, the standard rule, or never cancel automatically), and the
// default for website day trips (Booking window settings).
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
    ".scx-f[hidden],.scx-back [hidden]{display:none!important}" +
    ".sdl-btn{background:none;border:0;padding:0;color:var(--lagoon-deep,#0f6f68);text-decoration:underline;cursor:pointer;font:inherit;font-size:.78rem;margin-left:4px}body.ro-staff .sdl-btn{display:none!important}" +
    ".sdl-opt{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin:0 0 8px;cursor:pointer;font-size:.88rem}.sdl-opt.on{border-color:var(--lagoon,#1f7a72);background:var(--lagoon-tint,#e4f2ef)}.sdl-opt input{margin-top:3px}.sdl-opt small{display:block;color:var(--ink-soft);font-size:.78rem;margin-top:2px}" +
    ".sdl-row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}.sdl-row input[type=datetime-local]{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:inherit;font-size:.86rem;background:var(--sand)}" +
    ".sdl-chip{border:1px solid var(--line);background:var(--surface,#fff);border-radius:999px;padding:4px 10px;font:inherit;font-size:.76rem;font-weight:700;cursor:pointer}.sdl-chip:hover{border-color:var(--lagoon,#1f7a72)}" +
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
    return sb.from("booking_requests").select("id,order_code,guest_name,guest_email,stay_type,stay_type_label,status,check_in,check_out,total_amount,amount_paid,cb_reservation_id,cb_owned,cb_info,booking_origin,source,hold_mode,hold_until,hold_note")
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
        el.innerHTML = autoHtml(res.data) + (el.id !== "sdlNow" && ACTIVE.indexOf(String(r.status)) > -1 && r.cb_owned !== true && r.source !== "sheet_import" && !(res.data && res.data.source === "none")
          ? ' <button type="button" class="sdl-btn" data-sdl="' + esc(r.order_code) + '">Change deadline…</button>' : "");
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
      cur = null; dlCur = null;
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

  // ---------------------------------------------------------------- v72: payment deadline per booking
  var dlCur = null;
  function manilaParts(d) {
    var f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    var o = {}; f.forEach(function (x) { o[x.type] = x.value; });
    return o.year + "-" + o.month + "-" + o.day + "T" + (o.hour === "24" ? "00" : o.hour) + ":" + o.minute;
  }
  function fromManila(v) { return v ? new Date(v + ":00+08:00") : null; }
  function addDaysStr(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function openDeadline(code) {
    if (!code) return;
    fetchRow(code).then(function (r) {
      if (!r) { alert("Couldn't find " + code + "."); return; }
      if (r.hold_mode === undefined) { alert("Payment deadlines need the database update booking-v72-payment-deadline-control.sql."); return; }
      dlCur = { row: r }; cur = null; payCur = null;
      var mode = r.hold_mode === "until" ? "until" : r.hold_mode === "off" ? "off" : "standard";
      var now = new Date(), ci = r.check_in;
      var preset = [];
      var today = manilaParts(now).slice(0, 10);
      preset.push(["Today 5:00 PM", today + "T17:00"]);
      preset.push(["Tomorrow 12:00 PM", addDaysStr(today, 1) + "T12:00"]);
      preset.push(["In 24 hours", manilaParts(new Date(now.getTime() + 864e5))]);
      if (ci) preset.push([r.stay_type === "overnight" ? "2 days before arrival, 5:00 PM" : "Day before the trip, 5:00 PM", addDaysStr(ci, r.stay_type === "overnight" ? -2 : -1) + "T17:00"]);
      preset = preset.filter(function (x) { var d = fromManila(x[1]); return d && d.getTime() > now.getTime() + 15 * 60e3 && (!ci || x[1].slice(0, 10) <= ci); });
      var hasEmail = EMAIL_RE.test(String(r.guest_email || "").trim()) && ["pending", "pending_payment"].indexOf(String(r.status)) > -1;
      var until = r.hold_until ? manilaParts(new Date(r.hold_until)) : (preset[0] ? preset[0][1] : "");
      $("scxTitle").textContent = "Payment deadline — " + (r.order_code || "");
      $("scxSub").textContent = (r.guest_name || "Guest") + " · " + (r.stay_type === "overnight" ? "Villa stay" : (r.stay_type_label || "Day trip")) + " · " + dateText(r) + " · " + peso(r.total_amount) + (Number(r.amount_paid) ? " (paid " + peso(r.amount_paid) + ")" : "");
      $("scxBody").innerHTML =
        '<p class="scx-info" id="sdlNow"></p>' +
        '<span class="scx-lbl">How long to hold it while waiting for payment</span>' +
        '<label class="sdl-opt" data-m="until"><input type="radio" name="sdlMode" value="until"' + (mode === "until" ? " checked" : "") + '><span><b>Cancel if unpaid by…</b><small>The booking is cancelled automatically at this time if nothing is paid, and the ' + (r.stay_type === "overnight" ? "casita is" : "cabana is") + ' released. Earlier or later than the usual rule.</small>' +
          '<span class="sdl-row"><input type="datetime-local" id="sdlUntil" value="' + esc(until) + '"> <span class="scx-hint">Manila time</span></span>' +
          '<span class="sdl-row">' + preset.map(function (x) { return '<button type="button" class="sdl-chip" data-v="' + esc(x[1]) + '">' + esc(x[0]) + "</button>"; }).join("") + "</span></span></label>" +
        '<label class="sdl-opt" data-m="standard"><input type="radio" name="sdlMode" value="standard"' + (mode === "standard" ? " checked" : "") + '><span><b>Standard rule</b><small>' +
          esc(r.stay_type === "overnight" ? "Villas: cancelled 24 hours after booking if unpaid (booked 15+ days ahead); never for bookings 14 days or less before arrival." :
            "Website day trips: the default in Booking window settings (5:00 PM on the trip day unless changed). Staff-entered day trips: never.") + "</small></span></label>" +
        '<label class="sdl-opt" data-m="off"><input type="radio" name="sdlMode" value="off"' + (mode === "off" ? " checked" : "") + '><span><b>Don\'t cancel automatically</b><small>The team follows up and cancels it by hand if needed.</small></span></label>' +
        '<div class="scx-f"><label for="sdlNote">Note for the team</label><input id="sdlNote" maxlength="300" value="' + esc(r.hold_note || "") + '" placeholder="e.g. Guest asked for until Friday noon — paying via bank transfer"></div>' +
        (hasEmail ? '<label class="scx-chk"><input type="checkbox" id="sdlEmail"' + (mode === "until" ? "" : "") + '><span><b>Email the guest the payment link with this deadline</b> at ' + esc(r.guest_email) + "</span></label>" +
          '<div class="scx-f" id="sdlMsgWrap" hidden><label for="sdlMsg">Message to the guest</label><textarea id="sdlMsg">' + esc("Hi {first},\n\nThis is a reminder about your reservation {order} for {date}. To keep it, please complete your payment by the deadline below.") + "</textarea></div>" : "") +
        '<p class="scx-err" id="sdlErr"></p>' +
        '<div class="scx-acts"><button type="button" class="btn-sm ghost" data-x="close">Close</button><button type="button" class="btn-sm spl-go" id="sdlGo">Save deadline</button></div>';
      back.classList.add("open");
      syncDl();
      loadAuto(r.order_code, $("sdlNow"), "scx-info");
    });
  }
  function syncDl() {
    var m = (back.querySelector('input[name=sdlMode]:checked') || {}).value;
    Array.prototype.forEach.call(back.querySelectorAll(".sdl-opt"), function (o) { o.classList.toggle("on", o.getAttribute("data-m") === m); });
    if ($("sdlEmail")) { $("sdlEmail").disabled = m === "off"; if (m === "off") $("sdlEmail").checked = false; $("sdlMsgWrap").hidden = !$("sdlEmail").checked; }
  }
  back.addEventListener("change", function (e) {
    if (!dlCur) return;
    if (e.target.name === "sdlMode" || e.target.id === "sdlEmail") syncDl();
    if (e.target.id === "sdlUntil") { var u = back.querySelector('input[name=sdlMode][value=until]'); if (u) { u.checked = true; syncDl(); } }
  });
  back.addEventListener("click", function (e) {
    if (!dlCur) return;
    var chip = e.target.closest(".sdl-chip");
    if (chip) { e.preventDefault(); $("sdlUntil").value = chip.getAttribute("data-v"); back.querySelector('input[name=sdlMode][value=until]').checked = true; syncDl(); return; }
    if (!e.target.closest("#sdlGo")) return;
    var r = dlCur.row, m = (back.querySelector('input[name=sdlMode]:checked') || {}).value;
    var note = $("sdlNote").value.trim(), until = m === "until" ? fromManila($("sdlUntil").value) : null;
    var email = $("sdlEmail") && $("sdlEmail").checked;
    if (!m) { $("sdlErr").textContent = "Choose an option."; return; }
    if (m === "until" && !until) { $("sdlErr").textContent = "Choose the date and time."; return; }
    if (m === "off" && !note) { $("sdlErr").textContent = "Add a short note on why it shouldn't be cancelled automatically."; $("sdlNote").focus(); return; }
    var btn = $("sdlGo"); btn.disabled = true; btn.textContent = "Saving…"; $("sdlErr").textContent = "";
    sb.rpc("staff_set_payment_deadline", { p_booking_id: r.id, p_mode: m, p_until: until ? until.toISOString() : null, p_note: note || null,
      p_email_guest: !!email, p_message: email && $("sdlMsg") ? ($("sdlMsg").value.trim() || null) : null }).then(function (res) {
      if (res.error) { btn.disabled = false; btn.textContent = "Save deadline"; $("sdlErr").textContent = res.error.message; return; }
      dlCur = null;
      back.classList.remove("open");
      var a = res.data || {};
      alert(r.order_code + ": " + (a.at ? "cancels automatically " + fmtAt(a.at) + " if still unpaid." : (a.note || "saved.")) + (a.emailed ? "\nPayment link emailed to " + a.to + "." : ""));
      document.querySelectorAll(".scx-auto[data-code]").forEach(function (x) { x.removeAttribute("data-code"); });
      var pbox = document.querySelector(".scx-panel"); if (pbox) pbox.removeAttribute("data-code");
      place(); placePanel();
      if (D.reload) D.reload();
    });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-sdl]");
    if (!b || back.contains(b)) return;
    e.preventDefault(); e.stopPropagation();
    openDeadline(b.getAttribute("data-sdl"));
  }, true);
  back.addEventListener("click", function (e) {
    var b = e.target.closest("[data-sdl]");
    if (b) { e.preventDefault(); openDeadline(b.getAttribute("data-sdl")); }
  });

  // ---------------------------------------------------------------- v72: default for website day trips (Booking window settings)
  var HOLD_RULES = [["trip_day_5pm", "5:00 PM on the trip day (standard)"], ["day_before_5pm", "5:00 PM the day before the trip"],
    ["hours_6", "6 hours after booking"], ["hours_12", "12 hours after booking"], ["hours_24", "24 hours after booking"], ["hours_48", "48 hours after booking"]];
  function placeHoldRule() {
    var bal = $("bwDtBalance"), wb = $("windowModalBackdrop");
    if (!bal || !wb || $("bwDtHold")) return;
    var wrap = document.createElement("div");
    wrap.className = "modal-field";
    wrap.innerHTML = '<label for="bwDtHold">Day trips booked online by guests: cancel if still unpaid by</label><select id="bwDtHold">' +
      HOLD_RULES.map(function (x) { return '<option value="' + x[0] + '">' + esc(x[1]) + "</option>"; }).join("") + "</select>" +
      '<p class="field-hint" style="margin:4px 0 0">Earlier releases the cabana sooner so other guests can book it. Applies to bookings made after you change it (and never later than 5:00 PM on the trip day). Staff can set a different deadline on any booking with &ldquo;Change deadline&hellip;&rdquo;.</p>';
    var lbl = bal.closest("label");
    lbl.parentNode.insertBefore(wrap, lbl.nextSibling);
    new MutationObserver(function () {
      if (!wb.classList.contains("open")) return;
      sb.from("booking_settings").select("daytrip_hold_rule").eq("id", 1).maybeSingle().then(function (res) {
        if (res.error) { $("bwDtHold").disabled = true; return; }
        $("bwDtHold").disabled = false;
        $("bwDtHold").value = (res.data && res.data.daytrip_hold_rule) || "trip_day_5pm";
        $("bwDtHold").setAttribute("data-was", $("bwDtHold").value);
      });
    }).observe(wb, { attributes: true, attributeFilter: ["class"] });
    $("bwSave").addEventListener("click", function () {
      var sel = $("bwDtHold");
      if (!sel || sel.disabled || sel.value === sel.getAttribute("data-was")) return;
      sb.from("booking_settings").update({ daytrip_hold_rule: sel.value }).eq("id", 1).then(function (res) {
        if (res.error) { alert("Couldn't save the day-trip payment deadline: " + res.error.message); return; }
        sel.setAttribute("data-was", sel.value);
      });
    });
  }
  setTimeout(placeHoldRule, 600);

  // ---------------------------------------------------------------- the dialog
  var cur = null; // { row, backdrop }
  function close() { back.classList.remove("open"); cur = null; payCur = null; dlCur = null; }
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
    payCur = null; dlCur = null;
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
