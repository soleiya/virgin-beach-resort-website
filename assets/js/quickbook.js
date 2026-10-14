/* Home page booking box: pick dates → straight into the booking page with
   them filled in (book-stay/ for casitas, book/ for day trips). */
(function () {
  "use strict";
  var form = document.getElementById("quickBook");
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var mode = "stay";
  try { if (localStorage.getItem("vbr.qb") === "day") mode = "day"; } catch (e) {}

  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fill(sel, from, to, val, suffix) {
    var h = "";
    for (var i = from; i <= to; i++) h += '<option value="' + i + '"' + (i === val ? " selected" : "") + ">" + i + (suffix ? suffix(i) : "") + "</option>";
    sel.innerHTML = h;
  }
  fill($("qbGuests"), 1, 20, 2, function (i) { return i === 1 ? " guest" : " guests"; });
  fill($("qbAdults"), 1, 40, 2);
  fill($("qbKids"), 0, 20, 0);

  var t = today();
  $("qbIn").min = t; $("qbDate").min = t; $("qbOut").min = addDays(t, 1);
  $("qbIn").addEventListener("change", function () {
    var a = $("qbIn").value;
    if (!a) return;
    $("qbOut").min = addDays(a, 1);
    if (!$("qbOut").value || $("qbOut").value <= a) $("qbOut").value = addDays(a, 1);
  });

  function setMode(m) {
    mode = m;
    Array.prototype.forEach.call(form.querySelectorAll(".qb-tab"), function (b) {
      var on = b.getAttribute("data-mode") === m;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    Array.prototype.forEach.call(form.querySelectorAll(".qb-fields"), function (f) { f.hidden = f.getAttribute("data-mode") !== m; });
    $("qbError").hidden = true;
    try { localStorage.setItem("vbr.qb", m); } catch (e) {}
  }
  form.querySelector(".qb-tabs").addEventListener("click", function (e) {
    var b = e.target.closest(".qb-tab");
    if (b) setMode(b.getAttribute("data-mode"));
  });
  setMode(mode);

  function fail(msg, el) {
    var err = $("qbError");
    err.textContent = msg;
    err.hidden = false;
    if (el) el.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var t = today();
    if (mode === "stay") {
      var a = $("qbIn").value, b = $("qbOut").value;
      if (!a || a < t) return fail("Pick your check-in date.", $("qbIn"));
      if (!b || b <= a) return fail("Pick a check-out date after check-in.", $("qbOut"));
      location.href = "book-stay/index.html?in=" + a + "&out=" + b + "&guests=" + $("qbGuests").value;
    } else {
      var d = $("qbDate").value;
      if (!d || d < t) return fail("Pick the date of your visit.", $("qbDate"));
      location.href = "book/index.html?date=" + d + "&adults=" + $("qbAdults").value + "&kids=" + $("qbKids").value;
    }
  });
})();
