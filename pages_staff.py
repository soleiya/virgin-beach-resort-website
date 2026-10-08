# -*- coding: utf-8 -*-
"""Standalone staff reservations dashboard — staff/index.html.
Not part of the public site (no nav link, no public header/footer). Gated by
a Supabase Auth login (shared staff account); reads/writes booking_requests
directly via the Supabase JS client, respecting the 'authenticated' RLS
policies set up in SETUP-BOOKING.md."""

import os

ROOT = os.path.dirname(os.path.abspath(__file__))


def v(rel):
    """Cache-busting version for an asset: a short hash of its contents.
    GitHub Pages lets browsers cache JS/CSS for a while, so without this staff
    keep running the old dashboard after an update. Re-run this script after
    editing any of these files and the ?v= changes automatically."""
    import hashlib
    with open(os.path.join(ROOT, rel), "rb") as fh:
        return hashlib.sha1(fh.read()).hexdigest()[:10]


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
<link rel="stylesheet" href="../assets/css/style.css?v=__V_CSS__">
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
  .status-expired { background: #ece7e1; color: #7a6f66; text-decoration: line-through; text-decoration-thickness: 1px; }
  .payby { display: block; font-size: 0.72rem; margin-top: 5px; color: var(--ink-soft); white-space: nowrap; }
  .payby.overdue { color: var(--rose, #9c4a3f); font-weight: 700; }
  /* ---------- cabana map planner ---------- */
  .modal.modal-planner { max-width: 1120px; }
  .planner-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 12px; }
  .planner-status { font-size: 0.88rem; padding: 10px 14px; border-radius: 10px; background: var(--lagoon-tint); margin-bottom: 12px; min-height: 20px; }
  .planner-status.is-pending { background: #fdf0dc; }
  .planner-confirm { display: none; gap: 8px; margin-top: 8px; }
  .planner-confirm.open { display: flex; }
  .planner-list { margin-top: 16px; max-height: 260px; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; }
  .planner-list table { min-width: 0; }
  .planner-list td, .planner-list th { padding: 8px 12px; font-size: 0.8rem; }
  .planner-list tr.is-source td { background: var(--lagoon-tint); }

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
  .modal.modal-booking { max-width: 860px; }
  .modal-map-status { font-size: 0.82rem; color: var(--ink-soft); margin: 0 0 10px; }
  .modal-map-selected { margin-top: 12px; font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .modal-map-selected .cabana-mini-chip { background: var(--lagoon-tint); }
  .modal .cabana-legend { margin-top: 12px; }
  .modal-error { color: var(--rose, #9c4a3f); font-size: 0.85rem; display: none; margin: 0; }
  .row-actions { display: flex; gap: 6px; }
  .status-badge.readonly { cursor: default; }
  .modal-pay-existing { font-size: 0.85rem; margin-bottom: 8px; }
  .modal-pay-existing a { color: var(--lagoon-deep); margin-right: 12px; }
  .modal-hint { font-size: 0.78rem; color: var(--ink-soft); margin: 6px 0 0; }
  .modal .modal-check { display: flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: 0; font-size: 0.88rem; font-weight: 600; color: var(--ink); margin: 6px 0 4px; cursor: pointer; }
  .modal .modal-check input { width: auto; }
  .modal .modal-check.is-disabled { color: var(--ink-soft); cursor: default; }
  .modal-bill { padding: 16px 18px; }
  .modal-bill .bill-total { font-size: 1.1rem; }
  .modal-bill .bill-row.discount span:last-child { color: var(--lagoon-deep); }
  .modal-bill .bill-note { font-size: 0.8rem; color: var(--ink-soft); margin: 10px 0 0; }
  .modal-bill .bill-note button { margin-left: 6px; }
  .modal input[readonly] { background: #e6dfd0; border-style: dashed; color: var(--ink-soft); cursor: not-allowed; }
  .modal-lock { font-size: 0.72rem; font-weight: 400; color: var(--ink-soft); text-transform: none; letter-spacing: 0; }

  /* ---------- villas (overnight) ---------- */
  .villa-chip { background: #e8e2f4 !important; }
  .modal.modal-villa { max-width: 900px; }
  .villa-pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
  .villa-pick-group { grid-column: 1 / -1; font-size: 0.7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-soft); font-weight: 700; margin-top: 6px; }
  .villa-opt { display: flex !important; align-items: flex-start; gap: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--sand); cursor: pointer; text-transform: none !important; letter-spacing: 0 !important; font-size: 0.84rem !important; color: var(--ink) !important; font-weight: 600 !important; margin: 0 !important; }
  .villa-opt input { width: auto !important; margin-top: 2px; }
  .villa-opt small { display: block; font-weight: 400; color: var(--ink-soft); font-size: 0.72rem; }
  .villa-opt.is-taken { opacity: .55; cursor: not-allowed; background: #f1e3df; }
  .villa-opt.is-on { border-color: var(--lagoon); background: var(--lagoon-tint); }
  .vg-row { display: grid; grid-template-columns: 26px 1fr 190px 30px; gap: 8px; align-items: center; margin-bottom: 6px; }
  .vg-row .vg-n { font-size: .75rem; color: var(--ink-soft); font-weight: 700; text-align: center; }
  .vg-row button { border: 1px solid var(--line); background: var(--surface); border-radius: 50%; width: 28px; height: 28px; cursor: pointer; }
  .vg-row.vg-missing input { border-color: #d6a06b; background: #fdf3e6; }
  .modal-subhead { font-family: var(--font-display); font-size: 1.02rem; margin: 18px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); }
  .cap-line { font-size: 0.82rem; padding: 8px 12px; border-radius: 8px; background: var(--sand-deep); margin-top: 8px; }
  .cap-line.over { background: #fbe4e4; color: #9b2c2c; font-weight: 700; }

  .modal.modal-cal { max-width: 1260px; width: 100%; }
  .cal-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; margin-bottom: 12px; }
  .cal-scroll { overflow: auto; border: 1px solid var(--line); border-radius: 10px; max-height: 64vh; }
  table.cal { border-collapse: separate; border-spacing: 0; min-width: 0; width: max-content; }
  table.cal th, table.cal td { border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); padding: 0; height: 40px; }
  table.cal thead th { position: sticky; top: 0; z-index: 2; background: var(--sand-deep); font-size: .68rem; text-transform: none; letter-spacing: 0; padding: 4px 2px; min-width: 64px; text-align: center; }
  table.cal thead th.we { background: #eadfc6; }
  table.cal thead th.peak { background: #f3d9b1; }
  table.cal thead th.today { box-shadow: inset 0 -3px 0 var(--lagoon); }
  table.cal th.unit { position: sticky; left: 0; z-index: 3; background: var(--surface); text-align: left; padding: 4px 10px; min-width: 150px; font-size: .78rem; text-transform: none; letter-spacing: 0; }
  table.cal th.unit small { display: block; color: var(--ink-soft); font-weight: 400; font-size: .68rem; }
  table.cal thead th.unit { z-index: 4; background: var(--sand-deep); }
  table.cal td.free { cursor: pointer; }
  table.cal td.free:hover { background: var(--lagoon-tint); }
  table.cal td.free.we { background: rgba(234,223,198,.35); }
  .cal-bk { margin: 3px 2px; height: 32px; border-radius: 6px; padding: 2px 8px; font-size: .72rem; line-height: 1.2; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; color: #fff; display: flex; flex-direction: column; justify-content: center; }
  .cal-bk small { opacity: .85; font-size: .64rem; }
  .cal-bk.st-pending { background: #c98a3a; }
  .cal-bk.st-pending_payment { background: #c0652a; }
  .cal-bk.st-confirmed { background: #1f7a72; }
  .cal-bk.st-completed { background: #7d7466; }
  .cal-bk.st-block { background: repeating-linear-gradient(45deg, #6b6559, #6b6559 6px, #7d776c 6px, #7d776c 12px); }
  .cal-bk.cont-l { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: 0; }
  .cal-bk.cont-r { border-top-right-radius: 0; border-bottom-right-radius: 0; margin-right: 0; }
  .cal-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: .76rem; color: var(--ink-soft); margin-top: 10px; }
  .cal-legend i { display: inline-block; width: 14px; height: 14px; border-radius: 4px; vertical-align: -2px; margin-right: 5px; }
  .cal-side { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
  @media (max-width: 760px) { .cal-side { grid-template-columns: 1fr; } .vg-row { grid-template-columns: 22px 1fr; } .vg-row select { grid-column: 2; } }
  .cal-panel { border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: var(--sand); }
  .cal-panel h3 { font-family: var(--font-display); font-size: 1rem; margin: 0 0 10px; }
  .peak-list { list-style: none; padding: 0; margin: 8px 0 0; max-height: 160px; overflow: auto; font-size: .82rem; }
  .peak-list li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--line); }
  .peak-list button { border: 0; background: none; color: #9b2c2c; cursor: pointer; }
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
        <span>Overnight &middot; Day Trip &middot; Corporate</span>
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
        <button class="pill" data-filter="overnight">Overnight</button>
        <button class="pill" data-filter="daytrip">Day Trips</button>
        <button class="pill" data-filter="imported">Imported (2026 Sheet)</button>
        <input class="search" id="searchBox" type="text" placeholder="Search guest, contact, notes&hellip;">
      </div>
      <div class="toolbar-right">
        <button class="btn-sm ghost" id="villaCalBtn">Villa Calendar</button>
        <button class="btn-sm ghost" id="plannerBtn">Cabana Map</button>
        <button class="btn-sm ghost" id="logBtn">Activity Log</button>
        <button class="btn-sm ghost" id="exportBtn">Export CSV</button>
        <button class="btn-sm primary" id="addVillaBtn">+ Villa Booking</button>
        <button class="btn-sm primary" id="addBtn">+ Day Trip Booking</button>
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
            <th class="sortable" data-sort="check_in">Date / Check-in<span class="sort-arrow">&#9662;</span></th>
            <th>Cabana / Villa</th>
            <th class="sortable" data-sort="party">Party<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="total_amount">Total<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="status">Status<span class="sort-arrow">&#9662;</span></th>
            <th>Payment</th>
            <th class="sortable" data-sort="source">Source<span class="sort-arrow">&#9662;</span></th>
            <th>Notes</th>
            <th>Staff Notes</th>
            <th class="sortable" data-sort="created_at">Date Entered<span class="sort-arrow">&#9662;</span></th>
            <th>Actions</th>
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
  <div class="modal modal-booking">
    <h2 id="bookingModalTitle">Add a Booking</h2>
    <p id="bookingModalSub" style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 20px;">For a request that came in outside the website — Messenger, phone, walk-in, etc.</p>
    <form id="addForm">
      <div class="modal-row three">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addChannel">Came in via</label>
          <select id="addChannel">
            <option value="messenger">Messenger</option>
            <option value="phone">Phone Call</option>
            <option value="email">Email</option>
            <option value="walk_in">Walk-in</option>
            <option value="website">Website</option>
            <option value="sheet_import">Imported (2026 Sheet)</option>
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
            <option value="other">Other / Add-on</option>
          </select>
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addStatus">Status</label>
          <select id="addStatus">
            <option value="pending">Pending</option>
            <option value="pending_payment">Pending Payment</option>
            <option value="confirmed">Confirmed</option>
            <option value="declined">Declined</option>
            <option value="completed">Completed</option>
            <option value="expired">Expired (unpaid)</option>
          </select>
        </div>
      </div>
      <div class="modal-row">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addName">Guest Name <span class="modal-lock" id="addNameLock" hidden>&middot; locked</span></label>
          <input id="addName" type="text" required>
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addBookedBy">Booked By <span class="modal-lock">&middot; locked</span></label>
          <input id="addBookedBy" type="text" readonly tabindex="-1">
        </div>
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
          <label for="addKids">Kids 6&ndash;12</label>
          <input id="addKids" type="number" min="0" value="0">
        </div>
      </div>
      <div class="modal-row three">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addKids05">Kids 0&ndash;5 <span class="modal-lock">&middot; free</span></label>
          <input id="addKids05" type="number" min="0" value="0">
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addSeniors">Senior Citizens / PWD</label>
          <input id="addSeniors" type="number" min="0" value="0">
          <p class="modal-hint">Counted within Adults &mdash; 20% off their own share.</p>
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addPets">Pets</label>
          <input id="addPets" type="number" min="0" max="2" value="0">
        </div>
      </div>
      <div class="modal-field">
        <label>Cabana(s)</label>
        <p class="modal-map-status" id="addMapStatus">Pick a preferred date to see which cabanas are free that day.</p>
        <div id="addCabanaMap"></div>
        <div class="modal-map-selected" id="addCabanaSelected"></div>
      </div>
      <div class="modal-field" id="addPricing">
        <label>Amount</label>
        <div id="addBill" class="bill-summary modal-bill"></div>
        <div class="modal-row three" id="addDiscountRow" style="margin:12px 0 0;">
          <div class="modal-field" style="margin-bottom:0;">
            <label for="addDiscountType">Discount</label>
            <select id="addDiscountType">
              <option value="">No discount</option>
              <option value="percent">Percent (%)</option>
              <option value="amount">Amount (&#8369;)</option>
            </select>
          </div>
          <div class="modal-field" style="margin-bottom:0;">
            <label for="addDiscountValue" id="addDiscountValueLabel">Value</label>
            <input id="addDiscountValue" type="number" min="0" step="0.01" disabled>
          </div>
          <div class="modal-field" style="margin-bottom:0;">
            <label for="addDiscountReason">Reason <span class="modal-lock">&middot; shown to guest</span></label>
            <input id="addDiscountReason" type="text" maxlength="80" placeholder="e.g. Repeat guest" disabled>
          </div>
        </div>
        <div class="modal-field" id="addManualTotalWrap" style="margin:12px 0 0;" hidden>
          <label for="addTotal">Total (&#8369;)</label>
          <input id="addTotal" type="number" min="0" step="0.01" placeholder="Enter the quoted amount">
          <p class="modal-hint" id="addManualTotalHint">No rate sheet for this booking type &mdash; enter the quoted amount.</p>
        </div>
      </div>
      <div class="modal-field">
        <label for="addNotes">Notes</label>
        <textarea id="addNotes" rows="3" placeholder="Anything from the conversation worth keeping"></textarea>
      </div>
      <div class="modal-field" id="addPaymentField">
        <label for="addPayFile">Payment Proof</label>
        <div id="addPayExisting" class="modal-pay-existing"></div>
        <input id="addPayFile" type="file" accept="image/*,application/pdf">
        <p class="modal-hint">Uploading a proof marks a Pending booking as Confirmed when you save.</p>
      </div>
      <div class="modal-field" id="addStaffNotesField">
        <label for="addStaffNotes">Staff Notes</label>
        <textarea id="addStaffNotes" rows="2"></textarea>
      </div>
      <label class="modal-check" id="addNotifyWrap"><input type="checkbox" id="addNotify" checked> <span id="addNotifyText">Email the guest a summary of these changes</span></label>
      <p class="modal-hint" id="addNotifyHint" hidden></p>
      <p class="modal-error" id="addError"></p>
      <div class="modal-actions">
        <button type="button" class="btn-sm ghost" id="cancelAddBtn">Cancel</button>
        <button type="submit" class="btn-sm primary" id="saveBookingBtn">Save Booking</button>
      </div>
    </form>
  </div>
</div>


<div class="modal-backdrop" id="villaModalBackdrop">
  <div class="modal modal-villa">
    <h2 id="villaModalTitle">New Villa Booking</h2>
    <p id="villaModalSub" style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 20px;">Overnight stay in one or more casitas. Priced from the same rate sheet as the website.</p>
    <form id="villaForm">
      <div class="modal-row three">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="vChannel">Came in via</label>
          <select id="vChannel">
            <option value="phone">Phone Call</option>
            <option value="messenger">Messenger</option>
            <option value="email">Email</option>
            <option value="walk_in">Walk-in</option>
            <option value="website">Website</option>
            <option value="booking_com">Booking.com</option>
            <option value="agoda">Agoda</option>
            <option value="cloudbeds">Cloudbeds (imported)</option>
            <option value="events">Wedding / Events</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="vStatus">Status</label>
          <select id="vStatus">
            <option value="pending">Pending</option>
            <option value="pending_payment">Pending Payment</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="declined">Declined / Cancelled</option>
            <option value="expired">Expired (unpaid)</option>
          </select>
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="vBookedBy">Booked By <span class="modal-lock">&middot; locked</span></label>
          <input id="vBookedBy" type="text" readonly tabindex="-1">
        </div>
      </div>
      <div class="modal-row three">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="vName">Primary Guest <span class="modal-lock" id="vNameLock" hidden>&middot; locked</span></label>
          <input id="vName" type="text" required>
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="vPhone">Phone</label>
          <input id="vPhone" type="text">
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="vEmail">Email</label>
          <input id="vEmail" type="text">
        </div>
      </div>

      <h3 class="modal-subhead">Stay</h3>
      <div class="modal-row three">
        <div class="modal-field" style="margin-bottom:0;"><label for="vIn">Check-in</label><input id="vIn" type="date" required></div>
        <div class="modal-field" style="margin-bottom:0;"><label for="vOut">Check-out</label><input id="vOut" type="date" required></div>
        <div class="modal-field" style="margin-bottom:0;"><label>Nights</label><input id="vNights" type="text" readonly tabindex="-1"></div>
      </div>
      <div class="modal-field">
        <label>Villa(s)</label>
        <p class="modal-hint" id="vAvailNote" style="margin:0 0 8px;">Set the dates to see which villas are free.</p>
        <div class="villa-pick" id="vPick"></div>
      </div>

      <h3 class="modal-subhead">Guests <span class="modal-lock">&middot; every guest is charged the meal package per night</span></h3>
      <label class="modal-check"><input type="checkbox" id="vPrimarySenior"> Primary guest is a Senior Citizen / PWD</label>
      <div id="vGuests" style="margin-top:8px;"></div>
      <button type="button" class="btn-sm ghost" id="vAddGuest">+ Add companion</button>
      <div class="cap-line" id="vCap" hidden></div>
      <div class="modal-row three" style="margin-top:14px;">
        <div class="modal-field" style="margin-bottom:0;"><label for="vPets">Pets</label><input id="vPets" type="number" min="0" max="2" value="0"></div>
        <div class="modal-field" style="margin-bottom:0;"><label for="vCountry">Country</label><input id="vCountry" type="text" value="Philippines"></div>
        <div class="modal-field" style="margin-bottom:0;"><label class="modal-check" style="margin-top:26px;"><input type="checkbox" id="vOverCap"> Allow over capacity</label></div>
      </div>

      <h3 class="modal-subhead">Add-ons</h3>
      <div class="villa-pick" id="vAddons"><span class="muted">Loading…</span></div>

      <h3 class="modal-subhead">Amount</h3>
      <label class="modal-check"><input type="checkbox" id="vOnline"> 3% Convenience Discount (website booking, paid by bank transfer)</label>
      <div id="vBill" class="bill-summary modal-bill"></div>
      <div class="modal-row three" style="margin:12px 0 0;">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="vDiscType">Discount</label>
          <select id="vDiscType"><option value="">No discount</option><option value="percent">Percent (%)</option><option value="amount">Amount (&#8369;)</option></select>
        </div>
        <div class="modal-field" style="margin-bottom:0;"><label for="vDiscValue">Value</label><input id="vDiscValue" type="number" min="0" step="0.01" disabled></div>
        <div class="modal-field" style="margin-bottom:0;"><label for="vDiscReason">Reason <span class="modal-lock">&middot; shown to guest</span></label><input id="vDiscReason" type="text" maxlength="80" disabled></div>
      </div>
      <label class="modal-check" id="vKeepWrap" hidden><input type="checkbox" id="vKeepTotal"> Keep the price agreed elsewhere: <input id="vKeepAmount" type="number" step="0.01" style="width:140px; margin-left:6px;"></label>

      <h3 class="modal-subhead">Notes &amp; payment</h3>
      <div class="modal-field"><label for="vNotes">Guest requests</label><textarea id="vNotes" rows="2"></textarea></div>
      <div class="modal-field"><label for="vStaffNotes">Staff Notes</label><textarea id="vStaffNotes" rows="2"></textarea></div>
      <div class="modal-field" id="vPayField">
        <label for="vPayFile">Payment Proof</label>
        <div id="vPayExisting" class="modal-pay-existing"></div>
        <input id="vPayFile" type="file" accept="image/*,application/pdf">
        <p class="modal-hint">Uploading a proof marks a Pending booking as Confirmed when you save (the guest gets the confirmation email).</p>
      </div>
      <label class="modal-check" id="vNotifyWrap"><input type="checkbox" id="vNotify"> <span id="vNotifyText">Email the guest</span></label>
      <p class="modal-error" id="vError"></p>
      <div class="modal-actions">
        <button type="button" class="btn-sm ghost" id="vLogBtn" hidden>Activity</button>
        <button type="button" class="btn-sm ghost" id="vCancel">Cancel</button>
        <button type="submit" class="btn-sm primary" id="vSave">Save Booking</button>
      </div>
    </form>
  </div>
</div>

<div class="modal-backdrop" id="villaCalBackdrop">
  <div class="modal modal-cal">
    <h2>Villa Calendar</h2>
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 14px;">All 18 casitas. Click a booking to open it, or an empty night to start a booking there. Weekend / peak nights are shaded.</p>
    <div class="cal-bar">
      <div class="filter-field"><label for="calStart">From</label><input type="date" id="calStart"></div>
      <div class="filter-field"><label for="calDays">Show</label>
        <select id="calDays"><option value="14">2 weeks</option><option value="21" selected>3 weeks</option><option value="31">1 month</option><option value="62">2 months</option></select>
      </div>
      <button class="btn-sm ghost" type="button" id="calPrev">&larr; Back</button>
      <button class="btn-sm ghost" type="button" id="calToday">Today</button>
      <button class="btn-sm ghost" type="button" id="calNext">Forward &rarr;</button>
      <span id="calStatus" class="modal-hint" style="margin-left:auto;"></span>
    </div>
    <div class="cal-scroll"><table class="cal" id="calTable"></table></div>
    <div class="cal-legend">
      <span><i style="background:#c98a3a"></i>Pending</span><span><i style="background:#c0652a"></i>Pending payment</span>
      <span><i style="background:#1f7a72"></i>Confirmed</span><span><i style="background:#7d7466"></i>Completed</span>
      <span><i style="background:#6b6559"></i>Blocked</span>
    </div>
    <div class="cal-side">
      <div class="cal-panel">
        <h3>Block a villa</h3>
        <p class="modal-hint" style="margin:0 0 8px;">For repairs, owner use, etc. Blocked nights can't be booked online or here.</p>
        <div class="modal-row" style="margin-bottom:8px;">
          <select id="blkVilla"></select>
          <input id="blkReason" type="text" placeholder="Reason, e.g. Roof repair">
        </div>
        <div class="modal-row" style="margin-bottom:8px;">
          <input id="blkIn" type="date"><input id="blkOut" type="date">
        </div>
        <button class="btn-sm primary" type="button" id="blkSave">Block these nights</button>
        <p class="modal-error" id="blkError"></p>
      </div>
      <div class="cal-panel">
        <h3>Peak dates <span class="modal-lock">&middot; charged the weekend rate</span></h3>
        <div class="modal-row" style="margin-bottom:8px;">
          <input id="peakDate" type="date"><input id="peakLabel" type="text" placeholder="e.g. Eve of All Saints' Day">
        </div>
        <button class="btn-sm ghost" type="button" id="peakAdd">Add peak night</button>
        <ul class="peak-list" id="peakList"></ul>
      </div>
    </div>
    <div class="modal-actions"><button type="button" class="btn-sm ghost" id="calClose">Close</button></div>
  </div>
</div>

<div class="modal-backdrop" id="plannerBackdrop">
  <div class="modal modal-planner">
    <h2>Cabana Map</h2>
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 16px;">See every cabana for a day and move parties around &mdash; e.g. to keep a large group together. Click a booked cabana to pick it up, then click a free cabana to move it there (or another booked cabana to swap the two).</p>
    <div class="planner-bar">
      <div class="filter-field">
        <label for="plannerDate">Date</label>
        <input type="date" id="plannerDate">
      </div>
      <button class="btn-sm ghost" type="button" id="plannerPrev">&larr; Prev day</button>
      <button class="btn-sm ghost" type="button" id="plannerToday">Today</button>
      <button class="btn-sm ghost" type="button" id="plannerNext">Next day &rarr;</button>
      <label class="modal-check" style="margin-left:auto;"><input type="checkbox" id="plannerNotify" checked> Email guests whose cabana is moved</label>
    </div>
    <div class="planner-status" id="plannerStatus"></div>
    <div class="planner-confirm" id="plannerConfirm">
      <button class="btn-sm primary" type="button" id="plannerConfirmBtn">Confirm move</button>
      <button class="btn-sm ghost" type="button" id="plannerCancelBtn">Cancel</button>
    </div>
    <div id="plannerMap"></div>
    <div class="planner-list">
      <table>
        <thead><tr><th>Guest</th><th>Order</th><th>Party</th><th>Cabana(s)</th><th>Status</th></tr></thead>
        <tbody id="plannerList"></tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn-sm ghost" id="closePlannerBtn">Close</button>
    </div>
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
<script src="../assets/js/booking-config.js?v=__V_CFG__"></script>
<script src="../assets/js/cabana-map.js?v=__V_MAP__"></script>
<script src="../assets/js/pricing.js?v=__V_PRICE__"></script>
<script src="../assets/js/staff-dashboard.js?v=__V_DASH__"></script>
<script src="../assets/js/staff-villas.js?v=__V_VILLAS__"></script>
</body>
</html>
"""

html = (html.replace("__V_CSS__", v("assets/css/style.css"))
            .replace("__V_CFG__", v("assets/js/booking-config.js"))
            .replace("__V_MAP__", v("assets/js/cabana-map.js"))
            .replace("__V_PRICE__", v("assets/js/pricing.js"))
            .replace("__V_DASH__", v("assets/js/staff-dashboard.js"))
            .replace("__V_VILLAS__", v("assets/js/staff-villas.js")))

os.makedirs(os.path.join(ROOT, "staff"), exist_ok=True)
with open(os.path.join(ROOT, "staff", "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print("wrote staff/index.html")
