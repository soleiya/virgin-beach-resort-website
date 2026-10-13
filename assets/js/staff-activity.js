/* Virgin Beach Resort — Staff dashboard: Team Activity + "last active" tracking.
 *
 * 1. Heartbeat: while a signed-in staff member is actually using the dashboard
 *    (tab in front + a click, key press, scroll or touch in the last 5 minutes)
 *    we call staff_heartbeat() at most every 2 minutes. The database folds
 *    pings into visits (a gap of 30+ minutes starts a new visit).
 * 2. Team Activity modal: staff_activity_overview() for the table and
 *    staff_activity_history() for the timeline, which also rebuilds older
 *    history from Supabase's own sign-in records and the booking audit log.
 * See supabase-functions/booking-v12-staff-activity.sql.
 */
(function () {
  "use strict";
  var D = window.VBRDash;
  if (!D || !D.sb) return;
  var sb = D.sb;
  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------- heartbeat
  var PING_EVERY = 2 * 60 * 1000, IDLE_AFTER = 5 * 60 * 1000;
  var lastInput = Date.now(), lastPing = 0, signedIn = false, rpcMissing = false;

  function ping(force) {
    if (!signedIn || rpcMissing) return;
    if (document.visibilityState !== "visible") return;
    var now = Date.now();
    if (!force && (now - lastInput > IDLE_AFTER || now - lastPing < PING_EVERY)) return;
    lastPing = now;
    sb.rpc("staff_heartbeat", { p_user_agent: navigator.userAgent }).then(function (res) {
      // Before the SQL is installed the function doesn't exist — stop trying.
      if (res.error && /staff_heartbeat|function/i.test(res.error.message || "")) rpcMissing = true;
    });
  }
  ["click", "keydown", "scroll", "touchstart", "mousemove"].forEach(function (ev) {
    window.addEventListener(ev, function () {
      var wasIdle = Date.now() - lastInput > IDLE_AFTER;
      lastInput = Date.now();
      if (wasIdle) ping(true);
    }, { passive: true, capture: true });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { lastInput = Date.now(); ping(true); }
  });
  setInterval(function () { ping(false); }, 30 * 1000);

  sb.auth.getSession().then(function (r) {
    signedIn = !!(r.data && r.data.session);
    if (signedIn) ping(true);
  });
  sb.auth.onAuthStateChange(function (event, session) {
    var was = signedIn;
    signedIn = !!session;
    if (signedIn && !was) ping(true);
  });

  // ---------------------------------------------------------------- helpers
  function esc(s) { return D.esc ? D.esc(s) : String(s == null ? "" : s); }
  function label(email) { return (D.staffLabel && D.staffLabel(email)) || email || "—"; }
  function fmt(ts) { return ts ? D.fmtDateTime(ts) : "—"; }
  function rel(ts) {
    if (!ts) return "";
    var mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hrs / 24);
    if (days < 60) return days + (days === 1 ? " day ago" : " days ago");
    return Math.round(days / 30) + " months ago";
  }
  function presence(ts) {
    if (!ts) return "";
    var mins = (Date.now() - new Date(ts).getTime()) / 60000;
    return mins <= 10 ? "now" : mins <= 24 * 60 ? "today" : mins <= 7 * 24 * 60 ? "week" : "";
  }
  function device(ua) {
    if (!ua) return "";
    var os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" :
      /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
    var br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" :
      /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
    return [br, os].filter(Boolean).join(" on ");
  }
  function duration(a, b) {
    if (!a || !b) return "";
    var mins = Math.round((new Date(b) - new Date(a)) / 60000);
    if (mins < 1) return "under a minute";
    if (mins < 60) return mins + " min";
    var h = Math.floor(mins / 60), m = mins % 60;
    return h + " h" + (m ? " " + m + " min" : "");
  }
  function until(a, b) {
    if (!b) return "";
    var sa = fmt(a), sb2 = fmt(b), da = sa.split(" ").slice(0, 2).join(" "), db = sb2.split(" ").slice(0, 2).join(" ");
    return "until " + (da === db ? sb2.split(" ").slice(2).join(" ") : sb2);
  }
  var ACTION_WORDS = { insert: "Created booking", update: "Edited booking", "delete": "Deleted booking",
    cabana_added: "Added a cabana", cabana_removed: "Removed a cabana" };

  // ---------------------------------------------------------------- modal
  var backdrop = $("teamModalBackdrop"), teamBody = $("teamBody"), histBody = $("teamHistBody");
  var histStaff = $("teamHistStaff"), histDays = $("teamHistDays"), histKind = $("teamHistKind");
  if (!backdrop) return;
  var people = [];

  function setupMissing(where) {
    where.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--ink-soft);">Team Activity needs a one-time database update (booking-v12-staff-activity.sql).</td></tr>';
  }

  function loadOverview() {
    teamBody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading…</td></tr>';
    return sb.rpc("staff_activity_overview").then(function (res) {
      if (res.error) {
        if (/staff_activity_overview|function/i.test(res.error.message || "")) return setupMissing(teamBody);
        teamBody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--rose,#9c4a3f);">Couldn\'t load team activity: ' + esc(res.error.message) + "</td></tr>";
        return;
      }
      people = res.data || [];
      var keep = histStaff.value;
      histStaff.innerHTML = '<option value="">Everyone</option>' + people.map(function (p) {
        return '<option value="' + esc(p.user_id) + '">' + esc(label(p.email)) + "</option>";
      }).join("");
      histStaff.value = keep;
      teamBody.innerHTML = "";
      people.forEach(function (p) {
        var tr = document.createElement("tr");
        if (p.user_id === histStaff.value) tr.className = "is-selected";
        var pr = presence(p.last_active_at);
        tr.innerHTML =
          "<td><b>" + esc(label(p.email)) + '</b><span class="rel">' + esc(p.email) + "</span></td>" +
          '<td><span class="presence ' + pr + '"></span>' + (pr === "now" ? "<b>Online now</b>" : esc(fmt(p.last_active_at))) +
            '<span class="rel">' + esc(pr === "now" ? "" : rel(p.last_active_at)) + "</span></td>" +
          "<td>" + esc(fmt(p.last_sign_in_at)) + '<span class="rel">' + esc(rel(p.last_sign_in_at)) + "</span></td>" +
          "<td>" + esc(fmt(p.last_change_at)) + '<span class="rel">' + esc(rel(p.last_change_at)) + "</span></td>" +
          '<td class="num">' + esc(p.open_days_30d) + "</td>" +
          '<td class="num">' + esc(p.changes_30d) + "</td>";
        tr.addEventListener("click", function () {
          histStaff.value = histStaff.value === p.user_id ? "" : p.user_id;
          Array.prototype.forEach.call(teamBody.children, function (r) { r.classList.remove("is-selected"); });
          if (histStaff.value) tr.classList.add("is-selected");
          loadHistory();
        });
        teamBody.appendChild(tr);
      });
      if (!people.length) teamBody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--ink-soft);">No staff accounts found.</td></tr>';
    });
  }

  function loadHistory() {
    histBody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--ink-soft);">Loading…</td></tr>';
    sb.rpc("staff_activity_history", { p_user_id: histStaff.value || null, p_days: Number(histDays.value) || 30 }).then(function (res) {
      if (res.error) {
        if (/staff_activity_history|function/i.test(res.error.message || "")) return setupMissing(histBody);
        histBody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--rose,#9c4a3f);">Couldn\'t load history: ' + esc(res.error.message) + "</td></tr>";
        return;
      }
      var k = histKind.value;
      var rows = (res.data || []).filter(function (r) {
        if (!k) return true;
        if (k === "use") return r.kind === "active" || r.kind === "open";
        return r.kind === k;
      });
      if (!rows.length) {
        histBody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--ink-soft);">Nothing recorded for this period.</td></tr>';
        return;
      }
      histBody.innerHTML = rows.map(function (r) {
        var what, detail = "";
        if (r.kind === "active") {
          what = "Using the dashboard";
          detail = until(r.at, r.ended_at) + " (" + duration(r.at, r.ended_at) + ")" +
            (device(r.detail) ? " · " + device(r.detail) : "");
        } else if (r.kind === "open") {
          what = "Dashboard open";
          detail = until(r.at, r.ended_at) + " (about " + duration(r.at, r.ended_at) + ")";
        } else if (r.kind === "sign_in") {
          what = "Signed in";
          detail = device(r.detail) || "";
        } else {
          what = "Booking change";
          var parts = String(r.detail || "").split(" · ");
          detail = (ACTION_WORDS[parts[0]] || (parts[0] || "").replace(/_/g, " ")) + (parts.length > 1 ? " — " + parts.slice(1).join(" · ") : "");
        }
        return "<tr><td>" + esc(fmt(r.at)) + '<span class="rel">' + esc(rel(r.at)) + "</span></td>" +
          "<td>" + esc(label(r.email)) + "</td>" +
          '<td><span class="kind-pill k-' + esc(r.kind) + '">' + esc(what) + "</span></td>" +
          "<td>" + esc(detail) + "</td></tr>";
      }).join("");
    });
  }

  function open() {
    backdrop.classList.add("open");
    ping(true);
    loadOverview().then(loadHistory);
  }
  function close() { backdrop.classList.remove("open"); }
  $("teamBtn").addEventListener("click", open);
  $("closeTeamBtn").addEventListener("click", close);
  $("teamRefreshBtn").addEventListener("click", function () { loadOverview().then(loadHistory); });
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  histStaff.addEventListener("change", function () {
    Array.prototype.forEach.call(teamBody.children, function (r, i) {
      r.classList.toggle("is-selected", !!people[i] && people[i].user_id === histStaff.value);
    });
    loadHistory();
  });
  histDays.addEventListener("change", loadHistory);
  histKind.addEventListener("change", loadHistory);
})();
