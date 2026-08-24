(function () {
  var cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || cfg.url.indexOf("YOUR-PROJECT-REF") !== -1) {
    document.getElementById("loginScreen").innerHTML =
      "<h2>Not connected yet</h2><p>This dashboard needs assets/js/booking-config.js filled in with your real Supabase project first — see SETUP-BOOKING.md.</p>";
    return;
  }

  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  var TYPE_LABELS = {
    day_trip: "Day Trip", half_day: "Half-day", day_picnic: "Picnic", corporate: "Corporate",
  };
  var SOURCE_LABELS = {
    website: "Website", messenger: "Messenger", phone: "Phone", email: "Email", walk_in: "Walk-in", other: "Other",
  };
  var STATUS_ORDER = ["pending", "pending_payment", "confirmed", "declined", "completed"];
  var STATUS_LABELS = {
    pending: "Pending", pending_payment: "Pending Payment", confirmed: "Confirmed",
    declined: "Declined", completed: "Completed",
  };

  var loginScreen = document.getElementById("loginScreen");
  var dashScreen = document.getElementById("dashScreen");
  var logoutBtn = document.getElementById("logoutBtn");
  var loginBtn = document.getElementById("loginBtn");
  var loginError = document.getElementById("loginError");
  var bookingsBody = document.getElementById("bookingsBody");
  var countLine = document.getElementById("countLine");
  var searchBox = document.getElementById("searchBox");
  var filterPills = document.getElementById("filterPills");

  var allRows = [];
  var activeFilter = "all";

  function showDash() {
    loginScreen.style.display = "none";
    dashScreen.style.display = "block";
    logoutBtn.style.display = "inline-block";
    loadBookings();
  }
  function showLogin() {
    loginScreen.style.display = "block";
    dashScreen.style.display = "none";
    logoutBtn.style.display = "none";
  }

  sb.auth.getSession().then(function (res) {
    if (res.data.session) showDash(); else showLogin();
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
      showDash();
    });
  });

  logoutBtn.addEventListener("click", function () {
    sb.auth.signOut().then(showLogin);
  });

  function loadBookings() {
    countLine.textContent = "Loading…";
    sb.from("booking_requests").select("*").order("created_at", { ascending: false }).then(function (res) {
      if (res.error) {
        countLine.textContent = "Couldn't load bookings: " + res.error.message;
        return;
      }
      allRows = res.data || [];
      render();
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

  function applyFilter(rows) {
    var q = (searchBox.value || "").trim().toLowerCase();
    return rows.filter(function (r) {
      var matchesFilter = true;
      if (activeFilter === "today") matchesFilter = isToday(r.check_in);
      else if (activeFilter === "week") matchesFilter = isThisWeek(r.check_in);
      else if (activeFilter === "month") matchesFilter = isThisMonth(r.check_in);
      else if (activeFilter === "unpaid") matchesFilter = r.status === "pending" || r.status === "pending_payment";
      if (!matchesFilter) return false;
      if (!q) return true;
      var hay = [r.guest_name, r.guest_email, r.guest_phone, r.notes, r.staff_notes].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
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

  function render() {
    var rows = applyFilter(allRows);
    countLine.textContent = rows.length + " of " + allRows.length + " bookings shown";
    if (!rows.length) {
      bookingsBody.innerHTML = '<tr class="empty-row"><td colspan="10">No bookings match this view.</td></tr>';
      return;
    }
    bookingsBody.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");

      var tdGuest = document.createElement("td");
      tdGuest.className = "col-guest";
      tdGuest.textContent = r.guest_name || "—";
      tr.appendChild(tdGuest);

      var tdContact = document.createElement("td");
      tdContact.innerHTML = (r.guest_phone ? r.guest_phone : "") + (r.guest_phone && r.guest_email ? "<br>" : "") +
        (r.guest_email ? '<span class="muted">' + r.guest_email + "</span>" : "");
      tr.appendChild(tdContact);

      var tdType = document.createElement("td");
      tdType.innerHTML = '<span class="type-badge">' + (TYPE_LABELS[r.stay_type] || r.stay_type_label || r.stay_type || "—") + "</span>";
      tr.appendChild(tdType);

      var tdDate = document.createElement("td");
      tdDate.textContent = fmtDate(r.check_in);
      tr.appendChild(tdDate);

      var tdParty = document.createElement("td");
      var kids = (r.children_6_12 || 0) + (r.children_0_5 || 0);
      tdParty.textContent = (r.adults || 0) + " adult" + (r.adults === 1 ? "" : "s") + (kids ? ", " + kids + " kid" + (kids === 1 ? "" : "s") : "");
      tr.appendChild(tdParty);

      var tdStatus = document.createElement("td");
      var statusBadge = document.createElement("span");
      statusBadge.className = "status-badge status-" + r.status;
      statusBadge.textContent = STATUS_LABELS[r.status] || r.status;
      statusBadge.addEventListener("click", function () {
        var idx = STATUS_ORDER.indexOf(r.status);
        var next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
        r.status = next;
        statusBadge.className = "status-badge status-" + next;
        statusBadge.textContent = STATUS_LABELS[next];
        updateField(r.id, "status", next, statusBadge);
      });
      tdStatus.appendChild(statusBadge);
      tr.appendChild(tdStatus);

      var tdSource = document.createElement("td");
      tdSource.innerHTML = '<span class="source-badge">' + (SOURCE_LABELS[r.source] || r.source || "Website") + "</span>";
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

  // ---------- add booking modal ----------
  var addBtn = document.getElementById("addBtn");
  var addModalBackdrop = document.getElementById("addModalBackdrop");
  var addForm = document.getElementById("addForm");
  var cancelAddBtn = document.getElementById("cancelAddBtn");

  function openModal() { addModalBackdrop.classList.add("open"); }
  function closeModal() { addModalBackdrop.classList.remove("open"); addForm.reset(); }

  addBtn.addEventListener("click", openModal);
  cancelAddBtn.addEventListener("click", closeModal);
  addModalBackdrop.addEventListener("click", function (e) { if (e.target === addModalBackdrop) closeModal(); });

  addForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var type = document.getElementById("addType").value;
    var payload = {
      status: "pending",
      source: document.getElementById("addChannel").value,
      stay_type: type,
      stay_type_label: TYPE_LABELS[type],
      check_in: document.getElementById("addDate").value || null,
      adults: parseInt(document.getElementById("addAdults").value || "0", 10),
      children_6_12: parseInt(document.getElementById("addKids").value || "0", 10),
      children_0_5: 0,
      guest_name: document.getElementById("addName").value,
      guest_phone: document.getElementById("addPhone").value || null,
      guest_email: document.getElementById("addEmail").value || null,
      notes: document.getElementById("addNotes").value || null,
    };
    sb.from("booking_requests").insert([payload]).then(function (res) {
      if (res.error) {
        alert("Couldn't save this booking: " + res.error.message);
        return;
      }
      closeModal();
      loadBookings();
    });
  });

  // ---------- CSV export (currently filtered/visible rows) ----------
  document.getElementById("exportBtn").addEventListener("click", function () {
    var rows = applyFilter(allRows);
    var headers = ["Guest", "Phone", "Email", "Type", "Preferred Date", "Adults", "Kids 6-12", "Kids 0-5", "Status", "Source", "Notes", "Staff Notes", "Received"];
    function csvCell(v) {
      v = v === null || v === undefined ? "" : String(v);
      return '"' + v.replace(/"/g, '""') + '"';
    }
    var lines = [headers.map(csvCell).join(",")];
    rows.forEach(function (r) {
      lines.push([
        r.guest_name, r.guest_phone, r.guest_email,
        TYPE_LABELS[r.stay_type] || r.stay_type, fmtDate(r.check_in),
        r.adults, r.children_6_12, r.children_0_5,
        STATUS_LABELS[r.status] || r.status, SOURCE_LABELS[r.source] || r.source,
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
})();
