// =============================================================================
// Staff dashboard: "Campaigns" view — AI-suggested offers to past guests.
// • Suggestions: Claude proposes offers (who, what, the email); staff review,
//   tweak, decline, or approve & send. Every guest gets a personal single-use
//   code that the website's booking pages apply (villas and day trips).
// • Campaigns: everything sent or sending — sent / queued / failed, codes
//   redeemed, booking value; pause, resume or cancel.
// • Guests: the guest directory (from the website's bookings + the Cloudbeds
//   guest list) by segment: family, friends, couple, solo, corporate.
// • Codes (v70): every code sent — who got it, tries on the website, bookings,
//   disable / re-enable; plus every attempt to use a code on the booking
//   pages (also mistyped or unknown codes).
// • Settings: daily sending limit, test address.
// Data: booking-v65/v69/v70 (campaign_* functions) + the "campaigns" function.
// v70: open to every staff account; view-only accounts (Accounting) can look
// but the buttons that change things are hidden and the database refuses.
// =============================================================================
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc;
  var dashScreen = document.getElementById("dashScreen");
  var $ = function (id) { return document.getElementById(id); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function num(v) { return Number(v) || 0; }
  function n0(v) { return num(v).toLocaleString("en-PH"); }
  function money(v) { return "₱" + num(v).toLocaleString("en-PH", { maximumFractionDigits: 0 }); }
  function todayStr() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmtDay(s) { return s ? new Date(String(s).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—"; }
  function fmtTime(s) { return s ? new Date(s).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; }
  function plural(n, a, b) { return n0(n) + " " + (num(n) === 1 ? a : (b || a + "s")); }

  var SEGMENTS = [["family", "Families"], ["friends", "Friends / barkada"], ["couple", "Couples"], ["solo", "Solo"], ["corporate", "Corporate"]];
  var TIERS = [["vip", "VIP (₱150k+ or 4+ visits)"], ["repeat", "Repeat (2–3 visits)"], ["one_time", "One-time"], ["upcoming", "Booked, not yet visited"]];
  var SEG_NAME = {}; SEGMENTS.forEach(function (s) { SEG_NAME[s[0]] = s[1]; });
  var TIER_NAME = { vip: "VIP", repeat: "Repeat", one_time: "One-time", upcoming: "Upcoming" };
  var SOUNDBITES = ["Exclusive resort in Batangas", "White sand beach, 3 hours from Manila", "Private villa resort", "Virgin white sand beach", "A drive away white sand beach"];
  var TOPIC_NAME = { atv: "ATV rides", dining: "Food & dining", romance: "Couples", wellness: "Massage", activities: "Activities", celebration: "Celebrations",
    daytrip: "Day trips", villa: "Villas & casitas", corporate: "Corporate & groups", beach: "Beach & aerial", drive: "The drive" };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var STATUS = { suggested: "AI suggestion", draft: "Draft", sending: "Sending", sent: "Sent", paused: "Paused", declined: "Declined", cancelled: "Cancelled" };

  // ---------------------------------------------------------------- calls
  function call(name, args) {
    return sb.rpc(name, args || {}).then(function (res) { if (res.error) throw new Error(res.error.message); return res.data; });
  }
  function fn(body) {
    return sb.functions.invoke("campaigns", { body: body }).then(function (res) {
      if (!res.error) { if (res.data && res.data.error) throw new Error(res.data.error); return res.data; }
      var ctx = res.error.context;
      if (ctx && typeof ctx.json === "function") return ctx.json().then(function (j) { throw new Error((j && j.error) || res.error.message); }, function () { throw new Error(res.error.message); });
      throw new Error(res.error.message);
    });
  }
  function offerLine(o) {
    o = o || {};
    var kinds = o.booking_kinds && o.booking_kinds.length ? o.booking_kinds : ["overnight"];
    var what = kinds.indexOf("overnight") > -1 && kinds.indexOf("day_trip") > -1 ? "stay or day trip" : kinds.indexOf("day_trip") > -1 ? "day trip" : "stay";
    if (o.kind === "perk") return "Freebie: " + (o.perk || "—");
    if (o.kind === "fixed") return money(o.amount) + " off the " + what;
    var on = o.applies_to === "rooms" ? (what === "day trip" ? "cabana rental" : "casita rates") : o.applies_to === "add_ons" ? "add-ons" : "whole " + what;
    return num(o.percent) + "% off " + on;
  }
  function ruleText(r) {
    r = r || {};
    var out = [];
    if (r.emails && r.emails.length) out.push(plural(r.emails.length, "chosen guest"));
    if (r.segments && r.segments.length) out.push(r.segments.map(function (s) { return SEG_NAME[s] || s; }).join(" / "));
    if (r.tiers && r.tiers.length) out.push(r.tiers.map(function (s) { return TIER_NAME[s] || s; }).join(" / "));
    if (r.kinds && r.kinds.length) out.push(r.kinds.map(function (k) { return k === "villa" ? "stayed in a casita" : "came on a day trip"; }).join(" or "));
    if (r.months && r.months.length) out.push("visited in " + r.months.map(function (m) { return MONTHS[m - 1]; }).join(", "));
    if (num(r.min_days_since)) out.push("last visit " + n0(r.min_days_since) + "+ days ago");
    if (num(r.max_days_since)) out.push("visited in the last " + n0(r.max_days_since) + " days");
    if (r.last_from || r.last_to) out.push("last visit " + (r.last_from ? "from " + fmtDay(r.last_from) : "") + (r.last_to ? " to " + fmtDay(r.last_to) : ""));
    if (num(r.min_visits)) out.push(n0(r.min_visits) + "+ visits");
    if (r.max_visits !== undefined && r.max_visits !== null && r.max_visits !== "") out.push("at most " + plural(r.max_visits, "visit"));
    if (num(r.min_spend)) out.push("spent " + money(r.min_spend) + "+");
    if (r.kids === true) out.push("with kids");
    if (r.kids === false) out.push("no kids");
    if (r.opt_in_only) out.push("opted in to promos");
    if (r.include_upcoming) out.push("incl. guests with a booking coming up");
    return out.length ? out.join(" · ") : "All guests with an email";
  }

  // ---------------------------------------------------------------- styles
  var css = document.createElement("style");
  css.textContent =
    ".view-toggle [data-view=\"campaigns\"]{display:none}body.cmp-staff .view-toggle [data-view=\"campaigns\"]{display:inline-block}" +
    "#cmView{display:none}body.cmv #cmView{display:block;max-width:1400px;margin:0 auto}body.cmv #dashScreen>:not(#cmView){display:none!important}" +
    "#cmView .cm-head{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:flex-end;margin-bottom:12px}" +
    "#cmView .cm-head h2{margin:0;font-size:1.5rem}#cmView .cm-head p{margin:4px 0 0;font-size:.84rem;color:var(--ink-soft)}" +
    ".cm-tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px}.cm-tiles .sum-tile b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cm-modal .cm-tiles .sum-tile b{font-size:1.05rem}" +
    "#cmView .cm-tabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin-bottom:14px;overflow-x:auto}" +
    "#cmView .cm-tabs button{border:0;background:none;color:var(--ink-soft);font:700 .92rem var(--font-body);padding:10px 14px;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;white-space:nowrap}" +
    "#cmView .cm-tabs button.on{color:var(--lagoon-deep);border-bottom-color:var(--lagoon)}#cmView .cm-tabs b{font-size:.72rem;background:var(--lagoon);color:#fff;border-radius:999px;padding:1px 7px;margin-left:5px}" +
    ".cm-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}.cm-bar input[type=text],.cm-bar input[type=search],.cm-bar select{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface);color:var(--ink);font:inherit;font-size:.86rem}" +
    ".cm-bar .grow{flex:1;min-width:220px}.cm-note{font-size:.8rem;color:var(--ink-soft);margin:0 0 12px}.cm-err{color:#b3261e;font-size:.84rem;font-weight:600}.cm-ok{color:#17694a;font-size:.84rem;font-weight:600}" +
    ".cm-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}" +
    ".cm-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;min-width:0}" +
    ".cm-card h3{margin:0;font-family:var(--font-display);font-weight:600;font-size:1.08rem}.cm-card .cm-meta{display:flex;flex-wrap:wrap;gap:6px}" +
    ".cm-chip{display:inline-block;font-size:.72rem;font-weight:700;border-radius:999px;padding:3px 9px;background:var(--sand-deep);color:var(--ink-soft);white-space:nowrap}" +
    ".cm-ro-note{display:none;margin:0 0 12px;padding:8px 12px;border-radius:10px;background:#eef1f4;color:#4a5563;font-size:.84rem}body.cm-ro .cm-ro-note{display:block}" +
    "body.cm-ro #cmAsk,body.cm-ro #cmNew,body.cm-ro [data-decline],body.cm-ro #eSave,body.cm-ro #eLaunch,body.cm-ro #eTest,body.cm-ro #eDecline,body.cm-ro #eRewrite," +
    "body.cm-ro [data-st],body.cm-ro #cmImport,body.cm-ro #cmRebuild,body.cm-ro #cmSaveSet,body.cm-ro [data-cact],body.cm-ro #cdBulk,body.cm-ro #eInstr,body.cm-ro #eTestTo{display:none!important}" +
    ".cd-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}.cd-filters select,.cd-filters input{font:inherit;font-size:.86rem;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface)}" +
    ".cd-filters input{flex:1;min-width:200px}.cd-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.cd-chips button{font:inherit;font-size:.8rem;font-weight:700;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 12px;cursor:pointer}" +
    ".cd-chips button.on{background:var(--lagoon-deep);border-color:var(--lagoon-deep);color:#fff}.cd-chips b{font-weight:800;opacity:.75;margin-left:4px}" +
    ".cm-chip.cs-booked{background:#dff1e4;color:#1d6b37}.cm-chip.cs-tried{background:#fbe8c2;color:#7f5200}.cm-chip.cs-disabled,.cm-chip.cs-expired{background:#eef1f4;color:#4a5563}.cm-chip.cs-not_sent{background:#f7dcd6;color:#8a2a1a}" +
    ".cm-chip.cs-sent,.cm-chip.cs-queued{background:var(--lagoon-tint);color:var(--lagoon-deep)}.cd-ok{color:#1d6b37;font-weight:700}.cd-bad{color:#8a2a1a;font-weight:700}" +
    ".cm-t tr.cd-row{cursor:pointer}.cm-t tr.cd-row:hover td{background:var(--sand)}.cd-h3{font-family:var(--font-display);font-weight:600;font-size:1.05rem;margin:26px 0 10px}" +
    ".cm-avail{margin:10px 0;padding:10px 12px;border-radius:10px;font-size:.84rem;line-height:1.45;background:var(--lagoon-tint);color:var(--lagoon-deep)}.cm-avail small{display:block;opacity:.8}" +
    ".cm-avail.tight{background:#fbe8c2;color:#7f5200}.cm-avail.full{background:#f7dcd6;color:#8a2a1a}" +
    ".cm-pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.cm-pslot{display:flex;flex-direction:column;gap:6px;min-width:0}" +
    ".cm-pimg{aspect-ratio:3/2;border-radius:8px;overflow:hidden;background:var(--sand,#efe7da)}.cm-pimg img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".cm-pslot select{width:100%;font:inherit;font-size:.8rem;padding:5px 6px;border:1px solid var(--line);border-radius:8px;background:#fff}.cm-pslot small{color:var(--ink-soft,#6b7774);font-size:.72rem}" +
    ".linkish{background:none;border:0;padding:0;color:var(--lagoon-deep,#0f6f68);text-decoration:underline;cursor:pointer;font:inherit}@media(max-width:560px){.cm-pgrid{grid-template-columns:1fr 1fr}}" +
    ".cm-chip.ai{background:#ece4f2;color:#6b4a85}.cm-chip.offer{background:var(--lagoon-tint);color:var(--lagoon-deep)}.cm-chip.st-sending{background:#f6e6cf;color:#94591c}.cm-chip.st-sent{background:#dff1e4;color:#1d6b37}" +
    ".cm-chip.st-declined,.cm-chip.st-cancelled{background:#eef1f4;color:#4a5563}.cm-chip.st-paused{background:#fbe8c2;color:#7f5200}.cm-chip.st-draft{background:#e6eefb;color:#2350a0}" +
    ".cm-card .cm-why{white-space:pre-line;font-size:.84rem;color:var(--ink-soft);line-height:1.45}.cm-card .cm-subj{font-size:.86rem}.cm-card .cm-subj b{font-weight:700}" +
    ".cm-card .cm-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:4px}" +
    ".cm-empty{text-align:center;color:var(--ink-soft);padding:30px 10px;background:var(--surface);border:1px dashed var(--line);border-radius:14px}" +
    ".cm-twrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:12px}" +
    "table.cm-t{width:100%;min-width:760px;border-collapse:collapse;font-size:.82rem}table.cm-t th{text-align:left;font-size:.66rem;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-soft);padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--surface);position:sticky;top:0}" +
    "table.cm-t td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}table.cm-t .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}table.cm-t tr.click{cursor:pointer}table.cm-t tr.click:hover td{background:var(--lagoon-tint)}" +
    ".cm-sub{display:block;font-size:.72rem;color:var(--ink-soft)}" +
    ".cm-matrix td.num b{font-size:.95rem}.cm-matrix td.num{cursor:pointer}.cm-matrix td.num:hover{background:var(--lagoon-tint)}" +
    // editor
    ".cm-back{position:fixed;inset:0;background:rgba(20,28,27,.45);z-index:1500;display:none;overflow:auto;padding:24px 12px}.cm-back.open{display:block}" +
    ".cm-modal{max-width:1280px;margin:0 auto;background:var(--sand);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden}" +
    ".cm-mhead{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px;background:var(--surface);border-bottom:1px solid var(--line)}.cm-mhead h2{margin:0;font-size:1.2rem}" +
    ".cm-x{border:0;background:none;font-size:1.6rem;line-height:1;cursor:pointer;color:var(--ink-soft)}" +
    ".cm-mbody{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:16px;padding:16px 18px}@media(max-width:980px){.cm-mbody{grid-template-columns:1fr}}" +
    ".cm-sec{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:12px}.cm-sec h4{margin:0 0 8px;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft)}" +
    ".cm-f{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;min-width:0}.cm-f label,.cm-lbl{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft)}" +
    ".cm-f input,.cm-f select,.cm-f textarea{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--sand);color:var(--ink);font:inherit;font-size:.88rem;width:100%;box-sizing:border-box}.cm-f textarea{min-height:150px;line-height:1.5}" +
    ".cm-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}" +
    ".cm-checks{display:flex;flex-wrap:wrap;gap:4px 12px;margin:2px 0 10px}.cm-checks label{display:inline-flex;align-items:center;gap:5px;font-size:.84rem;cursor:pointer}.cm-checks input{width:auto;margin:0}" +
    ".cm-months{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 10px}.cm-months button{border:1px solid var(--line);background:var(--sand);border-radius:7px;padding:3px 8px;font:700 .76rem var(--font-body);cursor:pointer;color:var(--ink)}.cm-months button.on{background:var(--lagoon);border-color:var(--lagoon);color:#fff}" +
    ".cm-aud{background:var(--lagoon-tint);border-radius:10px;padding:10px 12px;font-size:.86rem}.cm-aud b{font-size:1.15rem}.cm-aud small{display:block;color:var(--ink-soft);margin-top:4px}" +
    ".cm-prev{position:sticky;top:12px}.cm-prevbox{background:#f4efe6;border-radius:12px;border:1px solid var(--line);max-height:72vh;overflow:auto}.cm-prevsubj{font-size:.86rem;margin:0 0 8px}" +
    ".cm-mfoot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;padding:12px 18px;background:var(--surface);border-top:1px solid var(--line);position:sticky;bottom:0}.cm-mfoot .cm-msg{margin-right:auto}" +
    ".btn-sm.danger{background:#fbe9e7;color:#9b2c2c;border:1px solid #f1c4bd}.btn-sm:disabled{opacity:.55;cursor:default}" +
    ".cm-why-box{white-space:pre-line;font-size:.84rem;background:#f5f0fa;border-radius:10px;padding:10px 12px;color:#4d3a5f;margin-bottom:12px}" +
    "@media(max-width:1100px){.cm-tiles{grid-template-columns:repeat(3,1fr)!important}}@media(max-width:640px){.cm-tiles{grid-template-columns:1fr 1fr!important}.cm-cards{grid-template-columns:1fr}}";
  document.head.appendChild(css);

  // ---------------------------------------------------------------- shell
  var el = document.createElement("section");
  el.id = "cmView";
  el.innerHTML =
    '<div class="cm-head"><div><h2>Offers &amp; Campaigns</h2><p id="cmSub">Personal offers to past guests — suggested by AI, approved by you.</p></div>' +
    '<div><button type="button" class="btn-sm ghost" id="cmNew">+ New campaign</button> <button type="button" class="btn-sm ghost" id="cmRefresh">Refresh</button></div></div>' +
    '<div class="cm-tiles" id="cmTiles"></div>' +
    '<div class="cm-tabs" id="cmTabs"><button type="button" data-t="suggest">Suggestions</button><button type="button" data-t="campaigns">Campaigns</button><button type="button" data-t="codes">Codes</button><button type="button" data-t="guests">Guests</button><button type="button" data-t="settings">Settings</button></div>' +
    '<div id="cmBody"></div>';
  dashScreen.insertBefore(el, dashScreen.firstChild);

  var back = document.createElement("div");
  back.className = "cm-back";
  back.innerHTML = '<div class="cm-modal" role="dialog" aria-modal="true" aria-labelledby="cmEdTitle"><div class="cm-mhead"><h2 id="cmEdTitle">Campaign</h2><button type="button" class="cm-x" id="cmClose" aria-label="Close">×</button></div><div id="cmEd"></div></div>';
  document.body.appendChild(back);

  // ---------------------------------------------------------------- state
  var shown = false, tab = store("vbr.cmTab") || "suggest", ov = null, list = null, seg = null, guests = null, guestQ = "", guestSeg = "", busy = {}, flash = "";
  function tile(label, value, sub, cls) { return '<div class="sum-tile' + (cls ? " " + cls : "") + '"><span>' + label + "</span><b>" + value + "</b><em>" + sub + "</em></div>"; }
  function setFlash(msg, bad) { flash = msg ? '<p class="' + (bad ? "cm-err" : "cm-ok") + '">' + esc(msg) + "</p>" : ""; }

  function loadAll() {
    if (!shown) return;
    Promise.all([call("campaign_overview"), call("campaign_list")]).then(function (r) {
      ov = r[0]; list = r[1] || []; drawTiles(); drawTabs(); draw();
    }, function (e) {
      $("cmBody").innerHTML = '<p class="cm-err">' + esc(/campaign_|function/.test(e.message) ? "Campaigns need a one-time database update (booking-v65)." : e.message) + "</p>";
    });
  }
  function drawTiles() {
    if (!ov) return;
    var st = ov.settings || {};
    $("cmTiles").innerHTML =
      tile("Guests we can email", n0(ov.emailable), n0(ov.profiles) + " in the directory · " + n0(ov.opted_out) + " opted out") +
      tile("AI suggestions", n0(ov.suggested), n0(ov.drafts) + " draft" + (num(ov.drafts) === 1 ? "" : "s") + " waiting", num(ov.suggested) ? "hot" : "") +
      tile("Sending now", n0(ov.queued), plural(ov.sent_today, "email") + " sent today · limit " + n0(st.daily_cap || 300)) +
      tile("Emails sent", n0(ov.sent_30), "last 30 days") +
      tile("Codes redeemed", n0(ov.redeemed_30), "bookings in the last 30 days") +
      tile("Booking value", money(ov.revenue_30), "from offer codes · 30 days");
    $("cmSub").textContent = "Personal offers to past guests — suggested by AI, approved by you. Guest list updated " + (ov.profiles_at ? fmtTime(ov.profiles_at) : "never") + ".";
  }
  function drawTabs() {
    var nSug = (list || []).filter(function (c) { return c.status === "suggested" || c.status === "draft"; }).length;
    Array.prototype.forEach.call($("cmTabs").querySelectorAll("button"), function (b) {
      var t = b.getAttribute("data-t");
      b.classList.toggle("on", t === tab);
      b.innerHTML = { suggest: "Suggestions", campaigns: "Campaigns", codes: "Codes", guests: "Guests", settings: "Settings" }[t] + (t === "suggest" && nSug ? "<b>" + nSug + "</b>" : "");
    });
  }
  function draw() {
    if (tab === "suggest") drawSuggest();
    else if (tab === "campaigns") drawCampaigns();
    else if (tab === "codes") drawCodes();
    else if (tab === "guests") drawGuests();
    else drawSettings();
  }

  // ---------------------------------------------------------------- suggestions
  function drawSuggest() {
    var items = (list || []).filter(function (c) { return c.status === "suggested" || c.status === "draft"; });
    var noGuests = ov && num(ov.emailable) < 50;
    $("cmBody").innerHTML =
      '<div class="cm-bar"><input type="text" class="grow" id="cmFocus" placeholder="Optional focus for the AI — e.g. fill weekdays in February, Valentine\'s couples, corporate Christmas 2027" value="' + esc(store("vbr.cmFocus") || "") + '">' +
      '<select id="cmCount" aria-label="How many suggestions"><option value="3">3 ideas</option><option value="4" selected>4 ideas</option><option value="6">6 ideas</option></select>' +
      '<button type="button" class="btn-sm primary" id="cmAsk"' + (busy.ask ? " disabled" : "") + ">" + (busy.ask ? "Thinking… (about a minute)" : "✨ Suggest offers with AI") + "</button></div>" +
      (noGuests ? '<p class="cm-note">⚠ Only ' + n0(ov.emailable) + ' guests have an email on file so far. Go to <b>Guests → Refresh from Cloudbeds</b> to bring in the emails of past Cloudbeds guests first.</p>' : "") +
      flash +
      (items.length ? '<div class="cm-cards">' + items.map(card).join("") + "</div>"
        : '<div class="cm-empty">No suggestions waiting. Ask the AI for ideas, or start a <a href="#" data-new="1">new campaign</a> yourself.</div>');
  }
  function card(c) {
    var st = c.stats || {};
    var hero = c.offer && c.offer.images && c.offer.images[0];
    return '<div class="cm-card" data-id="' + esc(c.id) + '">' +
      (hero && /^[a-z0-9-]+$/.test(hero) ? '<div class="cm-pimg" style="margin:-4px 0 2px"><img src="/assets/images/email/' + hero + '.jpg" alt="" loading="lazy"></div>' : "") +
      '<div class="cm-meta">' + (c.source === "ai" ? '<span class="cm-chip ai">✨ AI</span>' : "") + '<span class="cm-chip st-' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + "</span>" +
      '<span class="cm-chip offer">' + esc(offerLine(c.offer)) + "</span></div>" +
      "<h3>" + esc(c.name) + "</h3>" +
      '<div class="cm-subj"><b>' + esc(plural(c.est_recipients || 0, "guest")) + "</b> · " + esc(c.audience_label || ruleText(c.audience)) + "</div>" +
      (c.rationale ? '<div class="cm-why">' + esc(c.rationale) + "</div>" : "") +
      '<div class="cm-subj">✉ <b>' + esc(c.subject || "(no subject yet)") + "</b></div>" +
      '<div class="cm-why">Code valid until ' + esc(fmtDay(c.expires_on)) + (num(c.est_revenue) ? " · AI estimate: " + esc(n0(c.est_bookings)) + " bookings, " + esc(money(c.est_revenue)) : "") + "</div>" +
      '<div class="cm-acts"><button type="button" class="btn-sm primary" data-edit="' + esc(c.id) + '">Review &amp; send…</button>' +
      '<button type="button" class="btn-sm danger" data-decline="' + esc(c.id) + '">Decline</button></div>' +
      "</div>";
  }
  function ask() {
    if (busy.ask) return;
    var focus = ($("cmFocus").value || "").trim();
    store("vbr.cmFocus", focus);
    busy.ask = true; setFlash(""); drawSuggest();
    fn({ action: "suggest", count: Number($("cmCount").value) || 4, focus: focus }).then(function (r) {
      busy.ask = false; setFlash(plural(r.added, "new suggestion") + " from the AI. Review each one before sending.");
      loadAll();
    }, function (e) { busy.ask = false; setFlash(e.message, true); drawSuggest(); });
  }
  function decline(id) {
    var c = byId(id);
    var why = window.prompt("Decline “" + (c ? c.name : "this campaign") + "”?\nOptional: why (the AI learns from this):", "");
    if (why === null) return;
    call("campaign_set_status", { p_id: id, p_status: "declined", p_reason: why }).then(function () { setFlash("Declined."); loadAll(); }, function (e) { alert(e.message); });
  }
  function byId(id) { return (list || []).filter(function (c) { return c.id === id; })[0]; }

  // ---------------------------------------------------------------- campaigns
  function drawCampaigns() {
    var items = (list || []).filter(function (c) { return c.status !== "suggested" && c.status !== "draft"; });
    $("cmBody").innerHTML = flash + (items.length ? '<div class="cm-twrap"><table class="cm-t"><thead><tr><th>Campaign</th><th>Status</th><th>Offer</th><th class="num">Sent</th><th class="num">Waiting</th><th class="num">Failed</th><th class="num">Redeemed</th><th class="num">Booking value</th><th>Started</th></tr></thead><tbody>' +
      items.map(function (c) {
        var s = c.stats || {};
        return '<tr class="click" data-open="' + esc(c.id) + '"><td><b>' + esc(c.name) + '</b><span class="cm-sub">' + esc(c.audience_label || ruleText(c.audience)) + "</span></td>" +
          '<td><span class="cm-chip st-' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + "</span>" + (c.decline_reason ? '<span class="cm-sub">' + esc(c.decline_reason) + "</span>" : "") + "</td>" +
          "<td>" + esc(offerLine(c.offer)) + '<span class="cm-sub">until ' + esc(fmtDay(c.expires_on)) + "</span></td>" +
          '<td class="num">' + n0(s.sent) + '</td><td class="num">' + n0(s.queued) + '</td><td class="num">' + n0(s.failed) + "</td>" +
          '<td class="num"><b>' + n0(s.redeemed) + "</b>" + (num(s.sent) ? '<span class="cm-sub">' + (Math.round(num(s.redeemed) / num(s.sent) * 1000) / 10) + "%</span>" : "") + "</td>" +
          '<td class="num">' + money(s.revenue) + (num(s.discount_given) ? '<span class="cm-sub">−' + money(s.discount_given) + " discount</span>" : "") + "</td>" +
          "<td>" + esc(c.launched_at ? fmtTime(c.launched_at) : "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<div class="cm-empty">Nothing sent yet. Approve a suggestion to start your first campaign.</div>');
  }
  function openDetail(id) {
    openModal("Loading…", '<div style="padding:24px">Loading…</div>');
    call("campaign_get", { p_id: id }).then(function (c) {
      detail = c;
      var s = c.stats || {};
      var acts = (c.status === "sending" ? '<button type="button" class="btn-sm ghost" data-st="paused">Pause sending</button>' : "") +
        (c.status === "paused" ? '<button type="button" class="btn-sm primary" data-st="sending">Resume sending</button>' : "") +
        (c.status === "sending" || c.status === "paused" ? '<button type="button" class="btn-sm danger" data-st="cancelled">Cancel unsent emails</button>' : "") +
        (c.status === "declined" ? '<button type="button" class="btn-sm ghost" data-st="draft">Restore as draft</button>' : "");
      openModal(c.name,
        '<div style="padding:16px 18px">' +
        '<div class="cm-tiles">' +
        tile("Status", esc(STATUS[c.status] || c.status), c.launched_at ? "started " + esc(fmtTime(c.launched_at)) : "") +
        tile("Sent", n0(s.sent), n0(s.queued) + " waiting · " + n0(s.failed) + " failed") +
        tile("Redeemed", n0(s.redeemed), num(s.sent) ? (Math.round(num(s.redeemed) / num(s.sent) * 1000) / 10) + "% of emails" : "") +
        tile("Booking value", money(s.revenue), "discount given " + money(s.discount_given)) +
        tile("Unsubscribed", n0(s.unsubscribed), "from this email") +
        tile("Offer", esc(offerLine(c.offer)), "until " + esc(fmtDay(c.expires_on))) + "</div>" +
        '<p class="cm-note"><b>Audience:</b> ' + esc(c.audience_label || ruleText(c.audience)) + ' · <b>Subject:</b> ' + esc(c.subject || "") + "</p>" +
        (c.rationale ? '<div class="cm-why-box">' + esc(c.rationale) + "</div>" : "") +
        '<div class="cm-bar">' + acts + '<button type="button" class="btn-sm ghost" data-preview="1">See the email</button><button type="button" class="btn-sm ghost" data-codes="' + esc(c.id) + '">Codes &amp; tries</button></div>' +
        '<div class="cm-twrap" style="max-height:52vh;overflow:auto"><table class="cm-t"><thead><tr><th>Guest</th><th>Code</th><th>Email</th><th>Booking with the code</th></tr></thead><tbody>' +
        (c.recipients || []).map(function (r) {
          var b = r.booking;
          return "<tr><td><b>" + esc(r.name || "—") + '</b><span class="cm-sub">' + esc(r.email) + '</span></td><td><code>' + esc(r.code || "") + "</code></td>" +
            "<td>" + esc(r.status) + (r.sent_at ? '<span class="cm-sub">' + esc(fmtTime(r.sent_at)) + "</span>" : "") + (r.error ? '<span class="cm-sub cm-err">' + esc(r.error) + "</span>" : "") + "</td>" +
            "<td>" + (b ? "<b>" + esc(b.order_code || "") + "</b> · " + esc(money(b.total)) + '<span class="cm-sub">' + esc((b.stay_type === "overnight" ? "Villa " : "Day trip ") + fmtDay(b.check_in) + " · " + b.status) + "</span>" : '<span class="muted">—</span>') + "</td></tr>";
        }).join("") + "</tbody></table></div></div>");
    }, function (e) { openModal("Couldn't load", '<p class="cm-err" style="padding:18px">' + esc(e.message) + "</p>"); });
  }

  // ---------------------------------------------------------------- guests
  function drawGuests() {
    $("cmBody").innerHTML = flash + '<div class="cm-bar"><button type="button" class="btn-sm primary" id="cmImport"' + (busy.imp ? " disabled" : "") + ">" + (busy.imp ? "Importing…" : "Refresh from Cloudbeds") + "</button>" +
      '<button type="button" class="btn-sm ghost" id="cmRebuild"' + (busy.reb ? " disabled" : "") + ">Rebuild guest list</button>" +
      '<span class="cm-note" style="margin:0">' + (ov ? n0(ov.contacts) + " Cloudbeds guest records" + (ov.contacts_at ? " · last import " + esc(fmtTime(ov.contacts_at)) : " · not imported yet") : "") + "</span></div>" +
      '<p class="cm-note">One row per email address, from website bookings and Cloudbeds reservations (cancelled bookings and staff stays left out). Booking.com / Agoda relay addresses can\'t be emailed and are skipped. Segment = the kind of party they usually come with.</p>' +
      '<div id="cmMatrix"><p class="cm-note">Loading segments…</p></div>' +
      '<div class="cm-bar" style="margin-top:14px"><input type="search" class="grow" id="cmGQ" placeholder="Search name, email or phone" value="' + esc(guestQ) + '">' +
      '<select id="cmGSeg"><option value="">All segments</option>' + SEGMENTS.concat([["vip", "VIP"], ["repeat", "Repeat"], ["one_time", "One-time"], ["upcoming", "Upcoming"]]).map(function (s) { return '<option value="' + s[0] + '"' + (guestSeg === s[0] ? " selected" : "") + ">" + esc(s[1]) + "</option>"; }).join("") + "</select></div>" +
      '<div id="cmGList"><p class="cm-note">Loading…</p></div>';
    call("campaign_segments").then(function (s) { seg = s; drawMatrix(); }, function (e) { $("cmMatrix").innerHTML = '<p class="cm-err">' + esc(e.message) + "</p>"; });
    loadGuests();
  }
  function drawMatrix() {
    if (!seg || !$("cmMatrix")) return;
    var rows = seg.segments || [], cell = {}, segTot = {}, tierTot = {};
    rows.forEach(function (r) { cell[r.segment + "|" + r.tier] = r; segTot[r.segment] = (segTot[r.segment] || 0) + num(r.guests); tierTot[r.tier] = (tierTot[r.tier] || 0) + num(r.guests); });
    var tiers = ["vip", "repeat", "one_time", "upcoming"];
    $("cmMatrix").innerHTML = '<div class="cm-twrap"><table class="cm-t cm-matrix"><thead><tr><th>Segment</th>' + tiers.map(function (t) { return '<th class="num">' + esc(TIER_NAME[t]) + "</th>"; }).join("") + '<th class="num">All</th></tr></thead><tbody>' +
      SEGMENTS.map(function (s) {
        return "<tr><td><b>" + esc(s[1]) + "</b></td>" + tiers.map(function (t) {
          var r = cell[s[0] + "|" + t];
          return '<td class="num" data-gs="' + s[0] + '">' + (r ? "<b>" + n0(r.guests) + '</b><span class="cm-sub">avg ' + money(r.avg_spend) + (r.avg_days_since !== null && r.avg_days_since !== undefined ? " · " + n0(r.avg_days_since) + "d ago" : "") + "</span>" : '<span class="muted">—</span>') + "</td>";
        }).join("") + '<td class="num" data-gs="' + s[0] + '"><b>' + n0(segTot[s[0]] || 0) + "</b></td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  var gTimer = null;
  function loadGuests() {
    call("campaign_guests", { p_search: guestQ || null, p_segment: guestSeg || null, p_limit: 200, p_offset: 0 }).then(function (g) {
      guests = g;
      if (!$("cmGList")) return;
      var rows = g.rows || [];
      $("cmGList").innerHTML = '<p class="cm-note">' + plural(g.total, "guest") + (num(g.total) > rows.length ? " · showing the top " + rows.length + " by spend" : "") + "</p>" +
        (rows.length ? '<div class="cm-twrap" style="max-height:60vh;overflow:auto"><table class="cm-t"><thead><tr><th>Guest</th><th>Segment</th><th class="num">Visits</th><th>Last visit</th><th class="num">Spend</th><th>Months</th><th>Offers</th></tr></thead><tbody>' +
          rows.map(function (r) {
            return "<tr><td><b>" + esc(r.name || "—") + '</b><span class="cm-sub">' + esc(r.email) + (r.phone ? " · " + esc(r.phone) : "") + "</span></td>" +
              "<td>" + esc(SEG_NAME[r.segment] || r.segment || "") + '<span class="cm-sub">' + esc(TIER_NAME[r.tier] || r.tier || "") + (r.kids ? " · kids" : "") + "</span></td>" +
              '<td class="num">' + n0(r.visits) + '<span class="cm-sub">' + (num(r.villa_stays) ? n0(r.villa_stays) + " stay" + (num(r.villa_stays) === 1 ? "" : "s") : "") + (num(r.day_trips) ? " " + n0(r.day_trips) + " day" : "") + "</span></td>" +
              "<td>" + esc(fmtDay(r.last_visit)) + (r.next_visit ? '<span class="cm-sub">next: ' + esc(fmtDay(r.next_visit)) + "</span>" : "") + "</td>" +
              '<td class="num">' + money(r.spend) + "</td><td>" + esc((r.months || []).map(function (m) { return MONTHS[m - 1]; }).join(", ")) + "</td>" +
              "<td>" + (r.opted_out ? '<span class="cm-chip st-declined">Unsubscribed</span>' : r.opt_in ? '<span class="cm-chip st-sent">Opted in</span>' : "") + (r.contacted_at ? '<span class="cm-sub">last offer ' + esc(fmtDay(r.contacted_at)) + "</span>" : "") + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<div class="cm-empty">No guests match.</div>');
    }, function (e) { if ($("cmGList")) $("cmGList").innerHTML = '<p class="cm-err">' + esc(e.message) + "</p>"; });
  }
  function importGuests() {
    if (busy.imp) return;
    busy.imp = true; setFlash("Importing the Cloudbeds guest list… this keeps running on its own for a few minutes; refresh later to see the new totals."); drawGuests();
    fn({ action: "import_guests" }).then(function (r) {
      busy.imp = false;
      setFlash(r.more ? "Imported " + n0(r.fetched) + " Cloudbeds guest records so far — the rest continue in the background (refresh in a few minutes)." : "Imported " + n0(r.fetched) + " guest records; guest list rebuilt (" + n0(r.profiles && r.profiles.profiles) + " guests).");
      loadAll();
    }, function (e) { busy.imp = false; setFlash(e.message, true); drawGuests(); });
  }
  function rebuild() {
    busy.reb = true; drawGuests();
    call("campaign_rebuild_profiles").then(function (r) { busy.reb = false; setFlash("Guest list rebuilt: " + n0(r.profiles) + " guests with an email (" + n0(r.bookings_without_email) + " bookings have no email)."); loadAll(); },
      function (e) { busy.reb = false; setFlash(e.message, true); drawGuests(); });
  }

  // ---------------------------------------------------------------- settings
  function drawSettings() {
    var st = (ov && ov.settings) || {};
    $("cmBody").innerHTML = flash + '<div class="cm-sec" style="max-width:640px"><h4>Sending</h4>' +
      '<div class="cm-row"><div class="cm-f"><label for="cmCap">Emails per day (all campaigns)</label><input id="cmCap" type="number" min="1" max="1500" value="' + esc(st.daily_cap || 300) + '"></div>' +
      '<div class="cm-f"><label for="cmBatch">Emails every 5 minutes</label><input id="cmBatch" type="number" min="1" max="60" value="' + esc(st.batch_size || 25) + '"></div></div>' +
      '<div class="cm-f"><label for="cmTest">Send tests to</label><input id="cmTest" type="email" value="' + esc(st.test_email || "") + '"></div>' +
      '<button type="button" class="btn-sm primary" id="cmSaveSet">Save</button>' +
      '<p class="cm-note" style="margin-top:12px">Offers go out from reservations@virginbeachresort.com (the same Google mailbox as booking emails, which Google limits to about 2,000 emails a day in total), a few at a time, so booking emails always get through. Every email has an unsubscribe link; unsubscribed guests are never emailed offers again. Only accounts on the Campaigns list can open this view; ask Claude to add someone.</p></div>';
  }
  function saveSettings() {
    Promise.all([
      call("campaign_setting_set", { p_key: "daily_cap", p_value: Number($("cmCap").value) || 300 }),
      call("campaign_setting_set", { p_key: "batch_size", p_value: Number($("cmBatch").value) || 25 }),
      call("campaign_setting_set", { p_key: "test_email", p_value: ($("cmTest").value || "").trim() }),
    ]).then(function () { setFlash("Settings saved."); loadAll(); }, function (e) { setFlash(e.message, true); drawSettings(); });
  }

  // ---------------------------------------------------------------- editor
  function openModal(title, html) { $("cmEdTitle").textContent = title; $("cmEd").innerHTML = html; back.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeModal() { back.classList.remove("open"); document.body.style.overflow = ""; $("cmEd").innerHTML = ""; ed = null; detail = null; }
  $("cmClose").addEventListener("click", closeModal);
  back.addEventListener("click", function (e) { if (e.target === back) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && back.classList.contains("open")) closeModal(); });
  function shadow(host, html) {
    if (!host) return;
    var root = host.shadowRoot || host.attachShadow({ mode: "open" });
    root.innerHTML = html.replace(/^[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  }

  var detail = null;
  var ed = null, audTimer = null, prevTimer = null, audSeq = 0, prevSeq = 0;
  var photoCat = null, shownPhotos = [];
  function blank() {
    return { id: null, name: "", status: "draft", source: "staff", audience: { segments: [], skip_contacted_days: 14 }, audience_label: "",
      offer: { kind: "percent", percent: 10, applies_to: "rooms", booking_kinds: ["overnight"] }, code_prefix: "", expires_on: addDays(todayStr(), 30),
      subject: "", headline: "", body: "Hi {first_name},\n\n", cta_label: "Book with my code" };
  }
  function openEditor(c) {
    ed = JSON.parse(JSON.stringify(c || blank()));
    ed.audience = ed.audience || {}; ed.offer = ed.offer || {};
    var a = ed.audience, o = ed.offer;
    var chk = function (name, opts, vals) {
      return '<div class="cm-checks">' + opts.map(function (x) { return '<label><input type="checkbox" data-a="' + name + '" value="' + x[0] + '"' + ((vals || []).indexOf(x[0]) > -1 ? " checked" : "") + ">" + esc(x[1]) + "</label>"; }).join("") + "</div>";
    };
    var kinds = o.booking_kinds && o.booking_kinds.length ? o.booking_kinds : ["overnight"];
    openModal(ed.id ? (ed.status === "suggested" ? "Review AI suggestion" : "Edit campaign") : "New campaign",
      '<div class="cm-mbody"><div>' +
      (ed.rationale ? '<div class="cm-why-box"><b>' + (ed.source === "ai" ? "Why the AI suggests this: " : "Notes: ") + "</b>" + esc(ed.rationale) + "</div>" : "") +
      '<div class="cm-sec"><h4>Campaign</h4><div class="cm-f"><label for="eName">Name (staff only)</label><input id="eName" value="' + esc(ed.name) + '"></div></div>' +
      '<div class="cm-sec"><h4>Who gets it</h4>' +
      '<span class="cm-lbl">Kind of group</span>' + chk("segments", SEGMENTS, a.segments) +
      '<span class="cm-lbl">Loyalty</span>' + chk("tiers", TIERS, a.tiers) +
      '<span class="cm-lbl">Has come for</span>' + chk("kinds", [["villa", "Casita stays"], ["daytrip", "Day trips"]], a.kinds) +
      '<span class="cm-lbl">Visited in these months (any)</span><div class="cm-months" id="eMonths">' + MONTHS.map(function (m, i) { return '<button type="button" data-m="' + (i + 1) + '" class="' + ((a.months || []).indexOf(i + 1) > -1 ? "on" : "") + '">' + m + "</button>"; }).join("") + "</div>" +
      '<div class="cm-row"><div class="cm-f"><label for="eMinDays">Last visit more than … days ago</label><input id="eMinDays" type="number" min="0" value="' + esc(a.min_days_since || "") + '"></div>' +
      '<div class="cm-f"><label for="eMaxDays">Last visit within … days</label><input id="eMaxDays" type="number" min="0" value="' + esc(a.max_days_since || "") + '"></div>' +
      '<div class="cm-f"><label for="eMinVisits">At least … visits</label><input id="eMinVisits" type="number" min="0" value="' + esc(a.min_visits || "") + '"></div>' +
      '<div class="cm-f"><label for="eMinSpend">Spent at least ₱</label><input id="eMinSpend" type="number" min="0" step="1000" value="' + esc(a.min_spend || "") + '"></div>' +
      '<div class="cm-f"><label for="eKids">Kids in the party</label><select id="eKids"><option value="">Any</option><option value="true"' + (a.kids === true ? " selected" : "") + '>With kids</option><option value="false"' + (a.kids === false ? " selected" : "") + '>No kids</option></select></div>' +
      '<div class="cm-f"><label for="eSkip">Skip guests offered in the last … days</label><input id="eSkip" type="number" min="0" value="' + esc(a.skip_contacted_days === undefined ? 14 : a.skip_contacted_days) + '"></div></div>' +
      '<div class="cm-checks"><label><input type="checkbox" id="eOptIn"' + (a.opt_in_only ? " checked" : "") + '>Only guests who ticked “send me promos”</label>' +
      '<label><input type="checkbox" id="eUpcoming"' + (a.include_upcoming ? " checked" : "") + ">Include guests with a booking coming up</label></div>" +
      '<div class="cm-f"><label for="eAudLabel">Audience description (staff only)</label><input id="eAudLabel" value="' + esc(ed.audience_label || "") + '" placeholder="e.g. Families who came in summer, not back for a year"></div>' +
      '<div class="cm-aud" id="eAud">Counting…</div></div>' +
      '<div class="cm-sec"><h4>The offer</h4>' +
      '<div class="cm-checks"><label><input type="radio" name="eKind" value="percent"' + (o.kind !== "fixed" && o.kind !== "perk" ? " checked" : "") + ">% off</label>" +
      '<label><input type="radio" name="eKind" value="fixed"' + (o.kind === "fixed" ? " checked" : "") + ">₱ off</label>" +
      '<label><input type="radio" name="eKind" value="perk"' + (o.kind === "perk" ? " checked" : "") + ">Freebie</label></div>" +
      '<div class="cm-row"><div class="cm-f" id="wPct"><label for="ePct">Percent off</label><input id="ePct" type="number" min="1" max="100" value="' + esc(o.percent || 10) + '"></div>' +
      '<div class="cm-f" id="wAmt"><label for="eAmt">Pesos off</label><input id="eAmt" type="number" min="1" step="100" value="' + esc(o.amount || 1000) + '"></div>' +
      '<div class="cm-f" id="wPerk" style="grid-column:span 2"><label for="ePerk">The freebie (shown to the guest and on the booking)</label><input id="ePerk" value="' + esc(o.perk || "") + '" placeholder="e.g. Free 60-minute massage for two"></div>' +
      '<div class="cm-f" id="wOn"><label for="eOn">Off what</label><select id="eOn"><option value="rooms"' + (o.applies_to === "rooms" ? " selected" : "") + '>Casita rates / cabana</option><option value="all"' + (o.applies_to === "all" ? " selected" : "") + '>The whole booking</option><option value="add_ons"' + (o.applies_to === "add_ons" ? " selected" : "") + ">Add-ons (stays only)</option></select></div></div>" +
      '<span class="cm-lbl">Good for</span><div class="cm-checks"><label><input type="checkbox" data-k="overnight"' + (kinds.indexOf("overnight") > -1 ? " checked" : "") + '>Casita stays</label><label><input type="checkbox" data-k="day_trip"' + (kinds.indexOf("day_trip") > -1 ? " checked" : "") + ">Day trips</label></div>" +
      '<div class="cm-row"><div class="cm-f"><label for="eFrom">Stay / visit from</label><input id="eFrom" type="date" value="' + esc(o.stay_from || "") + '"></div>' +
      '<div class="cm-f"><label for="eTo">Stay / visit until</label><input id="eTo" type="date" value="' + esc(o.stay_to || "") + '"></div>' +
      '<div class="cm-f"><label for="eMinN">Minimum nights</label><input id="eMinN" type="number" min="0" value="' + esc(o.min_nights || "") + '"></div>' +
      '<div class="cm-f"><label for="eMinT">Minimum booking ₱</label><input id="eMinT" type="number" min="0" step="1000" value="' + esc(o.min_total || "") + '"></div>' +
      '<div class="cm-f"><label for="eExp">Book by (code expires)</label><input id="eExp" type="date" value="' + esc(ed.expires_on || "") + '"></div>' +
      '<div class="cm-f"><label for="ePrefix">Code starts with</label><input id="ePrefix" maxlength="12" value="' + esc(ed.code_prefix || "") + '" placeholder="e.g. SUMMER"></div></div>' +
      '<div class="cm-avail" id="eAvail">Checking Cloudbeds availability…</div>' +
      '<p class="cm-note" style="margin:0">Each guest gets their own code (e.g. ' + esc((ed.code_prefix || "VBR").toUpperCase()) + '-7KQ2M): one booking, only with their email address. The website applies it automatically.</p></div>' +
      '<div class="cm-sec"><h4>The email</h4>' +
      '<div class="cm-f"><label for="eSubj">Subject</label><input id="eSubj" maxlength="120" value="' + esc(ed.subject || "") + '"></div>' +
      '<div class="cm-f"><label for="eHead">Headline</label><input id="eHead" maxlength="140" value="' + esc(ed.headline || "") + '"></div>' +
      '<div class="cm-f"><label for="eBodyT">Message</label><textarea id="eBodyT">' + esc(ed.body || "") + "</textarea></div>" +
      '<div class="cm-f"><label for="eCta">Button</label><input id="eCta" maxlength="40" value="' + esc(ed.cta_label || "") + '"></div>' +
      '<p class="cm-note" style="margin:0 0 8px">{first_name} becomes the guest\'s first name. The offer, code, terms and unsubscribe link are added below the message automatically.</p>' +
      '<div class="cm-bar" style="margin:0"><input type="text" class="grow" id="eInstr" placeholder="Ask the AI to rewrite — e.g. shorter, more playful, mention the bonfire"><button type="button" class="btn-sm ghost" id="eRewrite">✨ Rewrite</button></div></div>' +
      '<div class="cm-sec"><h4>Photos</h4><div id="ePhotos" class="cm-photos"><p class="cm-note">Loading photos…</p></div>' +
      '<div class="cm-f" style="margin-top:10px"><label for="eTag">Line above the photo</label><select id="eTag"><option value="">Automatic</option>' +
      SOUNDBITES.map(function (t) { return "<option" + (o.tagline === t ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + "</select></div>" +
      '<p class="cm-note" style="margin:0">The first photo is the big one at the top; the other two sit under the button. Pick photos that match the offer — an ATV ride gets an ATV photo, a food treat gets a food photo.</p></div>' +
      "</div>" +
      '<div class="cm-prev"><div class="cm-sec"><h4>Preview</h4><p class="cm-prevsubj" id="ePrevSubj"></p><div class="cm-prevbox" id="ePrev"></div></div></div></div>' +
      '<div class="cm-mfoot"><span class="cm-msg" id="eMsg"></span>' +
      (ed.status === "suggested" || ed.status === "draft" ? (ed.id ? '<button type="button" class="btn-sm danger" id="eDecline">Decline</button>' : "") : "") +
      '<input type="email" id="eTestTo" placeholder="test email" value="' + esc((ov && ov.settings && ov.settings.test_email) || "") + '" style="border:1px solid var(--line);border-radius:999px;padding:8px 12px;font:inherit;font-size:.84rem;min-width:200px">' +
      '<button type="button" class="btn-sm ghost" id="eTest">Send test</button>' +
      '<button type="button" class="btn-sm ghost" id="eSave">Save draft</button>' +
      '<button type="button" class="btn-sm primary" id="eLaunch">Approve &amp; send…</button></div>');
    syncKind(); countAudience(); preview(); checkAvail();
  }
  // is there still room on the offer's dates? (Cloudbeds, live)
  var availSeq = 0, availTimer = null;
  function checkAvail() {
    var c = collect(); if (!c || !$("eAvail")) return;
    var seq = ++availSeq;
    call("campaign_window_check", { p_offer: c.offer, p_expires: c.expires_on || null }).then(function (r) {
      if (seq !== availSeq || !$("eAvail")) return;
      ed.avail = r;
      $("eAvail").className = "cm-avail " + (r.verdict || "");
      $("eAvail").innerHTML = "<b>" + (r.verdict === "full" ? "No room on these dates. " : r.verdict === "tight" ? "Mostly full. " : "Room available. ") + "</b>" +
        esc(r.note || "") + (c.offer.stay_from || c.offer.stay_to ? "" : " <small>(No stay dates set — checked " + esc(fmtDay(r.from)) + " to " + esc(fmtDay(r.to)) + ".)</small>");
    }, function (e) { if ($("eAvail")) $("eAvail").textContent = "Couldn't check availability: " + e.message; });
  }
  function collect() {
    if (!ed) return null;
    var a = {}, o = {};
    ["segments", "tiers", "kinds"].forEach(function (k) {
      var v = Array.prototype.filter.call($("cmEd").querySelectorAll('input[data-a="' + k + '"]'), function (x) { return x.checked; }).map(function (x) { return x.value; });
      if (v.length) a[k] = v;
    });
    var months = Array.prototype.filter.call($("eMonths").querySelectorAll("button.on"), function () { return true; }).map(function (b) { return Number(b.getAttribute("data-m")); });
    if (months.length) a.months = months;
    var numv = function (id) { var v = $(id).value; return v === "" ? null : Number(v); };
    if (numv("eMinDays")) a.min_days_since = numv("eMinDays");
    if (numv("eMaxDays")) a.max_days_since = numv("eMaxDays");
    if (numv("eMinVisits")) a.min_visits = numv("eMinVisits");
    if (numv("eMinSpend")) a.min_spend = numv("eMinSpend");
    if ($("eKids").value) a.kids = $("eKids").value === "true";
    a.skip_contacted_days = numv("eSkip") === null ? 0 : numv("eSkip");
    if ($("eOptIn").checked) a.opt_in_only = true;
    if ($("eUpcoming").checked) a.include_upcoming = true;
    if (ed.audience && ed.audience.emails) a.emails = ed.audience.emails;
    var kind = (($("cmEd").querySelector('input[name="eKind"]:checked') || {}).value) || "percent";
    o.kind = kind;
    if (kind === "percent") o.percent = numv("ePct");
    if (kind === "fixed") o.amount = numv("eAmt");
    if (kind === "perk") o.perk = $("ePerk").value.trim();
    o.applies_to = kind === "perk" ? "all" : $("eOn").value;
    o.booking_kinds = Array.prototype.filter.call($("cmEd").querySelectorAll("input[data-k]"), function (x) { return x.checked; }).map(function (x) { return x.getAttribute("data-k"); });
    if (!o.booking_kinds.length) o.booking_kinds = ["overnight"];
    if ($("eFrom").value) o.stay_from = $("eFrom").value;
    if ($("eTo").value) o.stay_to = $("eTo").value;
    if (numv("eMinN")) o.min_nights = numv("eMinN");
    if (numv("eMinT")) o.min_total = numv("eMinT");
    if (ed.offer && ed.offer.images && ed.offer.images.length) o.images = ed.offer.images.slice(0, 3);
    if ($("eTag") && $("eTag").value) o.tagline = $("eTag").value;
    return { id: ed.id, name: $("eName").value.trim(), status: ed.status, source: ed.source, rationale: ed.rationale || null, audience: a, audience_label: $("eAudLabel").value.trim() || ruleText(a),
      offer: o, code_prefix: $("ePrefix").value.trim(), expires_on: $("eExp").value, subject: $("eSubj").value.trim(), headline: $("eHead").value.trim(),
      body: $("eBodyT").value, cta_label: $("eCta").value.trim() || "Book with my code" };
  }
  function syncKind() {
    var kind = (($("cmEd").querySelector('input[name="eKind"]:checked') || {}).value) || "percent";
    $("wPct").style.display = kind === "percent" ? "" : "none";
    $("wAmt").style.display = kind === "fixed" ? "" : "none";
    $("wPerk").style.display = kind === "perk" ? "" : "none";
    $("wOn").style.display = kind === "perk" ? "none" : "";
  }
  function countAudience() {
    var c = collect(); if (!c) return;
    var seq = ++audSeq;
    $("eAud").innerHTML = "Counting…";
    call("campaign_audience", { p_rule: c.audience, p_sample: 8 }).then(function (r) {
      if (seq !== audSeq || !$("eAud")) return;
      ed.count = num(r.count);
      var segs = Object.keys(r.by_segment || {}).map(function (k) { return (SEG_NAME[k] || k) + " " + n0(r.by_segment[k]); }).join(" · ");
      $("eAud").innerHTML = "<b>" + plural(r.count, "guest") + "</b> will get this" + (num(r.spend) ? " · they've spent " + money(r.spend) + " with us" : "") +
        "<small>" + esc(segs) + "</small>" + ((r.sample || []).length ? "<small>e.g. " + esc((r.sample || []).map(function (s) { return s.name || s.email; }).join(", ")) + "</small>" : "");
      var btn = $("eLaunch"); if (btn) btn.textContent = "Approve & send to " + plural(r.count, "guest") + "…";
    }, function (e) { if ($("eAud")) $("eAud").innerHTML = '<span class="cm-err">' + esc(e.message) + "</span>"; });
  }
  function preview() {
    var c = collect(); if (!c) return;
    var seq = ++prevSeq;
    fn({ action: "preview", campaign: c, catalog: !photoCat }).then(function (p) {
      if (seq !== prevSeq || !$("ePrev")) return;
      if (p.photos) photoCat = p.photos;
      shownPhotos = p.images || [];
      drawPhotos();
      $("ePrevSubj").innerHTML = "<b>Subject:</b> " + esc(p.subject || "(none)");
      shadow($("ePrev"), p.html);
    }, function (e) { if ($("ePrev")) $("ePrev").innerHTML = '<p class="cm-err" style="padding:12px">' + esc(e.message) + "</p>"; });
  }
  function drawPhotos() {
    var box = $("ePhotos"); if (!box || !photoCat) return;
    var topics = []; photoCat.forEach(function (p) { if (topics.indexOf(p.topic) < 0) topics.push(p.topic); });
    var byKey = {}; photoCat.forEach(function (p) { byKey[p.key] = p; });
    var auto = !(ed.offer && ed.offer.images && ed.offer.images.length);
    box.innerHTML = '<div class="cm-pgrid">' + [0, 1, 2].map(function (i) {
      var k = shownPhotos[i] || "", p = byKey[k];
      return '<div class="cm-pslot"><div class="cm-pimg">' + (p ? '<img src="' + esc(p.url) + '" alt="' + esc(p.alt) + '" loading="lazy">' : "") + "</div>" +
        '<select data-photo="' + i + '"><option value="">' + (i ? "No photo" : "Choose…") + "</option>" +
        topics.map(function (t) {
          return '<optgroup label="' + esc(TOPIC_NAME[t] || t) + '">' + photoCat.filter(function (x) { return x.topic === t; }).map(function (x) {
            return '<option value="' + esc(x.key) + '"' + (x.key === k ? " selected" : "") + ">" + esc(x.caption) + "</option>";
          }).join("") + "</optgroup>";
        }).join("") + "</select><small>" + (i ? "Under the button" : "Top photo") + "</small></div>";
    }).join("") + "</div>" +
      '<p class="cm-note" style="margin:6px 0 0">' + (auto ? "Picked automatically from the offer. Change any photo to choose your own." :
        'Chosen by hand. <button type="button" class="linkish" id="ePhotoAuto">Pick automatically</button>') + "</p>";
  }
  function edMsg(t, bad) { if ($("eMsg")) { $("eMsg").className = "cm-msg " + (bad ? "cm-err" : "cm-ok"); $("eMsg").textContent = t || ""; } }
  function save() {
    var c = collect();
    return call("campaign_save", { p: c }).then(function (id) { ed.id = id; if (ed.status === "suggested") ed.status = "draft"; return id; });
  }

  $("cmEd").addEventListener("input", function (e) {
    if (!ed) return;
    if (e.target.closest(".cm-mbody > div:first-child")) {
      if (e.target.matches("#eSubj,#eHead,#eBodyT,#eCta,#ePerk,#ePct,#eAmt,#eOn,#eFrom,#eTo,#eMinN,#eMinT,#eExp,#ePrefix,input[data-k]")) { clearTimeout(prevTimer); prevTimer = setTimeout(preview, 700); }
      if (e.target.closest(".cm-sec") && e.target.closest(".cm-sec").querySelector("#eAud")) { clearTimeout(audTimer); audTimer = setTimeout(countAudience, 400); }
    }
  });
  $("cmEd").addEventListener("change", function (e) {
    if (!ed) return;
    if (e.target.name === "eKind") { syncKind(); preview(); }
    if (e.target.matches("input[type=checkbox],select") && e.target.closest(".cm-sec") && e.target.closest(".cm-sec").querySelector("#eAud")) { clearTimeout(audTimer); audTimer = setTimeout(countAudience, 200); }
    if (e.target.matches("input[data-k],#eOn,#eTag")) preview();
    if (e.target.matches("input[data-k],#eFrom,#eTo,#eExp")) { clearTimeout(availTimer); availTimer = setTimeout(checkAvail, 300); }
    if (e.target.matches("select[data-photo]")) {
      var imgs = shownPhotos.slice(0, 3); imgs[Number(e.target.getAttribute("data-photo"))] = e.target.value;
      var seen = {}; ed.offer.images = imgs.filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; });
      if (!ed.offer.images.length) ed.offer.images = null;
      preview();
    }
  });
  $("cmEd").addEventListener("click", function (e) {
    if (!ed) return;
    var m = e.target.closest("#eMonths [data-m]");
    if (m) { m.classList.toggle("on"); clearTimeout(audTimer); audTimer = setTimeout(countAudience, 300); return; }
    if (e.target.closest("#eSave")) {
      edMsg("Saving…");
      save().then(function () { edMsg("Saved as a draft."); loadAll(); }, function (er) { edMsg(er.message, true); });
    }
    if (e.target.closest("#ePhotoAuto")) { ed.offer.images = null; preview(); return; }
    if (e.target.closest("#eDecline")) { var id = ed.id; closeModal(); decline(id); }
    if (e.target.closest("#eTest")) {
      var to = ($("eTestTo").value || "").trim();
      edMsg("Sending a test to " + to + "…");
      fn({ action: "send_test", campaign: collect(), to: to }).then(function (r) { edMsg("Test sent to " + r.to + " (with a sample code)."); }, function (er) { edMsg(er.message, true); });
    }
    if (e.target.closest("#eRewrite")) {
      var b = $("eRewrite"); b.disabled = true; b.textContent = "Rewriting…";
      fn({ action: "rewrite", campaign: collect(), instruction: $("eInstr").value }).then(function (r) {
        b.disabled = false; b.textContent = "✨ Rewrite";
        if (r.subject) $("eSubj").value = r.subject;
        if (r.headline) $("eHead").value = r.headline;
        if (r.body) $("eBodyT").value = r.body;
        if (r.cta_label) $("eCta").value = r.cta_label;
        edMsg("Rewritten — check it, then save."); preview();
      }, function (er) { b.disabled = false; b.textContent = "✨ Rewrite"; edMsg(er.message, true); });
    }
    if (e.target.closest("#eLaunch")) {
      var c = collect();
      if (!c.subject || !c.body.replace(/Hi \{first_name\},?/, "").trim()) { edMsg("Write the subject and the message first.", true); return; }
      if (!c.expires_on || c.expires_on < todayStr()) { edMsg("Set a code expiry date in the future.", true); return; }
      if (!num(ed.count)) { edMsg("No guests match this audience.", true); return; }
      if (ed.avail && ed.avail.verdict === "full") { edMsg("These dates are full in Cloudbeds — change the stay dates first.", true); return; }
      if (ed.avail && ed.avail.verdict === "tight" && !confirm("Most of these dates are already full in Cloudbeds:\n" + ed.avail.note + "\n\nSend anyway?")) return;
      if (!confirm("Send “" + c.name + "” to " + plural(ed.count, "guest") + "?\n\nOffer: " + offerLine(c.offer) + "\nSubject: " + c.subject +
        "\n\nEach guest gets a personal code. Emails go out a few at a time (up to your daily limit); you can pause or cancel from the Campaigns tab.")) return;
      edMsg("Creating codes…");
      save().then(function (id) { return call("campaign_launch", { p_id: id }); }).then(function (r) {
        fn({ action: "process" }).catch(function () { return null; }); // first batch right away
        closeModal(); tab = "campaigns"; store("vbr.cmTab", tab);
        setFlash("Sending to " + plural(r.recipients, "guest") + " — the first emails are going out now.");
        loadAll();
      }, function (er) { edMsg(er.message, true); });
    }
  });

  // the campaign detail window: pause / resume / cancel, see the email
  $("cmEd").addEventListener("click", function (e) {
    if (!detail || ed) return;
    var c = detail;
    var b = e.target.closest("[data-st]");
    if (b) {
      var to = b.getAttribute("data-st");
      if (to === "cancelled" && !confirm("Stop this campaign? Emails not sent yet are dropped and their codes switched off. Codes already emailed keep working.")) return;
      call("campaign_set_status", { p_id: c.id, p_status: to }).then(function () { closeModal(); loadAll(); }, function (er) { alert(er.message); });
      return;
    }
    var cb2 = e.target.closest("[data-codes]");
    if (cb2) { window.VBRCampaignCodes.show(cb2.getAttribute("data-codes")); return; }
    if (e.target.closest("[data-preview]")) {
      fn({ action: "preview", campaign: c }).then(function (p) { openModal(c.name + " — email", '<div style="padding:16px 18px"><p class="cm-prevsubj"><b>Subject:</b> ' + esc(p.subject) + '</p><div class="cm-prevbox" id="cmShadow"></div></div>'); shadow($("cmShadow"), p.html); });
    }
  });

  // ---------------------------------------------------------------- page events
  el.addEventListener("click", function (e) {
    var t = e.target.closest("#cmTabs [data-t]");
    if (t) { tab = t.getAttribute("data-t"); store("vbr.cmTab", tab); setFlash(""); drawTabs(); draw(); return; }
    if (e.target.closest("#cmRefresh")) { setFlash(""); loadAll(); return; }
    if (e.target.closest("#cmNew") || e.target.closest("[data-new]")) { e.preventDefault(); openEditor(null); return; }
    if (e.target.closest("#cmAsk")) { ask(); return; }
    var ed1 = e.target.closest("[data-edit]");
    if (ed1) { var c = byId(ed1.getAttribute("data-edit")); if (c) openEditor(c); return; }
    var dc = e.target.closest("[data-decline]");
    if (dc) { decline(dc.getAttribute("data-decline")); return; }
    var op = e.target.closest("[data-open]");
    if (op) { openDetail(op.getAttribute("data-open")); return; }
    if (e.target.closest("#cmImport")) { importGuests(); return; }
    if (e.target.closest("#cmRebuild")) { rebuild(); return; }
    if (e.target.closest("#cmSaveSet")) { saveSettings(); return; }
    var gs = e.target.closest("[data-gs]");
    if (gs) { guestSeg = gs.getAttribute("data-gs"); if ($("cmGSeg")) $("cmGSeg").value = guestSeg; loadGuests(); }
  });
  el.addEventListener("input", function (e) {
    if (e.target.id === "cmGQ") { guestQ = e.target.value.trim(); clearTimeout(gTimer); gTimer = setTimeout(loadGuests, 350); }
  });
  el.addEventListener("change", function (e) {
    if (e.target.id === "cmGSeg") { guestSeg = e.target.value; loadGuests(); }
  });

  // ---------------------------------------------------------------- codes (v70)
  var codesF = { state: store("vbr.cdState") || "", search: "", campaign_id: "" }, codesData = null, attData = null, attOnly = "", cdTimer = null, cdSeq = 0;
  var CSTATE = { booked: "Booked", tried: "Tried, not booked", sent: "Sent, not tried", queued: "Waiting to send", not_sent: "Not sent", disabled: "Disabled", expired: "Expired" };
  function drawCodes() {
    $("cmBody").innerHTML = flash +
      '<p class="cm-ro-note">View only — this account can look at codes but not change them.</p>' +
      '<div class="cm-tiles" id="cdTiles"></div>' +
      '<div class="cd-filters"><input type="search" id="cdQ" placeholder="Search code, guest, email or booking no." value="' + esc(codesF.search) + '">' +
      '<select id="cdCamp"><option value="">All campaigns</option></select>' +
      '<button type="button" class="btn-sm ghost" id="cdBulk" hidden>Disable unused codes of this campaign</button></div>' +
      '<div class="cd-chips" id="cdChips"></div>' +
      '<div id="cdList"><p class="cm-note">Loading codes…</p></div>' +
      '<h3 class="cd-h3">Attempts on the website</h3>' +
      '<p class="cm-note" style="margin-top:-4px">Every time someone applies a code on the booking pages — also codes that don\'t exist (typos or guessing). The email is what was typed on the booking form at the time, if any.</p>' +
      '<div class="cd-chips" id="atChips"></div><div id="atList"><p class="cm-note">Loading…</p></div>';
    loadCodes(); loadAttempts();
  }
  function loadCodes() {
    var seq = ++cdSeq;
    call("campaign_codes", { p: { state: codesF.state || null, search: codesF.search || null, campaign_id: codesF.campaign_id || null, limit: 300 } }).then(function (d) {
      if (seq !== cdSeq || !$("cdList")) return;
      codesData = d; drawCodeList();
    }, function (e) { if ($("cdList")) $("cdList").innerHTML = '<p class="cm-err">' + esc(/campaign_codes|function/.test(e.message) ? "Codes need a one-time database update (booking-v70)." : e.message) + "</p>"; });
  }
  function drawCodeList() {
    var d = codesData || {}, c = d.counts || {};
    $("cdTiles").innerHTML =
      tile("Codes sent out", n0(d.all), n0(c.queued || 0) + " waiting · " + n0(c.not_sent || 0) + " not sent") +
      tile("Tried on the website", n0(d.tried_any), "codes someone entered") +
      tile("Booked", n0(c.booked || 0), num(d.all) ? (Math.round(num(c.booked) / num(d.all) * 1000) / 10) + "% of codes" : "", num(c.booked) ? "hot" : "") +
      tile("Booking value", money(d.revenue), "discount given " + money(d.discount)) +
      tile("Disabled / expired", n0(num(c.disabled) + num(c.expired)), "");
    var sel = $("cdCamp");
    if (sel && sel.options.length <= 1) (d.campaigns || []).forEach(function (x) { var o = document.createElement("option"); o.value = x.id; o.textContent = x.name; sel.appendChild(o); });
    if (sel) sel.value = codesF.campaign_id;
    if ($("cdBulk")) $("cdBulk").hidden = !codesF.campaign_id;
    var chips = [["", "All", d.all]].concat(Object.keys(CSTATE).map(function (k) { return [k, CSTATE[k], c[k] || 0]; }));
    $("cdChips").innerHTML = chips.map(function (x) { return '<button type="button" data-cs="' + x[0] + '" class="' + (codesF.state === x[0] ? "on" : "") + '">' + esc(x[1]) + "<b>" + n0(x[2]) + "</b></button>"; }).join("");
    var rows = d.rows || [];
    $("cdList").innerHTML = !rows.length ? '<div class="cm-empty">' + (num(d.all) ? "No codes match." : "No offer codes yet — they're created when a campaign is approved and sent.") + "</div>" :
      '<div class="cm-twrap"><table class="cm-t"><thead><tr><th>Code</th><th>Guest</th><th>Campaign</th><th>Status</th><th>Tries on the website</th><th>Booking</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="cd-row" data-code="' + esc(r.code) + '"><td><code>' + esc(r.code) + "</code>" + (r.active ? "" : '<span class="cm-sub">switched off</span>') + "</td>" +
          "<td><b>" + esc(r.guest_name || "—") + '</b><span class="cm-sub">' + esc(r.email || "") + "</span></td>" +
          "<td>" + esc(r.campaign || "") + '<span class="cm-sub">' + (r.sent_at ? "sent " + esc(fmtTime(r.sent_at)) : esc(r.send_status || "")) + " · until " + esc(fmtDay(r.expires_on)) + "</span></td>" +
          '<td><span class="cm-chip cs-' + esc(r.state) + '">' + esc(CSTATE[r.state] || r.state) + "</span></td>" +
          "<td>" + (num(r.tries) ? "<b>" + plural(r.tries, "try", "tries") + "</b>" + '<span class="cm-sub">last ' + esc(fmtTime(r.last_try)) + " · " +
            (r.last_ok ? '<span class="cd-ok">worked</span>' : '<span class="cd-bad">' + esc(r.last_error || "refused") + "</span>") + "</span>" +
            (r.other_email ? '<span class="cm-sub cd-bad">tried with a different email</span>' : "") : '<span class="muted">—</span>') + "</td>" +
          "<td>" + (num(r.bookings) ? "<b>" + esc(r.orders || "") + '</b><span class="cm-sub">' + esc(money(r.revenue)) + " · saved " + esc(money(r.discount)) + "</span>" : '<span class="muted">—</span>') + "</td>" +
          '<td class="num">' + (r.state === "booked" ? "" : '<button type="button" class="btn-sm ' + (r.active ? "danger" : "ghost") + '" data-cact="' + (r.active ? "off" : "on") + '" data-code="' + esc(r.code) + '">' + (r.active ? "Disable" : "Enable") + "</button>") + "</td></tr>";
      }).join("") + "</tbody></table></div>" + (num(d.total) > rows.length ? '<p class="cm-note">Showing ' + n0(rows.length) + " of " + n0(d.total) + " — search to narrow it down.</p>" : "");
  }
  function loadAttempts() {
    call("campaign_code_attempts", { p: { only: attOnly || null, days: 60, limit: 150 } }).then(function (d) {
      attData = d; if ($("atList")) drawAttempts();
    }, function (e) { if ($("atList")) $("atList").innerHTML = '<p class="cm-err">' + esc(e.message) + "</p>"; });
  }
  function attRows(rows, showCode) {
    return '<div class="cm-twrap"><table class="cm-t"><thead><tr><th>When</th>' + (showCode ? "<th>Code entered</th>" : "") + "<th>Result</th><th>Email on the form</th><th>Where</th></tr></thead><tbody>" +
      rows.map(function (a) {
        var stage = a.stage === "booked" ? "Booked " + (a.order_code || "") : a.stage === "refused" ? "Booking refused" : "Applied";
        return "<tr><td>" + esc(fmtTime(a.at)) + (num(a.repeats) > 1 ? '<span class="cm-sub">' + n0(a.repeats) + " times</span>" : "") + "</td>" +
          (showCode ? '<td><code>' + esc(a.code) + "</code>" + '<span class="cm-sub">' + (a.known ? esc(a.campaign ? a.campaign + (a.owner ? " · sent to " + a.owner : "") : "discount code") : "not a code we have") + "</span></td>" : "") +
          "<td>" + (a.ok ? '<span class="cd-ok">' + esc(stage) + " ✓</span>" : '<span class="cd-bad">' + esc(a.stage === "refused" ? "Booking refused" : "Refused") + "</span>" + '<span class="cm-sub">' + esc(a.error || "") + "</span>") + "</td>" +
          "<td>" + (a.email ? esc(a.email) + (a.matches_owner === false ? '<span class="cm-sub cd-bad">not the address it was sent to</span>' : a.matches_owner ? '<span class="cm-sub cd-ok">the address it was sent to</span>' : "") : '<span class="muted">not typed yet</span>') + "</td>" +
          "<td>" + esc(a.page === "/book/" ? "Day trip booking" : a.page === "/book-stay/" ? "Villa booking" : (a.page || "")) + '<span class="cm-sub">' + esc([a.kind === "day_trip" ? "day trip" : a.kind, a.check_in ? "for " + fmtDay(a.check_in) : "", a.device, a.browser ? "browser " + a.browser : ""].filter(Boolean).join(" · ")) + "</span></td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function drawAttempts() {
    var d = attData || {}, s = d.summary || {};
    $("atChips").innerHTML = [["", "All", s.attempts], ["failed", "Refused", s.failed], ["unknown", "Unknown codes", s.unknown], ["campaign", "Offer codes only", null]].map(function (x) {
      return '<button type="button" data-at="' + x[0] + '" class="' + (attOnly === x[0] ? "on" : "") + '">' + esc(x[1]) + (x[2] != null ? "<b>" + n0(x[2]) + "</b>" : "") + "</button>";
    }).join("") + '<span class="cm-note" style="align-self:center;margin:0 0 0 6px">last 60 days · ' + plural(s.browsers || 0, "browser") + " · " + plural(s.booked || 0, "booking") + " made with a code</span>";
    var rows = d.rows || [];
    $("atList").innerHTML = rows.length ? attRows(rows, true) : '<div class="cm-empty">No codes tried on the website yet' + (attOnly ? " for this filter" : "") + ".</div>";
  }
  function openCode(code) {
    openModal("Code " + code, '<div style="padding:24px">Loading…</div>');
    call("campaign_code_detail", { p_code: code }).then(function (d) {
      var r = d.code || {}, pl = d.plain || {};
      var bk = d.bookings || [], at = d.attempts || [];
      openModal("Code " + code,
        '<div style="padding:16px 18px">' +
        '<div class="cm-tiles">' +
        tile("Sent to", esc(r.guest_name || r.email || "—"), esc(r.email || "") + (r.sent_at ? " · " + esc(fmtTime(r.sent_at)) : "")) +
        tile("Campaign", esc(r.campaign || pl.label || "—"), "valid until " + esc(fmtDay(r.expires_on || pl.expires_on))) +
        tile("Status", esc(CSTATE[r.state] || (pl.active ? "Active" : "Disabled")), pl.active ? "the code works" : "switched off — the website refuses it") +
        tile("Tries", n0(r.tries || 0), num(r.failed_tries) ? n0(r.failed_tries) + " refused" : "") +
        tile("Bookings", n0(r.bookings || 0), num(r.bookings) ? money(r.revenue) + " · saved " + money(r.discount) : "") + "</div>" +
        '<div class="cm-bar">' + (r.state === "booked" ? "" : '<button type="button" class="btn-sm ' + (pl.active ? "danger" : "primary") + '" data-cact="' + (pl.active ? "off" : "on") + '" data-code="' + esc(code) + '">' + (pl.active ? "Disable this code" : "Enable this code") + "</button>") + "</div>" +
        (pl.note ? '<div class="cm-why-box">' + esc(pl.note) + "</div>" : "") +
        '<h3 class="cd-h3" style="margin-top:6px">Bookings with this code</h3>' +
        (bk.length ? '<div class="cm-twrap"><table class="cm-t"><thead><tr><th>Booking</th><th>Stay</th><th>Guest email</th><th class="num">Total</th><th class="num">Saved</th></tr></thead><tbody>' +
          bk.map(function (b) {
            return "<tr><td><b>" + esc(b.order_code || "") + '</b><span class="cm-sub">' + esc(b.status) + " · made " + esc(fmtTime(b.created_at)) + "</span></td><td>" + esc((b.stay_type === "overnight" ? "Villa " : "Day trip ") + fmtDay(b.check_in)) + "</td><td>" + esc(b.guest_email || "") + '</td><td class="num">' + esc(money(b.total)) + '</td><td class="num">' + esc(money(b.discount)) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="cm-note">No booking yet.</p>') +
        '<h3 class="cd-h3">Tries on the website</h3>' + (at.length ? attRows(at, false) : '<p class="cm-note">Nobody has entered this code on the website yet.</p>') +
        "</div>");
    }, function (e) { openModal("Couldn't load", '<p class="cm-err" style="padding:18px">' + esc(e.message) + "</p>"); });
  }
  function setActive(codes, on, after) {
    if (!on && !confirm(codes.length === 1 ? "Disable code " + codes[0] + "? The website will refuse it from now on (bookings already made keep it)." : "Disable " + plural(codes.length, "unused code") + "?")) return;
    call("campaign_code_set_active", { p_codes: codes, p_active: on }).then(function (n) {
      setFlash(n0(n) + " code" + (n === 1 ? "" : "s") + " " + (on ? "re-enabled" : "disabled") + ".");
      if (after) after();
      if (tab === "codes") drawCodes();
    }, function (e) { alert(e.message); });
  }
  el.addEventListener("click", function (e) {
    if (tab !== "codes") return;
    var b = e.target.closest("[data-cact]");
    if (b) { e.stopPropagation(); setActive([b.getAttribute("data-code")], b.getAttribute("data-cact") === "on"); return; }
    var cs = e.target.closest("[data-cs]");
    if (cs) { codesF.state = cs.getAttribute("data-cs"); store("vbr.cdState", codesF.state); loadCodes(); return; }
    var at = e.target.closest("[data-at]");
    if (at) { attOnly = at.getAttribute("data-at"); loadAttempts(); return; }
    if (e.target.closest("#cdBulk")) {
      var unused = ((codesData && codesData.rows) || []).filter(function (r) { return r.active && r.state !== "booked"; }).map(function (r) { return r.code; });
      if (!unused.length) { alert("No active unused codes in this campaign."); return; }
      setActive(unused, false);
      return;
    }
    var row = e.target.closest("tr.cd-row");
    if (row) openCode(row.getAttribute("data-code"));
  });
  el.addEventListener("input", function (e) {
    if (e.target.id === "cdQ") { codesF.search = e.target.value.trim(); clearTimeout(cdTimer); cdTimer = setTimeout(loadCodes, 350); }
  });
  el.addEventListener("change", function (e) {
    if (e.target.id === "cdCamp") { codesF.campaign_id = e.target.value; loadCodes(); }
  });
  $("cmEd").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cact]");
    if (!b || ed) return;
    var code = b.getAttribute("data-code");
    setActive([code], b.getAttribute("data-cact") === "on", function () { openCode(code); });
  });
  window.VBRCampaignCodes = { show: function (campaignId) { codesF.campaign_id = campaignId || ""; codesF.state = ""; closeModal(); tab = "codes"; store("vbr.cmTab", tab); drawTabs(); draw(); } };

  // ---------------------------------------------------------------- campaign accounts
  function whenView(fn2, tries) {
    if (window.VBRView) return fn2(window.VBRView);
    if ((tries || 0) < 100) setTimeout(function () { whenView(fn2, (tries || 0) + 1); }, 50);
  }
  function checkAccount() {
    if (dashScreen.style.display !== "block") { document.body.classList.remove("cmp-staff"); return; }
    // v70: every staff account; view-only accounts get the page without the buttons that change things
    sb.auth.getSession().then(function (res) {
      var ok = !!(res.data && res.data.session && res.data.session.user);
      document.body.classList.toggle("cmp-staff", ok);
      if (!ok) { if (shown) whenView(function (V) { V.set("new"); }); return; }
      call("campaign_access").then(function (a) { document.body.classList.toggle("cm-ro", !(a && a.can_edit)); }, function () { document.body.classList.remove("cm-ro"); });
    });
  }
  new MutationObserver(checkAccount).observe(dashScreen, { attributes: true, attributeFilter: ["style"] });
  checkAccount();

  window.VBRCampaigns = {
    show: function (on) {
      var was = shown; shown = !!on;
      document.body.classList.toggle("cmv", shown);
      if (shown && !was) { drawTabs(); loadAll(); }
      if (!shown && was) closeModal();
    },
  };
})();
