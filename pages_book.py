# -*- coding: utf-8 -*-
from build import page, CLOUDBEDS_URL

body = f"""
<section class="page-hero" style="min-height:40vh;">
  <img src="../assets/images/aerial-extra-19.jpg" alt="Aerial view of Virgin Beach Resort">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Book Direct</span>
    <h1>Request Your Day Trip</h1>
    <p class="lede">Send us your preferred date and party size — our reservations team will confirm availability directly with you, no third-party booking site involved.</p>
  </div>
</section>

<section class="center" style="max-width:640px; margin:0 auto; padding-bottom:0;">
  <p class="prose">Booking an overnight stay instead? Reserve a casita directly through our booking engine.</p>
  <a class="btn btn-ghost mt-lg" href="{CLOUDBEDS_URL}">Book an Overnight Stay</a>
</section>

<section>
  <div class="wrap" style="max-width:760px;">
    <div id="bookingFormWrap">
      <form class="inquiry" id="bookingForm">
        <div>
          <label for="stayType">What are you booking?</label>
          <select id="stayType">
            <option value="day_trip">Day Trip (Full Day)</option>
            <option value="half_day">Half-day Tour</option>
            <option value="day_picnic">Day Picnic</option>
            <option value="corporate">Corporate Outing</option>
          </select>
        </div>

        <div>
          <label for="checkIn" id="checkInLabel">Preferred Date</label>
          <input id="checkIn" type="date" required>
        </div>

        <div id="cabanaStep" hidden>
          <label id="cabanaStepLabel">Choose your cabana</label>
          <p class="field-hint" id="cabanaHint">Pick a date above first — availability updates live for that day.</p>
          <div class="cabana-map-wrap">
            <div id="cabanaMapStatus" class="cabana-map-status">Pick a date to see availability.</div>
            <div id="cabanaMap"></div>
            <div id="cabanaSelectedNote" class="cabana-selected-note" hidden></div>
          </div>
          <input type="hidden" id="cabanaId" value="">
        </div>

        <div class="row-2" style="grid-template-columns:1fr 1fr 1fr;">
          <div><label for="adults">Adults</label><input id="adults" type="number" min="1" value="2" required></div>
          <div><label for="kids612">Kids (6&ndash;12)</label><input id="kids612" type="number" min="0" value="0"></div>
          <div><label for="kids05">Kids (0&ndash;5)</label><input id="kids05" type="number" min="0" value="0"></div>
        </div>

        <div class="row-2">
          <div><label for="guestName">Full Name</label><input id="guestName" type="text" required></div>
          <div><label for="guestPhone">Phone</label><input id="guestPhone" type="tel" required></div>
        </div>
        <div class="row-2">
          <div><label for="guestEmail">Email</label><input id="guestEmail" type="email" required></div>
          <div><label for="country">Country</label><input id="country" type="text"></div>
        </div>

        <div>
          <label for="hearAbout">How did you hear about us?</label>
          <select id="hearAbout">
            <option value="">Prefer not to say</option>
            <option value="facebook">Facebook / Instagram</option>
            <option value="google">Google Search</option>
            <option value="referral">Friend / Family Referral</option>
            <option value="repeat_guest">I've stayed before</option>
            <option value="travel_agent">Travel Agent</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label for="occasion">Any occasion we should know about?</label>
          <select id="occasion">
            <option value="">None in particular</option>
            <option value="birthday">Birthday</option>
            <option value="anniversary">Anniversary</option>
            <option value="team_building">Team Building / Company Outing</option>
            <option value="reunion">Reunion</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div><label for="notes">Anything else we should know?</label><textarea id="notes" placeholder="Special requests, occasion, group size details, etc."></textarea></div>

        <label class="field-hint" style="display:flex; align-items:flex-start; gap:8px; font-size:0.85rem;">
          <input type="checkbox" id="marketingOptIn" style="margin-top:3px;" checked>
          Send me occasional promos and updates from Virgin Beach Resort.
        </label>

        <button class="btn btn-primary" type="submit" id="submitBtn">Send Request</button>
        <p class="field-hint">This secures your request &mdash; it isn't confirmed until our team follows up with availability and payment details.</p>
      </form>
    </div>
    <div id="bookingStatus" class="form-status" hidden></div>
  </div>
</section>

<section class="band-tint center">
  <div class="wrap" style="max-width:560px; margin:0 auto;">
    <span class="eyebrow">Already booked?</span>
    <h2>Upload your payment screenshot</h2>
    <p class="prose mx-auto mt-lg">Paid already? Send us proof of payment using the Order ID from your confirmation email.</p>
    <a class="btn btn-ghost mt-lg" href="../pay/index.html">Upload Payment Proof</a>
  </div>
</section>

<section class="band-tint center">
  <div class="wrap" style="max-width:560px; margin:0 auto;">
    <span class="eyebrow">Prefer to talk?</span>
    <h2>Call or message us directly</h2>
    <p class="prose mx-auto mt-lg">Mobile: <a class="text-link" href="tel:+639177920712">+63 917 792 0712</a> &middot;
    Email: <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></p>
  </div>
</section>

<script src="https://unpkg.com/@supabase/supabase-js@2"></script>
<script src="../assets/js/booking-config.js"></script>
<script src="../assets/js/cabana-map.js"></script>
<script src="../assets/js/booking.js"></script>
"""

page("book/index.html", "Request Your Day Trip", "Request a Day Trip, Half-day Tour, Day Picnic, or Corporate outing directly with Virgin Beach Resort. Booking an overnight casita? That's handled through our booking engine.", body)
