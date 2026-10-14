/* ==========================================================================
   Staff dashboard — "Email to guest" composer
   --------------------------------------------------------------------------
   Used by the Day Trip and Villa booking forms. Staff pick a template, edit
   the opening message (and the subject of the first email), and see a live
   preview of the exact email the guest will receive — rendered by the
   send-booking-email function from the unsaved form, so the amounts, bank
   details and links are the real ones. Nothing is sent until Save.
   Tokens in templates: {first} {name} {order} {date} {checkout} {nights}
   ========================================================================== */
(function () {
  "use strict";

  var TEMPLATES = {
    quote_daytrip: [
      ["Standard quotation", "Hi {first},\n\nThank you for choosing Virgin Beach Resort! As discussed with our reservations team, here is the quotation for your visit on {date}. We're holding your reservation for you until the payment deadline below."],
      ["After a Messenger / phone chat", "Hi {first},\n\nIt was lovely chatting with you! As promised, here is the quotation for {date}. Everything we discussed is listed below — just follow the payment steps to lock in your reservation."],
      ["Returning guest", "Hi {first},\n\nWelcome back to Virgin Beach Resort — we're so happy you're coming again! Here is the quotation for your visit on {date}."],
      ["Celebration / special occasion", "Hi {first},\n\nThank you for choosing Virgin Beach Resort for your celebration! Here is the quotation for {date}. Let us know if there's anything special we can prepare for your group."],
      ["Group / company", "Hi {first},\n\nThank you for considering Virgin Beach Resort for your group. Here is the quotation for {date}, based on the head count and areas we discussed. If the number of guests changes, just reply and we'll update it for you."],
    ],
    quote_overnight: [
      ["Standard quotation", "Hi {first},\n\nThank you for choosing Virgin Beach Resort! As discussed with our reservations team, here is the quotation for your overnight stay from {date} to {checkout} ({nights} night/s). We're holding your casita for you until the payment deadline below."],
      ["After a Messenger / phone chat", "Hi {first},\n\nIt was lovely chatting with you! As promised, here is the quotation for your stay from {date} to {checkout}. Everything we discussed is listed below — just follow the payment steps to lock in your casita."],
      ["Returning guest", "Hi {first},\n\nWelcome back to Virgin Beach Resort — we're so happy you're staying with us again! Here is the quotation for {date} to {checkout}."],
      ["Celebration / special occasion", "Hi {first},\n\nThank you for choosing Virgin Beach Resort for your special stay! Here is the quotation for {date} to {checkout}. Tell us what you're celebrating and we'll be happy to prepare a little something."],
      ["Group / several casitas", "Hi {first},\n\nThank you for choosing Virgin Beach Resort for your group. Here is the quotation for {date} to {checkout}, covering all the casitas and guests we discussed. Every guest has the full-board meal package (lunch, dinner and breakfast), so please send us everyone's full name and age if you haven't yet."],
    ],
    change: [
      ["Changes as requested", "Hi {first},\n\nAs requested, we've updated your reservation {order}. Here are the changes:"],
      ["Adjustment from the resort", "Hi {first},\n\nWe've made a small adjustment to your reservation {order} — the details are below. If this doesn't work for you, just reply and we'll sort it out right away."],
      ["Upgrade / added extras", "Hi {first},\n\nGood news — we've updated your reservation {order} with the extras below. We look forward to welcoming you!"],
    ],
  };

  // opts: { root, notifyEl, mode(): "quote"|"change", overnight(): bool,
  //         request(): {draft, unit_ids, booking_id?, quote_params?, changes?} }
  function create(opts) {
    var D = window.VBRDash;
    var root = opts.root;
    root.classList.add("mail-panel");
    root.innerHTML =
      '<div class="mail-head"><span class="mail-ico">✉</span><div><h3>Email to the guest</h3><p class="mail-sub"></p></div></div>' +
      '<div class="mail-send"></div>' +
      '<div class="mail-body">' +
      '  <div class="mail-field"><label>Template</label><select class="mail-tpl"></select></div>' +
      '  <div class="mail-field mail-subj-wrap"><label>Subject</label><input class="mail-subj" type="text" maxlength="180"></div>' +
      '  <div class="mail-field"><label>Opening message <span class="mail-tip">edit freely · {first} = guest\'s first name</span></label><textarea class="mail-msg" rows="6"></textarea></div>' +
      '  <div class="mail-preview-head"><span>Preview — exactly what the guest receives</span><button type="button" class="btn-sm ghost mail-big">Enlarge</button></div>' +
      '  <div class="mail-frame-wrap"><iframe class="mail-frame" title="Email preview" sandbox="allow-same-origin allow-popups"></iframe><div class="mail-status"></div></div>' +
      "</div>";
    var q = function (sel) { return root.querySelector(sel); };
    var sub = q(".mail-sub"), tpl = q(".mail-tpl"), subj = q(".mail-subj"), msg = q(".mail-msg"),
      frame = q(".mail-frame"), status = q(".mail-status"), body = q(".mail-body"), subjWrap = q(".mail-subj-wrap");
    // The form's existing "send email" checkbox becomes the panel's switch.
    var sendLabel = opts.notifyEl.closest("label");
    q(".mail-send").appendChild(sendLabel);
    var hint = opts.hintEl;
    if (hint) q(".mail-send").appendChild(hint);

    var touched = false, seq = 0, timer = null, lastKey = "", defaultSubject = "";

    function list() {
      var m = opts.mode();
      return m === "change" ? TEMPLATES.change : opts.overnight() ? TEMPLATES.quote_overnight : TEMPLATES.quote_daytrip;
    }
    function fillTemplates(keepText) {
      var L = list();
      tpl.innerHTML = L.map(function (t, i) { return '<option value="' + i + '">' + t[0] + "</option>"; }).join("") + '<option value="custom">Custom (my own wording)</option>';
      if (!keepText || !touched) { tpl.value = "0"; msg.value = L[0][1]; touched = false; }
      else tpl.value = "custom";
    }
    tpl.addEventListener("change", function () {
      if (tpl.value === "custom") { msg.focus(); return; }
      msg.value = list()[Number(tpl.value)][1];
      touched = false;
      refresh(true);
    });
    msg.addEventListener("input", function () { touched = true; tpl.value = "custom"; refresh(); });
    subj.addEventListener("input", function () { refresh(); });
    q(".mail-big").addEventListener("click", function () {
      root.classList.toggle("mail-wide");
      q(".mail-big").textContent = root.classList.contains("mail-wide") ? "Smaller" : "Enlarge";
    });
    opts.notifyEl.addEventListener("change", function () { sync(); refresh(true); });

    function sync() {
      var on = opts.notifyEl.checked && !opts.notifyEl.disabled;
      root.classList.toggle("is-off", !on);
      body.hidden = !on;
      var m = opts.mode();
      subjWrap.hidden = m === "change";
      sub.textContent = m === "change"
        ? "Sent when you save, if the guest-facing details changed. The change table is added automatically."
        : "The quotation with the amount due, bank details and upload link is added automatically below your message.";
    }

    function refresh(now) {
      clearTimeout(timer);
      if (!(opts.notifyEl.checked && !opts.notifyEl.disabled)) { sync(); return; }
      timer = setTimeout(load, now ? 50 : 700);
    }
    function load() {
      var req;
      try { req = opts.request(); } catch (e) { status.textContent = "Fill in the booking to see the email."; return; }
      if (!req) { status.textContent = "Fill in the booking to see the email."; return; }
      req.kind = opts.mode();
      req.custom = { subject: subj.value.trim(), message: msg.value };
      var key = JSON.stringify(req);
      if (key === lastKey) return;
      lastKey = key;
      var my = ++seq;
      status.textContent = "Updating preview…";
      status.hidden = false;
      D.sb.functions.invoke("send-booking-email", { body: req }).then(function (res) {
        if (my !== seq) return;
        var data = res.data;
        if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { data = null; } }
        if (res.error || !data || data.error) {
          status.textContent = "Preview unavailable: " + ((data && data.error) || (res.error && res.error.message) || "unknown error") + ". The email will still be sent normally.";
          return;
        }
        status.hidden = true;
        if (!subj.value.trim() || subj.value === defaultSubject) { defaultSubject = data.subject; if (!subj.value.trim()) subj.placeholder = data.subject; }
        frame.srcdoc = data.html;
      });
    }

    return {
      reset: function () {
        touched = false; lastKey = ""; subj.value = ""; subj.placeholder = ""; defaultSubject = "";
        root.classList.remove("mail-wide"); q(".mail-big").textContent = "Enlarge";
        frame.srcdoc = ""; status.hidden = false; status.textContent = "";
        fillTemplates(false); sync(); refresh(true);
      },
      refresh: function () { sync(); refresh(); },
      // What to save with the booking / pass to the change email.
      value: function () {
        var send = opts.notifyEl.checked && !opts.notifyEl.disabled;
        return { send: send, subject: subj.value.trim(), message: msg.value.trim() };
      },
    };
  }

  window.VBREmail = { create: create, TEMPLATES: TEMPLATES };
})();
