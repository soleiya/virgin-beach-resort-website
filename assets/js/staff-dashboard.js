(function () {
  var cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || cfg.url.indexOf("YOUR-PROJECT-REF") !== -1) {
    document.getElementById("loginScreen").innerHTML =
      "<h2>Not connected yet</h2><p>This dashboard needs assets/js/booking-config.js filled in with your real Supabase project first — see SETUP-BOOKING.md.</p>";
    return;
  }

  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  // Maps each staff member's dashboard login email to their display name,
  // so a booking they add through this dashboard can be attributed to them
  // by name (same idea as the old sheet's "Booker" column) instead of a
  // raw email address. Falls back to the email's first part for anyone
  // signing in with an address not in this list.
  var STAFF_EMAIL_NAMES = {
    "oriel@virginbeachresort.com": "Oriel",
    "chesca@virginbeachresort.com": "Chesca",
    "shan@virginbeachresort.com": "Shan",
    "reymer@virginbeachresort.com": "Reymer",
    "camile@virginbeachresort.com": "Camile",
    "jackie@virginbeachresort.com": "Jackie",
    "jhoms@virginbeachresort.com": "Jhoms",
    "carmela@virginbeachresort.com": "Carmela",
    "sugar@virginbeachresort.com": "Sugar",
    "harly@virginbeachresort.com": "Harly",
    "bea@virginbeachresort.com": "Bea",
    "aubrey@virginbeachresort.com": "Aubrey",
    "marison@virginbeachresort.com": "Marison",
    "sjc@virginbeachresort.com": "SJC",
    "rm@virginbeachresort.com": "RM",
    "gwen@virginbeachresort.com": "Gwen",
    "msnikka@virginbeachresort.com": "Ms. Nikka",
    "fo@staff.local": "FO",
    "sugar@staff.local": "Sugar",
    "fo@virginbeachresort.com": "FO",
  };
  var currentStaffName = null;

  var TYPE_LABELS = {
    day_trip: "Day Trip",
    half_day: "Half-Day Trip",
    flash_sale: "Flash Sale",
    all_inclusive_family: "All Inclusive (Family)",
    all_inclusive_barkada: "All Inclusive (Barkada)",
    corporate: "Corporate",
    other: "Other / Add-on",
    overnight: "Overnight Stay",
  };
  var SOURCE_LABELS = {
    website: "Website", messenger: "Messenger", phone: "Phone", email: "Email", walk_in: "Walk-in", other: "Other",
    sheet_import: "Imported (2026 Sheet)",
    cloudbeds: "Cloudbeds (website)", booking_com: "Booking.com", agoda: "Agoda", expo: "Expo", events: "Wedding / Events",
    corporate: "Corporate", partner: "Partner / Referral", returnee: "Returning guest", staff_stay: "Employee / friend stay",
  };
  var STATUS_ORDER = ["pending", "pending_payment", "confirmed", "declined", "completed", "expired"];
  var STATUS_LABELS = {
    pending: "Pending", pending_payment: "Pending Payment", confirmed: "Confirmed",
    declined: "Declined", completed: "Completed", expired: "Expired",
  };
  // Bookings that no longer hold their cabana(s).
  function releasesCabanas(status) { return status === "declined" || status === "expired"; }

  // Same rule as booking_deadlines() in supabase-functions/booking-v7.sql:
  // pay within 24h of booking or it expires, never past 8:00 AM on the trip
  // date. Booked on/after 8:00 AM of the trip date = pay on arrival.
  function paymentDeadlines(r) {
    if (!r.created_at) return null;
    var created = new Date(r.created_at).getTime();
    var trip8 = r.check_in ? new Date(r.check_in + "T08:00:00+08:00").getTime() : null;
    if (trip8 !== null && trip8 <= created) return null;
    var fin = created + 24 * 3600e3;
    if (trip8 !== null && trip8 < fin) fin = trip8;
    return { final: fin };
  }
  // Actions the booking_audit_log trigger can record — see the SQL that
  // created log_booking_change() / log_cabana_change() for exactly how
  // and when each one is written.
  var LOG_ACTION_LABELS = {
    insert: "Booking created",
    update: "Booking edited",
    delete: "Booking deleted",
    cabana_added: "Cabana added",
    cabana_removed: "Cabana removed",
    villa_added: "Villa assigned",
    villa_removed: "Villa removed",
    villa_changed: "Villa changed",
    villa_blocked: "Villa blocked",
    villa_unblocked: "Villa block removed",
  };

  var loginScreen = document.getElementById("loginScreen");
  var dashScreen = document.getElementById("dashScreen");
  var logoutBtn = document.getElementById("logoutBtn");
  var loginBtn = document.getElementById("loginBtn");
  var loginError = document.getElementById("loginError");
  var bookingsBody = document.getElementById("bookingsBody");
  var countLine = document.getElementById("countLine");
  var searchBox = document.getElementById("searchBox");
  // Links in the staff alert emails open the dashboard pre-filtered: ?q=VBR-1042
  var deepLinkQ = new URLSearchParams(location.search).get("q");
  if (deepLinkQ && searchBox) searchBox.value = deepLinkQ;
  var filterPills = document.getElementById("filterPills");
  var summaryBar = document.getElementById("summaryBar");

  var filterDateField = document.getElementById("filterDateField");
  var filterDateFrom = document.getElementById("filterDateFrom");
  var filterDateTo = document.getElementById("filterDateTo");
  var filterStatus = document.getElementById("filterStatus");
  var filterType = document.getElementById("filterType");
  var filterBookedBy = document.getElementById("filterBookedBy");
  var filterSource = document.getElementById("filterSource");
  var clearFiltersBtn = document.getElementById("clearFiltersBtn");

  var allRows = [];
  var activeFilter = "all";
  // Two sections: Day Trips (day trip / half-day / packages / other) and
  // Villas (overnight stays). Remembered per browser.
  var activeSection = "daytrip";
  try { activeSection = localStorage.getItem("vbr.section") === "villas" ? "villas" : "daytrip"; } catch (e) {}
  var filterLoadFrom = document.getElementById("filterLoadFrom");
  var THIS_YEAR = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 4));
  function isVillaRow(r) { return r.stay_type === "overnight"; }

  // ---------- Cloudbeds (master for villas; see booking-v14-cloudbeds-sync.sql) ----------
  // Cloudbeds' reservation pages use an internal id its API doesn't expose, so
  // links open the Reservations list and copy the reservation number to paste
  // into Cloudbeds' search box.
  var CB_RES_URL = "https://hotels.cloudbeds.com/connect/208402#/reservations";
  var CB_STATUS = { not_confirmed: "Not confirmed", confirmed: "Confirmed", checked_in: "Checked in", checked_out: "Checked out",
    canceled: "Cancelled", no_show: "No-show", deleted: "Deleted", in_progress: "In progress" };
  function cbUrl(r) { return r && r.cb_reservation_id ? CB_RES_URL : null; }
  function cbLinkHtml(r) {
    return r.cb_reservation_id ? '<a class="cb-link" data-cb="' + esc(r.cb_reservation_id) + '" href="' + CB_RES_URL + '" target="_blank" rel="noopener" title="Copies the number and opens Cloudbeds — paste it into Cloudbeds\' search">Cloudbeds #' + esc(r.cb_reservation_id) + " ↗</a>" : "";
  }
  // any .cb-link with data-cb: copy the reservation number on the way to Cloudbeds
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-cb]");
    if (!a) return;
    var n = a.getAttribute("data-cb");
    try { navigator.clipboard.writeText(n); } catch (err) {}
    var tip = document.createElement("span");
    tip.className = "cb-copied";
    tip.textContent = "#" + n + " copied — paste in Cloudbeds search";
    a.insertAdjacentElement("afterend", tip);
    setTimeout(function () { tip.remove(); }, 4000);
  }, true);
  // a website villa booking that hasn't reached Cloudbeds yet
  function cbWaiting(r) {
    return isVillaRow(r) && !r.cb_owned && !r.cb_reservation_id && ["declined", "expired", "completed"].indexOf(r.status) === -1 &&
      (r.booking_villas || []).length > 0 && (!r.check_out || r.check_out >= new Date().toISOString().slice(0, 10));
  }
  var cbPushOn = null; // false = test mode (website bookings aren't sent to Cloudbeds)
  function cbClashes(r) { return r.cb_info && Array.isArray(r.cb_info.clashes) ? r.cb_info.clashes : []; }
  // Default view: today's bookings first, then upcoming dates (soonest first),
  // then past dates (most recent first). Click "Preferred Date" to cycle
  // through Today-first → oldest-first → newest-first.
  var sortField = "today_first";
  var sortDir = "asc";
  var cabanasById = {};
  var cabanasList = [];

  function loadCabanaOptions() {
    if (!window.VBRCabanaMap) return Promise.resolve([]);
    return window.VBRCabanaMap.loadCabanas(sb).then(function (cabanas) {
      cabanasById = {};
      cabanasList = cabanas;
      cabanas.forEach(function (c) { cabanasById[c.id] = c; });
      return cabanas;
    });
  }

  function showDash() {
    loginScreen.style.display = "none";
    dashScreen.style.display = "block";
    logoutBtn.style.display = "inline-block";
    populateStaticFilterOptions();
    // Wait until every dashboard script (villas, email panel) has run.
    var go = function () {
      Promise.all([loadCabanaOptions(), window.VBRVillas ? window.VBRVillas.init().catch(function () {}) : null]).then(loadBookings);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
  }
  function showLogin() {
    loginScreen.style.display = "block";
    dashScreen.style.display = "none";
    logoutBtn.style.display = "none";
  }

  function staffNameForEmail(email) {
    if (!email) return null;
    var lower = email.trim().toLowerCase();
    if (STAFF_EMAIL_NAMES[lower]) return STAFF_EMAIL_NAMES[lower];
    var local = lower.split("@")[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  sb.auth.getSession().then(function (res) {
    if (res.data.session) {
      currentStaffName = staffNameForEmail(res.data.session.user && res.data.session.user.email);
      showDash();
    } else {
      showLogin();
    }
  });

  loginBtn.addEventListener("click", function () {
    var email = document.getElementById("loginEmail").value.trim();
    var password = document.getElementById("loginPassword").value;
    loginError.style.display = "none";
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In";
      if (res.error) {
        loginError.textContent = "Couldn't sign in — check the email and password.";
        loginError.style.display = "block";
        return;
      }
      currentStaffName = staffNameForEmail(email);
      showDash();
    });
  });

  logoutBtn.addEventListener("click", function () {
    sb.auth.signOut().then(function () {
      currentStaffName = null;
      showLogin();
    });
  });

  // ---------- static filter dropdown options (status / type / source) ----------
  function populateStaticFilterOptions() {
    if (filterLoadFrom && !filterLoadFrom.options.length) {
      var opts = [[String(THIS_YEAR), THIS_YEAR + " onwards"]];
      for (var y = THIS_YEAR - 1; y >= 2021; y--) opts.push([String(y), "From " + y]);
      opts.push(["all", "All years"]);
      filterLoadFrom.innerHTML = opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("");
      filterLoadFrom.addEventListener("change", loadBookings);
    }
    STATUS_ORDER.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s;
      opt.textContent = STATUS_LABELS[s];
      filterStatus.appendChild(opt);
    });
    Object.keys(TYPE_LABELS).forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t;
      opt.textContent = TYPE_LABELS[t];
      filterType.appendChild(opt);
    });
    Object.keys(SOURCE_LABELS).forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s;
      opt.textContent = SOURCE_LABELS[s];
      filterSource.appendChild(opt);
    });
    // "Booked by" is free text entered by staff over time, so its option
    // list is filled in from whatever names actually appear in the data —
    // see populateBookedByOptions(), called once bookings are loaded.
  }

  function populateBookedByOptions() {
    var names = {};
    allRows.forEach(function (r) { if (r.booked_by) names[r.booked_by] = true; });
    var sorted = Object.keys(names).sort(function (a, b) { return a.localeCompare(b); });
    var current = filterBookedBy.value;
    filterBookedBy.innerHTML = '<option value="">Anyone</option>';
    sorted.forEach(function (n) {
      var opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      filterBookedBy.appendChild(opt);
    });
    if (sorted.indexOf(current) !== -1) filterBookedBy.value = current;
  }

  // Supabase caps a single request at its project "Max Rows" setting
  // (1000 by default) — with 2000+ bookings now on file, one plain
  // .select() would silently show staff only the newest 1000 and quietly
  // under-count every summary stat. This pages through in batches of
  // 1000 until a page comes back short, so every row actually loads.
  var PAGE_SIZE = 1000;
  // Years of Cloudbeds history are on file, so by default only bookings
  // from the start of this year onwards are loaded ("Bookings loaded").
  function loadFrom() {
    var v = filterLoadFrom && filterLoadFrom.value;
    if (v === "all") return null;
    return (Number(v) || THIS_YEAR) + "-01-01";
  }
  function loadBookingsPage(offset, acc) {
    var qy = sb.from("booking_requests")
      .select("*, booking_cabanas(cabana_id), booking_villas(villa_id,provisional)");
    var from = loadFrom();
    if (from) qy = qy.or("check_in.gte." + from + ",check_in.is.null,check_out.gte." + from);
    return qy
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
      .then(function (res) {
        if (res.error) return Promise.reject(res.error);
        var page = res.data || [];
        acc = acc.concat(page);
        if (page.length === PAGE_SIZE) {
          countLine.textContent = "Loading… (" + acc.length + " so far)";
          return loadBookingsPage(offset + PAGE_SIZE, acc);
        }
        return acc;
      });
  }

  function loadBookings() {
    countLine.textContent = "Loading…";
    return loadBookingsPage(0, []).then(function (rows) {
      allRows = rows;
      populateBookedByOptions();
      render();
      if (cbLastRun === null) loadCbStatus();
    }, function (err) {
      countLine.textContent = "Couldn't load bookings: " + (err && err.message ? err.message : err);
    });
  }

  function dateOnly(d) {
    var dt = new Date(d);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }
  function isToday(dateStr) {
    if (!dateStr) return false;
    var d = dateOnly(dateStr), t = dateOnly(new Date());
    return d.getTime() === t.getTime();
  }
  function isThisWeek(dateStr) {
    if (!dateStr) return false;
    var d = dateOnly(dateStr), t = dateOnly(new Date());
    var start = new Date(t); start.setDate(t.getDate() - t.getDay());
    var end = new Date(start); end.setDate(start.getDate() + 6);
    return d >= start && d <= end;
  }
  function isThisMonth(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr), t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth();
  }

  // [first, last] day (YYYY-MM-DD, Manila) for Today / This Week / Month / Year.
  function ymd(d) { return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function periodFor(f) {
    var t = new Date(ymd(new Date()) + "T00:00:00");
    var s, e;
    if (f === "today") { s = e = t; }
    else if (f === "week") { s = new Date(t); s.setDate(t.getDate() - t.getDay()); e = new Date(s); e.setDate(s.getDate() + 6); }
    else if (f === "month") { s = new Date(t.getFullYear(), t.getMonth(), 1); e = new Date(t.getFullYear(), t.getMonth() + 1, 0); }
    else if (f === "year") { s = new Date(t.getFullYear(), 0, 1); e = new Date(t.getFullYear(), 11, 31); }
    else return null;
    var f2 = function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    return [f2(s), f2(e)];
  }
  // Day trips: the visit date falls in the period. Villas: the stay overlaps
  // it (so "Today" = arriving today or staying tonight).
  function inPeriod(r, p) {
    if (!r.check_in) return false;
    var a = String(r.check_in).slice(0, 10);
    if (!isVillaRow(r)) return a >= p[0] && a <= p[1];
    var b = r.check_out ? String(r.check_out).slice(0, 10) : a;
    return a <= p[1] && (b > p[0] || (a === b && a >= p[0]));
  }
  function nightsOf(r) {
    if (!r.check_in || !r.check_out) return 0;
    return Math.max(0, Math.round((new Date(r.check_out + "T00:00:00Z") - new Date(r.check_in + "T00:00:00Z")) / 86400000));
  }

  function partyTotal(r) {
    return (r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0);
  }

  function isPaidStatus(status) { return status === "confirmed" || status === "completed"; }
  function isUnpaidStatus(status) { return status === "pending" || status === "pending_payment"; }

  function applyFilter(rows) {
    var q = (searchBox.value || "").trim().toLowerCase();
    var dField = filterDateField.value || "check_in";
    var dFrom = filterDateFrom.value || "";
    var dTo = filterDateTo.value || "";
    var fStatus = filterStatus.value;
    var fType = filterType.value;
    var fBookedBy = filterBookedBy.value;
    var fSource = filterSource.value;

    var period = periodFor(activeFilter);
    return rows.filter(function (r) {
      if (activeSection === "villas" ? !isVillaRow(r) : isVillaRow(r)) return false;
      var matchesFilter = true;
      if (period) matchesFilter = inPeriod(r, period);
      else if (activeFilter === "unpaid") matchesFilter = isUnpaidStatus(r.status);
      else if (activeFilter === "imported") matchesFilter = r.source === "sheet_import";
      else if (activeFilter === "overnight") matchesFilter = r.stay_type === "overnight";
      else if (activeFilter === "daytrip") matchesFilter = r.stay_type !== "overnight";
      if (!matchesFilter) return false;

      if (dFrom || dTo) {
        var raw = r[dField];
        if (!raw) return false;
        var d = dateOnly(raw);
        if (dFrom && d < dateOnly(dFrom)) return false;
        if (dTo && d > dateOnly(dTo)) return false;
      }

      if (fStatus && r.status !== fStatus) return false;
      if (fType && r.stay_type !== fType) return false;
      if (fBookedBy && r.booked_by !== fBookedBy) return false;
      if (fSource && (r.source || "website") !== fSource) return false;

      if (!q) return true;
      var hay = [r.guest_name, r.guest_email, r.guest_phone, r.notes, r.staff_notes, r.booked_by, r.order_code, r.room_name, r.guest_names, r.cb_reservation_id, r.cb_info && r.cb_info.ota_ref].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  // ---------- sorting ----------
  function sortValue(r, field) {
    if (field === "party") return partyTotal(r);
    if (field === "total_amount") return r.total_amount == null ? -Infinity : Number(r.total_amount);
    if (field === "check_in" || field === "created_at") return r[field] ? new Date(r[field]).getTime() : -Infinity;
    if (field === "stay_type") return (TYPE_LABELS[r.stay_type] || r.stay_type_label || r.stay_type || "").toLowerCase();
    var v = r[field];
    if (v === null || v === undefined) return "";
    return String(v).toLowerCase();
  }

  function todayStr() {
    var t = new Date();
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  function sortTodayFirst(rows) {
    var today = todayStr();
    function group(r) {
      if (!r.check_in) return 3;
      if (r.check_in === today) return 0;
      return r.check_in > today ? 1 : 2;
    }
    return rows.slice().sort(function (a, b) {
      var ga = group(a), gb = group(b);
      if (ga !== gb) return ga - gb;
      if (ga === 1 && a.check_in !== b.check_in) return a.check_in < b.check_in ? -1 : 1;  // upcoming: soonest first
      if (ga === 2 && a.check_in !== b.check_in) return a.check_in > b.check_in ? -1 : 1;  // past: most recent first
      return (b.created_at || "") < (a.created_at || "") ? -1 : (b.created_at || "") > (a.created_at || "") ? 1 : 0;
    });
  }

  function sortRows(rows) {
    if (sortField === "today_first") return sortTodayFirst(rows);
    var field = sortField, dir = sortDir === "asc" ? 1 : -1;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var va = sortValue(a, field), vb = sortValue(b, field);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return copy;
  }

  function arrowFor(field) {
    if (field === "today_first") return "&#9733;"; // ★ = today first
    return sortDir === "asc" ? "&#9652;" : "&#9662;";
  }
  document.querySelectorAll("th.sortable").forEach(function (th) {
    var thField = th.getAttribute("data-sort");
    if (thField === sortField || (thField === "check_in" && sortField === "today_first")) {
      th.classList.add("sort-active");
      th.querySelector(".sort-arrow").innerHTML = arrowFor(sortField);
      if (sortField === "today_first") th.title = "Sorted: today first, then upcoming, then past. Click to change.";
    }
    th.addEventListener("click", function () {
      var field = thField;
      if (field === "check_in") {
        // cycle: today-first → oldest first → newest first → today-first
        if (sortField === "today_first") { sortField = "check_in"; sortDir = "asc"; }
        else if (sortField === "check_in" && sortDir === "asc") { sortDir = "desc"; }
        else { sortField = "today_first"; sortDir = "asc"; }
      } else if (sortField === field) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortField = field;
        sortDir = field === "created_at" ? "desc" : "asc";
      }
      document.querySelectorAll("th.sortable").forEach(function (h) { h.classList.remove("sort-active"); h.title = ""; });
      th.classList.add("sort-active");
      th.querySelector(".sort-arrow").innerHTML = arrowFor(sortField);
      if (sortField === "today_first") th.title = "Sorted: today first, then upcoming, then past. Click to change.";
      render();
    });
  });

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function peso(n) {
    if (n === null || n === undefined || n === "") return "—";
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(s) {
    if (!s) return "—";
    var d = new Date(s + (s.length <= 10 ? "T00:00:00" : ""));
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtDateTime(s) {
    if (!s) return "—";
    var d = new Date(s);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function updateField(id, field, value, el) {
    var patch = {};
    patch[field] = value;
    sb.from("booking_requests").update(patch).eq("id", id).then(function (res) {
      if (res.error && el) {
        el.style.background = "#fde3d0";
        setTimeout(function () { el.style.background = ""; }, 1500);
      }
    });
  }

  // ---------- summary stats (recomputed from whatever is currently filtered) ----------
  function renderSummary(rows) {
    var guests = 0, paidTotal = 0, paidCount = 0, unpaidTotal = 0, unpaidCount = 0, roomNights = 0;
    rows.forEach(function (r) {
      guests += partyTotal(r);
      if (isVillaRow(r) && r.status !== "declined" && r.status !== "expired") roomNights += nightsOf(r) * Math.max(1, (r.booking_villas || []).length);
      var amt = r.total_amount != null ? Number(r.total_amount) : 0;
      if (isPaidStatus(r.status)) { paidTotal += amt; paidCount++; }
      else if (isUnpaidStatus(r.status)) { unpaidTotal += amt; unpaidCount++; }
    });
    summaryBar.innerHTML =
      '<div class="summary-tile"><div class="summary-label">Bookings Shown</div><div class="summary-value">' + rows.length + '</div></div>' +
      '<div class="summary-tile"><div class="summary-label">Total Guests</div><div class="summary-value">' + guests + '</div></div>' +
      (activeSection === "villas" ? '<div class="summary-tile"><div class="summary-label">Room Nights</div><div class="summary-value">' + roomNights + '</div><div class="summary-sub">casita × nights, excl. cancelled</div></div>' : "") +
      '<div class="summary-tile paid"><div class="summary-label">Total Paid</div><div class="summary-value">' + peso(paidTotal) + '</div><div class="summary-sub">' + paidCount + " confirmed/completed</div></div>" +
      '<div class="summary-tile unpaid"><div class="summary-label">Total Unpaid</div><div class="summary-value">' + peso(unpaidTotal) + '</div><div class="summary-sub">' + unpaidCount + " pending</div></div>";
  }

  // Display only — cabanas are added/removed in the ✎ edit form (on the map).
  function cabanaLabelsFor(r) {
    return (r.booking_cabanas || []).map(function (bc) {
      var c = cabanasById[bc.cabana_id];
      return c ? c.label : "Unknown cabana";
    });
  }
  function renderCabanaCell(td, r) {
    td.innerHTML = "";
    td.className = "cabana-cell";
    if (r.stay_type === "overnight") {
      var vlabels = window.VBRVillas ? window.VBRVillas.labelsFor(r) : [];
      if (!vlabels.length) { td.innerHTML = '<span class="muted">— no villa</span>'; return; }
      var vwrap = document.createElement("div");
      vwrap.className = "cabana-cell-chips";
      vlabels.forEach(function (l) {
        var chip = document.createElement("span");
        chip.className = "cabana-mini-chip villa-chip";
        chip.style.paddingRight = "10px";
        chip.textContent = l;
        vwrap.appendChild(chip);
      });
      td.appendChild(vwrap);
      return;
    }
    var assignedIds = (r.booking_cabanas || []).map(function (bc) { return bc.cabana_id; });
    // Imported 2026-sheet rows never had a literal cabana number recorded —
    // only how many dining/lounge cabanas were used.
    if (!assignedIds.length && (r.legacy_dining_cabanas || r.legacy_lounge_cabanas)) {
      var legacyNote = document.createElement("div");
      legacyNote.className = "muted";
      legacyNote.style.fontSize = "0.82rem";
      var bits = [];
      if (r.legacy_dining_cabanas) bits.push(r.legacy_dining_cabanas + " dining");
      if (r.legacy_lounge_cabanas) bits.push(r.legacy_lounge_cabanas + " lounge");
      legacyNote.textContent = bits.join(", ") + " (from 2026 sheet)";
      td.appendChild(legacyNote);
      return;
    }
    if (!assignedIds.length) { td.innerHTML = '<span class="muted">—</span>'; return; }
    var chipWrap = document.createElement("div");
    chipWrap.className = "cabana-cell-chips";
    assignedIds.forEach(function (id) {
      var c = cabanasById[id];
      var chip = document.createElement("span");
      chip.className = "cabana-mini-chip";
      chip.style.paddingRight = "10px";
      chip.textContent = c ? c.label.replace(/^Section /, "") : "Unknown cabana";
      chipWrap.appendChild(chip);
    });
    td.appendChild(chipWrap);
  }

  function openSignedUrl(bucket, path) {
    sb.storage.from(bucket).createSignedUrl(path, 3600).then(function (res) {
      if (res.data && res.data.signedUrl) window.open(res.data.signedUrl, "_blank");
      else alert("Couldn't open the file" + (res.error ? ": " + res.error.message : "."));
    });
  }
  function proofLinks(r) {
    var links = [];
    if (r.payment_screenshot_path) links.push({ text: "View payment proof", bucket: "payment-proofs", path: r.payment_screenshot_path });
    (r.senior_id_paths || []).forEach(function (path, i, all) {
      links.push({ text: "View senior ID" + (all.length > 1 ? " " + (i + 1) : ""), bucket: "senior-ids", path: path });
    });
    (r.pet_vaccination_paths || []).forEach(function (path, i, all) {
      links.push({ text: "View pet vaccination card" + (all.length > 1 ? " " + (i + 1) : ""), bucket: "pet-vaccinations", path: path });
    });
    return links;
  }
  // Display only — payment proofs are uploaded from the ✎ edit form.
  function renderPayCell(td, r) {
    td.innerHTML = "";
    var links = proofLinks(r);
    if (!links.length) { td.innerHTML = '<span class="muted">—</span>'; return; }
    links.forEach(function (l) {
      var a = document.createElement("a");
      a.className = "pay-link";
      a.href = "#";
      a.textContent = l.text;
      a.addEventListener("click", function (e) { e.preventDefault(); openSignedUrl(l.bucket, l.path); });
      td.appendChild(a);
      td.appendChild(document.createElement("br"));
    });
  }

  function applySectionChrome() {
    Array.prototype.forEach.call(document.querySelectorAll("#sectionTabs .sec-tab"), function (t) {
      t.classList.toggle("active", t.getAttribute("data-section") === activeSection);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-section]:not(.sec-tab)"), function (el) {
      el.style.display = el.getAttribute("data-section") === activeSection ? "" : "none";
    });
    var table = bookingsBody.closest("table");
    if (table) table.classList.toggle("mode-villas", activeSection === "villas");
    var th = document.getElementById("thDate"), tu = document.getElementById("thUnits");
    if (th) th.textContent = activeSection === "villas" ? "Arrive → Depart" : "Date";
    if (tu) tu.textContent = activeSection === "villas" ? "Villa(s)" : "Cabana(s)";
    var nV = 0, nD = 0;
    allRows.forEach(function (r) { if (isVillaRow(r)) nV++; else nD++; });
    var cv = document.getElementById("secCountVillas"), cd = document.getElementById("secCountDaytrip");
    if (cv) cv.textContent = nV.toLocaleString();
    if (cd) cd.textContent = nD.toLocaleString();
    searchBox.placeholder = activeSection === "villas" ? "Search guest, Cloudbeds #, villa, notes…" : "Search guest, contact, notes…";
  }
  document.getElementById("sectionTabs").addEventListener("click", function (e) {
    var t = e.target.closest(".sec-tab");
    if (!t) return;
    activeSection = t.getAttribute("data-section");
    try { localStorage.setItem("vbr.section", activeSection); } catch (err) {}
    if (activeSection === "villas") filterType.value = "";
    render();
  });

  function render() {
    applySectionChrome();
    var filtered = applyFilter(allRows);
    renderSummary(filtered);
    var rows = sortRows(filtered);
    var inSection = allRows.filter(function (r) { return activeSection === "villas" ? isVillaRow(r) : !isVillaRow(r); }).length;
    var from = loadFrom();
    countLine.textContent = rows.length.toLocaleString() + " of " + inSection.toLocaleString() + (activeSection === "villas" ? " villa bookings" : " day-trip bookings") +
      " shown" + (from ? " · loaded from " + fmtDate(from) + " (change under “Bookings loaded”)" : " · all years loaded");
    if (!rows.length) {
      bookingsBody.innerHTML = '<tr class="empty-row"><td colspan="16">No bookings match this view.</td></tr>';
      return;
    }
    bookingsBody.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");

      var tdOrder = document.createElement("td");
      tdOrder.innerHTML = '<span class="order-code">' + (r.order_code || "—") + "</span>";
      tr.appendChild(tdOrder);

      var tdGuest = document.createElement("td");
      tdGuest.className = "col-guest";
      tdGuest.textContent = r.guest_name || "—";
      tr.appendChild(tdGuest);

      var tdContact = document.createElement("td");
      tdContact.innerHTML = (r.guest_phone ? r.guest_phone : "") + (r.guest_phone && r.guest_email ? "<br>" : "") +
        (r.guest_email ? '<span class="muted">' + r.guest_email + "</span>" : "");
      tr.appendChild(tdContact);

      var tdType = document.createElement("td");
      tdType.className = "col-type";
      tdType.innerHTML = '<span class="type-badge">' + (TYPE_LABELS[r.stay_type] || r.stay_type_label || r.stay_type || "—") + "</span>";
      tr.appendChild(tdType);

      var tdBookedBy = document.createElement("td");
      tdBookedBy.className = "muted";
      tdBookedBy.textContent = r.booked_by || "—";
      tr.appendChild(tdBookedBy);

      var tdDate = document.createElement("td");
      tdDate.textContent = fmtDate(r.check_in);
      if (r.stay_type === "overnight" && r.check_out) {
        var nn = Math.round((new Date(r.check_out + "T00:00:00Z") - new Date(r.check_in + "T00:00:00Z")) / 86400000);
        tdDate.innerHTML = esc(fmtDate(r.check_in)) + '<span class="payby">→ ' + esc(fmtDate(r.check_out)) + " · " + nn + " night" + (nn === 1 ? "" : "s") + "</span>";
      }
      tr.appendChild(tdDate);

      var tdCabana = document.createElement("td");
      renderCabanaCell(tdCabana, r);
      tr.appendChild(tdCabana);

      var tdParty = document.createElement("td");
      var kids = (r.children_6_12 || 0) + (r.children_0_5 || 0);
      var partyText = (r.adults || 0) + " adult" + (r.adults === 1 ? "" : "s") + (kids ? ", " + kids + " kid" + (kids === 1 ? "" : "s") : "");
      if (r.senior_count) partyText += " (incl. " + r.senior_count + " senior)";
      if (r.pet_count) partyText += ", " + r.pet_count + " pet" + (r.pet_count === 1 ? "" : "s");
      if (r.extra_beds) partyText += " · " + r.extra_beds + " extra bed" + (r.extra_beds === 1 ? "" : "s");
      tdParty.textContent = partyText;
      if (r.stay_type === "overnight" && r.source === "website" && !(r.companions && r.companions.length + 1 === partyTotal(r))) {
        tdParty.innerHTML += '<span class="payby overdue">guest names missing</span>';
      }
      if (r.guest_names) tdParty.title = "Guests: " + r.guest_names;
      tr.appendChild(tdParty);

      var tdTotal = document.createElement("td");
      tdTotal.className = "col-total";
      tdTotal.innerHTML = esc(peso(r.total_amount)) + '<span class="bd-link">Breakdown ›</span>';
      tdTotal.addEventListener("click", function () { openBreakdown(r); });
      if (r.total_amount != null && r.stay_type === "overnight") {
        tdTotal.title = "Room: " + peso(r.room_total) + " · Meals: " + peso(r.meal_total) + (Number(r.extra_bed_total) ? " · Extra beds: " + peso(r.extra_bed_total) : "") +
          (Number(r.pet_total) ? " · Pets: " + peso(r.pet_total) : "") + (Number(r.add_on_total) ? " · Add-ons: " + peso(r.add_on_total) : "") +
          (Number(r.online_discount) ? " · 3% book-direct: −" + peso(r.online_discount) : "") + (Number(r.discount_amount) ? " · Discount: −" + peso(r.discount_amount) : "");
      } else if (r.total_amount != null) {
        tdTotal.title = "People: " + peso(r.subtotal_people) + (r.senior_discount ? " (incl. " + peso(r.senior_discount) + " senior discount)" : "") + " · Cabana(s): " + peso(r.cabana_total);
      }
      if (isVillaRow(r) && r.cb_info) {
        if (r.cb_owned && r.cb_info.balance != null && Number(r.cb_info.balance) > 0.5 && r.status !== "declined") {
          tdTotal.innerHTML += '<span class="payby">balance ' + esc(peso(r.cb_info.balance)) + "</span>";
        } else if (!r.cb_owned && r.cb_info.total != null && r.total_amount != null && Math.abs(Number(r.cb_info.total) - Number(r.total_amount)) > 1) {
          tdTotal.innerHTML += '<span class="payby overdue" title="Cloudbeds priced it from its own rate plan. Adjust the folio in Cloudbeds so it matches the website total.">Cloudbeds: ' + esc(peso(r.cb_info.total)) + "</span>";
        }
      }
      tr.appendChild(tdTotal);

      var tdStatus = document.createElement("td");
      var statusBadge = document.createElement("span");
      statusBadge.className = "status-badge readonly status-" + r.status;
      statusBadge.textContent = STATUS_LABELS[r.status] || r.status;
      statusBadge.title = "Change the status with ✎ Edit";
      tdStatus.appendChild(statusBadge);
      if (isVillaRow(r) && r.cb_info && r.cb_info.status) {
        var cbs = document.createElement("span");
        cbs.className = "payby cb-status";
        cbs.textContent = "Cloudbeds: " + (CB_STATUS[r.cb_info.status] || r.cb_info.status);
        tdStatus.appendChild(cbs);
      }
      if (cbWaiting(r) && cbPushOn === false) {
        var ct = document.createElement("span");
        ct.className = "payby";
        ct.textContent = "Test mode: not sent to Cloudbeds";
        ct.title = "Until launch, website villa bookings stay on the website only.";
        tdStatus.appendChild(ct);
      } else if (cbWaiting(r)) {
        var cw = document.createElement("span");
        cw.className = "payby" + (r.cb_push_state === "error" ? " overdue" : "");
        cw.textContent = r.cb_push_state === "error" ? "⚠ Not in Cloudbeds yet" : "Sending to Cloudbeds…";
        cw.title = r.cb_push_error ? "Cloudbeds said: " + r.cb_push_error + " — it's retried every 5 minutes. If it keeps failing, add the booking in Cloudbeds by hand." : "Created in Cloudbeds within a minute.";
        tdStatus.appendChild(cw);
      } else if (r.cb_push_state === "done" && r.cb_push_error) {
        var cn = document.createElement("span");
        cn.className = "payby overdue";
        cn.textContent = "⚠ Check casita in Cloudbeds";
        cn.title = r.cb_push_error;
        tdStatus.appendChild(cn);
      }
      if (cbClashes(r).length && r.status !== "declined" && r.status !== "expired") {
        var cc = document.createElement("span");
        cc.className = "payby overdue";
        cc.textContent = "⚠ Casita clash";
        cc.title = cbClashes(r).join("\n") + "\nFix the room assignment in Cloudbeds.";
        tdStatus.appendChild(cc);
      }
      if ((r.status === "pending" || r.status === "pending_payment") && !r.payment_uploaded_at) {
        var dl = paymentDeadlines(r);
        var pb = document.createElement("span");
        pb.className = "payby";
        if (!dl) pb.textContent = "pay on arrival";
        else {
          var nowMs = Date.now();
          pb.textContent = nowMs >= dl.final ? "past deadline — expiring" : "pay by " + fmtDateTime(new Date(dl.final).toISOString());
          if (nowMs >= dl.final - 3 * 3600e3) pb.classList.add("overdue");
          pb.title = "Expires at " + fmtDateTime(new Date(dl.final).toISOString()) + " if still unpaid; the cabana(s) are then released.";
        }
        tdStatus.appendChild(pb);
      } else if (r.status === "expired" && r.expired_at) {
        var ex = document.createElement("span");
        ex.className = "payby";
        ex.textContent = "unpaid · released " + fmtDateTime(r.expired_at);
        tdStatus.appendChild(ex);
      }
      tr.appendChild(tdStatus);

      var tdPay = document.createElement("td");
      tdPay.className = "pay-cell";
      renderPayCell(tdPay, r);
      tr.appendChild(tdPay);

      var tdSource = document.createElement("td");
      tdSource.innerHTML = '<span class="source-badge">' + (SOURCE_LABELS[r.source] || r.source || "Website") + "</span>" +
        (r.cb_reservation_id ? "<br>" + cbLinkHtml(r) : "") +
        (r.cb_info && r.cb_info.ota_ref && r.cb_owned ? '<span class="payby">ref ' + esc(r.cb_info.ota_ref) + "</span>" : "");
      tr.appendChild(tdSource);

      var tdNotes = document.createElement("td");
      tdNotes.className = "col-notes";
      tdNotes.textContent = r.notes || "—";
      tr.appendChild(tdNotes);

      var tdStaffNotes = document.createElement("td");
      tdStaffNotes.className = "col-notes";
      tdStaffNotes.contentEditable = "true";
      tdStaffNotes.setAttribute("data-editable", "true");
      tdStaffNotes.textContent = r.staff_notes || "";
      tdStaffNotes.addEventListener("blur", function () {
        var val = tdStaffNotes.textContent.trim();
        if (val !== (r.staff_notes || "")) {
          r.staff_notes = val;
          updateField(r.id, "staff_notes", val, tdStaffNotes);
        }
      });
      tr.appendChild(tdStaffNotes);

      var tdReceived = document.createElement("td");
      tdReceived.className = "muted";
      tdReceived.textContent = fmtDateTime(r.created_at);
      tr.appendChild(tdReceived);

      var tdLog = document.createElement("td");
      var actions = document.createElement("div");
      actions.className = "row-actions";
      var editBtnCell = document.createElement("button");
      editBtnCell.type = "button";
      editBtnCell.className = "log-btn";
      editBtnCell.title = "Edit this booking";
      editBtnCell.textContent = "✎";
      editBtnCell.addEventListener("click", function () {
        if (r.stay_type === "overnight" && window.VBRVillas) window.VBRVillas.openBooking(r);
        else openModal(r);
      });
      actions.appendChild(editBtnCell);
      var logBtnCell = document.createElement("button");
      logBtnCell.type = "button";
      logBtnCell.className = "log-btn";
      logBtnCell.title = "View activity log for this booking";
      logBtnCell.textContent = "🕘";
      logBtnCell.addEventListener("click", function () {
        openLogModal(r.id, (r.guest_name || "This booking") + (r.order_code ? " (" + r.order_code + ")" : ""));
      });
      actions.appendChild(logBtnCell);
      tdLog.appendChild(actions);
      tr.appendChild(tdLog);

      bookingsBody.appendChild(tr);
    });
  }

  filterPills.addEventListener("click", function (e) {
    var pill = e.target.closest(".pill");
    if (!pill) return;
    Array.prototype.forEach.call(filterPills.querySelectorAll(".pill"), function (p) { p.classList.remove("active"); });
    pill.classList.add("active");
    activeFilter = pill.getAttribute("data-filter");
    render();
  });
  searchBox.addEventListener("input", render);
  [filterDateField, filterDateFrom, filterDateTo, filterStatus, filterType, filterBookedBy, filterSource].forEach(function (el) {
    el.addEventListener("change", render);
  });
  clearFiltersBtn.addEventListener("click", function () {
    Array.prototype.forEach.call(filterPills.querySelectorAll(".pill"), function (p) { p.classList.remove("active"); });
    filterPills.querySelector('.pill[data-filter="all"]').classList.add("active");
    activeFilter = "all";
    searchBox.value = "";
    filterDateField.value = "check_in";
    filterDateFrom.value = "";
    filterDateTo.value = "";
    filterStatus.value = "";
    filterType.value = "";
    filterBookedBy.value = "";
    filterSource.value = "";
    render();
  });

  // ---------- add / edit booking modal ----------
  // One form does both: "+ Add Booking" opens it blank, the ✎ button on a
  // row opens it pre-filled. Edits only send the fields that actually
  // changed, so the activity log (log_booking_change trigger) shows a clean
  // "field: old → new" line per change, attributed to whoever is signed in.
  var addBtn = document.getElementById("addBtn");
  var addModalBackdrop = document.getElementById("addModalBackdrop");
  var addForm = document.getElementById("addForm");
  var cancelAddBtn = document.getElementById("cancelAddBtn");
  var modalTitle = document.getElementById("bookingModalTitle");
  var modalSub = document.getElementById("bookingModalSub");
  var saveBookingBtn = document.getElementById("saveBookingBtn");
  var addError = document.getElementById("addError");
  var addDateEl = document.getElementById("addDate");
  var addMapEl = document.getElementById("addCabanaMap");
  var addMapStatus = document.getElementById("addMapStatus");
  var addSelectedEl = document.getElementById("addCabanaSelected");
  var staffNotesField = document.getElementById("addStaffNotesField");
  var paymentField = document.getElementById("addPaymentField");
  var payExistingEl = document.getElementById("addPayExisting");
  var payFileEl = document.getElementById("addPayFile");
  var notifyWrap = document.getElementById("addNotifyWrap");
  var notifyEl = document.getElementById("addNotify");
  var notifyText = document.getElementById("addNotifyText");
  var notifyHint = document.getElementById("addNotifyHint");
  var QUOTE_STATUSES = ["pending", "pending_payment"];
  var RATE_SHEET_TYPES = ["day_trip", "half_day", "all_inclusive_family", "all_inclusive_barkada"];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // Guest-facing details that go into the "changes to your reservation"
  // email. Status, staff notes, booked-by and source are internal and left out.
  var GUEST_FIELDS = [
    ["stay_type", "Booking", function (v) { return FULL_TYPE_NAMES[v] || TYPE_LABELS[v] || v || ""; }],
    ["check_in", "Date", function (v) { return v ? fmtDateLong(v) : "To be confirmed"; }],
    ["adults", "Adults", String],
    ["senior_count", "Senior citizens / PWD", String],
    ["children_6_12", "Kids (6–12)", String],
    ["children_0_5", "Kids (0–5)", String],
    ["pet_count", "Pets", String],
    ["discount_amount", "Discount", function (v) { return Number(v) > 0 ? peso(v) : "None"; }],
    ["total_amount", "Total", function (v) { return v === null || v === undefined || v === "" ? "" : peso(v); }],
    ["guest_name", "Name", String],
    ["guest_phone", "Phone", String],
    ["guest_email", "Email", String],
    ["notes", "Notes", String],
  ];
  var FULL_TYPE_NAMES = {
    day_trip: "Day Trip (Full Day)", half_day: "Half-Day Trip", flash_sale: "Flash Sale Day Trip",
    all_inclusive_family: "All Inclusive — Family Package", all_inclusive_barkada: "All Inclusive — Barkada Package",
    corporate: "Corporate Outing", other: "Other / Add-on",
  };
  function fmtDateLong(s) {
    var d = new Date(s + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  function cabanaListText(ids) {
    var labels = ids.map(function (id) { return cabanasById[id] ? cabanasById[id].label : "Unknown cabana"; });
    labels.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    return labels.length ? labels.join(", ") : "None";
  }

  function uploadList() {
    var items = ["their payment"];
    if (intVal("addSeniors") > 0) items.push("Senior Citizen/PWD ID(s)");
    if (intVal("addPets") > 0) items.push("pet vaccination card(s)");
    return items.length === 1 ? items[0] : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  function updateNotifyState() {
    notifyWrap.style.display = "flex";
    var email = $("addEmail").value.trim();
    if (!editingRow) {
      // New staff booking: optionally send it to the guest as a quotation —
      // the same email a website booking gets (amount due, bank details,
      // pay-by time, and a link to upload payment / Senior IDs / pet cards).
      var type = $("addType").value, status = $("addStatus").value;
      var hasTotal = P.hasRateSheet(type) || $("addTotal").value !== "";
      var why = !EMAIL_RE.test(email) ? "Add the guest's email address to send them the quotation"
        : type === "corporate" ? "Corporate outings get a tailored quote from the events team — not sent automatically"
        : QUOTE_STATUSES.indexOf(status) === -1 ? "Only Pending bookings can be sent as a quotation"
        : RATE_SHEET_TYPES.indexOf(type) === -1 && !hasTotal ? "Enter the Total for this booking type to send a quotation"
        : "";
      notifyEl.disabled = !!why;
      if (why) notifyEl.checked = false;
      else if (!notifyTouched) notifyEl.checked = true;
      notifyWrap.classList.toggle("is-disabled", !!why);
      notifyText.textContent = why || "Send the quotation to " + email + " when I save";
      notifyHint.hidden = !!why;
      if (dtMail) setTimeout(function () { dtMail.refresh(); }, 0);
      notifyHint.textContent = "Same email as a website booking: the amount due shown above" +
        ", bank details, pay-by time, and a link for the guest to upload " + uploadList() +
        ". Unpaid bookings expire automatically after 24 hours.";
      return;
    }
    notifyHint.hidden = true;
    var ok = EMAIL_RE.test(email);
    notifyEl.disabled = !ok;
    if (!ok) notifyEl.checked = false;
    notifyWrap.classList.toggle("is-disabled", !ok);
    notifyText.textContent = ok
      ? "Email " + email + " a summary of the changes when I save"
      : "No guest email on this booking — the guest won't be emailed";
    if (dtMail) dtMail.refresh();
  }

  function renderPayExisting(r) {
    payExistingEl.innerHTML = "";
    var links = r ? proofLinks(r) : [];
    if (!links.length) { payExistingEl.innerHTML = '<span class="muted">No payment proof uploaded yet.</span>'; return; }
    links.forEach(function (l) {
      var a = document.createElement("a");
      a.href = "#";
      a.textContent = l.text;
      a.addEventListener("click", function (e) { e.preventDefault(); openSignedUrl(l.bucket, l.path); });
      payExistingEl.appendChild(a);
    });
    if (r.payment_uploaded_at) {
      var when = document.createElement("span");
      when.className = "muted";
      when.textContent = "uploaded " + fmtDateTime(r.payment_uploaded_at);
      payExistingEl.appendChild(when);
    }
  }

  // "Email to the guest" panel (staff-email.js): template + editable opening
  // message + live preview of the exact email, next to the form.
  var dtMail = null, notifyTouched = false;
  function mailPanel() {
    if (dtMail || !window.VBREmail) return dtMail;
    dtMail = window.VBREmail.create({
      root: document.getElementById("addMail"), notifyEl: notifyEl, hintEl: notifyHint,
      mode: function () { return editingRow ? "change" : "quote"; },
      overnight: function () { return false; },
      request: function () {
        var vals = formValues();
        Object.keys(vals).forEach(function (k) { if (vals[k] === undefined) delete vals[k]; });
        if (!editingRow) return { draft: vals, unit_ids: modalCabanaIds.slice() };
        var r = editingRow, patch = {};
        Object.keys(vals).forEach(function (k) { if (k !== "guest_name" && k !== "booked_by" && !sameValue(vals[k], r[k])) patch[k] = vals[k]; });
        var before = (r.booking_cabanas || []).map(function (bc) { return bc.cabana_id; });
        return { booking_id: r.id, draft: vals, unit_ids: modalCabanaIds.slice(), changes: guestChanges(r, patch, before, modalCabanaIds.slice()) };
      },
    });
    notifyEl.addEventListener("click", function () { notifyTouched = true; });
    addForm.addEventListener("input", function () { if (dtMail) dtMail.refresh(); });
    addForm.addEventListener("change", function () { if (dtMail) dtMail.refresh(); });
    return dtMail;
  }

  var editingRow = null;      // null = adding a new booking
  var modalCabanaIds = [];    // cabana ids currently picked on the map

  function $(id) { return document.getElementById(id); }
  function intVal(id) { return parseInt($(id).value || "0", 10) || 0; }

  // Which cabanas are already taken on a date, worked out from the bookings
  // already loaded in the dashboard (staff can see every booking, so this
  // also says who has it). The booking being edited never blocks itself.
  function holdsForDate(dateStr) {
    var held = new Set(), info = {};
    if (!dateStr) return { held: held, info: info };
    allRows.forEach(function (r) {
      if (r.check_in !== dateStr || releasesCabanas(r.status)) return;
      if (editingRow && r.id === editingRow.id) return;
      (r.booking_cabanas || []).forEach(function (bc) {
        held.add(bc.cabana_id);
        info[bc.cabana_id] = "booked by " + (r.guest_name || "a guest") + (r.order_code ? " (" + r.order_code + ")" : "");
      });
    });
    return { held: held, info: info };
  }

  function renderModalSelected() {
    renderModalBill();
    addSelectedEl.innerHTML = "";
    if (!modalCabanaIds.length) {
      addSelectedEl.innerHTML = '<span class="muted">No cabana picked yet — tap one on the map (optional).</span>';
      return;
    }
    var label = document.createElement("strong");
    label.textContent = "Selected (" + modalCabanaIds.length + "):";
    addSelectedEl.appendChild(label);
    modalCabanaIds.forEach(function (id) {
      var c = cabanasById[id];
      var chip = document.createElement("span");
      chip.className = "cabana-mini-chip";
      chip.textContent = c ? c.label.replace(/^Section /, "") : "Unknown cabana";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "cabana-mini-remove";
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        modalCabanaIds = modalCabanaIds.filter(function (x) { return x !== id; });
        renderModalMap();
      });
      chip.appendChild(rm);
      addSelectedEl.appendChild(chip);
    });
  }

  function renderModalMap() {
    if (!window.VBRCabanaMap || !cabanasList.length) {
      addMapStatus.textContent = "The cabana map couldn't load — cabanas can still be added from the table afterwards.";
      addMapEl.innerHTML = "";
      renderModalSelected();
      return;
    }
    var dateStr = addDateEl.value;
    var h = holdsForDate(dateStr);
    // If the date changed and a picked cabana is now taken, drop it.
    var dropped = modalCabanaIds.filter(function (id) { return h.held.has(id); });
    if (dropped.length) modalCabanaIds = modalCabanaIds.filter(function (id) { return !h.held.has(id); });
    addMapStatus.textContent = dateStr
      ? (dropped.length
          ? dropped.length + " picked cabana(s) are already booked on this date and were removed — pick another."
          : "Showing availability for " + fmtDate(dateStr) + ". Hover a taken cabana to see who has it.")
      : "Pick a preferred date to see which cabanas are free that day.";
    window.VBRCabanaMap.render(addMapEl, {
      cabanas: cabanasList,
      heldSet: h.held,
      heldInfo: h.info,
      selectedIds: modalCabanaIds,
      crop: { top: 0.33, bottom: 0.56 },
      onSelect: function (c) {
        var i = modalCabanaIds.indexOf(c.id);
        if (i >= 0) modalCabanaIds.splice(i, 1); else modalCabanaIds.push(c.id);
        renderModalMap();
      },
    });
    renderModalSelected();
  }

  // ---------- pricing (same calculation as the public booking form) ----------
  var P = window.VBRPricing;
  var billEl = $("addBill");
  var manualTotalWrap = $("addManualTotalWrap");
  var discTypeEl = $("addDiscountType"), discValueEl = $("addDiscountValue"), discReasonEl = $("addDiscountReason");
  var openPriceSig = null; // pricing inputs when an existing booking was opened

  function priceSig() {
    return [$("addType").value, intVal("addAdults"), intVal("addKids"), intVal("addKids05"), intVal("addSeniors"), intVal("addPets"),
      modalCabanaIds.slice().sort().join(","), discTypeEl.value, discValueEl.value, $("addTotal").value].join("|");
  }

  // Everything the booking will be saved with: the rate-sheet bill, the
  // discount and the total. For an existing booking whose pricing inputs
  // haven't been touched, the saved total is kept as-is (older bookings were
  // priced by hand) — change anything that affects price and it's recalculated.
  function modalPricing() {
    var type = $("addType").value;
    var bill = P.compute({
      type: type, adults: intVal("addAdults"), kids612: intVal("addKids"), kids05: intVal("addKids05"),
      seniors: intVal("addSeniors"), pets: intVal("addPets"),
      cabanas: modalCabanaIds.map(function (id) { return cabanasById[id]; }).filter(Boolean),
    });
    var out = { bill: bill, rated: bill.rated, discountType: null, discountValue: null, discount: 0, total: null, kept: false, error: null };
    if (bill.rated) {
      var kind = discTypeEl.value;
      var val = Number(discValueEl.value) || 0;
      if (kind && val > 0) {
        if (kind === "percent" && val > 100) out.error = "A percentage discount can't be more than 100%.";
        if (kind === "amount" && val > bill.total) out.error = "The discount is more than the total.";
        out.discountType = kind; out.discountValue = val;
        out.discount = P.discountAmount(bill.total, kind, val);
      }
      out.total = P.r2(bill.total - out.discount);
    } else {
      out.total = $("addTotal").value === "" ? null : Number($("addTotal").value);
    }
    out.calculated = out.total;
    var saved = editingRow ? editingRow.total_amount : null;
    if (editingRow && openPriceSig !== null && priceSig() === openPriceSig &&
        (saved == null ? out.total != null : out.total == null || Math.abs(Number(saved) - out.total) > 0.5)) {
      out.kept = true;
      out.total = saved == null ? null : Number(saved);
    }
    return out;
  }

  function billRow(label, amount, cls) {
    return '<div class="bill-row' + (cls ? " " + cls : "") + '"><span>' + label + "</span><span>" + amount + "</span></div>";
  }

  // The rate-sheet lines for a Day Trip bill (shared by the form and the
  // Breakdown view): "3 adults × ₱1,250", each cabana, package extras.
  function dayTripRows(b) {
    var L = [];
    if (b.isPackage) {
      L.push(billRow("Package (up to " + b.includedPax + " guests, " + b.includedCabanas + " cabana)", peso(b.base)));
      if (b.extraPax) L.push(billRow(b.extraPax + " extra guest" + (b.extraPax === 1 ? "" : "s"), peso(b.extraPaxCost)));
      if (b.pets) L.push(billRow(b.pets + " pet" + (b.pets === 1 ? "" : "s"), peso(b.extraPetCost)));
      if (b.extraCabanas) L.push(billRow(b.extraCabanas + " extra cabana" + (b.extraCabanas === 1 ? "" : "s"), peso(b.extraCabanaCost)));
    } else {
      if (b.regularAdults) L.push(billRow(b.regularAdults + " adult" + (b.regularAdults === 1 ? "" : "s") + " × " + peso(b.rate.adult), peso(b.regularAdults * b.rate.adult)));
      if (b.seniors) L.push(billRow(b.seniors + " senior/PWD × " + peso(b.seniorRate) + " <em>(VAT-exempt, 20% off)</em>", peso(b.seniors * b.seniorRate)));
      if (b.kids612) L.push(billRow(b.kids612 + " child" + (b.kids612 === 1 ? "" : "ren") + " (6–12) × " + peso(b.rate.child612), peso(b.kids612 * b.rate.child612)));
      if (b.kids05) L.push(billRow(b.kids05 + " child" + (b.kids05 === 1 ? "" : "ren") + " (0–5)", "Free"));
      if (b.pets) L.push(billRow(b.pets + " pet" + (b.pets === 1 ? "" : "s") + " × " + peso(b.rate.pet), peso(b.petCost)));
      b.cabanas.forEach(function (c) { L.push(billRow(esc(c.label), peso(b.cabanaPrice(c)))); });
    }
    return L;
  }

  function renderModalBill() {
    if (!billEl) return;
    var pr = modalPricing(), b = pr.bill;
    var rated = b.rated;
    manualTotalWrap.hidden = rated;
    discTypeEl.disabled = !rated;
    if (!rated) discTypeEl.value = "";
    discValueEl.disabled = discReasonEl.disabled = !rated || !discTypeEl.value;
    $("addDiscountValueLabel").textContent = discTypeEl.value === "percent" ? "Percent (%)" : discTypeEl.value === "amount" ? "Amount (₱)" : "Value";
    if (!rated) {
      billEl.innerHTML = '<div class="bill-lines">' + billRow(esc(FULL_TYPE_NAMES[b.type] || b.type), "Quoted by hand") + "</div>" +
        '<div class="bill-total"><span>Total</span><span>' + (pr.total == null ? "—" : peso(pr.total)) + "</span></div>";
      return;
    }
    var L = dayTripRows(b);
    if (pr.discount > 0) {
      L.push(billRow("Discount" + (pr.discountType === "percent" ? " (" + pr.discountValue + "%)" : "") +
        (discReasonEl.value.trim() ? " — " + esc(discReasonEl.value.trim()) : ""), "−" + peso(pr.discount), "discount"));
    }
    var warn = b.cabanas.length && b.totalCapacity < b.totalGuests
      ? '<p class="bill-warning">The cabana' + (b.cabanas.length === 1 ? "" : "s") + " picked seat up to " + b.totalCapacity + ", and the party is " + b.totalGuests + ".</p>" : "";
    var note = pr.kept
      ? '<p class="bill-note">' + (pr.total == null ? "No saved total" : "Saved total kept: " + peso(pr.total)) + " (rate sheet gives " + peso(pr.calculated) + ")." +
        ' <button type="button" class="btn-sm ghost" id="useCalcTotal">Use rate sheet total</button></p>'
      : "";
    billEl.innerHTML = '<div class="bill-lines">' + (L.join("") || billRow("Add the party size and cabana(s)", "—")) + "</div>" + warn +
      '<div class="bill-total"><span>Total</span><span>' + (pr.total == null ? "—" : peso(pr.total)) + "</span></div>" + note +
      (pr.error ? '<p class="bill-note" style="color:#9b2c2c;">' + esc(pr.error) + "</p>" : "");
    var useBtn = $("useCalcTotal");
    if (useBtn) useBtn.addEventListener("click", function () { openPriceSig = null; renderModalBill(); });
  }

  ["addAdults", "addKids", "addKids05", "addSeniors", "addPets", "addTotal", "addDiscountValue", "addDiscountReason"].forEach(function (id) {
    $(id).addEventListener("input", renderModalBill);
  });
  ["addType", "addDiscountType"].forEach(function (id) { $(id).addEventListener("change", renderModalBill); });

  function openModal(row) {
    addForm.reset();
    addError.style.display = "none";
    editingRow = row && row.id ? row : null;
    if (editingRow) {
      var r = editingRow;
      modalTitle.textContent = "Edit Booking" + (r.order_code ? " · " + r.order_code : "");
      modalSub.textContent = "Changes are saved to the activity log under your name.";
      saveBookingBtn.textContent = "Save Changes";
      staffNotesField.style.display = "block";
      paymentField.style.display = "block";
      notifyEl.checked = true;
      renderPayExisting(r);
      $("addChannel").value = r.source || "other";
      $("addType").value = r.stay_type || "day_trip";
      $("addStatus").value = r.status || "pending";
      $("addName").value = r.guest_name || "";
      $("addName").readOnly = true;
      $("addNameLock").hidden = false;
      $("addBookedBy").value = r.booked_by || "—";
      $("addPhone").value = r.guest_phone || "";
      $("addEmail").value = r.guest_email || "";
      addDateEl.value = r.check_in || "";
      $("addAdults").value = r.adults || 0;
      $("addKids").value = r.children_6_12 || 0;
      $("addKids05").value = r.children_0_5 || 0;
      discTypeEl.value = r.discount_type || "";
      discValueEl.value = r.discount_value != null ? r.discount_value : "";
      discReasonEl.value = r.discount_reason || "";
      $("addSeniors").value = r.senior_count || 0;
      $("addPets").value = r.pet_count || 0;
      $("addTotal").value = r.total_amount != null ? r.total_amount : "";
      $("addNotes").value = r.notes || "";
      $("addStaffNotes").value = r.staff_notes || "";
      modalCabanaIds = (r.booking_cabanas || []).map(function (bc) { return bc.cabana_id; });
      openPriceSig = priceSig();
    } else {
      openPriceSig = null;
      modalTitle.textContent = "Add a Booking";
      modalSub.textContent = "For a request that came in outside the website — Messenger, phone, walk-in, etc.";
      saveBookingBtn.textContent = "Save Booking";
      staffNotesField.style.display = "none";
      paymentField.style.display = "none";
      $("addStatus").value = "pending";
      $("addName").readOnly = false;
      $("addNameLock").hidden = true;
      $("addBookedBy").value = currentStaffName || "";
      notifyEl.checked = false;
      modalCabanaIds = [];
    }
    notifyTouched = false;
    renderModalMap();
    updateNotifyState();
    var mp = mailPanel();
    if (mp) mp.reset();
    addModalBackdrop.classList.add("open");
  }
  function closeModal() {
    addModalBackdrop.classList.remove("open");
    addForm.reset();
    editingRow = null;
    modalCabanaIds = [];
  }

  addBtn.addEventListener("click", function () { openModal(null); });
  cancelAddBtn.addEventListener("click", closeModal);
  addModalBackdrop.addEventListener("click", function (e) { if (e.target === addModalBackdrop) closeModal(); });
  addDateEl.addEventListener("change", renderModalMap);
  ["addEmail", "addTotal", "addSeniors", "addPets"].forEach(function (id) { $(id).addEventListener("input", updateNotifyState); });
  ["addType", "addStatus"].forEach(function (id) { $(id).addEventListener("change", updateNotifyState); });

  function formValues() {
    var type = $("addType").value;
    var pr = modalPricing();
    var b = pr.bill;
    return {
      source: $("addChannel").value,
      stay_type: type,
      stay_type_label: TYPE_LABELS[type],
      status: $("addStatus").value,
      guest_name: $("addName").value.trim(),
      booked_by: currentStaffName || null,
      guest_phone: $("addPhone").value.trim() || null,
      guest_email: $("addEmail").value.trim() || null,
      check_in: addDateEl.value || null,
      adults: intVal("addAdults"),
      children_6_12: intVal("addKids"),
      senior_count: intVal("addSeniors"),
      pet_count: intVal("addPets"),
      children_0_5: intVal("addKids05"),
      total_amount: pr.total,
      subtotal_people: b.rated && !pr.kept ? P.r2(b.subtotalPeople) : undefined,
      cabana_total: b.rated && !pr.kept ? P.r2(b.isPackage ? b.extraCabanaCost : b.cabanaTotal) : undefined,
      senior_discount: b.rated && !pr.kept ? P.r2(b.seniorDiscount) : undefined,
      discount_type: pr.discountType,
      discount_value: pr.discountType ? pr.discountValue : null,
      discount_amount: pr.discount,
      discount_reason: pr.discountType ? (discReasonEl.value.trim() || null) : null,
      notes: $("addNotes").value.trim() || null,
      staff_notes: $("addStaffNotes").value.trim() || null,
    };
  }

  function showFormError(msg) {
    addError.textContent = msg;
    addError.style.display = "block";
    saveBookingBtn.disabled = false;
  }

  function sameValue(a, b) {
    var empty = function (v) { return v === null || v === undefined || v === ""; };
    if (empty(a) && empty(b)) return true;
    // an empty count and 0 are the same (older bookings left some counts blank)
    if ((empty(a) && b === 0) || (a === 0 && empty(b))) return true;
    if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
    return String(a) === String(b);
  }

  function syncCabanas(bookingId, before, after) {
    var toAdd = after.filter(function (id) { return before.indexOf(id) === -1; });
    var toRemove = before.filter(function (id) { return after.indexOf(id) === -1; });
    var jobs = [];
    if (toAdd.length) {
      jobs.push(sb.from("booking_cabanas").insert(toAdd.map(function (id) { return { booking_id: bookingId, cabana_id: id }; })));
    }
    if (toRemove.length) {
      jobs.push(sb.from("booking_cabanas").delete().eq("booking_id", bookingId).in("cabana_id", toRemove));
    }
    return Promise.all(jobs).then(function (results) {
      var err = results.filter(function (r) { return r && r.error; })[0];
      if (err) throw err.error;
    });
  }

  // Staff-uploaded proofs go under staff/ — the email function treats those as
  // already verified (no "please verify" alert to the team).
  function uploadProof(r, file) {
    var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    var path = "staff/" + r.id + "-" + Date.now() + "." + ext;
    return sb.storage.from("payment-proofs").upload(path, file, { contentType: file.type || "image/jpeg" }).then(function (res) {
      if (res.error) throw res.error;
      return path;
    });
  }

  function guestChanges(r, patch, beforeCabanas, afterCabanas) {
    var out = [];
    GUEST_FIELDS.forEach(function (f) {
      var key = f[0];
      if (!(key in patch)) return;
      var fmt = f[2];
      var before = r[key] === null || r[key] === undefined ? "" : fmt(r[key]);
      var after = patch[key] === null || patch[key] === undefined ? "" : fmt(patch[key]);
      if (before !== after) out.push({ label: f[1], before: before || "—", after: after || "—" });
    });
    var b = cabanaListText(beforeCabanas), a = cabanaListText(afterCabanas);
    if (b !== a) out.push({ label: "Cabana(s)", before: b, after: a });
    return out;
  }

  addForm.addEventListener("submit", function (e) {
    e.preventDefault();
    addError.style.display = "none";
    var vals = formValues();
    Object.keys(vals).forEach(function (k) { if (vals[k] === undefined) delete vals[k]; });
    var pricing = modalPricing();
    if (pricing.error) return showFormError(pricing.error);
    if (vals.pet_count > 2) return showFormError("A maximum of two pets are permitted per reservation.");
    if (!vals.guest_name) return showFormError("Guest name is required.");
    if (vals.senior_count > vals.adults) return showFormError("Senior citizens are counted within adults — senior count can't be more than adults.");
    saveBookingBtn.disabled = true;
    if (notifyEl.checked && !notifyEl.disabled) saveBookingBtn.textContent = editingRow ? "Saving & emailing…" : "Saving & sending…";

    if (editingRow) {
      var r = editingRow;
      var patch = {};
      Object.keys(vals).forEach(function (k) {
        if (k === "stay_type_label") return; // only follows a real type change (below)
        if (k === "guest_name" || k === "booked_by") return; // locked once the booking exists
        if (!sameValue(vals[k], r[k])) patch[k] = vals[k];
      });
      if (patch.stay_type) patch.stay_type_label = vals.stay_type_label;
      var beforeCabanas = (r.booking_cabanas || []).map(function (bc) { return bc.cabana_id; });
      var afterCabanas = modalCabanaIds.slice();
      var changes = guestChanges(r, patch, beforeCabanas, afterCabanas);
      var notify = notifyEl.checked && !notifyEl.disabled && changes.length > 0;
      var file = payFileEl.files && payFileEl.files[0];
      saveBookingBtn.textContent = "Saving…";

      var upload = file ? uploadProof(r, file) : Promise.resolve(null);
      upload
        .then(function (path) {
          if (path) {
            patch.payment_screenshot_path = path;
            patch.payment_uploaded_at = new Date().toISOString();
            var st = patch.status || r.status;
            if (st === "pending" || st === "pending_payment") patch.status = "confirmed";
          }
          if (!Object.keys(patch).length) return;
          return sb.from("booking_requests").update(patch).eq("id", r.id).then(function (res) { if (res.error) throw res.error; });
        })
        .then(function () { return syncCabanas(r.id, beforeCabanas, afterCabanas); })
        .then(function () {
          if (!notify) return null;
          var mv = dtMail ? dtMail.value() : { message: "" };
          return sb.rpc("notify_booking_change", {
            p_booking_id: r.id,
            p_changes: changes,
            p_old_check_in: "check_in" in patch ? r.check_in : null,
            p_message: mv.message || null,
          }).then(function (res) { return res.error ? res.error : null; });
        })
        .then(function (notifyErr) {
          saveBookingBtn.disabled = false;
          closeModal();
          loadBookings();
          if (notifyErr) alert("Changes saved, but the guest email couldn't be queued: " + notifyErr.message);
        })
        .catch(function (err) {
          saveBookingBtn.textContent = "Save Changes";
          showFormError("Couldn't save the changes: " + (err && err.message ? err.message : err));
        });
      return;
    }

    // New booking. created_at (the "Date Entered") is left for Postgres to
    // stamp off the server clock; order_code comes from trg_set_order_code.
    var payload = Object.assign({}, vals, { email_guest: false });
    if (!payload.staff_notes) delete payload.staff_notes;
    var cabanaIds = modalCabanaIds.slice();
    var sendQuote = notifyEl.checked && !notifyEl.disabled;
    sb.from("booking_requests").insert([payload]).select().then(function (res) {
      if (res.error) return showFormError("Couldn't save this booking: " + res.error.message);
      var row = res.data && res.data[0];
      var attach = row && cabanaIds.length ? syncCabanas(row.id, [], cabanaIds) : Promise.resolve();
      attach.then(function () {
        // Flip email_guest only now that the cabanas are attached — the
        // database trigger then sends the quotation with them listed.
        if (!sendQuote || !row) return null;
        var mv = dtMail ? dtMail.value() : { subject: "", message: "" };
        var upd = { email_guest: true };
        if (mv.message || mv.subject) upd.email_custom = { quote: { subject: mv.subject || null, message: mv.message || null } };
        return sb.from("booking_requests").update(upd).eq("id", row.id).then(function (u) {
          return u.error ? "Booking saved, but the quotation email couldn't be queued: " + u.error.message : null;
        });
      }).then(function (warn) {
        saveBookingBtn.disabled = false;
        closeModal();
        loadBookings();
        if (warn) alert(warn);
      }, function (err) {
        saveBookingBtn.disabled = false;
        closeModal();
        loadBookings();
        alert("Booking saved, but the cabana(s) couldn't be attached" + (sendQuote ? " and the quotation was NOT sent" : "") + ": " + (err && err.message ? err.message : err));
      });
    });
  });

  // ---------- Cabana Map planner ----------
  // A whole-day view of every cabana. Click a booked cabana to pick it up,
  // then a free one to move that party there, or another booked one to swap
  // the two parties. Each affected guest gets the "changes to your
  // reservation" email (if they have an email and the box is ticked).
  var plannerBackdrop = $("plannerBackdrop");
  var plannerDateEl = $("plannerDate");
  var plannerMapEl = $("plannerMap");
  var plannerStatus = $("plannerStatus");
  var plannerConfirm = $("plannerConfirm");
  var plannerList = $("plannerList");
  var plannerSource = null;   // { cabanaId, row }
  var plannerPending = null;  // { from, to, row, other }

  function plannerHolds(dateStr) {
    var byCabana = {};
    allRows.forEach(function (r) {
      if (r.check_in !== dateStr || releasesCabanas(r.status)) return;
      (r.booking_cabanas || []).forEach(function (bc) { byCabana[bc.cabana_id] = r; });
    });
    return byCabana;
  }
  function cabLabel(id) { return cabanasById[id] ? cabanasById[id].label.replace(/^Section /, "Sec. ") : "cabana"; }
  function partySize(r) { return (r.adults || 0) + (r.children_6_12 || 0) + (r.children_0_5 || 0); }

  function renderPlanner() {
    var dateStr = plannerDateEl.value;
    var holds = plannerHolds(dateStr);
    var heldSet = new Set(Object.keys(holds));
    var info = {};
    Object.keys(holds).forEach(function (id) {
      var r = holds[id];
      info[id] = (r.guest_name || "Guest") + (r.order_code ? " (" + r.order_code + ")" : "") + " · " + partySize(r) + " pax";
    });
    if (plannerPending) {
      plannerStatus.className = "planner-status is-pending";
      plannerStatus.textContent = plannerPending.other
        ? "Swap: " + plannerPending.row.guest_name + " → " + cabLabel(plannerPending.to) + ", and " + plannerPending.other.guest_name + " → " + cabLabel(plannerPending.from) + "?"
        : "Move " + plannerPending.row.guest_name + " from " + cabLabel(plannerPending.from) + " to " + cabLabel(plannerPending.to) + "?";
      plannerConfirm.classList.add("open");
    } else {
      plannerConfirm.classList.remove("open");
      plannerStatus.className = "planner-status";
      plannerStatus.textContent = plannerSource
        ? "Picked up " + cabLabel(plannerSource.cabanaId) + " (" + plannerSource.row.guest_name + "). Click a free cabana to move it there, another booked cabana to swap, or the same one to put it back."
        : (heldSet.size ? heldSet.size + " cabana(s) booked on " + fmtDate(dateStr) + ". Hover to see who has each; click one to move it." : "No cabanas booked on " + fmtDate(dateStr) + ".");
    }
    window.VBRCabanaMap.render(plannerMapEl, {
      cabanas: cabanasList,
      heldSet: heldSet,
      heldInfo: info,
      clickableHeld: true,
      highlightId: plannerPending ? plannerPending.to : (plannerSource ? plannerSource.cabanaId : null),
      selectedLabel: "Picked up / moving to",
      crop: { top: 0.33, bottom: 0.56 },
      onSelect: function (c) {
        if (plannerPending) return;
        var holder = holds[c.id];
        if (!plannerSource) {
          if (holder) plannerSource = { cabanaId: c.id, row: holder };
        } else if (c.id === plannerSource.cabanaId) {
          plannerSource = null;
        } else {
          plannerPending = { from: plannerSource.cabanaId, to: c.id, row: plannerSource.row, other: holder && holder.id !== plannerSource.row.id ? holder : null };
          if (holder && holder.id === plannerSource.row.id) { plannerPending = null; plannerStatus.textContent = "That cabana already belongs to the same booking."; return; }
        }
        renderPlanner();
      },
    });
    // the day's bookings
    var dayRows = allRows.filter(function (r) { return r.check_in === dateStr && !releasesCabanas(r.status); })
      .sort(function (a, b) { return partySize(b) - partySize(a); });
    plannerList.innerHTML = dayRows.length ? "" : '<tr><td colspan="5" class="muted">No active bookings on this date.</td></tr>';
    dayRows.forEach(function (r) {
      var tr = document.createElement("tr");
      if (plannerSource && plannerSource.row.id === r.id) tr.className = "is-source";
      var cabs = (r.booking_cabanas || []).map(function (bc) { return cabLabel(bc.cabana_id); }).join(", ");
      if (!cabs && (r.legacy_dining_cabanas || r.legacy_lounge_cabanas)) cabs = (r.legacy_dining_cabanas || 0) + " dining, " + (r.legacy_lounge_cabanas || 0) + " lounge (no numbers)";
      [r.guest_name || "—", r.order_code || "—", partySize(r) + " pax", cabs || "— not assigned", STATUS_LABELS[r.status] || r.status].forEach(function (t) {
        var td = document.createElement("td"); td.textContent = t; tr.appendChild(td);
      });
      plannerList.appendChild(tr);
    });
  }

  function emailMove(r, beforeIds, afterIds) {
    if (!$("plannerNotify").checked || !EMAIL_RE.test(String(r.guest_email || "").trim())) return Promise.resolve();
    var changes = [{ label: "Cabana(s)", before: cabanaListText(beforeIds), after: cabanaListText(afterIds) }];
    return sb.rpc("notify_booking_change", { p_booking_id: r.id, p_changes: changes, p_old_check_in: null });
  }

  function applyPlannerMove() {
    var m = plannerPending;
    if (!m) return;
    var btn = $("plannerConfirmBtn");
    btn.disabled = true;
    var aBefore = (m.row.booking_cabanas || []).map(function (bc) { return bc.cabana_id; });
    var aAfter = aBefore.map(function (id) { return id === m.from ? m.to : id; });
    var bBefore = null, bAfter = null;
    if (m.other) {
      bBefore = (m.other.booking_cabanas || []).map(function (bc) { return bc.cabana_id; });
      bAfter = bBefore.map(function (id) { return id === m.to ? m.from : id; });
    }
    // For a swap, free cabana B first so the two moves can't collide.
    var run = m.other
      ? sb.from("booking_cabanas").delete().eq("booking_id", m.other.id).eq("cabana_id", m.to)
          .then(function (res) { if (res.error) throw res.error; return syncCabanas(m.row.id, aBefore, aAfter); })
          .then(function () { return sb.from("booking_cabanas").insert([{ booking_id: m.other.id, cabana_id: m.from }]); })
          .then(function (res) { if (res && res.error) throw res.error; })
      : syncCabanas(m.row.id, aBefore, aAfter);
    run
      .then(function () {
        return Promise.all([emailMove(m.row, aBefore, aAfter), m.other ? emailMove(m.other, bBefore, bAfter) : null]);
      })
      .then(function () { plannerPending = null; plannerSource = null; return loadBookings(); })
      .then(function () { btn.disabled = false; renderPlanner(); })
      .catch(function (err) {
        btn.disabled = false;
        plannerPending = null;
        plannerStatus.textContent = "Couldn't move the cabana: " + (err && err.message ? err.message : err);
        loadBookings().then(renderPlanner);
      });
  }

  function shiftPlannerDate(days) {
    var d = new Date((plannerDateEl.value || todayStr()) + "T00:00:00");
    d.setDate(d.getDate() + days);
    plannerDateEl.value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    plannerSource = null; plannerPending = null;
    renderPlanner();
  }
  $("plannerBtn").addEventListener("click", function () {
    if (!plannerDateEl.value) plannerDateEl.value = todayStr();
    plannerSource = null; plannerPending = null;
    plannerBackdrop.classList.add("open");
    renderPlanner();
  });
  $("closePlannerBtn").addEventListener("click", function () { plannerBackdrop.classList.remove("open"); });
  plannerBackdrop.addEventListener("click", function (e) { if (e.target === plannerBackdrop) plannerBackdrop.classList.remove("open"); });
  plannerDateEl.addEventListener("change", function () { plannerSource = null; plannerPending = null; renderPlanner(); });
  $("plannerPrev").addEventListener("click", function () { shiftPlannerDate(-1); });
  $("plannerNext").addEventListener("click", function () { shiftPlannerDate(1); });
  $("plannerToday").addEventListener("click", function () { plannerDateEl.value = todayStr(); plannerSource = null; plannerPending = null; renderPlanner(); });
  $("plannerConfirmBtn").addEventListener("click", applyPlannerMove);
  $("plannerCancelBtn").addEventListener("click", function () { plannerPending = null; renderPlanner(); });

  // ---------- CSV export (currently filtered/visible rows) ----------
  document.getElementById("exportBtn").addEventListener("click", function () {
    var rows = sortRows(applyFilter(allRows));
    var headers = ["Order ID", "Guest", "Guest Names", "Phone", "Email", "Type", "Booked By", "Preferred Date / Check-in", "Check-out", "Cabana(s) / Villa(s)", "Adults", "Senior Citizens", "Kids 6-12", "Kids 0-5", "Pets", "Subtotal (People)", "Cabana Total", "Senior Discount", "Total", "Status", "Payment Proof", "Senior ID(s)", "Source", "How Heard", "Occasion", "Notes", "Staff Notes", "Date Entered"];
    function csvCell(v) {
      v = v === null || v === undefined ? "" : String(v);
      return '"' + v.replace(/"/g, '""') + '"';
    }
    var lines = [headers.map(csvCell).join(",")];
    rows.forEach(function (r) {
      var cabanaLabels = (r.booking_cabanas || [])
        .map(function (bc) { return cabanasById[bc.cabana_id] ? cabanasById[bc.cabana_id].label : ""; })
        .filter(Boolean)
        .join("; ");
      if (!cabanaLabels && (r.legacy_dining_cabanas || r.legacy_lounge_cabanas)) {
        var legacyBits = [];
        if (r.legacy_dining_cabanas) legacyBits.push(r.legacy_dining_cabanas + " dining");
        if (r.legacy_lounge_cabanas) legacyBits.push(r.legacy_lounge_cabanas + " lounge");
        cabanaLabels = legacyBits.join(", ") + " (from 2026 sheet)";
      }
      if (r.stay_type === "overnight" && window.VBRVillas) cabanaLabels = window.VBRVillas.labelsFor(r).join("; ");
      lines.push([
        r.order_code, r.guest_name, r.guest_names || "", r.guest_phone, r.guest_email,
        TYPE_LABELS[r.stay_type] || r.stay_type, r.booked_by || "", fmtDate(r.check_in), r.check_out ? fmtDate(r.check_out) : "", cabanaLabels,
        r.adults, r.senior_count || 0, r.children_6_12, r.children_0_5, r.pet_count || 0,
        r.subtotal_people != null ? r.subtotal_people : "", r.cabana_total != null ? r.cabana_total : "",
        r.senior_discount != null ? r.senior_discount : "", r.total_amount != null ? r.total_amount : "",
        STATUS_LABELS[r.status] || r.status, r.payment_screenshot_path ? "Uploaded" : "",
        (r.senior_id_paths && r.senior_id_paths.length) ? "Uploaded (" + r.senior_id_paths.length + ")" : "",
        SOURCE_LABELS[r.source] || r.source, r.how_heard || "", r.occasion || "",
        r.notes, r.staff_notes, fmtDateTime(r.created_at),
      ].map(csvCell).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "vbr-bookings-" + activeFilter + "-" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ---------- activity log modal ----------
  var logBtn = document.getElementById("logBtn");
  var logModalBackdrop = document.getElementById("logModalBackdrop");
  var closeLogBtn = document.getElementById("closeLogBtn");
  var logBody = document.getElementById("logBody");
  var logStaffFilter = document.getElementById("logStaffFilter");
  var logFrom = document.getElementById("logFrom");
  var logTo = document.getElementById("logTo");
  var logRefreshBtn = document.getElementById("logRefreshBtn");
  var logBookingFilterEl = document.getElementById("logBookingFilter");
  var currentLogBookingId = null;
  var logOptionsPopulated = false;

  function populateLogStaffOptions() {
    if (logOptionsPopulated) return;
    logOptionsPopulated = true;
    Object.keys(STAFF_EMAIL_NAMES).sort(function (a, b) {
      return STAFF_EMAIL_NAMES[a].localeCompare(STAFF_EMAIL_NAMES[b]);
    }).forEach(function (email) {
      var opt = document.createElement("option");
      opt.value = email;
      opt.textContent = STAFF_EMAIL_NAMES[email];
      logStaffFilter.appendChild(opt);
    });
  }

  function staffLabelForLogEmail(email) {
    if (!email) return "—";
    var name = staffNameForEmail(email);
    return name || email;
  }

  function describeLogChanges(entry) {
    if (entry.action === "insert") return "New booking created.";
    if (entry.action === "delete") return "Booking deleted.";
    if (entry.action && entry.action.indexOf("villa_") === 0) {
      var ch = entry.changes || {};
      return esc((LOG_ACTION_LABELS[entry.action] || entry.action) + ": " + (ch.from_villa ? ch.from_villa + " → " : "") + (ch.villa || "a villa") +
        (ch.check_in ? " (" + fmtDate(ch.check_in) + " → " + fmtDate(ch.check_out) + ")" : "") + (ch.reason ? " — " + ch.reason : ""));
    }
    if (entry.action === "cabana_added" || entry.action === "cabana_removed") {
      var cid = entry.changes && entry.changes.cabana_id;
      var label = cid && cabanasById[cid] ? cabanasById[cid].label : "a cabana";
      return (entry.action === "cabana_added" ? "Added " : "Removed ") + label;
    }
    if (entry.action === "update" && entry.changes) {
      var parts = [];
      Object.keys(entry.changes).forEach(function (field) {
        var c = entry.changes[field];
        var oldV = c && c.old !== undefined && c.old !== null ? String(c.old) : "—";
        var newV = c && c.new !== undefined && c.new !== null ? String(c.new) : "—";
        parts.push("<b>" + field + "</b>: " + oldV + " → " + newV);
      });
      return parts.length ? parts.join("<br>") : "Minor update (no visible fields changed).";
    }
    return "—";
  }

  function loadLog() {
    logBody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading…</td></tr>';
    var query = sb.from("booking_audit_log").select("*").order("logged_at", { ascending: false }).limit(300);
    if (currentLogBookingId) query = query.eq("booking_id", currentLogBookingId);
    if (logStaffFilter.value) query = query.eq("changed_by_email", logStaffFilter.value);
    if (logFrom.value) query = query.gte("logged_at", logFrom.value + "T00:00:00");
    if (logTo.value) query = query.lte("logged_at", logTo.value + "T23:59:59");
    query.then(function (res) {
      if (res.error) {
        logBody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--rose,#9c4a3f);">Couldn\'t load the log: ' + res.error.message + "</td></tr>";
        return;
      }
      var entries = res.data || [];
      if (!entries.length) {
        logBody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--ink-soft);">No matching activity.</td></tr>';
        return;
      }
      logBody.innerHTML = "";
      entries.forEach(function (entry) {
        var tr = document.createElement("tr");

        var tdWhen = document.createElement("td");
        tdWhen.textContent = fmtDateTime(entry.logged_at);
        tr.appendChild(tdWhen);

        var tdStaff = document.createElement("td");
        tdStaff.textContent = staffLabelForLogEmail(entry.changed_by_email);
        tr.appendChild(tdStaff);

        var tdAction = document.createElement("td");
        tdAction.textContent = LOG_ACTION_LABELS[entry.action] || entry.action;
        tr.appendChild(tdAction);

        var tdBooking = document.createElement("td");
        tdBooking.textContent = (entry.guest_name || "—") + (entry.order_code ? " (" + entry.order_code + ")" : "");
        tr.appendChild(tdBooking);

        var tdWhat = document.createElement("td");
        tdWhat.className = "log-change";
        tdWhat.innerHTML = describeLogChanges(entry);
        tr.appendChild(tdWhat);

        logBody.appendChild(tr);
      });
    });
  }

  function openLogModal(bookingId, bookingLabel) {
    populateLogStaffOptions();
    currentLogBookingId = bookingId || null;
    if (currentLogBookingId) {
      logBookingFilterEl.style.display = "block";
      logBookingFilterEl.innerHTML = "Showing history for <b>" + (bookingLabel || "this booking") + '</b> only — <a id="logShowAllLink">show all bookings</a>';
      var link = document.getElementById("logShowAllLink");
      if (link) link.addEventListener("click", function () {
        currentLogBookingId = null;
        logBookingFilterEl.style.display = "none";
        loadLog();
      });
    } else {
      logBookingFilterEl.style.display = "none";
    }
    logModalBackdrop.classList.add("open");
    loadLog();
  }
  function closeLogModal() { logModalBackdrop.classList.remove("open"); }

  logBtn.addEventListener("click", function () { openLogModal(null, null); });
  closeLogBtn.addEventListener("click", closeLogModal);
  logModalBackdrop.addEventListener("click", function (e) { if (e.target === logModalBackdrop) closeLogModal(); });
  logRefreshBtn.addEventListener("click", loadLog);
  logStaffFilter.addEventListener("change", loadLog);
  logFrom.addEventListener("change", loadLog);
  logTo.addEventListener("change", loadLog);

  // ---------- price breakdown (click a Total) ----------
  var bdBackdrop = document.getElementById("bdBackdrop"), bdBody = document.getElementById("bdBody");
  var bdRow = null;
  function closeBreakdown() { bdBackdrop.classList.remove("open"); bdRow = null; }
  document.getElementById("bdClose").addEventListener("click", closeBreakdown);
  bdBackdrop.addEventListener("click", function (e) { if (e.target === bdBackdrop) closeBreakdown(); });
  document.getElementById("bdEdit").addEventListener("click", function () {
    var r = bdRow; closeBreakdown();
    if (!r) return;
    if (isVillaRow(r) && window.VBRVillas) window.VBRVillas.openBooking(r); else openModal(r);
  });
  var KIND_SECTIONS = { room: "Casita", meal: "Full-board meals", senior_room: "Discounts", extra_bed: "Extras", pet: "Extras", add_on: "Add-ons", online_discount: "Discounts", discount: "Discounts" };
  // Overnight quote lines → "desc · 2 × ₱15,525" rows, grouped.
  function villaRows(lines) {
    var out = [], last = null;
    (lines || []).forEach(function (l) {
      var sec = KIND_SECTIONS[l.kind] || "Other";
      if (sec !== last) { out.push('<div class="bill-sec">' + esc(sec) + "</div>"); last = sec; }
      var amt = Number(l.amount), qty = Number(l.qty) || 0, rate = Number(l.rate) || 0;
      var math = qty && rate && l.kind !== "senior_room" && l.kind !== "online_discount" ? '<span class="bd-qty">' + qty + " × " + esc(peso(Math.abs(rate))) + "</span>" : "";
      out.push(billRow(esc(l.desc) + math, amt === 0 ? "Free" : (amt < 0 ? "−" + peso(-amt) : peso(amt)), amt < 0 ? "discount" : ""));
    });
    return out;
  }
  function legacyCabanas(r) {
    var pick = function (kind) { return cabanasList.filter(function (c) { return String(c.cabana_type || "").indexOf(kind) === 0; })[0]; };
    var out = [], d = pick("dining"), l = pick("lounge");
    for (var i = 0; i < (r.legacy_dining_cabanas || 0); i++) out.push({ label: "Dining cabana", cabana_type: "dining", price: d ? d.price : 1500, capacity: d ? d.capacity : 10 });
    for (i = 0; i < (r.legacy_lounge_cabanas || 0); i++) out.push({ label: "Lounge cabana", cabana_type: "lounge", price: l ? l.price : 2000, capacity: l ? l.capacity : 4 });
    return out;
  }
  function openBreakdown(r) {
    bdRow = r;
    document.getElementById("bdTitle").textContent = "Price breakdown" + (r.order_code ? " · " + r.order_code : "");
    var when = isVillaRow(r) ? fmtDate(r.check_in) + " → " + fmtDate(r.check_out) + " · " + nightsOf(r) + " night" + (nightsOf(r) === 1 ? "" : "s") : fmtDate(r.check_in);
    document.getElementById("bdSub").textContent = (r.guest_name || "") + " · " + (TYPE_LABELS[r.stay_type] || r.stay_type || "") + " · " + when;
    var note = document.getElementById("bdNote");
    note.textContent = "";
    var saved = r.total_amount == null ? null : Number(r.total_amount);
    var foot = function (calc) {
      var html = '<div class="bill-total"><span>Total on the booking</span><span>' + (saved == null ? "—" : peso(saved)) + "</span></div>";
      if (calc != null && saved != null && Math.abs(calc - saved) > 0.5) {
        html += '<p class="bill-note">The rate sheet gives ' + peso(calc) + " for these details — the booking keeps its agreed total of " + peso(saved) +
          (r.source === "sheet_import" ? " (from the 2026 Day Trip sheet)." : /Cloudbeds/.test(r.staff_notes || "") ? " (from Cloudbeds — rate plans, promos and OTA prices differ)." : ".") + "</p>";
      }
      return html;
    };
    if (/^\[Imported from Cloudbeds/.test(r.staff_notes || "")) note.textContent = (r.staff_notes || "").replace(/^\[Imported from Cloudbeds #\d+\]\s*·?\s*/, "Cloudbeds: ");
    else if (r.source === "sheet_import" && r.staff_notes) note.textContent = "Sheet remarks: " + r.staff_notes.replace(/^\[Imported from 2026 Day Trip Calendar\]\s*/, "");
    if (isVillaRow(r) && r.cb_owned) {
      var ci = r.cb_info || {};
      var CL = ['<div class="bill-sec">Cloudbeds folio</div>',
        billRow(esc(r.room_name || "Room(s)") + '<span class="bd-qty">' + nightsOf(r) + " night" + (nightsOf(r) === 1 ? "" : "s") + "</span>", ci.total != null ? peso(ci.total) : peso(r.total_amount))];
      if (ci.paid != null) CL.push(billRow("Paid", "−" + peso(ci.paid), "discount"));
      if (ci.balance != null) CL.push(billRow("<b>Balance</b>", "<b>" + peso(ci.balance) + "</b>"));
      bdBody.innerHTML = '<div class="bill-lines">' + CL.join("") + "</div>" +
        '<p class="bill-note">This stay was booked in Cloudbeds, so it\'s priced there (rate plans, promos, OTA prices). ' +
        (cbUrl(r) ? '<a class="cb-link" data-cb="' + esc(r.cb_reservation_id) + '" href="' + cbUrl(r) + '" target="_blank" rel="noopener">Open the folio in Cloudbeds ↗</a> (copies #' + esc(r.cb_reservation_id) + ")" : "") + "</p>";
      bdBackdrop.classList.add("open");
      return;
    }
    if (isVillaRow(r)) {
      bdBody.innerHTML = '<div class="bill-lines">' + billRow("Calculating…", "") + "</div>";
      sb.rpc("quote_booking_overnight", { p_booking_id: r.id }).then(function (res) {
        if (bdRow !== r) return;
        if (res.error || !res.data || !res.data.ok) {
          bdBody.innerHTML = '<div class="bill-lines">' + billRow(esc((res.error && res.error.message) || (res.data && res.data.error) || "No villa assigned — can't price this stay"), "—") + "</div>" + foot(null);
          return;
        }
        var q = res.data, L = villaRows(q.lines), calc = Number(q.total);
        var d = Number(r.discount_amount) || 0;
        if (d > 0) { L.push(billRow("Discount" + (r.discount_reason ? " — " + esc(r.discount_reason) : ""), "−" + peso(d), "discount")); calc -= d; }
        bdBody.innerHTML = '<div class="bill-lines">' + L.join("") + "</div>" +
          '<p class="bill-note">' + q.nights + " night(s) · " + q.weekday_nights + " weekday, " + q.weekend_nights + " weekend/peak · " + q.guests + " guest(s)</p>" + foot(Math.round(calc * 100) / 100);
      });
    } else {
      var cabs = (r.booking_cabanas || []).map(function (bc) { return cabanasById[bc.cabana_id]; }).filter(Boolean);
      if (!cabs.length) cabs = legacyCabanas(r);
      var b = P.compute({ type: r.stay_type, adults: r.adults, kids612: r.children_6_12, kids05: r.children_0_5, seniors: r.senior_count, pets: r.pet_count, cabanas: cabs });
      if (!b.rated) {
        bdBody.innerHTML = '<div class="bill-lines">' + billRow(esc(FULL_TYPE_NAMES[r.stay_type] || r.stay_type || "Booking"), "Quoted by hand") + "</div>" + foot(null);
      } else {
        var L = dayTripRows(b), calc = b.total;
        var d2 = Number(r.discount_amount) || 0;
        if (d2 > 0) { L.push(billRow("Discount" + (r.discount_reason ? " — " + esc(r.discount_reason) : ""), "−" + peso(d2), "discount")); calc -= d2; }
        bdBody.innerHTML = '<div class="bill-lines">' + (L.join("") || billRow("No guests or cabanas recorded", "—")) + "</div>" + foot(P.r2(calc));
      }
    }
    bdBackdrop.classList.add("open");
  }

  // ---------- Cloudbeds sync status (Villas section) ----------
  var cbBar = document.getElementById("cbSync"), cbLastRun = null;
  function ago(ts) {
    var m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
  }
  function loadCbStatus() {
    if (!cbBar) return;
    sb.rpc("cb_sync_status").then(function (res) {
      if (res.error) { cbBar.hidden = true; return; }
      var s = res.data || {}, lp = s.last_pull || {}, html = [];
      cbBar.hidden = false;
      var wasOn = cbPushOn;
      cbPushOn = s.push_enabled === true;
      var ran = lp.ran_at || null;
      var stale = !ran || Date.now() - new Date(ran).getTime() > 20 * 60000;
      html.push('<span class="cb-dot' + (stale ? " bad" : "") + '"></span><b>Cloudbeds</b> ' +
        (s.setup ? (ran ? "synced " + ago(ran) : "waiting for the first sync") : "sync not set up yet"));
      if (!cbPushOn) html.push('<span class="cb-test" title="Cloudbeds reservations come in, but nothing made on the website is sent to Cloudbeds until launch.">TEST MODE · website bookings stay here</span>');
      else if (s.push_waiting) html.push('<span class="' + (s.push_errors ? "cb-warn" : "") + '" title="Website villa bookings not in Cloudbeds yet (retried every 5 min)">' +
        s.push_waiting + " website booking" + (s.push_waiting === 1 ? "" : "s") + " not in Cloudbeds yet</span>");
      if (s.clashes_upcoming) html.push('<span class="cb-warn" title="Stays where Cloudbeds\' casita couldn\'t be shown here — fix the room assignment in Cloudbeds">' + s.clashes_upcoming + " casita clash" + (s.clashes_upcoming === 1 ? "" : "es") + "</span>");
      var le = s.last_error;
      if (le && le.at && (!ran || new Date(le.at) >= new Date(ran) - 60000) && Date.now() - new Date(le.at).getTime() < 3600e3) {
        html.push('<span class="cb-warn" title="' + esc((le.errors || []).join("\n")) + '">last sync had errors</span>');
      }
      html.push('<button type="button" class="btn-sm ghost" id="cbSyncNow">Sync now</button>');
      cbBar.innerHTML = html.join(" · ");
      document.getElementById("cbSyncNow").addEventListener("click", function (e) {
        e.target.disabled = true; e.target.textContent = "Syncing…";
        sb.rpc("cb_request_sync").then(function () { setTimeout(function () { loadCbStatus(); loadBookings(); }, 12000); });
      });
      // new data from Cloudbeds → refresh the list (unless a form is open)
      if (ran && cbLastRun && ran !== cbLastRun && (lp.applied || lp.pushed) && !document.querySelector(".modal-backdrop.open")) loadBookings();
      cbLastRun = ran;
      if (wasOn !== cbPushOn && allRows.length) render();
    });
  }
  setInterval(function () { if (document.visibilityState === "visible" && allRows.length) loadCbStatus(); }, 60000);

  // Shared with staff-villas.js (overnight bookings, villa calendar).
  window.VBRDash = {
    sb: sb,
    rows: function () { return allRows; },
    reload: loadBookings,
    render: render,
    staffName: function () { return currentStaffName; },
    staffLabel: staffLabelForLogEmail,
    openLog: openLogModal,
    villaRows: villaRows, billRow: billRow,
    esc: esc, peso: peso, fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    proofLinks: proofLinks, openSignedUrl: openSignedUrl, uploadProof: uploadProof,
    cbUrl: cbUrl, loadCbStatus: loadCbStatus,
    STATUS_LABELS: STATUS_LABELS, SOURCE_LABELS: SOURCE_LABELS,
  };
})();
