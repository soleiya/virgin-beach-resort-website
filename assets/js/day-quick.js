/* Day Trip page: the booking box at the top (same look as the home page's
   villa box). Picking a date + party fills the booking form just below and
   takes the guest straight to the cabana map. */
(function () {
  "use strict";
  var box = document.getElementById("dayQuick");
  if (!box) return;
  var $ = function (id) { return document.getElementById(id); };
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); }
  function fill(sel, from, to, val) {
    var h = "";
    for (var i = from; i <= to; i++) h += '<option value="' + i + '"' + (i === val ? " selected" : "") + ">" + i + "</option>";
    sel.innerHTML = h;
  }
  var form = { date: $("checkIn"), adults: $("adults"), kids: $("kids612"), kids05: $("kids05") };
  fill($("dqAdults"), 1, 60, Math.max(1, parseInt(form.adults && form.adults.value, 10) || 2));
  fill($("dqKids"), 0, 30, parseInt(form.kids && form.kids.value, 10) || 0);
  fill($("dqKids05"), 0, 30, parseInt(form.kids05 && form.kids05.value, 10) || 0);
  $("dqDate").min = today();
  if (form.date && form.date.value) $("dqDate").value = form.date.value; // e.g. from the home page box

  function set(el, v) {
    if (!el || String(el.value) === String(v)) return;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  box.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = $("dqDate").value, err = $("dqError");
    if (!d || d < today()) { err.textContent = "Pick the date of your visit."; err.hidden = false; $("dqDate").focus(); return; }
    err.hidden = true;
    set(form.date, d);
    set(form.adults, $("dqAdults").value);
    set(form.kids, $("dqKids").value);
    set(form.kids05, $("dqKids05").value);
    var target = $("cabanaStep") && !$("cabanaStep").hidden ? $("cabanaStep") : $("planYourTrip");
    setTimeout(function () { target.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
  });
  // keep the box in step if the guest changes the date in the form
  if (form.date) form.date.addEventListener("change", function () { if (form.date.value) $("dqDate").value = form.date.value; });
})();
