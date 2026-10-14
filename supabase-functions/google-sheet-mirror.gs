/**
 * Virgin Beach Resort — Day Trip Calendar mirror (Google Apps Script)
 *
 * The website (staff dashboard) is where day trips are booked and edited.
 * This script copies every day trip into a Google Sheet laid out like the
 * 2026 Day Trip Calendar (one tab per month, JAN … DEC), every 5 minutes,
 * so anyone used to reading the sheet still sees everything.
 *
 * The sheet is a mirror: rows are rewritten on every run, so don't type
 * bookings into it — add or change them in the staff dashboard.
 *
 * One-time setup
 *   1. Create a new Google Sheet (e.g. "Day Trip Calendar — live from website").
 *   2. Extensions → Apps Script, paste this whole file, save.
 *   3. Project Settings (gear) → Script Properties → add
 *        VBR_TOKEN = the token from Supabase (SQL editor:
 *          select decrypted_secret from vault.decrypted_secrets where name = 'sheet_export_token';)
 *        VBR_YEAR  = 2026   (optional; defaults to the current year)
 *   4. Run `setup` once (Run ▸ setup) and allow access when Google asks.
 *      It fills the sheet and schedules itself every 5 minutes.
 */

var SUPABASE_URL = "https://dokscqjvqtyhecmbshqd.supabase.co";
// The public "anon" key (the same one the website uses — safe to share).
var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRva3NjcWp2cXR5aGVjbWJzaHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTQzNDksImV4cCI6MjEwMzA5MDM0OX0.DbnnSokdaT_4E48LvgxG5An-xqVKGnxKjAVGrR-YLvk";
var MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
var FIRST_ROW = 6; // data starts on row 6, like the original calendar
var HEADERS = ["Booked by", "Day", "Name",
  "Adult", "Kids", "PWD / Senior", "PWD child", "Pet", "Dining", "Lounge", "Family", "Barkada", "Add'l cabana",
  "Flash adult", "Flash kids",
  "Half-day adult", "Half-day kids", "Half-day senior", "Half-day PWD child", "Half-day pet", "Half-day dining", "Half-day lounge",
  "Others", "Total", "Remarks"]; // columns B … Z

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncDayTrips") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncDayTrips").timeBased().everyMinutes(5).create();
  syncDayTrips();
}

function syncDayTrips() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("VBR_TOKEN");
  if (!token) throw new Error("Add the VBR_TOKEN script property first (see the notes at the top).");
  var year = Number(props.getProperty("VBR_YEAR")) || new Date().getFullYear();
  var res = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/rpc/daytrip_sheet_rows", {
    method: "post",
    contentType: "application/json",
    headers: { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY },
    payload: JSON.stringify({ p_token: token, p_year: year }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("Supabase said " + res.getResponseCode() + ": " + res.getContentText());
  var rows = JSON.parse(res.getContentText()) || [];
  var ss = SpreadsheetApp.getActive();
  var stamp = Utilities.formatDate(new Date(), "Asia/Manila", "MMM d, yyyy h:mm a");
  MONTHS.forEach(function (name, i) {
    writeMonth(ss, name, year, rows.filter(function (r) { return r.month === i + 1; }), stamp);
  });
  var first = ss.getSheets()[0];
  if (first.getName() !== "JAN" && first.getName() !== "About") {
    var blank = ss.getSheetByName("Sheet1");
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  }
}

function n(v) { return v ? Number(v) : ""; }

function rowFor(r) {
  var half = r.kind === "half_day", flash = r.kind === "flash_sale";
  var full = !half && !flash;
  return [
    r.booker || "", r.day, r.name || "",
    full ? n(r.adults) : "", full ? n(r.kids) : "", full ? n(r.seniors) : "", "", full ? n(r.pets) : "",
    full ? n(r.dining) : "", full ? n(r.lounge) : "", n(r.family), n(r.barkada), "",
    flash ? n(r.adults + r.seniors) : "", flash ? n(r.kids) : "",
    half ? n(r.adults) : "", half ? n(r.kids) : "", half ? n(r.seniors) : "", "", half ? n(r.pets) : "",
    half ? n(r.dining) : "", half ? n(r.lounge) : "",
    n(r.others), r.total == null ? "" : Number(r.total), r.remarks || "",
  ];
}

function writeMonth(ss, name, year, list, stamp) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name, MONTHS.indexOf(name));
  var width = HEADERS.length; // B..Z
  // header
  sh.getRange(1, 2).setValue(name + " " + year + " — Day Trips").setFontWeight("bold").setFontSize(14);
  sh.getRange(2, 2).setValue("Live copy of the website bookings · updated " + stamp + " · add or change bookings in the staff dashboard, not here.")
    .setFontColor("#666666").setFontStyle("italic");
  sh.getRange(4, 5).setValue("FULL DAY").setFontWeight("bold");
  sh.getRange(4, 15).setValue("FLASH SALE").setFontWeight("bold");
  sh.getRange(4, 17).setValue("HALF DAY").setFontWeight("bold");
  sh.getRange(5, 2, 1, width).setValues([HEADERS]).setFontWeight("bold").setBackground("#e8f1ef").setWrap(true);
  sh.setFrozenRows(5);
  // data
  var last = Math.max(sh.getLastRow(), FIRST_ROW);
  sh.getRange(FIRST_ROW, 2, last - FIRST_ROW + 1, width).clearContent().setFontWeight("normal").setBackground(null);
  var values = list.map(rowFor);
  if (values.length) sh.getRange(FIRST_ROW, 2, values.length, width).setValues(values);
  // totals row
  var tr = FIRST_ROW + values.length + 1;
  var totals = ["TOTAL", "", values.length + " booking" + (values.length === 1 ? "" : "s")];
  for (var c = 5; c <= 25; c++) {
    var col = String.fromCharCode(64 + c);
    totals.push(values.length ? "=SUM(" + col + FIRST_ROW + ":" + col + (tr - 2) + ")" : 0);
  }
  totals.push("");
  sh.getRange(tr, 2, 1, width).setValues([totals]).setFontWeight("bold").setBackground("#f3efe6");
  sh.getRange(FIRST_ROW, 25, Math.max(values.length + 2, 1), 1).setNumberFormat("₱#,##0.00");
}
