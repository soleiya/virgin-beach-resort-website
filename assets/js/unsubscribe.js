// Unsubscribe from offer emails (booking-v65): the link in every campaign email
// is /unsubscribe/?t=<token>; campaign_unsubscribe() adds the guest to
// campaign_optouts. Booking emails are not affected.
(function () {
  "use strict";
  var cfg = window.SUPABASE_CONFIG || {};
  var title = document.getElementById("unsubTitle"), msg = document.getElementById("unsubMsg");
  function show(t, m) { title.textContent = t; msg.textContent = m; }
  var tok = new URLSearchParams(location.search).get("t") || "";
  if (!/^[0-9a-f-]{36}$/i.test(tok)) { show("Unsubscribe", "This link is incomplete. Reply to any of our emails and we'll take you off the list."); return; }
  fetch(cfg.url + "/rest/v1/rpc/campaign_unsubscribe", {
    method: "POST",
    headers: { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: tok }),
  }).then(function (r) { return r.json(); }).then(function (r) {
    if (r && r.ok) show("You're unsubscribed", "We won't send offers to " + r.email + " anymore. Emails about your own bookings will still reach you.");
    else show("Link not recognised", "This unsubscribe link isn't valid anymore. Reply to any of our emails and we'll take you off the list.");
  }, function () { show("Something went wrong", "Please try again in a moment, or reply to any of our emails and we'll take you off the list."); });
})();
