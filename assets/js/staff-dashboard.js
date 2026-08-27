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
  };
  var SOURCE_LABELS = {
    website: "Website", messenger: "Messenger", phone: "Phone", email: "Email", walk_in: "Walk-in", other: "Other",
    sheet_import: "Imported (2026 Sheet)",
  };
  var STATUS_ORDER = ["pending", "pending_payment", "confirmed", "declined", "completed"];
  var STATUS_LABELS = {
    pending: "Pending", pending_payment: "Pending Payment", confirmed: "Confirmed",
    declined: "Declined", completed: "Completed",
  };
  // Actions the booking_audit_log trigger can record — see the SQL that
  // created log_booking_change() / log_cabana_change() for exactly how
  // and when each one is written.
  var LOG_ACTION_LABELS = {
    insert: "Booking created",
    update: "Booking edited",
    delete: "Booking deleted",
    cabana_added: "Cabana added",
    cabana_removed: "Cabana removed",
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
  var sortField = "created_at";
  var sortDir = "desc";
  var cabanasById = {};
  var addCabanaSelect = document.getElementById("addCabana");

  function loadCabanaOptions() {
    if (!window.VBRCabanaMap) return Promise.resolve([]);
    return window.VBRCabanaMap.loadCabanas(sb).then(function (cabanas) {
      cabanasById = {};
      cabanas.forEach(function (c) { cabanasById[c.id] = c; });
      if (addCabanaSelect) {
        var opts = ['<option value="">Not assigned yet</option>'];
        cabanas.forEach(function (c) {
          opts.push('<option value="' + c.id + '">' + c.label + "</option>");
        });
        addCabanaSelect.innerHTML = opts.join("");
      }
      return cabanas;
    });
  }

  function showDash() {
    loginScreen.style.display = "none";
    dashScreen.style.display = "block";
    logoutBtn.style.display = "inline-block";
    populateStaticFilterOptions();
    loadCabanaOptions().then(loadBookings);
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
  function loadBookingsPage(offset, acc) {
    return sb.from("booking_requests")
      .select("*, booking_cabanas(cabana_id)")
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
    loadBookingsPage(0, []).then(function (rows) {
      allRows = rows;
      populateBookedByOptions();
      render();
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

    return rows.filter(function (r) {
      var matchesFilter = true;
      if (activeFilter === "today") matchesFilter = isToday(r.check_in);
      else if (activeFilter === "week") matchesFilter = isThisWeek(r.check_in);
      else if (activeFilter === "month") matchesFilter = isThisMonth(r.check_in);
      else if (activeFilter === "unpaid") matchesFilter = isUnpaidStatus(r.status);
      else if (activeFilter === "imported") matchesFilter = r.source === "sheet_import";
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
      var hay = [r.guest_name, r.guest_email, r.guest_phone, r.notes, r.staff_notes, r.booked_by, r.order_code].join(" ").toLowerCase();
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

  function sortRows(rows) {
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

  document.querySelectorAll("th.sortable").forEach(function (th) {
    if (th.getAttribute("data-sort") === sortField) {
      th.classList.add("sort-active");
      th.querySelector(".sort-arrow").innerHTML = sortDir === "asc" ? "&#9652;" : "&#9662;";
    }
    th.addEventListener("click", function () {
      var field = th.getAttribute("data-sort");
      if (sortField === field) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortField = field;
        sortDir = field === "created_at" || field === "check_in" ? "desc" : "asc";
      }
      document.querySelectorAll("th.sortable").forEach(function (h) { h.classList.remove("sort-active"); });
      th.classList.add("sort-active");
      th.querySelector(".sort-arrow").innerHTML = sortDir === "asc" ? "&#9652;" : "&#9662;";
      render();
    });
  });

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
    var guests = 0, paidTotal = 0, paidCount = 0, unpaidTotal = 0, unpaidCount = 0;
    rows.forEach(function (r) {
      guests += partyTotal(r);
      var amt = r.total_amount != null ? Number(r.total_amount) : 0;
      if (isPaidStatus(r.status)) { paidTotal += amt; paidCount++; }
      else if (isUnpaidStatus(r.status)) { unpaidTotal += amt; unpaidCount++; }
    });
    summaryBar.innerHTML =
      '<div class="summary-tile"><div class="summary-label">Bookings Shown</div><div class="summary-value">' + rows.length + '</div></div>' +
      '<div class="summary-tile"><div class="summary-label">Total Guests</div><div class="summary-value">' + guests + '</div></div>' +
      '<div class="summary-tile paid"><div class="summary-label">Total Paid</div><div class="summary-value">' + peso(paidTotal) + '</div><div class="summary-sub">' + paidCount + " confirmed/completed</div></div>" +
      '<div class="summary-tile unpaid"><div class="summary-label">Total Unpaid</div><div class="summary-value">' + peso(unpaidTotal) + '</div><div class="summary-sub">' + unpaidCount + " pending</div></div>";
  }

  // A booking can include more than one cabana. Shows each as a small
  // removable chip plus a dropdown to add another — every change writes
  // straight to the booking_cabanas join table.
  function renderCabanaCell(td, r) {
    td.innerHTML = "";
    td.className = "cabana-cell";
    var assignedIds = (r.booking_cabanas || []).map(function (bc) { return bc.cabana_id; });

    // Imported 2026-sheet rows never had a literal cabana number recorded —
    // only how many dining/lounge cabanas were used. Show that count as a
    // plain note when there's no real cabana link to display instead.
    if (!assignedIds.length && (r.legacy_dining_cabanas || r.legacy_lounge_cabanas)) {
      var legacyNote = document.createElement("div");
      legacyNote.className = "muted";
      legacyNote.style.fontSize = "0.82rem";
      var bits = [];
      if (r.legacy_dining_cabanas) bits.push(r.legacy_dining_cabanas + " dining");
      if (r.legacy_lounge_cabanas) bits.push(r.legacy_lounge_cabanas + " lounge");
      legacyNote.textContent = bits.join(", ") + " (from 2026 sheet)";
      td.appendChild(legacyNote);
    }

    var chipWrap = document.createElement("div");
    chipWrap.className = "cabana-cell-chips";
    assignedIds.forEach(function (id) {
      var c = cabanasById[id];
      var chip = document.createElement("span");
      chip.className = "cabana-mini-chip";
      chip.textContent = c ? c.label.replace(/^Section /, "") : "Unknown cabana";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "cabana-mini-remove";
      rm.textContent = "×";
      rm.setAttribute("aria-label", "Remove " + (c ? c.label : "cabana"));
      rm.addEventListener("click", function () {
        sb.from("booking_cabanas").delete().eq("booking_id", r.id).eq("cabana_id", id).then(function (res) {
          if (res.error) { alert("Couldn't remove cabana: " + res.error.message); return; }
          r.booking_cabanas = (r.booking_cabanas || []).filter(function (bc) { return bc.cabana_id !== id; });
          renderCabanaCell(td, r);
        });
      });
      chip.appendChild(rm);
      chipWrap.appendChild(chip);
    });
    td.appendChild(chipWrap);

    if (Object.keys(cabanasById).length) {
      var addSelect = document.createElement("select");
      addSelect.className = "cabana-add-select";
      var opts = ['<option value="">+ add cabana</option>'];
      Object.keys(cabanasById).forEach(function (id) {
        if (assignedIds.indexOf(id) === -1) {
          opts.push('<option value="' + id + '">' + cabanasById[id].label + "</option>");
        }
      });
      addSelect.innerHTML = opts.join("");
      addSelect.addEventListener("change", function () {
        var val = addSelect.value;
        if (!val) return;
        sb.from("booking_cabanas").insert([{ booking_id: r.id, cabana_id: val }]).then(function (res) {
          if (res.error) { alert("Couldn't add cabana: " + res.error.message); return; }
          r.booking_cabanas = (r.booking_cabanas || []).concat([{ cabana_id: val }]);
          renderCabanaCell(td, r);
        });
      });
      td.appendChild(addSelect);
    }
  }

  function renderPayCell(td, r) {
    td.innerHTML = "";
    if (r.payment_screenshot_path) {
      var viewLink = document.createElement("a");
      viewLink.className = "pay-link";
      viewLink.href = "#";
      viewLink.textContent = "View screenshot";
      viewLink.addEventListener("click", function (e) {
        e.preventDefault();
        sb.storage.from("payment-proofs").createSignedUrl(r.payment_screenshot_path, 3600).then(function (res) {
          if (res.data && res.data.signedUrl) window.open(res.data.signedUrl, "_blank");
        });
      });
      td.appendChild(viewLink);
      td.appendChild(document.createElement("br"));
    }
    if (r.senior_id_paths && r.senior_id_paths.length) {
      r.senior_id_paths.forEach(function (path, i) {
        var idLink = document.createElement("a");
        idLink.className = "pay-link";
        idLink.href = "#";
        idLink.textContent = "View senior ID" + (r.senior_id_paths.length > 1 ? " " + (i + 1) : "");
        idLink.addEventListener("click", function (e) {
          e.preventDefault();
          sb.storage.from("senior-ids").createSignedUrl(path, 3600).then(function (res) {
            if (res.data && res.data.signedUrl) window.open(res.data.signedUrl, "_blank");
          });
        });
        td.appendChild(idLink);
        td.appendChild(document.createElement("br"));
      });
    }
    var uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "pay-upload-btn";
    uploadBtn.textContent = r.payment_screenshot_path ? "Replace" : "Mark Paid (Upload)";
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    uploadBtn.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var status = document.createElement("span");
      status.className = "pay-uploading";
      status.textContent = "Uploading…";
      td.innerHTML = "";
      td.appendChild(status);
      var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      var path = "staff/" + r.id + "-" + Date.now() + "." + ext;
      sb.storage
        .from("payment-proofs")
        .upload(path, file, { contentType: file.type || "image/jpeg" })
        .then(function (res) {
          if (res.error) throw res.error;
          var patch = {
            payment_screenshot_path: path,
            payment_uploaded_at: new Date().toISOString(),
          };
          if (r.status === "pending" || r.status === "pending_payment") patch.status = "confirmed";
          return sb.from("booking_requests").update(patch).eq("id", r.id).then(function (res2) {
            if (res2.error) throw res2.error;
            Object.assign(r, patch);
          });
        })
        .then(function () {
          render();
        })
        .catch(function () {
          status.textContent = "Upload failed — try again.";
          setTimeout(function () { renderPayCell(td, r); }, 1500);
        });
    });
    td.appendChild(uploadBtn);
    td.appendChild(fileInput);
  }

  function render() {
    var filtered = applyFilter(allRows);
    renderSummary(filtered);
    var rows = sortRows(filtered);
    countLine.textContent = rows.length + " of " + allRows.length + " bookings shown";
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
      tdType.innerHTML = '<span class="type-badge">' + (TYPE_LABELS[r.stay_type] || r.stay_type_label || r.stay_type || "—") + "</span>";
      tr.appendChild(tdType);

      var tdBookedBy = document.createElement("td");
      tdBookedBy.className = "muted";
      tdBookedBy.textContent = r.booked_by || "—";
      tr.appendChild(tdBookedBy);

      var tdDate = document.createElement("td");
      tdDate.textContent = fmtDate(r.check_in);
      tr.appendChild(tdDate);

      var tdCabana = document.createElement("td");
      renderCabanaCell(tdCabana, r);
      tr.appendChild(tdCabana);

      var tdParty = document.createElement("td");
      var kids = (r.children_6_12 || 0) + (r.children_0_5 || 0);
      var partyText = (r.adults || 0) + " adult" + (r.adults === 1 ? "" : "s") + (kids ? ", " + kids + " kid" + (kids === 1 ? "" : "s") : "");
      if (r.senior_count) partyText += " (incl. " + r.senior_count + " senior)";
      if (r.pet_count) partyText += ", " + r.pet_count + " pet" + (r.pet_count === 1 ? "" : "s");
      tdParty.textContent = partyText;
      if (r.guest_names) tdParty.title = "Guests: " + r.guest_names;
      tr.appendChild(tdParty);

      var tdTotal = document.createElement("td");
      tdTotal.className = "col-total";
      tdTotal.textContent = peso(r.total_amount);
      if (r.total_amount != null) {
        tdTotal.title = "People: " + peso(r.subtotal_people) + (r.senior_discount ? " (incl. " + peso(r.senior_discount) + " senior discount)" : "") + " · Cabana(s): " + peso(r.cabana_total);
      }
      tr.appendChild(tdTotal);

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
        renderSummary(applyFilter(allRows));
      });
      tdStatus.appendChild(statusBadge);
      tr.appendChild(tdStatus);

      var tdPay = document.createElement("td");
      tdPay.className = "pay-cell";
      renderPayCell(tdPay, r);
      tr.appendChild(tdPay);

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

      var tdLog = document.createElement("td");
      var logBtnCell = document.createElement("button");
      logBtnCell.type = "button";
      logBtnCell.className = "log-btn";
      logBtnCell.title = "View activity log for this booking";
      logBtnCell.textContent = "🕘";
      logBtnCell.addEventListener("click", function () {
        openLogModal(r.id, (r.guest_name || "This booking") + (r.order_code ? " (" + r.order_code + ")" : ""));
      });
      tdLog.appendChild(logBtnCell);
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
    var cabanaIds = addCabanaSelect
      ? Array.prototype.filter.call(addCabanaSelect.options, function (o) { return o.selected && o.value; }).map(function (o) { return o.value; })
      : [];
    var payload = {
      status: "pending",
      source: document.getElementById("addChannel").value,
      stay_type: type,
      stay_type_label: TYPE_LABELS[type],
      check_in: document.getElementById("addDate").value || null,
      adults: parseInt(document.getElementById("addAdults").value || "0", 10),
      children_6_12: parseInt(document.getElementById("addKids").value || "0", 10),
      children_0_5: 0,
      senior_count: parseInt(document.getElementById("addSeniors").value || "0", 10),
      pet_count: parseInt(document.getElementById("addPets").value || "0", 10),
      booked_by: currentStaffName,
      guest_name: document.getElementById("addName").value,
      guest_phone: document.getElementById("addPhone").value || null,
      guest_email: document.getElementById("addEmail").value || null,
      notes: document.getElementById("addNotes").value || null,
    };
    // check_in/adults/etc. above are what the guest wants; created_at (the
    // actual date/time this row was entered into the system) is left unset
    // here on purpose — Postgres stamps it itself, off the server clock, the
    // moment the row lands, and that's the "Date Entered" the table + CSV
    // export and the activity log both key off of.
    sb.from("booking_requests").insert([payload]).select().then(function (res) {
      if (res.error) {
        alert("Couldn't save this booking: " + res.error.message);
        return;
      }
      var row = res.data && res.data[0];
      var attach = row && cabanaIds.length
        ? sb.from("booking_cabanas").insert(cabanaIds.map(function (id) { return { booking_id: row.id, cabana_id: id }; }))
        : Promise.resolve();
      Promise.resolve(attach).then(function () {
        closeModal();
        loadBookings();
      });
    });
  });

  // ---------- CSV export (currently filtered/visible rows) ----------
  document.getElementById("exportBtn").addEventListener("click", function () {
    var rows = sortRows(applyFilter(allRows));
    var headers = ["Order ID", "Guest", "Guest Names", "Phone", "Email", "Type", "Booked By", "Preferred Date", "Cabana(s)", "Adults", "Senior Citizens", "Kids 6-12", "Kids 0-5", "Pets", "Subtotal (People)", "Cabana Total", "Senior Discount", "Total", "Status", "Payment Proof", "Senior ID(s)", "Source", "How Heard", "Occasion", "Notes", "Staff Notes", "Date Entered"];
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
      lines.push([
        r.order_code, r.guest_name, r.guest_names || "", r.guest_phone, r.guest_email,
        TYPE_LABELS[r.stay_type] || r.stay_type, r.booked_by || "", fmtDate(r.check_in), cabanaLabels,
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
})();
