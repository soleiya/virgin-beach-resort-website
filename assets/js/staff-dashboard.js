(function () {
  var cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || cfg.url.indexOf("YOUR-PROJECT-REF") !== -1) {
    document.getElementById("loginScreen").innerHTML =
      "<h2>Not connected yet</h2><p>This dashboard needs assets/js/booking-config.js filled in with your real Supabase project first — see SETUP-BOOKING.md.</p>";
    return;
  }

  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  var TYPE_LABELS = {
    day_trip: "Day Trip", corporate: "Corporate",
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

  var availDate = document.getElementById("availDate");
  var availStatus = document.getElementById("availStatus");
  var availMap = document.getElementById("availMap");

  function loadAvailability(dateStr) {
    if (!dateStr || !availMap || !window.VBRCabanaMap) return;
    availStatus.textContent = "Loading availability for " + dateStr + "…";
    Promise.all([
      window.VBRCabanaMap.loadCabanas(sb),
      sb.from("booking_requests")
        .select("guest_name,order_code,status,booking_cabanas(cabana_id)")
        .eq("check_in", dateStr)
        .neq("status", "declined"),
    ])
      .then(function (results) {
        var cabanas = results[0];
        var res = results[1];
        if (res.error) throw res.error;
        if (!cabanas.length) {
          availStatus.textContent = "No cabanas set up yet — run the Section 6 SQL in SETUP-BOOKING.md, then reload this page.";
          availMap.innerHTML = "";
          return;
        }
        var heldSet = new Set();
        var heldInfo = {};
        (res.data || []).forEach(function (row) {
          var note = (row.guest_name || "Guest") + " — " + (row.order_code || "no order ID") + " (" + (STATUS_LABELS[row.status] || row.status) + ")";
          (row.booking_cabanas || []).forEach(function (bc) {
            if (!bc.cabana_id) return;
            heldSet.add(bc.cabana_id);
            heldInfo[bc.cabana_id] = note;
          });
        });
        availStatus.textContent = (cabanas.length - heldSet.size) + " of " + cabanas.length + " cabanas open on " + dateStr + ". Hover a booked tile to see who has it.";
        window.VBRCabanaMap.render(availMap, {
          cabanas: cabanas,
          heldSet: heldSet,
          heldInfo: heldInfo,
          selectedIds: [],
          onSelect: function () {},
        });
      })
      .catch(function (err) {
        availStatus.textContent = "Couldn't load availability" + (err && err.message ? ": " + err.message : ".");
      });
  }

  if (availDate) {
    availDate.value = new Date().toISOString().slice(0, 10);
    availDate.addEventListener("change", function () { loadAvailability(availDate.value); });
  }

  function showDash() {
    loginScreen.style.display = "none";
    dashScreen.style.display = "block";
    logoutBtn.style.display = "inline-block";
    loadCabanaOptions().then(loadBookings);
    if (availDate) loadAvailability(availDate.value);
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
    sb.from("booking_requests")
      .select("*, booking_cabanas(cabana_id)")
      .order("created_at", { ascending: false })
      .then(function (res) {
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

  // A booking can include more than one cabana. Shows each as a small
  // removable chip plus a dropdown to add another — every change writes
  // straight to the booking_cabanas join table.
  function renderCabanaCell(td, r) {
    td.innerHTML = "";
    td.className = "cabana-cell";
    var assignedIds = (r.booking_cabanas || []).map(function (bc) { return bc.cabana_id; });

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
    var rows = applyFilter(allRows);
    countLine.textContent = rows.length + " of " + allRows.length + " bookings shown";
    if (!rows.length) {
      bookingsBody.innerHTML = '<tr class="empty-row"><td colspan="14">No bookings match this view.</td></tr>';
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
      guest_name: document.getElementById("addName").value,
      guest_phone: document.getElementById("addPhone").value || null,
      guest_email: document.getElementById("addEmail").value || null,
      notes: document.getElementById("addNotes").value || null,
    };
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
    var rows = applyFilter(allRows);
    var headers = ["Order ID", "Guest", "Guest Names", "Phone", "Email", "Type", "Preferred Date", "Cabana(s)", "Adults", "Senior Citizens", "Kids 6-12", "Kids 0-5", "Subtotal (People)", "Cabana Total", "Senior Discount", "Total", "Status", "Payment Proof", "Senior ID(s)", "Source", "How Heard", "Occasion", "Notes", "Staff Notes", "Received"];
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
      lines.push([
        r.order_code, r.guest_name, r.guest_names || "", r.guest_phone, r.guest_email,
        TYPE_LABELS[r.stay_type] || r.stay_type, fmtDate(r.check_in), cabanaLabels,
        r.adults, r.senior_count || 0, r.children_6_12, r.children_0_5,
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
})();
