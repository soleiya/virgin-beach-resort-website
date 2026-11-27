/* Weeknight offer banner (booking-v94)
   Fills <section data-weeknight-offer hidden> with the live weekday-only campaign offer and the
   Sun–Thu nights still open per casita, from public.weeknight_offer_public() (Cloudbeds availability
   via cb_rates). Stays hidden when no weekday offer is running or nothing is open.
   Needs booking-config.js (window.SUPABASE_CONFIG) loaded first. */
(function () {
  "use strict";
  var cfg = window.SUPABASE_CONFIG || {};
  var MAX_CHIPS = 10;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function d(iso) { var p = String(iso).slice(0, 10).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function md(iso) { var x = d(iso); return MON[x.getUTCMonth()] + " " + x.getUTCDate(); }
  function chip(iso) { var x = d(iso); return DOW[x.getUTCDay()] + ", " + md(iso); }
  function peso(n) { return "&#8369;" + Math.round(Number(n) || 0).toLocaleString("en-PH"); }

  function css() {
    if (document.getElementById("wno-css")) return;
    var s = document.createElement("style");
    s.id = "wno-css";
    s.textContent =
      ".wno{border:1px solid var(--line);background:var(--lagoon-tint);border-radius:18px;padding:clamp(20px,3vw,32px)}" +
      ".wno h2{margin:.2em 0 .3em}" +
      ".wno-lead{color:var(--ink-soft);max-width:68ch;margin:0 0 18px}" +
      ".wno-list{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}" +
      ".wno-room{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px}" +
      ".wno-room-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}" +
      ".wno-room-head a{font-weight:700;color:var(--ink);text-decoration:none}" +
      ".wno-room-head a:hover{color:var(--lagoon)}" +
      ".wno-room-head small{color:var(--ink-soft)}" +
      ".wno-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}" +
      ".wno-chips span{font-size:13px;line-height:1;padding:7px 9px;border-radius:999px;background:var(--lagoon-tint);color:var(--lagoon-deep);white-space:nowrap}" +
      ".wno-chips .more{background:transparent;color:var(--ink-soft)}" +
      ".wno-foot{margin:16px 0 0;font-size:13px;color:var(--ink-soft)}";
    document.head.appendChild(s);
  }

  function render(el, o) {
    var base = el.getAttribute("data-base") || "";
    var pct = Number(o.percent) || 0;
    var rooms = (o.rooms || []).map(function (r) {
      var n = r.nights || [];
      var chips = n.slice(0, MAX_CHIPS).map(function (x) { return "<span>" + esc(chip(x)) + "</span>"; }).join("");
      if (n.length > MAX_CHIPS) chips += '<span class="more">+' + (n.length - MAX_CHIPS) + " more</span>";
      return '<div class="wno-room"><div class="wno-room-head">' +
        '<a href="' + esc(base) + "book-stay/index.html?casita=" + encodeURIComponent(r.slug) + '">' + esc(r.name) + " &rarr;</a>" +
        "<small>" + n.length + " weeknight" + (n.length === 1 ? "" : "s") + " open &middot; from " + peso(r.rate) + "/night</small>" +
        '</div><div class="wno-chips">' + chips + "</div></div>";
    }).join("");
    el.innerHTML =
      '<div class="wrap"><div class="wno">' +
      '<span class="eyebrow">Weeknight offer</span>' +
      "<h2>Quiet weeknights" + (pct ? ", " + pct + "% off" : "") + "</h2>" +
      '<p class="wno-lead">Got our email? Your personal code takes ' + (pct ? pct + "% off" : "a discount off") +
      " casita rates on Sunday to Thursday nights until " + esc(md(o.stay_to)) +
      (o.book_by ? " (book by " + esc(md(o.book_by)) + ")" : "") +
      ". Book through the link in the email or enter your code when you book. These weeknights are still open:</p>" +
      '<div class="wno-list">' + rooms + "</div>" +
      '<p class="wno-foot">Live from our availability. Friday and Saturday nights and holiday eves are at the regular rate. Book only on virginbeachresort.com.</p>' +
      "</div></div>";
    el.hidden = false;
  }

  function run() {
    var el = document.querySelector("[data-weeknight-offer]");
    if (!el || !cfg.url || !cfg.anonKey || !window.fetch) return;
    css();
    fetch(cfg.url + "/rest/v1/rpc/weeknight_offer_public", {
      method: "POST",
      headers: { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey, "Content-Type": "application/json" },
      body: "{}",
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (o) { if (o && o.rooms && o.rooms.length) render(el, o); })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
