# -*- coding: utf-8 -*-
"""Standalone staff reservations dashboard — staff/index.html.
Not part of the public site (no nav link, no public header/footer). Gated by
a Supabase Auth login (shared staff account); reads/writes booking_requests
directly via the Supabase JS client, respecting the 'authenticated' RLS
policies set up in SETUP-BOOKING.md."""

import os

ROOT = os.path.dirname(os.path.abspath(__file__))

html = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Reservations Dashboard · Virgin Beach Resort</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..600&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/css/style.css">
<style>
  body { background: var(--sand); min-height: 100vh; }
  .dash-wrap { max-width: 1280px; margin: 0 auto; padding: 28px 20px 80px; }

  .dash-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .dash-brand { display: flex; align-items: center; gap: 12px; }
  .dash-brand img { height: 38px; width: auto; }
  .dash-brand h1 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; margin: 0; }
  .dash-brand span { display: block; font-size: 0.78rem; color: var(--ink-soft); }
  #logoutBtn { display: none; }

  /* ---------- login ---------- */
  #loginScreen { max-width: 420px; margin: 8vh auto 0; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 36px 32px; }
  #loginScreen h2 { font-family: var(--font-display); font-size: 1.4rem; margin: 0 0 6px; }
  #loginScreen p { color: var(--ink-soft); font-size: 0.9rem; margin: 0 0 24px; }
  #loginScreen label { display: block; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); margin-bottom: 6px; }
  #loginScreen input { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--sand); font-family: var(--font-body); font-size: 0.95rem; margin-bottom: 16px; }
  #loginScreen input:focus { outline: 2px solid var(--lagoon); outline-offset: 1px; }
  #loginBtn { width: 100%; padding: 13px; border: none; border-radius: 10px; background: var(--lagoon); color: #fff; font-family: var(--font-body); font-weight: 700; font-size: 0.95rem; cursor: pointer; }
  #loginBtn:hover { background: var(--lagoon-deep); }
  #loginBtn:disabled { opacity: 0.6; cursor: default; }
  #loginError { color: var(--rose, #9c4a3f); font-size: 0.85rem; margin-top: 14px; display: none; }

  /* ---------- dashboard ---------- */
  #dashScreen { display: none; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 18px; }
  .toolbar-left { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .pill { border: 1px solid var(--line); background: var(--surface); color: var(--ink-soft); font-family: var(--font-body); font-size: 0.8rem; font-weight: 700; padding: 7px 15px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
  .pill.active { background: var(--lagoon); border-color: var(--lagoon); color: #fff; }
  input.search { border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-family: var(--font-body); font-size: 0.85rem; padding: 8px 14px; border-radius: 999px; min-width: 200px; }
  .toolbar-right { display: flex; gap: 10px; }
  .btn-sm { font-family: var(--font-body); font-weight: 700; font-size: 0.85rem; border: none; border-radius: 999px; padding: 10px 18px; cursor: pointer; white-space: nowrap; }
  .btn-sm.primary { background: var(--lagoon); color: #fff; }
  .btn-sm.primary:hover { background: var(--lagoon-deep); }
  .btn-sm.ghost { background: var(--surface); color: var(--ink); border: 1px solid var(--line); }
  .btn-sm.ghost:hover { background: var(--sand-deep); }

  /* ---------- filters ---------- */
  .filters-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin: -6px 0 18px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .filter-field { display: flex; flex-direction: column; gap: 4px; }
  .filter-field label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
  .filter-field select, .filter-field input[type="date"] { border: 1px solid var(--line); background: var(--sand); color: var(--ink); font-family: var(--font-body); font-size: 0.82rem; padding: 7px 10px; border-radius: 8px; }
  .filter-sep { width: 1px; align-self: stretch; background: var(--line); margin: 0 2px; }

  /* ---------- summary bar ---------- */
  .summary-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px; }
  .summary-tile { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); padding: 14px 16px; }
  .summary-tile .summary-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); font-weight: 700; margin-bottom: 4px; }
  .summary-tile .summary-value { font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; }
  .summary-tile .summary-sub { font-size: 0.72rem; color: var(--ink-soft); margin-top: 2px; }
  .summary-tile.paid .summary-value { color: var(--lagoon-deep); }
  .summary-tile.unpaid .summary-value { color: var(--rose, #9c4a3f); }

  /* ---------- sortable headers ---------- */
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover { color: var(--ink); }
  th.sortable .sort-arrow { display: inline-block; margin-left: 4px; opacity: 0.35; font-size: 0.7em; }
  th.sortable.sort-active .sort-arrow { opacity: 1; }
  .log-btn { border: 1px solid var(--line); background: var(--surface); color: var(--ink-soft); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 0.85rem; line-height: 1; }
  .log-btn:hover { background: var(--sand-deep); color: var(--ink); }

  /* ---------- activity log modal ---------- */
  .modal.modal-wide { max-width: 900px; }
  .log-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 16px; }
  .log-scroll { max-height: 55vh; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; }
  table.log-table { width: 100%; border-collapse: collapse; min-width: 640px; }
  table.log-table th { position: sticky; top: 0; background: var(--sand-deep); text-align: left; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); padding: 10px 12px; border-bottom: 1px solid var(--line); }
  table.log-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 0.82rem; vertical-align: top; }
  .log-change b { color: var(--ink-soft); }
  .log-booking-filter { font-size: 0.82rem; color: var(--ink-soft); margin-bottom: 12px; }
  .log-booking-filter a { color: var(--lagoon-deep); cursor: pointer; }

  .count-line { font-size: 0.82rem; color: var(--ink-soft); margin-bottom: 12px; }

  .table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
  table { border-collapse: collapse; width: 100%; min-width: 1080px; }
  thead th { text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-soft); font-weight: 700; padding: 12px 14px; border-bottom: 1px solid var(--line); background: var(--sand-deep); white-space: nowrap; position: sticky; top: 0; }
  tbody td { padding: 12px 14px; border-bottom: 1px solid var(--line); font-size: 0.86rem; vertical-align: top; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: var(--sand); }
  .col-guest { font-weight: 700; min-width: 130px; }
  .col-notes { min-width: 160px; color: var(--ink-soft); max-width: 220px; }
  .muted { color: var(--ink-soft); }
  td[data-editable="true"] { cursor: text; }
  td[data-editable="true"]:hover { background: var(--lagoon-tint); }
  td[data-editable="true"]:focus { outline: 2px solid var(--lagoon); outline-offset: -2px; background: var(--lagoon-tint); }

  .type-badge, .source-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; background: var(--sand-deep); color: var(--ink-soft); white-space: nowrap; }
  .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; cursor: pointer; white-space: nowrap; user-select: none; }
  .status-badge:before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .status-pending { background: var(--amber-tint, #f6e9d6); color: var(--amber, #b6752b); }
  .status-pending_payment { background: #fde3d0; color: #b1531d; }
  .status-confirmed { background: var(--lagoon-tint); color: var(--lagoon-deep); }
  .status-declined { background: var(--rose-tint, #f3e0dc); color: var(--rose, #9c4a3f); }
  .status-completed { background: var(--sand-deep); color: var(--ink-soft); }

  .empty-row td { text-align: center; padding: 48px 20px; color: var(--ink-soft); }
  .order-code { font-family: var(--font-body); font-weight: 700; font-size: 0.78rem; color: var(--ink-soft); white-space: nowrap; }
  .cabana-select { border: 1px solid var(--line); background: var(--sand); font-family: var(--font-body); font-size: 0.8rem; padding: 5px 8px; border-radius: 6px; min-width: 150px; }
  .cabana-cell { min-width: 170px; }
  .cabana-cell-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
  .cabana-mini-chip { display: inline-flex; align-items: center; gap: 5px; background: var(--sand-deep); border-radius: 999px; padding: 3px 4px 3px 10px; font-size: 0.76rem; white-space: nowrap; }
  .cabana-mini-remove { border: none; background: transparent; color: var(--ink-soft); width: 16px; height: 16px; border-radius: 50%; cursor: pointer; font-size: 0.85rem; line-height: 1; padding: 0; }
  .cabana-mini-remove:hover { background: var(--driftwood); color: #fff; }
  .cabana-add-select { border: 1px solid var(--line); background: var(--sand); font-family: var(--font-body); font-size: 0.76rem; padding: 4px 6px; border-radius: 6px; width: 100%; }
  .col-total { font-weight: 700; white-space: nowrap; }
  .pay-cell { min-width: 150px; }
  .pay-link { display: inline-block; font-size: 0.78rem; color: var(--lagoon-deep); margin-bottom: 6px; }
  .pay-upload-btn { font-family: var(--font-body); font-size: 0.75rem; font-weight: 700; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 5px 10px; cursor: pointer; white-space: nowrap; }
  .pay-upload-btn:hover { background: var(--sand-deep); }
  .pay-uploading { font-size: 0.76rem; color: var(--ink-soft); }

  /* ---------- add-booking modal ---------- */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(18,32,29,0.55); display: none; align-items: center; justify-content: center; z-index: 200; padding: 20px; }
  .modal-backdrop.open { display: flex; }
  .modal { background: var(--surface); border-radius: 16px; padding: 32px; max-width: 560px; width: 100%; max-height: 90vh; overflow-y: auto; }
  .modal h2 { font-family: var(--font-display); font-size: 1.3rem; margin: 0 0 20px; }
  .modal label { display: block; font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); margin-bottom: 6px; }
  .modal input, .modal select, .modal textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--sand); font-family: var(--font-body); font-size: 0.9rem; }
  .modal-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .modal-row.three { grid-template-columns: 1fr 1fr 1fr; }
  .modal-field { margin-bottom: 14px; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
  @media (max-width: 560px) { .modal-row, .modal-row.three { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<div class="dash-wrap">
  <div class="dash-head">
    <div class="dash-brand">
      <img src="../assets/brand/logo-mark.png" alt="">
      <div>
        <h1>Reservations Dashboard</h1>
        <span>Day Trip &middot; Corporate</span>
      </div>
    </div>
    <button class="btn-sm ghost" id="logoutBtn">Sign Out</button>
  </div>

  <div id="loginScreen">
    <h2>Staff Sign In</h2>
    <p>Use the shared reservations login. Ask the office if you don't have it.</p>
    <label for="loginEmail">Email</label>
    <input id="loginEmail" type="email" autocomplete="username">
    <label for="loginPassword">Password</label>
    <input id="loginPassword" type="password" autocomplete="current-password">
    <button id="loginBtn">Sign In</button>
    <p id="loginError"></p>
  </div>

  <div id="dashScreen">
    <div class="toolbar">
      <div class="toolbar-left" id="filterPills">
        <button class="pill active" data-filter="all">All</button>
        <button class="pill" data-filter="today">Today</button>
        <button class="pill" data-filter="week">This Week</button>
        <button class="pill" data-filter="month">This Month</button>
        <button class="pill" data-filter="unpaid">Unpaid</button>
        <button class="pill" data-filter="imported">Imported (2026 Sheet)</button>
        <input class="search" id="searchBox" type="text" placeholder="Search guest, contact, notes&hellip;">
      </div>
      <div class="toolbar-right">
        <button class="btn-sm ghost" id="logBtn">Activity Log</button>
        <button class="btn-sm ghost" id="exportBtn">Export CSV</button>
        <button class="btn-sm primary" id="addBtn">+ Add Booking</button>
      </div>
    </div>

    <div class="filters-row" id="filtersRow">
      <div class="filter-field">
        <label for="filterDateField">Date range applies to</label>
        <select id="filterDateField">
          <option value="check_in">Preferred / check-in date</option>
          <option value="created_at">Date entered</option>
        </select>
      </div>
      <div class="filter-field">
        <label for="filterDateFrom">From</label>
        <input type="date" id="filterDateFrom">
      </div>
      <div class="filter-field">
        <label for="filterDateTo">To</label>
        <input type="date" id="filterDateTo">
      </div>
      <div class="filter-sep"></div>
      <div class="filter-field">
        <label for="filterStatus">Status</label>
        <select id="filterStatus"><option value="">All statuses</option></select>
      </div>
      <div class="filter-field">
        <label for="filterType">Type</label>
        <select id="filterType"><option value="">All types</option></select>
      </div>
      <div class="filter-field">
        <label for="filterBookedBy">Booked by</label>
        <select id="filterBookedBy"><option value="">Anyone</option></select>
      </div>
      <div class="filter-field">
        <label for="filterSource">Source</label>
        <select id="filterSource"><option value="">All sources</option></select>
      </div>
      <div class="filter-field">
        <button class="btn-sm ghost" id="clearFiltersBtn" type="button">Clear Filters</button>
      </div>
    </div>

    <div class="summary-bar" id="summaryBar"></div>

    <p class="count-line" id="countLine">Loading&hellip;</p>

    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th class="sortable" data-sort="order_code">Order ID<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="guest_name">Guest<span class="sort-arrow">&#9662;</span></th>
            <th>Contact</th>
            <th class="sortable" data-sort="stay_type">Type<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="booked_by">Booked By<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="check_in">Preferred Date<span class="sort-arrow">&#9662;</span></th>
            <th>Cabana(s)</th>
            <th class="sortable" data-sort="party">Party<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="total_amount">Total<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="status">Status<span class="sort-arrow">&#9662;</span></th>
            <th>Payment</th>
            <th class="sortable" data-sort="source">Source<span class="sort-arrow">&#9662;</span></th>
            <th>Notes</th>
            <th>Staff Notes</th>
            <th class="sortable" data-sort="created_at">Date Entered<span class="sort-arrow">&#9662;</span></th>
            <th>Log</th>
          </tr>
        </thead>
        <tbody id="bookingsBody">
          <tr class="empty-row"><td colspan="16">Loading bookings&hellip;</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="addModalBackdrop">
  <div class="modal">
    <h2>Add a Booking</h2>
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 20px;">For a request that came in outside the website — Messenger, phone, walk-in, etc.</p>
    <form id="addForm">
      <div class="modal-row">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addChannel">Came in via</label>
          <select id="addChannel">
            <option value="messenger">Messenger</option>
            <option value="phone">Phone Call</option>
            <option value="email">Email</option>
            <option value="walk_in">Walk-in</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addType">Booking Type</label>
          <select id="addType">
            <option value="day_trip">Day Trip (Full Day)</option>
            <option value="half_day">Half-Day Trip</option>
            <option value="flash_sale">Flash Sale Day Trip</option>
            <option value="all_inclusive_family">All Inclusive — Family Package</option>
            <option value="all_inclusive_barkada">All Inclusive — Barkada Package</option>
            <option value="corporate">Corporate Outing</option>
          </select>
        </div>
      </div>
      <div class="modal-field">
        <label for="addName">Guest Name</label>
        <input id="addName" type="text" required>
      </div>
      <div class="modal-field">
        <label for="addCabana">Cabana(s) (optional)</label>
        <select id="addCabana" multiple size="4"><option value="">Not assigned yet</option></select>
        <p class="field-hint">Ctrl/Cmd-click (or tap each) to select more than one.</p>
      </div>
      <div class="modal-row">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addPhone">Phone</label>
          <input id="addPhone" type="text">
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addEmail">Email / Messenger name</label>
          <input id="addEmail" type="text">
        </div>
      </div>
      <div class="modal-row three">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addDate">Preferred Date</label>
          <input id="addDate" type="date">
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addAdults">Adults</label>
          <input id="addAdults" type="number" min="0" value="1">
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addKids">Kids</label>
          <input id="addKids" type="number" min="0" value="0">
        </div>
      </div>
      <div class="modal-row">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addSeniors">Senior Citizens</label>
          <input id="addSeniors" type="number" min="0" value="0">
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addPets">Pets</label>
          <input id="addPets" type="number" min="0" value="0">
        </div>
      </div>
      <div class="modal-field">
        <label for="addNotes">Notes</label>
        <textarea id="addNotes" rows="3" placeholder="Anything from the conversation worth keeping"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-sm ghost" id="cancelAddBtn">Cancel</button>
        <button type="submit" class="btn-sm primary">Save Booking</button>
      </div>
    </form>
  </div>
</div>

<div class="modal-backdrop" id="logModalBackdrop">
  <div class="modal modal-wide">
    <h2>Activity Log</h2>
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 20px;">Every booking created, edited, or removed by a signed-in staff member is recorded here automatically &mdash; nobody, including staff, can edit or delete an entry once it's logged.</p>
    <p id="logBookingFilter" class="log-booking-filter" style="display:none;"></p>
    <div class="log-filters">
      <div class="filter-field">
        <label for="logStaffFilter">Staff</label>
        <select id="logStaffFilter"><option value="">Anyone</option></select>
      </div>
      <div class="filter-field">
        <label for="logFrom">From</label>
        <input type="date" id="logFrom">
      </div>
      <div class="filter-field">
        <label for="logTo">To</label>
        <input type="date" id="logTo">
      </div>
      <div class="filter-field">
        <button class="btn-sm ghost" type="button" id="logRefreshBtn">Refresh</button>
      </div>
    </div>
    <div class="log-scroll">
      <table class="log-table">
        <thead>
          <tr><th>When</th><th>Staff</th><th>Action</th><th>Booking</th><th>What changed</th></tr>
        </thead>
        <tbody id="logBody"><tr><td colspan="5" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading&hellip;</td></tr></tbody>
      </table>
    </div>
    <p class="field-hint" style="margin-top:12px;">Showing the most recent 300 entries matching these filters.</p>
    <div class="modal-actions">
      <button type="button" class="btn-sm ghost" id="closeLogBtn">Close</button>
    </div>
  </div>
</div>

<script src="https://unpkg.com/@supabase/supabase-js@2"></script>
<script src="../assets/js/booking-config.js"></script>
<script src="../assets/js/cabana-map.js"></script>
<script src="../assets/js/staff-dashboard.js"></script>
</body>
</html>
"""

os.makedirs(os.path.join(ROOT, "staff"), exist_ok=True)
with open(os.path.join(ROOT, "staff", "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print("wrote staff/index.html")
