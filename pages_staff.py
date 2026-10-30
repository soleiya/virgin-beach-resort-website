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
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..600&family=Manrope:wght@400;500;600;700;800&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/css/style.css?v=__V_CSS__">
<link rel="stylesheet" href="../assets/css/staff-cloudbeds.css?v=__V_CBCSS__">
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
  .modal.web-modal { max-width: 1120px; }
  .web-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .web-stat { background: var(--sand-deep); border-radius: 10px; padding: 10px 12px; }
  .web-stat small { display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); }
  .web-stat b { font-size: 1.25rem; display: block; margin-top: 2px; }
  .web-stat span { font-size: 0.75rem; color: var(--ink-soft); }
  .web-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-bottom: 12px; }
  .web-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  table.web-table { min-width: 980px; }
  table.web-table tbody tr { cursor: pointer; }
  table.web-table tbody tr:hover td { background: var(--lagoon-tint, #eef6f5); }
  .web-sub { display: block; font-size: 0.72rem; color: var(--ink-soft); margin-top: 2px; }
  .codes-form { background: var(--sand-deep); border-radius: 12px; padding: 14px 16px 6px; }
  .codes-actions { margin-bottom: 10px; }
  .cab-assign { display: grid; gap: 8px; }
  /* ---- Day Trip Calendar (the sheet, upgraded) ---- */
  :root { --dc-ok-bg: #dcf0e5; --dc-ok: #146343; --dc-low-bg: #fbe8c2; --dc-low: #7f5200; --dc-full-bg: #f6d9d3; --dc-full: #9b2c2c;
          --dc-day: #f1e9d6; --dc-wk: #faf6ec; --dc-excl: #f8dfe3; --dc-excl-ink: #8e2340; --dc-new: #eaf5f2; --dc-hit: #fff3c9; --dc-today: #ddeeea; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --dc-ok-bg: #173327; --dc-ok: #7fd9ad; --dc-low-bg: #3a2e12; --dc-low: #f2c66d; --dc-full-bg: #3d1d1b; --dc-full: #f3a39a;
          --dc-day: #24231a; --dc-wk: #1f1e17; --dc-excl: #3a1d26; --dc-excl-ink: #f3a7bd; --dc-new: #1b2b28; --dc-hit: #3a3417; --dc-today: #1c2f2b; } }
  :root[data-theme="dark"] { --dc-ok-bg: #173327; --dc-ok: #7fd9ad; --dc-low-bg: #3a2e12; --dc-low: #f2c66d; --dc-full-bg: #3d1d1b; --dc-full: #f3a39a;
          --dc-day: #24231a; --dc-wk: #1f1e17; --dc-excl: #3a1d26; --dc-excl-ink: #f3a7bd; --dc-new: #1b2b28; --dc-hit: #3a3417; --dc-today: #1c2f2b; }
  .dt-viewbar { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; flex-wrap: wrap; }
  .dt-viewbar .hint { font-size: 0.78rem; color: var(--ink-soft); }
  .view-switch { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; background: var(--surface); }
  .view-switch button { border: 0; background: transparent; padding: 7px 16px; font: inherit; font-size: 0.82rem; font-weight: 700; cursor: pointer; color: var(--ink-soft); }
  .view-switch button.active { background: var(--lagoon); color: #fff; }
  #dashScreen.dt-cal #filterPills, #dashScreen.dt-cal #filtersRow, #dashScreen.dt-cal #summaryBar, #dashScreen.dt-cal #countLine,
  #dashScreen.dt-cal .table-scroll, #dashScreen.dt-cal #cbList { display: none !important; }
  .dcal-panel { margin: 2px 0 0; padding: 0; }
  .dcal-top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 12px; border-bottom: 2px solid var(--lagoon); }
  .dcal-tabs { display: flex; flex-wrap: wrap; gap: 2px; }
  .dcal-tabs button { border: 1px solid var(--line); border-bottom: 0; background: var(--sand-deep); padding: 8px 12px 7px; border-radius: 8px 8px 0 0; font: inherit; font-size: 0.8rem; font-weight: 800; letter-spacing: .05em; cursor: pointer; color: var(--ink-soft); }
  .dcal-tabs button:hover { color: var(--ink); }
  .dcal-tabs button.active { background: var(--lagoon); color: #fff; border-color: var(--lagoon); }
  .dcal-tabs button .n { font-weight: 700; opacity: .8; margin-left: 5px; font-size: .7rem; letter-spacing: 0; }
  .dcal-tabs button.hit:not(.active) { background: var(--dc-hit); color: var(--ink); }
  .dcal-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-bottom: 7px; }
  .dcal-tools select, .dcal-tools input[type=search] { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; background: var(--surface); color: var(--ink); font: inherit; font-size: 0.84rem; width: auto; }
  .dcal-tools input[type=search] { min-width: 220px; }
  .dcal-chk { display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
  .dcal-chk input { width: auto; margin: 0; }
  .dcal-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin: 12px 0 10px; }
  .dcal-kpi { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 8px 10px; display: flex; flex-direction: column; min-width: 0; }
  .dcal-kpi span { font-size: 0.68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dcal-kpi b { font-size: 1.15rem; line-height: 1.3; white-space: nowrap; }
  .dcal-kpi b i { font-style: normal; font-size: .75rem; color: var(--ink-soft); }
  .dcal-kpi small { font-size: 0.7rem; color: var(--ink-soft); }
  .dcal-kpi.warn b { color: var(--dc-low); }
  .dcal-grid-wrap { margin: 0 0 8px; }
  .dcal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
  .dcal-grid .wd { font-size: 0.68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); text-align: center; padding: 2px 0; }
  .dcal-cell { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); padding: 5px 7px; min-height: 70px; cursor: pointer; text-align: left; font: inherit; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .dcal-cell:hover { border-color: var(--lagoon); }
  .dcal-cell.wkend { background: var(--dc-wk); }
  .dcal-cell.blank { visibility: hidden; }
  .dcal-cell.past { opacity: .55; }
  .dcal-cell.today { box-shadow: 0 0 0 2px var(--lagoon); }
  .dcal-cell.excl { background: var(--dc-excl); border-color: var(--dc-excl-ink); }
  .dcal-cell.hit { box-shadow: 0 0 0 2px #d6a400; }
  .dcal-cell.dim { opacity: .35; }
  .dcal-cell .dn { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; font-size: 0.86rem; font-weight: 800; }
  .dcal-cell .dn span { font-weight: 600; color: var(--ink-soft); font-size: 0.7rem; white-space: nowrap; }
  .dcal-cell .dn em { font-style: normal; font-size: 0.62rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--dc-excl-ink); }
  .dcal-cell .av { display: flex; gap: 3px; flex-wrap: wrap; }
  .dcal-cell .av b { font-size: 0.74rem; border-radius: 5px; padding: 1px 6px; font-weight: 800; white-space: nowrap; }
  .dcal-cell .bk { font-size: 0.68rem; color: var(--ink-soft); }
  .av .ok, .dcal-legend .ok, .pill-av.ok { background: var(--dc-ok-bg); color: var(--dc-ok); }
  .av .low, .dcal-legend .low, .pill-av.low { background: var(--dc-low-bg); color: var(--dc-low); }
  .av .full, .dcal-legend .full, .pill-av.full { background: var(--dc-full-bg); color: var(--dc-full); }
  .dcal-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.74rem; color: var(--ink-soft); margin-top: 6px; }
  .dcal-legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -2px; margin-right: 4px; }
  .dcal-legend i.ex { background: var(--dc-excl); border: 1px solid var(--dc-excl-ink); }
  .dcal-scroll { max-height: calc(100vh - 120px); overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
  .dcal-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .dcal-table th { position: sticky; top: 0; z-index: 3; background: var(--sand-deep); text-align: left; padding: 7px 8px; font-size: 0.68rem; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; border-bottom: 1px solid var(--line); }
  .dcal-table th.num { text-align: right; }
  .dcal-table th.cab-d, .dcal-table td.cab-d { box-shadow: inset 2px 0 0 var(--line); }
  .dcal-table td { padding: 6px 8px; border-top: 1px solid var(--line); vertical-align: top; }
  .dcal-table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .dcal-day td { background: var(--dc-day); border-top: 2px solid var(--ink-soft); padding: 6px 8px; position: sticky; top: 30px; z-index: 2; }
  .dcal-day.is-wkend td { background: var(--dc-day); }
  .dcal-day.is-today td { background: var(--dc-today); }
  .dcal-day.is-excl td { background: var(--dc-excl); }
  .dcal-day.flash td { animation: dcalFlash 1.4s ease-out; }
  @keyframes dcalFlash { 0%, 40% { background: var(--dc-hit); } }
  .dcal-dayhead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
  .dcal-date { font-size: 0.95rem; min-width: 98px; }
  .dcal-date b { font-size: 1.15rem; }
  .dcal-date span { color: var(--ink-soft); font-weight: 700; font-size: 0.8rem; text-transform: uppercase; letter-spacing: .05em; margin-left: 2px; }
  .dcal-day .is-wkend .dcal-date span, .dcal-day.is-wkend .dcal-date span { color: var(--dc-excl-ink); }
  .pill-av { display: inline-block; border-radius: 7px; padding: 3px 9px; font-size: 0.78rem; font-weight: 600; white-space: nowrap; }
  .pill-av b { font-weight: 800; }
  .pill-av.excl { background: var(--dc-excl-ink); color: #fff; font-weight: 800; }
  .dcal-day .dcal-cap { font-weight: 600; font-size: 0.8rem; color: var(--ink-soft); }
  .dcal-day .dcal-add { margin-left: auto; padding: 3px 12px; font-size: 0.76rem; }
  .dcal-row { cursor: pointer; }
  .dcal-row:hover td { background: var(--lagoon-tint); }
  .dcal-row.is-off td { color: var(--ink-soft); text-decoration: line-through; }
  .dcal-row.hit td { background: var(--dc-hit); }
  .dcal-row.is-web td:first-child { box-shadow: inset 3px 0 0 var(--lagoon); }
  .dcal-guest b { display: block; }
  .dcal-guest .muted, .dcal-cabno .muted { display: block; font-size: 0.72rem; }
  .dcal-tot td { background: var(--sand); font-weight: 800; font-size: 0.78rem; border-top: 1px solid var(--ink-soft); }
  .dcal-empty td { color: var(--ink-soft); font-style: italic; font-size: 0.8rem; }
  .linklike { border: 0; background: none; padding: 0; font: inherit; color: var(--lagoon); text-decoration: underline; cursor: pointer; font-style: normal; }
  .dcal-remarks { min-width: 160px; max-width: 280px; white-space: normal; color: var(--ink-soft); font-size: 0.78rem; }
  .dcal-cabno { white-space: nowrap; }
  .dcal-cabno .cab-tag { display: inline-block; background: var(--lagoon); color: #fff; border-radius: 6px; padding: 1px 6px; margin: 1px 2px 1px 0; font-weight: 700; font-size: 0.74rem; }
  .dcal-cabno .cab-tag.lounge { background: #c7832b; }
  .dcal-cabno button { font-size: 0.72rem; padding: 2px 8px; }
  .dcal-new td { background: var(--dc-new); vertical-align: top; }
  .dcal-new input, .dcal-new select { width: 100%; min-width: 0; border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; font: inherit; font-size: 0.8rem; background: var(--surface); color: var(--ink); margin: 0 0 3px; }
  .dcal-new input.n { width: 52px; text-align: right; }
  .dcal-new #dnName { min-width: 150px; font-weight: 700; }
  .dcal-new #dnTotal { width: 96px; text-align: right; }
  .dcal-new .acts { white-space: nowrap; }
  .dcal-new .err { color: var(--dc-full); font-size: 0.76rem; font-weight: 600; white-space: normal; max-width: 220px; margin-top: 4px; }
  @media (max-width: 900px) { .dcal-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 600px) { .dcal-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .dt-viewbar .hint { display: none; } }
  @media (max-width: 760px) { .dcal-cell { min-height: 56px; padding: 3px 4px; } .dcal-cell .av b { font-size: 0.62rem; padding: 0 3px; } .dcal-cell .bk { display: none; } .dcal-tools input[type=search] { min-width: 0; flex: 1; } }
  @media print {
    body * { visibility: hidden; }
    #dcalPanel, #dcalPanel * { visibility: visible; }
    #dcalPanel { position: absolute; inset: 0; }
    .dcal-tools, .dcal-cabno button, .dcal-day .btn-sm, .dcal-new, .dcal-grid-wrap { display: none !important; }
    .dcal-scroll { max-height: none; overflow: visible; border: 0; }
    .dcal-day td { position: static; }
  }
  .dimp-status { font-size: 0.88rem; margin: 10px 0; padding: 10px 12px; border-radius: 10px; background: var(--sand-deep); }
  .dimp-status.good { background: var(--dc-ok-bg); color: var(--dc-ok); }
  .dimp-status.bad { background: var(--dc-full-bg); color: var(--dc-full); }
  .dimp-steps { font-size: 0.84rem; color: var(--ink-soft); margin: 0 0 10px 18px; padding: 0; }
  .dimp-steps li { margin: 2px 0; }
  .dimp-tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin: 4px 0 10px; }
  .dimp-tiles .t { border: 1px solid var(--line); border-radius: 10px; padding: 8px; font-size: 0.72rem; color: var(--ink-soft); line-height: 1.25; }
  .dimp-tiles .t b { display: block; font-size: 1.2rem; color: var(--ink); }
  .dimp-tiles .add b { color: var(--dc-ok); } .dimp-tiles .rem b { color: var(--dc-full); } .dimp-tiles .upd b { color: var(--lagoon); }
  .dimp-list { border: 1px solid var(--line); border-radius: 10px; margin: 6px 0; padding: 6px 10px; font-size: 0.82rem; }
  .dimp-list summary { cursor: pointer; font-weight: 700; }
  .dimp-list ul { margin: 6px 0 2px; padding-left: 18px; max-height: 220px; overflow: auto; }
  .dimp-list.rem summary { color: var(--dc-full); }
  @media (max-width: 640px) { .dimp-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .dcal-pop { position: fixed; z-index: 1200; background: var(--surface, #fffdf8); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.18); padding: 12px; width: min(560px, calc(100vw - 24px)); max-height: 70vh; overflow: auto; }
  .dcal-pop-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
  .dcal-pop-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  .cab-assign-group { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
  .cab-assign-group h4 { font-size: 0.72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 6px; }
  .cab-assign-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .cab-chip { border: 1px solid var(--line); background: var(--sand); border-radius: 7px; padding: 3px 8px; font-size: 0.8rem; font-weight: 700; cursor: pointer; min-width: 36px; text-align: center; color: var(--ink); }
  .cab-chip.lounge { border-style: dashed; }
  .cab-chip.is-on { background: var(--lagoon, #1f7a72); color: #fff; border-color: transparent; }
  .cab-chip.is-taken { opacity: .38; cursor: not-allowed; text-decoration: line-through; }
  .cab-chip.is-blocked { background: repeating-linear-gradient(45deg, #eee, #eee 4px, #ddd 4px, #ddd 8px); color: #777; cursor: not-allowed; }
  .cd-h { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); margin: 6px 0 10px; font-weight: 700; }
  .cd-hint { font-size: 0.74rem; }
  .cd-types { display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .cd-types .modal-check { margin: 2px 0; font-weight: 500; }
  .codes-table .cd-cond { font-size: 0.78rem; color: var(--ink-soft); line-height: 1.4; }
  .code-st { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; }
  .code-st.on { background: #e3f4ec; color: #17694a; } .code-st.later { background: #e6eefb; color: #2350a0; }
  .code-st.expired, .code-st.off { background: #eef1f4; color: #4a5563; }
  .web-cb-ok { color: #17694a; font-weight: 700; }
  .web-cb-wait { color: #8a6d1a; font-weight: 700; }
  .web-cb-err { color: #b3261e; font-weight: 700; }
  .log-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 16px; }
  .log-scroll { max-height: 55vh; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; }
  table.log-table { width: 100%; border-collapse: collapse; min-width: 640px; }
  table.log-table th { position: sticky; top: 0; background: var(--sand-deep); text-align: left; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); padding: 10px 12px; border-bottom: 1px solid var(--line); }
  table.log-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 0.82rem; vertical-align: top; }
  .log-change b { color: var(--ink-soft); }
  .log-booking-filter { font-size: 0.82rem; color: var(--ink-soft); margin-bottom: 12px; }
  .log-booking-filter a { color: var(--lagoon-deep); cursor: pointer; }
  table.team-table { min-width: 0; }
  table.team-table td { font-size: 0.84rem; }
  table.team-table td:nth-child(n+2):nth-child(-n+4) { white-space: nowrap; }
  table.team-table tbody tr { cursor: pointer; }
  table.team-table tbody tr:hover, table.team-table tbody tr.is-selected { background: var(--lagoon-tint); }
  table.log-table th.num, table.log-table td.num { text-align: right; }
  .presence { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; background: #cfc6bb; vertical-align: 1px; }
  .presence.now { background: #2e9d6a; box-shadow: 0 0 0 3px rgba(46,157,106,.18); }
  .presence.today { background: #7fbf9c; }
  .presence.week { background: #e0b765; }
  .rel { display: block; font-size: 0.74rem; color: var(--ink-soft); margin-top: 2px; }
  .kind-pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; white-space: nowrap; background: var(--sand-deep); color: var(--ink-soft); }
  .kind-pill.k-active { background: var(--lagoon-tint); color: var(--lagoon-deep); }
  .kind-pill.k-open { background: #eef0e6; color: #5b6b3a; }
  .kind-pill.k-sign_in { background: #f6e9d6; color: #9a6421; }
  .kind-pill.k-change { background: #ece4f2; color: #6b4a85; }

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

  .origin-badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.68rem; font-weight: 800; letter-spacing: .02em; white-space: nowrap; margin-bottom: 3px; background: #eef1f4; color: #4a5563; }
  .origin-site_guest { background: #e3f4ec; color: #17694a; }
  .origin-site_staff { background: #e6eefb; color: #2350a0; }
  .origin-cloudbeds { background: #f3ecfb; color: #6a3aa8; }
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
  /* ---------- cabana blocks (under repair / unavailable / blocked) ---------- */
  .planner-block { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; background: #f6f3ee; }
  .planner-block-head { font-size: 0.86rem; margin-bottom: 10px; }
  .planner-block-head .muted { font-size: 0.8rem; margin-left: 6px; }
  .planner-block-fields { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 10px; }
  .planner-block-fields .grow { flex: 1 1 220px; }
  .planner-block-fields input[type="text"] { border: 1px solid var(--line); background: var(--sand); font-family: var(--font-body); font-size: 0.82rem; padding: 7px 10px; border-radius: 8px; width: 100%; }
  .planner-block-actions { display: flex; gap: 8px; margin-top: 10px; }
  .planner-blocks { margin-top: 16px; }
  .planner-blocks h4 { font-size: 0.86rem; margin: 0 0 8px; }
  .planner-blocks h4 .muted { font-weight: 400; font-size: 0.78rem; margin-left: 6px; }
  .planner-block-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 10px; max-height: 200px; overflow-y: auto; }
  .planner-block-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; font-size: 0.8rem; border-bottom: 1px solid var(--line); }
  .planner-block-list li:last-child { border-bottom: none; }
  .planner-block-list li.is-today { background: #f1ece3; }
  .planner-block-list li.muted { color: var(--ink-soft); justify-content: flex-start; }
  .block-reason { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; background: #6b6559; color: #fff; margin-right: 6px; white-space: nowrap; }
  .block-reason.r-under_repair { background: #9c4a3f; }
  .block-reason.r-unavailable { background: #7d6a3f; }
  .block-meta { display: block; color: var(--ink-soft); font-size: 0.72rem; margin-top: 2px; }
  .cabana-mini-chip.is-blocked-conflict { background: #f6dcd6; color: #7a2e24; }
  .planner-warn { display: block; margin-top: 6px; color: #7a2e24; font-weight: 600; }

  .more-row td { text-align: center; padding: 18px 14px; }
  .more-row .muted { font-size: 0.8rem; margin-left: 8px; }
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
  .modal.modal-booking, .modal.modal-villa { max-width: 1340px; }
  .bk-grid { display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 26px; align-items: start; }
  .bk-grid:has(.mail-wide) { grid-template-columns: minmax(0, 1fr) 660px; }
  .bk-mail { position: sticky; top: 0; }
  @media (max-width: 1120px) { .bk-grid, .bk-grid:has(.mail-wide) { grid-template-columns: 1fr; } .bk-mail { position: static; } }
  .mail-panel { border: 2px solid var(--lagoon); border-radius: 14px; background: var(--lagoon-tint); padding: 16px 16px 14px; }
  .mail-panel.is-off { background: var(--sand); border-color: var(--line); border-style: dashed; }
  .mail-head { display: flex; gap: 12px; align-items: flex-start; }
  .mail-ico { flex: none; width: 34px; height: 34px; border-radius: 50%; background: var(--lagoon); color: #fff; display: grid; place-items: center; font-size: 1rem; }
  .mail-panel.is-off .mail-ico { background: var(--ink-soft); }
  .mail-head h3 { font-family: var(--font-display); font-size: 1.12rem; margin: 2px 0 2px; }
  .mail-sub { font-size: 0.78rem; color: var(--ink-soft); margin: 0; }
  .mail-send { margin: 12px 0 4px; padding: 10px 12px; background: var(--surface); border-radius: 10px; }
  .mail-send .modal-check { margin: 0; font-size: 0.9rem; }
  .mail-send .modal-hint { margin-top: 6px; }
  .mail-body { margin-top: 12px; }
  .mail-field { margin-bottom: 10px; }
  .mail-tip { font-size: 0.7rem; font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--ink-soft); }
  .mail-panel textarea { resize: vertical; background: var(--surface) !important; line-height: 1.45; }
  .mail-panel input, .mail-panel select { background: var(--surface) !important; }
  .mail-preview-head { display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); margin: 4px 0 6px; }
  .mail-frame-wrap { position: relative; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #f4f1ea; }
  .mail-frame { display: block; width: 100%; height: 460px; border: 0; background: #f4f1ea; }
  .mail-wide .mail-frame { height: 72vh; }
  .mail-status { position: absolute; left: 0; right: 0; top: 0; padding: 8px 12px; font-size: 0.78rem; background: rgba(255,255,255,.92); color: var(--ink-soft); }
  .mail-status:empty { display: none; }
  /* Sections: Day Trips / Villas */
  .section-tabs { display: flex; gap: 6px; margin: 0 0 14px; border-bottom: 2px solid var(--line); }
  .sec-tab { appearance: none; border: 0; background: none; padding: 12px 20px 10px; font: 700 1rem var(--font-body); color: var(--ink-soft); cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; display: flex; align-items: center; gap: 8px; }
  .sec-tab:hover { color: var(--ink); }
  .sec-tab.active { color: var(--lagoon-deep); border-bottom-color: var(--lagoon); }
  .sec-count { font-size: 0.75rem; font-weight: 700; background: var(--sand-deep); color: var(--ink-soft); border-radius: 999px; padding: 2px 9px; }
  .sec-tab.active .sec-count { background: var(--lagoon-tint); color: var(--lagoon-deep); }
  .mode-villas .col-type { display: none; }
  td.col-total { cursor: pointer; }
  td.col-total .bd-link { display: block; font-size: 0.72rem; font-weight: 600; color: var(--lagoon-deep); margin-top: 3px; white-space: nowrap; }
  td.col-total:hover .bd-link { text-decoration: underline; }
  .bill-row .bd-qty { color: var(--ink-soft); font-size: 0.82rem; margin-left: 6px; white-space: nowrap; }
  .bill-sec { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); margin: 10px 0 2px; }
  .bill-sec:first-child { margin-top: 0; }
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
  .modal.modal-villa { max-width: 1340px; }
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
  .cal-bk.provisional { outline: 2px dashed rgba(255,255,255,0.85); outline-offset: -3px; opacity: 0.85; }
  .cb-sync { margin-left: auto; align-self: center; font-size: 0.8rem; color: var(--ink-soft); display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
  .cb-sync .btn-sm { padding: 3px 10px; font-size: 0.75rem; }
  .cb-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #2e9d6a; margin-right: 2px; }
  .cb-dot.bad { background: #c0573e; }
  .cb-warn { color: #a5462f; font-weight: 600; }
  .cb-test { background: #fff3cd; color: #7a5a00; border: 1px solid #f0d58a; border-radius: 999px; padding: 2px 10px; font-weight: 700; font-size: 0.72rem; letter-spacing: 0.03em; }
  .cb-link { font-size: 0.75rem; color: var(--teal, #1f7a72); text-decoration: none; white-space: nowrap; }
  .cb-link:hover { text-decoration: underline; }
  .cb-status { color: var(--ink-soft); }
  .pay-summary { margin-bottom: 4px; }
  .pay-bar { height: 8px; background: var(--line, #e6dccb); border-radius: 99px; overflow: hidden; margin-bottom: 10px; }
  .pay-bar span { display: block; height: 100%; background: #1f7a72; }
  .pay-figs { display: flex; flex-wrap: wrap; gap: 10px 28px; }
  .pay-figs small { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); }
  .pay-figs b { font-size: 1.1rem; }
  .pay-figs em { display: block; font-style: normal; font-size: 0.78rem; color: var(--ink-soft); }
  .pay-figs em.pay-ok { color: #1f7a72; font-weight: 700; }
  .pay-table .pay-amt { width: 120px; padding: 4px 6px; }
  .pay-table tr.pay-rejected td { opacity: 0.55; }
  .pay-st { font-size: 0.75rem; font-weight: 700; border-radius: 99px; padding: 2px 9px; }
  .pay-st-pending { background: #fff3cd; color: #7a5a00; }
  .pay-st-verified { background: #e2f3ee; color: #1f6b5c; }
  .pay-st-rejected { background: #f6e1dc; color: #9c4a3f; }
  .pay-record { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
  .pay-record h3 { font-size: 0.95rem; margin: 0 0 4px; }
  .pay-cell-fig { display: block; font-weight: 600; }
  .pay-open { display: inline-block; margin-top: 3px; font-size: 0.75rem; }
  .cb-copied { display: inline-block; margin-left: 6px; font-size: 0.72rem; background: #1f7a72; color: #fff; border-radius: 6px; padding: 2px 8px; }
  .cb-banner { background: #eef6f4; border: 1px solid #b9dcd5; color: #1d4b45; border-radius: 10px; padding: 10px 14px; font-size: 0.86rem; margin: -6px 0 16px; }
  .cb-banner a { color: #1f7a72; font-weight: 600; }
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
    <div class="section-tabs" role="tablist" id="sectionTabs">
      <button type="button" class="sec-tab active" role="tab" data-section="daytrip"><span class="sec-ico">☀</span> Day Trips <span class="sec-count" id="secCountDaytrip"></span></button>
      <button type="button" class="sec-tab" role="tab" data-section="villas"><span class="sec-ico">⌂</span> Villas <span class="sec-count" id="secCountVillas"></span></button>
      <div class="cb-sync" id="cbSync" data-section="villas" hidden></div>
    </div>
    <div class="toolbar">
      <div class="toolbar-left" id="filterPills">
        <button class="pill active" data-filter="all">All</button>
        <button class="pill" data-filter="today">Today</button>
        <button class="pill" data-filter="week">This Week</button>
        <button class="pill" data-filter="month">This Month</button>
        <button class="pill" data-filter="year">This Year</button>
        <button class="pill" data-filter="unpaid">Unpaid</button>
        <input class="search" id="searchBox" type="text" placeholder="Search guest, contact, notes&hellip;">
      </div>
      <div class="toolbar-right">
        <button class="btn-sm ghost" id="villaCalBtn" data-section="villas">Villa Calendar</button>
        <button class="btn-sm ghost" id="plannerBtn" data-section="daytrip">Cabana Map</button>
        <button class="btn-sm ghost" id="logBtn">Activity Log</button>
        <button class="btn-sm ghost" id="teamBtn">Team Activity</button>
        <button class="btn-sm ghost" id="webBtn">Website Bookings</button>
        <button class="btn-sm ghost" id="codesBtn">Discount Codes</button>
        <button class="btn-sm ghost" id="windowBtn">Booking Window</button>
        <button class="btn-sm ghost" id="exportBtn">Export CSV</button>
        <button class="btn-sm primary" id="addVillaBtn" data-section="villas">+ Villa Booking</button>
        <button class="btn-sm primary" id="addBtn" data-section="daytrip">+ Day Trip Booking</button>
      </div>
    </div>

    <div class="dt-viewbar" id="dtViewBar" data-section="daytrip">
      <div class="view-switch" id="dtViewSwitch" role="tablist" aria-label="Day trip view">
        <button type="button" role="tab" data-view="cal" class="active">&#128197; Calendar</button>
        <button type="button" role="tab" data-view="list">&#9776; List</button>
      </div>
      <span class="hint">Calendar: the Day Trip sheet, month by month, with cabanas left each day &middot; List: search and filter every booking</span>
    </div>

    <section class="dcal-panel" id="dcalPanel" data-section="daytrip" hidden>
      <div class="dcal-top">
        <div class="dcal-tabs" id="dcalTabs" role="tablist" aria-label="Month"></div>
        <div class="dcal-tools">
          <select id="dcalYear" aria-label="Year"></select>
          <button type="button" class="btn-sm ghost" id="dcalToday">Today</button>
          <input type="search" id="dcalSearch" placeholder="Find guest, booker, remarks&hellip;">
          <label class="dcal-chk"><input type="checkbox" id="dcalEmpty" checked> Empty days</label>
          <label class="dcal-chk"><input type="checkbox" id="dcalCancelled"> Cancelled</label>
          <button type="button" class="btn-sm ghost" id="dcalPrint">Print</button>
          <button type="button" class="btn-sm ghost" id="dcalImport" title="Bring the Day Trip Calendar .xlsx into the website">&#8679; Import from Sheet</button>
        </div>
      </div>
      <div class="dcal-kpis" id="dcalSum"></div>
      <div class="dcal-grid-wrap">
        <div class="dcal-grid" id="dcalGrid"></div>
        <div class="dcal-legend"><span><b>D</b> Dining &middot; <b>L</b> Lounge cabanas still free that day:</span><span><i class="ok"></i>plenty</span><span><i class="low"></i>few left (&le; 25%)</span><span><i class="full"></i>full</span><span><i class="ex"></i>exclusive booking</span><span>Click a day to jump to it.</span></div>
      </div>
      <div class="dcal-scroll">
        <table class="dcal-table">
          <thead><tr>
            <th>Booker</th><th>Guest</th><th class="num">Adult</th><th class="num">Kids</th><th class="num">0&ndash;5</th><th class="num">PWD | Sr</th><th class="num">Pet</th>
            <th class="num cab-d">Dining</th><th class="num">Lounge</th><th>Package</th><th class="num">Total</th><th>Status</th><th>Remarks</th><th title="Internal use only">Cabana no. <span style="font-weight:400;text-transform:none;letter-spacing:0;">(internal)</span></th>
          </tr></thead>
          <tbody id="dcalBody"></tbody>
        </table>
      </div>
    </section>

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
      <div class="filter-field" data-section="daytrip">
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
        <label for="filterOrigin">Made on</label>
        <select id="filterOrigin">
          <option value="">Anywhere</option>
          <option value="site">New website (guest + staff)</option>
          <option value="site_guest">Website · Guest</option>
          <option value="site_staff">Website · Staff</option>
          <option value="cloudbeds">Cloudbeds</option>
          <option value="sheet">Day Trip sheet</option>
        </select>
      </div>
      <div class="filter-field">
        <label for="filterLoadFrom">Bookings loaded</label>
        <select id="filterLoadFrom"></select>
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
            <th class="sortable" data-sort="order_code">Booking ID<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="guest_name">Guest<span class="sort-arrow">&#9662;</span></th>
            <th>Contact</th>
            <th class="sortable col-type" data-sort="stay_type">Type<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="booked_by">Booked By<span class="sort-arrow">&#9662;</span></th>
            <th class="sortable" data-sort="check_in"><span id="thDate">Date</span><span class="sort-arrow">&#9662;</span></th>
            <th id="thUnits">Cabana(s)</th>
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
      <div class="bk-grid"><div class="bk-main">
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
          <label for="addStatus">Status <span class="modal-lock" id="addStatusLock" hidden>&middot; new bookings start here</span></label>
          <select id="addStatus">
            <option value="pending">Confirmation Pending</option>
            <option value="pending_payment">Payment Under Review</option>
            <option value="confirmed">Confirmed</option>
            <option value="declined">Cancelled</option>
            <option value="completed">Completed</option>
            <option value="expired">Cancelled · payment not received</option>
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
      <div class="modal-row three" id="addCabanaCounts">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addDining">Dining cabanas</label>
          <input id="addDining" type="number" min="0" max="60" value="0">
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label for="addLounge">Lounge cabanas</label>
          <input id="addLounge" type="number" min="0" max="20" value="0">
        </div>
        <div class="modal-field" style="margin-bottom:0;">
          <label>Free that day</label>
          <p class="modal-hint" id="addCabanaLeft" style="margin-top:8px;">Pick a date</p>
        </div>
      </div>
      <div class="modal-field">
        <label>Cabana no. <span class="muted">(internal use only &mdash; for our records of who sat where; optional, assign any time)</span></label>
        <p class="modal-map-status" id="addMapStatus">Pick a date to see which cabanas are free that day.</p>
        <div id="addCabanaMap"></div>
        <div class="modal-map-selected" id="addCabanaSelected"></div>
        <label class="modal-check" style="margin-top:8px;"><input type="checkbox" id="addEmailCabNo"> Include the assigned cabana numbers in emails to the guest <span class="muted">(off = numbers stay hidden from the guest)</span></label>
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
        <select id="addPayPortion" style="margin-top:8px;"><option value="full">This proof is for the full payment</option><option value="deposit">This proof is for the 50% down payment</option><option value="balance">This proof is for the remaining balance</option></select>
        <p class="modal-hint">Saving records the payment as verified (it appears under Payments and, for villas, on the Cloudbeds folio) and confirms a pending booking.</p>
      </div>
      <div class="modal-field" id="addStaffNotesField">
        <label for="addStaffNotes">Staff Notes</label>
        <textarea id="addStaffNotes" rows="2"></textarea>
      </div>
      </div><aside class="bk-mail" id="addMail"></aside></div>
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
    <div class="cb-banner" id="vCbBanner" hidden></div>
    <form id="villaForm">
      <div class="bk-grid"><div class="bk-main">
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
          <label for="vStatus">Status <span class="modal-lock" id="vStatusLock" hidden>&middot; new bookings start here</span></label>
          <select id="vStatus">
            <option value="pending">Confirmation Pending</option>
            <option value="pending_payment">Confirmation Pending &middot; payment to verify</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Checked Out</option>
            <option value="declined">Canceled</option>
            <option value="expired">Canceled &middot; payment not received</option>
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
      <div class="modal-field v-code">
        <label for="vCode">Discount code <span class="muted">(optional)</span></label>
        <input id="vCode" type="text" autocomplete="off" spellcheck="false" maxlength="30" placeholder="e.g. EXCLUSIVE" style="text-transform:uppercase;">
        <p class="field-hint" id="vCodeMsg" hidden></p>
      </div>
      <div id="vBill" class="bill-summary modal-bill"></div>
      <div class="modal-row three" style="margin:12px 0 0;">
        <div class="modal-field" style="margin-bottom:0;">
          <label for="vDiscType">Discount</label>
          <select id="vDiscType"><option value="">No discount</option><option value="percent">Percent (%)</option><option value="amount">Amount (&#8369;)</option></select>
        </div>
        <div class="modal-field" style="margin-bottom:0;"><label for="vDiscValue">Value</label><input id="vDiscValue" type="number" min="0" step="0.01" disabled></div>
        <div class="modal-field" style="margin-bottom:0;"><label for="vDiscReason">Reason <span class="modal-lock">&middot; shown to guest</span></label><input id="vDiscReason" type="text" maxlength="80" disabled></div>
      </div>

      <h3 class="modal-subhead">Notes &amp; payment</h3>
      <div class="modal-field"><label for="vNotes">Guest requests</label><textarea id="vNotes" rows="2"></textarea></div>
      <div class="modal-field"><label for="vStaffNotes">Staff Notes</label><textarea id="vStaffNotes" rows="2"></textarea></div>
      <div class="modal-field" id="vPayField">
        <label for="vPayFile">Payment Proof</label>
        <div id="vPayExisting" class="modal-pay-existing"></div>
        <input id="vPayFile" type="file" accept="image/*,application/pdf">
        <select id="vPayPortion" style="margin-top:8px;"><option value="full">This proof is for the full payment</option><option value="deposit">This proof is for the 50% down payment</option><option value="balance">This proof is for the remaining balance</option></select>
        <p class="modal-hint">Saving records the payment as verified (Payments, and the Cloudbeds folio once live) and confirms a pending booking — the guest gets the confirmation email.</p>
      </div>
      </div><aside class="bk-mail" id="vMail"></aside></div>
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
        <p class="modal-hint" style="margin:0 0 8px;">For repairs, owner use, etc. Blocked nights can't be booked online or here. <b>Cloudbeds is the master:</b> block the room in Cloudbeds too, or OTAs can still sell it. Blocks made in Cloudbeds appear here automatically.</p>
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
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 16px;">See every cabana for a day and move parties around &mdash; e.g. to keep a large group together. Click a booked cabana to pick it up, then click a free cabana to move it there (or another booked cabana to swap the two). Use <b>Block cabanas</b> to take cabanas off sale (under repair, unavailable or blocked); click a blocked cabana to remove its block. <b>Cabana numbers are for internal use only</b> &mdash; a guest is emailed a move only if their booking has &ldquo;Include cabana numbers in emails&rdquo; ticked.</p>
    <div class="planner-bar">
      <div class="filter-field">
        <label for="plannerDate">Date</label>
        <input type="date" id="plannerDate">
      </div>
      <button class="btn-sm ghost" type="button" id="plannerPrev">&larr; Prev day</button>
      <button class="btn-sm ghost" type="button" id="plannerToday">Today</button>
      <button class="btn-sm ghost" type="button" id="plannerNext">Next day &rarr;</button>
      <button class="btn-sm ghost" type="button" id="plannerBlockBtn" title="Take cabanas off sale: under repair, unavailable or blocked">&#9940; Block cabanas&hellip;</button>
      <span class="muted" style="margin-left:auto;font-size:0.8rem;">Internal use only &mdash; guests aren&rsquo;t emailed unless their booking has cabana numbers in emails ticked</span>
    </div>
    <div class="planner-block" id="plannerBlockPanel" hidden>
      <div class="planner-block-head"><b>Block cabanas</b><span class="muted">Click cabanas on the map to pick them. Guests can't book them on these dates; the reason is only shown to staff.</span></div>
      <div class="planner-block-fields">
        <div class="filter-field">
          <label for="blkCabReason">Reason</label>
          <select id="blkCabReason">
            <option value="under_repair">Under repair</option>
            <option value="unavailable">Unavailable</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div class="filter-field"><label for="blkCabFrom">From</label><input type="date" id="blkCabFrom"></div>
        <div class="filter-field"><label for="blkCabTo">To (last day)</label><input type="date" id="blkCabTo"></div>
        <div class="filter-field grow"><label for="blkCabNote">Note (staff only, optional)</label><input type="text" id="blkCabNote" maxlength="200" placeholder="e.g. Roof leak, waiting for supplier"></div>
      </div>
      <div class="cabana-cell-chips" id="blkCabPicked"></div>
      <div class="planner-block-actions">
        <button class="btn-sm primary" type="button" id="blkCabSave">Block selected cabanas</button>
        <button class="btn-sm ghost" type="button" id="blkCabCancel">Cancel</button>
      </div>
      <p class="modal-error" id="blkCabError"></p>
    </div>
    <div class="planner-status" id="plannerStatus"></div>
    <div class="planner-confirm" id="plannerConfirm">
      <button class="btn-sm primary" type="button" id="plannerConfirmBtn">Confirm move</button>
      <button class="btn-sm ghost" type="button" id="plannerCancelBtn">Cancel</button>
    </div>
    <div id="plannerMap"></div>
    <div class="planner-list">
      <table>
        <thead><tr><th>Guest</th><th>Booking ID</th><th>Party</th><th>Cabana(s)</th><th>Status</th></tr></thead>
        <tbody id="plannerList"></tbody>
      </table>
    </div>
    <div class="planner-blocks">
      <h4>Blocked cabanas <span class="muted" id="plannerBlocksHint"></span></h4>
      <ul class="planner-block-list" id="plannerBlockList"></ul>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn-sm ghost" id="closePlannerBtn">Close</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="payModalBackdrop">
  <div class="modal modal-wide">
    <h2 id="payTitle">Payments</h2>
    <p id="paySub" style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 16px;"></p>
    <div id="paySummary" class="pay-summary"></div>
    <p class="field-hint" style="margin:6px 0 14px;">Guests pay <b>50% or 100% within 24 hours</b> to secure the booking; the <b>balance is due 15 days before arrival</b> (bookings made within 14 days pay 100%). Check each upload against the bank, then <b>Verify</b> it &mdash; the first verified payment confirms the booking and emails the confirmation; the one that completes the total emails &ldquo;fully paid&rdquo;.</p>
    <div class="log-scroll">
      <table class="log-table pay-table">
        <thead><tr><th>When</th><th>What</th><th class="num">Amount</th><th>Proof</th><th>Status</th><th></th></tr></thead>
        <tbody id="payRows"></tbody>
      </table>
    </div>
    <div class="pay-record">
      <h3>Record a payment</h3>
      <p class="field-hint" style="margin:0 0 8px;">Received another way (cash, card link, a transfer seen in the bank without an upload)? It counts as verified straight away.</p>
      <div class="modal-row">
        <input id="payRecAmount" type="number" step="0.01" min="0" placeholder="Amount (₱)">
        <select id="payRecKind"><option value="deposit">50% down payment</option><option value="full">Full payment</option><option value="balance">Balance</option><option value="other">Other</option></select>
        <select id="payRecMethod"><option value="transfer">Bank / e-wallet transfer</option><option value="link">Payment link (card / e-wallet)</option><option value="cash">Cash</option><option value="card">Card at the resort</option><option value="other">Other</option></select>
      </div>
      <div class="modal-row" style="margin-top:8px;">
        <input id="payRecNote" type="text" placeholder="Note (e.g. reference number)">
        <button type="button" class="btn-sm primary" id="payRecSave">Record payment</button>
      </div>
    </div>
    <p class="modal-error" id="payError"></p>
    <div class="modal-actions"><button type="button" class="btn-sm ghost" id="payClose">Close</button></div>
  </div>
</div>

<div class="modal-backdrop" id="webModalBackdrop">
  <div class="modal modal-wide web-modal">
    <h2>Website Bookings</h2>
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 16px;">Every booking made on the new website &mdash; by guests on the booking pages or by staff in this dashboard &mdash; newest first. Villas show whether they reached Cloudbeds.</p>
    <div class="web-stats" id="webStats"></div>
    <div class="web-filters">
      <div class="web-chips" id="webWho">
        <button type="button" class="pill active" data-who="">All</button>
        <button type="button" class="pill" data-who="site_guest">Guests</button>
        <button type="button" class="pill" data-who="site_staff">Staff</button>
      </div>
      <div class="web-chips" id="webKind">
        <button type="button" class="pill active" data-kind="">Villas &amp; day trips</button>
        <button type="button" class="pill" data-kind="villa">Villas</button>
        <button type="button" class="pill" data-kind="daytrip">Day trips</button>
      </div>
      <div class="filter-field">
        <label for="webDays">Made in the last</label>
        <select id="webDays"><option value="1">24 hours</option><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">12 months</option></select>
      </div>
      <button class="btn-sm ghost" type="button" id="webRefresh">Refresh</button>
    </div>
    <div class="log-scroll">
      <table class="log-table web-table">
        <thead>
          <tr><th>Made</th><th>Booking</th><th>Made by</th><th>Stay / trip</th><th class="num">Total</th><th>Status</th><th>Payment</th><th>Cloudbeds</th></tr>
        </thead>
        <tbody id="webBody"><tr><td colspan="8" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading&hellip;</td></tr></tbody>
      </table>
    </div>
    <p class="field-hint" style="margin-top:12px;">Click a booking to open it. Showing up to 500 bookings.</p>
    <div class="modal-actions">
      <button type="button" class="btn-sm ghost" id="webClose">Close</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="codesModalBackdrop">
  <div class="modal modal-wide web-modal">
    <h2>Discount Codes</h2>
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 16px;">Codes guests can enter when booking on the website (overnight stays and/or day trips; staff can enter them in the villa booking form too). A code is checked against the day the booking is made; bookings keep their discount even after a code expires or is switched off.</p>
    <form class="codes-form" id="codesForm" autocomplete="off">
      <h3 class="cd-h">The discount</h3>
      <div class="modal-row three">
        <div class="modal-field"><label for="cdCode">Code</label><input id="cdCode" type="text" maxlength="30" required placeholder="e.g. SUMMER25" style="text-transform:uppercase;"></div>
        <div class="modal-field"><label for="cdKind">Type</label>
          <select id="cdKind"><option value="percent">Percent off (%)</option><option value="fixed">Fixed amount off (&#8369;)</option></select></div>
        <div class="modal-field"><label for="cdAmount" id="cdAmountLabel">Percent off</label><input id="cdAmount" type="number" min="0.01" step="0.01" required placeholder="50"></div>
      </div>
      <div class="modal-row three">
        <div class="modal-field"><label for="cdApplies">Takes it off</label>
          <select id="cdApplies"><option value="rooms">Casita rates / cabana rental</option><option value="add_ons">Add-ons only (overnight)</option><option value="all">The whole booking</option></select></div>
        <div class="modal-field"><label>For</label>
          <label class="modal-check"><input type="checkbox" id="cdKOvernight" checked> Overnight stays</label>
          <label class="modal-check"><input type="checkbox" id="cdKDay"> Day trips</label></div>
        <div class="modal-field"><label for="cdMin">Minimum spend (&#8369;)</label><input id="cdMin" type="number" min="0" step="1" placeholder="0 = none"><span class="field-hint cd-hint">Casita charges for stays; the day-trip total for day trips</span></div>
      </div>
      <h3 class="cd-h">When it works</h3>
      <div class="modal-row three">
        <div class="modal-field"><label for="cdStart">Can be used from <span class="muted">(booking date)</span></label><input id="cdStart" type="date"></div>
        <div class="modal-field"><label for="cdEnd">Expires after <span class="muted">(blank = never)</span></label><input id="cdEnd" type="date"></div>
        <div class="modal-field"><label for="cdMinNights">Minimum nights <span class="muted">(stays)</span></label><input id="cdMinNights" type="number" min="0" step="1" placeholder="0 = any"></div>
      </div>
      <div class="modal-row three">
        <div class="modal-field"><label for="cdStayFrom">Stay / visit dates from</label><input id="cdStayFrom" type="date"></div>
        <div class="modal-field"><label for="cdStayTo">Stay / visit dates to</label><input id="cdStayTo" type="date"></div>
        <div class="modal-field"><span class="field-hint cd-hint" style="margin-top:24px;display:block;">Check-in (or day-trip) date must fall in this range. Blank = any date.</span></div>
      </div>
      <div class="modal-field" id="cdTypesWrap"><label>Only for these casitas <span class="muted">(stays; none ticked = all casitas)</span></label><div class="cd-types" id="cdTypes"><span class="muted">Loading&hellip;</span></div></div>
      <h3 class="cd-h">Limits</h3>
      <div class="modal-row three">
        <div class="modal-field"><label for="cdMaxUses">Maximum uses <span class="muted">(blank = unlimited)</span></label><input id="cdMaxUses" type="number" min="1" step="1" placeholder="e.g. 20"></div>
        <div class="modal-field"><label class="modal-check" style="margin-top:26px;"><input type="checkbox" id="cdOnce"> Once per guest email</label></div>
        <div class="modal-field"><label class="modal-check" style="margin-top:26px;"><input type="checkbox" id="cdActive" checked> Active</label></div>
      </div>
      <div class="modal-field"><label for="cdLabel">Description <span class="muted">(staff only)</span></label><input id="cdLabel" type="text" maxlength="200" placeholder="e.g. Rainy-season promo for partners"></div>
      <p class="form-error-box" id="cdError" style="display:none;"></p>
      <div class="codes-actions"><button type="submit" class="btn-sm primary" id="cdSave">Add code</button> <button type="button" class="btn-sm ghost" id="cdNew" hidden>New code</button></div>
    </form>
    <div class="log-scroll" style="margin-top:14px;">
      <table class="log-table web-table codes-table">
        <thead><tr><th>Code</th><th>Discount</th><th>For</th><th>Conditions</th><th>Valid</th><th>Status</th><th class="num">Used</th><th class="num">Discount given</th><th></th></tr></thead>
        <tbody id="codesBody"><tr><td colspan="9" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading&hellip;</td></tr></tbody>
      </table>
    </div>
    <div class="modal-actions"><button type="button" class="btn-sm ghost" id="codesClose">Close</button></div>
  </div>
</div>

<div class="modal-backdrop" id="dimpBackdrop">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dimpTitle" style="max-width: 760px">
    <div class="modal-head" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <h2 id="dimpTitle" style="margin:0">Import from the Day Trip Sheet</h2>
      <button type="button" class="btn-sm ghost" id="dimpClose" aria-label="Close">&times;</button>
    </div>
    <ol class="dimp-steps">
      <li>In Google Sheets, open <b>2026 Day Trip Calendar</b> &rarr; File &rarr; Download &rarr; Microsoft Excel (.xlsx).</li>
      <li>Pick that file below. You'll see what would change first &mdash; new bookings, updates, and rows taken off the sheet.</li>
      <li>Click <b>Apply changes</b>. Guests aren't emailed. Run it again any time the sheet changes; it only touches the sheet's own bookings.</li>
    </ol>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
      <div style="flex:1;min-width:240px"><label for="dimpFile">Sheet file (.xlsx)</label><input type="file" id="dimpFile" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
      <div><label for="dimpYear">Year of the sheet</label><select id="dimpYear"><option>2026</option><option>2027</option></select></div>
    </div>
    <div class="dimp-status" id="dimpStatus"></div>
    <div id="dimpResult"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button type="button" class="btn-sm ghost" id="dimpCancel">Close</button>
      <button type="button" class="btn-sm primary" id="dimpApply" disabled>Apply changes</button>
    </div>
  </div>
</div>

<div class="dcal-pop" id="dcalPop" hidden>
  <div class="dcal-pop-head"><strong id="dcalPopTitle"></strong><span class="muted" id="dcalPopSub"></span></div>
  <div class="cab-assign" id="dcalPopList"></div>
  <p class="modal-hint" id="dcalPopNote"></p>
  <div class="dcal-pop-actions"><button type="button" class="btn-sm ghost" id="dcalPopCancel">Cancel</button> <button type="button" class="btn-sm primary" id="dcalPopSave">Save &amp; email guest</button></div>
</div>

<div class="modal-backdrop" id="windowModalBackdrop">
  <div class="modal">
    <h2>Booking Window &amp; Cabanas</h2>
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 16px;">The last date guests can book on the website &mdash; overnight stays (last night) and day trips. Staff can still enter later bookings in the dashboard.</p>
    <div class="modal-field"><label for="bwUntil">Guests can book up to</label><input id="bwUntil" type="date"><span class="field-hint" id="bwInfo"></span></div>
    <div class="modal-row">
      <div class="modal-field"><label for="bwDining">Dining cabanas per day</label><input id="bwDining" type="number" min="0" max="200"></div>
      <div class="modal-field"><label for="bwLounge">Lounge cabanas per day</label><input id="bwLounge" type="number" min="0" max="50"></div>
    </div>
    <p class="field-hint" style="margin-top:-6px;">How many of each the website and the Day Trip Calendar count as available each day (before blocks and bookings).</p>
    <p class="form-error-box" id="bwError" style="display:none;"></p>
    <div class="modal-actions"><button type="button" class="btn-sm ghost" id="bwClose">Close</button> <button type="button" class="btn-sm primary" id="bwSave">Save</button></div>
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

<div class="modal-backdrop" id="teamModalBackdrop">
  <div class="modal modal-wide">
    <h2>Team Activity</h2>
    <p style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 20px;"><b>Last active</b> is the last time someone actually used the dashboard &mdash; not when they last typed their password (staff stay signed in for days, so &ldquo;last sign-in&rdquo; can be weeks old). Click a name to see their history.</p>
    <div class="log-scroll" style="max-height:none;">
      <table class="log-table team-table">
        <thead>
          <tr><th>Staff</th><th>Last active</th><th>Last signed in</th><th>Last booking change</th><th class="num" title="Days the dashboard was open, last 30 days">Days used<br>(30 d)</th><th class="num" title="Bookings created or edited, last 30 days">Changes<br>(30 d)</th></tr>
        </thead>
        <tbody id="teamBody"><tr><td colspan="6" style="padding:24px;text-align:center;color:var(--ink-soft);">Loading&hellip;</td></tr></tbody>
      </table>
    </div>
    <div class="log-filters" style="margin-top:22px;">
      <div class="filter-field">
        <label for="teamHistStaff">History for</label>
        <select id="teamHistStaff"><option value="">Everyone</option></select>
      </div>
      <div class="filter-field">
        <label for="teamHistDays">Period</label>
        <select id="teamHistDays"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select>
      </div>
      <div class="filter-field">
        <label for="teamHistKind">Show</label>
        <select id="teamHistKind"><option value="">Everything</option><option value="use">Dashboard use only</option><option value="sign_in">Sign-ins only</option><option value="change">Booking changes only</option></select>
      </div>
      <div class="filter-field">
        <button class="btn-sm ghost" type="button" id="teamRefreshBtn">Refresh</button>
      </div>
    </div>
    <div class="log-scroll">
      <table class="log-table">
        <thead><tr><th>When</th><th>Staff</th><th>What</th><th>Details</th></tr></thead>
        <tbody id="teamHistBody"></tbody>
      </table>
    </div>
    <p class="field-hint" style="margin-top:12px;">&ldquo;Using the dashboard&rdquo; is recorded from now on whenever someone clicks or types with the dashboard on screen. &ldquo;Dashboard open&rdquo; periods go further back: they come from the sign-in system, which renews each person's login about every hour while the dashboard is open in their browser.</p>
    <div class="modal-actions">
      <button type="button" class="btn-sm ghost" id="closeTeamBtn">Close</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="bdBackdrop">
  <div class="modal" style="max-width:620px;">
    <h2 id="bdTitle">Price breakdown</h2>
    <p id="bdSub" style="color:var(--ink-soft); font-size:0.85rem; margin:-10px 0 16px;"></p>
    <div id="bdBody" class="bill-summary modal-bill"></div>
    <p id="bdNote" class="modal-hint"></p>
    <div class="modal-actions">
      <button type="button" class="btn-sm ghost" id="bdEdit">Edit booking</button>
      <button type="button" class="btn-sm primary" id="bdClose">Close</button>
    </div>
  </div>
</div>

<script src="https://unpkg.com/@supabase/supabase-js@2"></script>
<script src="../assets/js/booking-config.js?v=__V_CFG__"></script>
<script src="../assets/js/cabana-map.js?v=__V_MAP__"></script>
<script src="../assets/js/pricing.js?v=__V_PRICE__"></script>
<script src="../assets/js/staff-dashboard.js?v=__V_DASH__"></script>
<script src="../assets/js/staff-email.js?v=__V_MAIL__"></script>
<script src="../assets/js/staff-villas.js?v=__V_VILLAS__"></script>
<script src="../assets/js/staff-payments.js?v=__V_PAYMENTS__"></script>
<script src="../assets/js/staff-activity.js?v=__V_ACT__"></script>
<script src="../assets/js/staff-website.js?v=__V_WEB__"></script>
<script src="../assets/js/staff-codes.js?v=__V_CODES__"></script>
<script src="../assets/js/staff-daycal.js?v=__V_DCAL__"></script>
<script src="../assets/js/staff-cloudbeds.js?v=__V_CBJS__"></script>
<script src="../assets/js/staff-cloudbeds-pages.js?v=__V_CBPAGES__"></script>
</body>
</html>
"""

html = (html.replace("__V_CSS__", v("assets/css/style.css"))
            .replace("__V_CFG__", v("assets/js/booking-config.js"))
            .replace("__V_MAP__", v("assets/js/cabana-map.js"))
            .replace("__V_PRICE__", v("assets/js/pricing.js"))
            .replace("__V_DASH__", v("assets/js/staff-dashboard.js"))
            .replace("__V_VILLAS__", v("assets/js/staff-villas.js"))
            .replace("__V_PAYMENTS__", v("assets/js/staff-payments.js"))
            .replace("__V_ACT__", v("assets/js/staff-activity.js"))
            .replace("__V_WEB__", v("assets/js/staff-website.js"))
            .replace("__V_CODES__", v("assets/js/staff-codes.js"))
            .replace("__V_DCAL__", v("assets/js/staff-daycal.js"))
            .replace("__V_MAIL__", v("assets/js/staff-email.js"))
            .replace("__V_CBCSS__", v("assets/css/staff-cloudbeds.css"))
            .replace("__V_CBJS__", v("assets/js/staff-cloudbeds.js"))
            .replace("__V_CBPAGES__", v("assets/js/staff-cloudbeds-pages.js")))

os.makedirs(os.path.join(ROOT, "staff"), exist_ok=True)
with open(os.path.join(ROOT, "staff", "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print("wrote staff/index.html")
