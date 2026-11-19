/* ==========================================================================
   Staff dashboard — Ask (AI assistant) (v81)
   --------------------------------------------------------------------------
   A floating "Ask" button opens a chat panel. Staff ask anything about
   bookings, guests, revenue, occupancy or the system; the staff-assistant
   edge function answers with Claude, looking things up in the live database
   with the staff member's own session (read-only — it can't change data).
   Each answer can show the lookups it ran. The conversation lives only in
   this tab ("New chat" clears it). Needs staff-dashboard.js loaded first.
   ========================================================================== */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb, esc = D.esc;

  var css = document.createElement("style");
  css.textContent =
    "#askFab{position:fixed;right:18px;bottom:18px;z-index:900;border:0;border-radius:999px;background:var(--lagoon,#1f7a72);color:#fff;font:inherit;font-weight:800;" +
    "padding:12px 18px;box-shadow:0 10px 30px -10px rgba(0,0,0,.45);cursor:pointer;display:none}#askFab:hover{background:var(--lagoon-deep,#14524c)}" +
    "body.ask-ready #askFab{display:block}body.ask-open #askFab{display:none}" +
    "#askPanel{position:fixed;right:18px;bottom:18px;z-index:901;width:min(460px,calc(100vw - 24px));height:min(640px,calc(100vh - 36px));display:none;flex-direction:column;" +
    "background:var(--surface,#fffdf8);color:var(--ink,#23241f);border:1px solid var(--line,#ddd2ba);border-radius:16px;box-shadow:0 24px 60px -20px rgba(0,0,0,.5);overflow:hidden}" +
    "body.ask-open #askPanel{display:flex}" +
    "#askPanel header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,#ddd2ba)}#askPanel header h3{margin:0;font-size:1rem;flex:1}" +
    "#askPanel header small{display:block;font-weight:500;color:var(--ink-soft,#6b6559);font-size:.72rem}" +
    "#askLog{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}" +
    ".ask-msg{max-width:92%;padding:9px 12px;border-radius:12px;font-size:.88rem;line-height:1.5;overflow-wrap:anywhere}" +
    ".ask-msg.me{align-self:flex-end;background:var(--lagoon,#1f7a72);color:#fff;white-space:pre-wrap}" +
    ".ask-msg.ai{align-self:flex-start;background:var(--sand,#f6f1e6);border:1px solid var(--line,#ddd2ba)}" +
    ".ask-msg.err{align-self:flex-start;background:#fbeaea;color:#8a1f1f}" +
    ".ask-msg.ai p{margin:0 0 8px}.ask-msg.ai p:last-child{margin:0}.ask-msg.ai ul,.ask-msg.ai ol{margin:0 0 8px;padding-left:20px}" +
    ".ask-msg.ai h4{margin:6px 0 4px;font-size:.9rem}.ask-msg.ai code{background:rgba(0,0,0,.06);padding:0 4px;border-radius:4px;font-size:.82em}" +
    ".ask-msg.ai .tw{overflow-x:auto;margin:0 0 8px}.ask-msg.ai table{border-collapse:collapse;font-size:.8rem}" +
    ".ask-msg.ai th,.ask-msg.ai td{border:1px solid var(--line,#ddd2ba);padding:3px 7px;text-align:left;white-space:nowrap}.ask-msg.ai th{background:rgba(0,0,0,.04)}" +
    ".ask-q{margin-top:6px;font-size:.74rem;color:var(--ink-soft,#6b6559)}.ask-q summary{cursor:pointer}" +
    ".ask-q pre{white-space:pre-wrap;background:rgba(0,0,0,.05);padding:6px;border-radius:6px;margin:4px 0;font-size:.72rem}" +
    ".ask-hint{color:var(--ink-soft,#6b6559);font-size:.82rem}.ask-hint button{display:block;margin:6px 0 0;text-align:left;font:inherit;font-size:.82rem;" +
    "background:none;border:1px solid var(--line,#ddd2ba);border-radius:10px;padding:7px 10px;cursor:pointer;color:inherit;width:100%}" +
    ".ask-hint button:hover{border-color:var(--lagoon,#1f7a72)}" +
    "#askForm{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line,#ddd2ba)}" +
    "#askInput{flex:1;resize:none;font:inherit;font-size:.9rem;padding:8px 10px;border-radius:10px;border:1px solid var(--line,#ddd2ba);background:var(--surface,#fffdf8);color:inherit;min-height:40px;max-height:140px}" +
    ".ask-typing{align-self:flex-start;color:var(--ink-soft,#6b6559);font-size:.82rem}" +
    "@media print{#askFab,#askPanel{display:none!important}}";
  document.head.appendChild(css);

  var fab = document.createElement("button");
  fab.type = "button"; fab.id = "askFab"; fab.textContent = "✦ Ask";
  fab.title = "Ask anything about bookings, guests, revenue or the system";
  var panel = document.createElement("section");
  panel.id = "askPanel"; panel.setAttribute("aria-label", "Ask the assistant");
  panel.innerHTML =
    '<header><h3>Ask<small>Live answers from the booking system · read-only</small></h3>' +
    '<button type="button" class="btn-sm ghost" id="askNew">New chat</button>' +
    '<button type="button" class="btn-sm ghost" id="askClose" aria-label="Close">✕</button></header>' +
    '<div id="askLog" aria-live="polite"></div>' +
    '<form id="askForm"><textarea id="askInput" rows="1" placeholder="e.g. How much have we earned from casitas in December so far?"></textarea>' +
    '<button type="submit" class="btn-sm primary" id="askSend">Send</button></form>';
  document.body.appendChild(fab);
  document.body.appendChild(panel);
  var $ = function (id) { return document.getElementById(id); };
  var log = $("askLog"), input = $("askInput"), send = $("askSend");

  // only once a staff member is signed in
  var dash = $("dashScreen");
  function ready() {
    var on = !!dash && getComputedStyle(dash).display !== "none";
    document.body.classList.toggle("ask-ready", on);
    if (!on) document.body.classList.remove("ask-open");
  }
  setInterval(ready, 1500); ready();

  var history = [], busy = false;
  var EXAMPLES = [
    "How are casita bookings for the rest of the year vs. the maximum we could earn?",
    "Which nights in December still have the most casitas free?",
    "Who is checking in tomorrow, and have they paid?",
    "Top 10 guests by total spend this year",
  ];
  function hello() {
    log.innerHTML = '<div class="ask-hint">Ask anything about bookings, guests, revenue, cabanas, casitas or payments. I look it up live, and I can\'t change anything.' +
      EXAMPLES.map(function (q) { return '<button type="button" data-q="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div>";
  }
  hello();

  // ------------------------------------------------------------- markdown (small, safe: everything escaped first)
  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  }
  function md(text) {
    var lines = String(text || "").replace(/\r/g, "").split("\n"), out = [], i = 0;
    while (i < lines.length) {
      var l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        var cells = function (r) { return r.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); }); };
        var head = cells(l), rows = []; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push('<div class="tw"><table><thead><tr>' + head.map(function (h) { return "<th>" + inline(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>");
        continue;
      }
      if (/^\s*[-*•]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
        var ord = /^\s*\d+[.)]\s+/.test(l), items = [];
        while (i < lines.length && (ord ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/).test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, "")); i++; }
        out.push((ord ? "<ol>" : "<ul>") + items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + (ord ? "</ol>" : "</ul>"));
        continue;
      }
      if (/^#{1,6}\s+/.test(l)) { out.push("<h4>" + inline(l.replace(/^#+\s+/, "")) + "</h4>"); i++; continue; }
      if (!l.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^#{1,6}\s|^\s*[-*•]\s+|^\s*\d+[.)]\s+|^\s*\|/.test(lines[i])) { para.push(inline(lines[i])); i++; }
      if (!para.length) { para.push(inline(lines[i])); i++; }
      out.push("<p>" + para.join("<br>") + "</p>");
    }
    return out.join("");
  }

  function add(cls, html) {
    var d = document.createElement("div");
    d.className = "ask-msg " + cls;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function ask(q) {
    q = String(q || "").trim();
    if (!q || busy) return;
    if (log.querySelector(".ask-hint")) log.innerHTML = "";
    busy = true; send.disabled = true;
    history.push({ role: "user", content: q });
    add("me", esc(q));
    var typing = document.createElement("div");
    typing.className = "ask-typing"; typing.textContent = "Looking it up…";
    log.appendChild(typing); log.scrollTop = log.scrollHeight;
    sb.functions.invoke("staff-assistant", { body: { messages: history } }).then(function (res) {
      typing.remove();
      var data = res.data, err = res.error;
      if (err || !data || data.error) {
        var msg = (data && data.error) || (err && err.message) || "Something went wrong.";
        var ctx = err && err.context;
        if (ctx && typeof ctx.json === "function") {
          return ctx.json().then(function (j) { fail(j && j.error ? j.error : msg); }, function () { fail(msg); });
        }
        return fail(msg);
      }
      history.push({ role: "assistant", content: data.answer });
      var box = add("ai", md(data.answer));
      if (data.queries && data.queries.length) {
        box.insertAdjacentHTML("beforeend", '<details class="ask-q"><summary>' + data.queries.length + " lookup" + (data.queries.length === 1 ? "" : "s") + "</summary>" +
          data.queries.map(function (x) {
            return "<div>" + esc(x.purpose || "") + (x.error ? " — <b>error:</b> " + esc(x.error) : " — " + x.rows + " row" + (x.rows === 1 ? "" : "s")) + "<pre>" + esc(x.sql) + "</pre></div>";
          }).join("") + "</details>");
      }
      done();
    }, function (e) { typing.remove(); fail(e && e.message ? e.message : "Couldn't reach the assistant."); });
  }
  function fail(msg) {
    history.pop(); // let them ask again
    add("err", esc(msg));
    done();
  }
  function done() { busy = false; send.disabled = false; input.focus(); }

  fab.addEventListener("click", function () { document.body.classList.add("ask-open"); setTimeout(function () { input.focus(); }, 30); });
  $("askClose").addEventListener("click", function () { document.body.classList.remove("ask-open"); });
  $("askNew").addEventListener("click", function () { if (busy) return; history = []; hello(); input.focus(); });
  log.addEventListener("click", function (e) { var b = e.target.closest("button[data-q]"); if (b) ask(b.getAttribute("data-q")); });
  $("askForm").addEventListener("submit", function (e) { e.preventDefault(); var q = input.value; input.value = ""; input.style.height = ""; ask(q); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("askForm").requestSubmit(); }
  });
  input.addEventListener("input", function () { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("ask-open")) document.body.classList.remove("ask-open"); });
})();
