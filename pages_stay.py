# -*- coding: utf-8 -*-
"""Book Your Stay — overnight casita booking (replaces Cloudbeds).

Guests pick dates, then how many of each casita type (live availability per
unit from Supabase), then list EVERY guest by name and age group — the
full-board meal package is charged per person per night, so the guest list is
mandatory and is what the price is calculated from. The bill shown is the
server's own quote_overnight() result, the same numbers the quotation email
and the staff dashboard use."""
from build import page, PET_POLICY_ITEMS, COUNTRIES, CASITAS, CASITA_RATES, asset_v

VILLA_IMG = {
    "deluxe-king-casita": "casita-king-exterior.jpg",
    "double-queen-casita": "casita-queen-exterior.jpg",
    "sunrise-casita": "sunrise-casita-exterior-day.jpg",
    "louver-window-casita": "casita-louver-exterior.jpg",
    "bamboo-king-casita": "bamboo-casita-day.jpg",
    "bamboo-casita": "bamboo-basita.jpg",
}
VILLA_BEDS = {
    "deluxe-king-casita": "King bed · bathtub · outdoor shower · 52 m²",
    "double-queen-casita": "2 queen beds · bathtub · outdoor shower · 52 m²",
    "sunrise-casita": "2 queen beds · glass sliding doors · 35 m²",
    "louver-window-casita": "2 queen beds · wooden jalousies · 35 m²",
    "bamboo-king-casita": "King bed · bamboo build · 30 m²",
    "bamboo-casita": "2 queen beds · bamboo build · 30 m²",
}

country_options = "\n".join(
    f'<option value="{c}"{" selected" if c == "Philippines" else ""}>{c}</option>' for c in COUNTRIES
)

type_cards = ""
for slug, name in CASITAS:
    wd, we = CASITA_RATES[slug]
    type_cards += f"""
      <div class="villa-type" data-type="{slug}">
        <img src="../assets/images/{VILLA_IMG[slug]}" alt="{name}" loading="lazy">
        <div>
          <h3>{name}</h3>
          <div class="vt-meta">{VILLA_BEDS[slug]} &middot; <span class="vt-occ"></span></div>
          <div class="vt-rate"><b>&#8369;{wd}</b> weekday &middot; <b>&#8369;{we}</b> Fri/Sat <span class="muted">/ night</span></div>
          <div class="vt-avail">Pick your dates to check availability</div>
        </div>
        <div class="stepper" role="group" aria-label="Number of {name}">
          <button type="button" class="st-minus" aria-label="One fewer {name}">&minus;</button>
          <output class="st-count">0</output>
          <button type="button" class="st-plus" aria-label="One more {name}">+</button>
        </div>
      </div>"""

body = f"""
<section class="page-hero" style="min-height:42vh;">
  <img src="../assets/images/18-private-villas-only.jpg" alt="Aerial view of Virgin Beach Resort's casitas along the cove">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Book Direct &middot; Overnight</span>
    <h1>Book Your Stay</h1>
    <p class="lede">Choose your dates and casita, tell us who's coming, and get your quotation by email right away &mdash; straight from our reservations team.</p>
  </div>
</section>

<section>
  <div class="wrap" style="max-width:820px;">
    <div id="stayFormWrap">
      <form class="inquiry" id="stayForm" novalidate>

        <div class="stay-step">
          <div class="stay-step-head"><span class="stay-step-num">1</span><div><h2>Your dates</h2><p>Check-in from 2:00 PM &middot; check-out by 11:30 AM</p></div></div>
          <div class="row-2">
            <div><label for="checkIn">Check-in</label><input id="checkIn" type="date" required></div>
            <div><label for="checkOut">Check-out</label><input id="checkOut" type="date" required></div>
          </div>
          <p class="stay-nights" id="nightsLine"></p>
        </div>

        <div class="stay-step">
          <div class="stay-step-head"><span class="stay-step-num">2</span><div><h2>Choose your casita(s)</h2><p>Friday &amp; Saturday nights and holiday eves are charged the weekend rate. Book more than one casita for a bigger group.</p></div></div>
          <p class="field-hint" id="availStatus" style="margin:0 0 12px;">Pick your dates above to see what's free.</p>
          <div class="villa-type-list" id="villaTypes">{type_cards}
          </div>
          <p class="villa-picked-note" id="pickedNote" hidden></p>
        </div>

        <div class="stay-step">
          <div class="stay-step-head"><span class="stay-step-num">3</span><div><h2>Who's staying</h2><p>Every guest has the full-board meal package (lunch, dinner &amp; breakfast) each night, so we need everyone's name and age group. Kids 0&ndash;5 eat free.</p></div></div>
          <div class="row-2">
            <div><label for="guestName">Your full name (primary guest)</label><input id="guestName" type="text" autocomplete="name" required></div>
            <div><label for="guestPhone">Mobile number</label><input id="guestPhone" type="tel" autocomplete="tel" required></div>
          </div>
          <div class="row-2">
            <div><label for="guestEmail">Email</label><input id="guestEmail" type="email" autocomplete="email" required></div>
            <div><label for="country">Country</label><select id="country">{country_options}</select></div>
          </div>
          <label class="inline-check"><input type="checkbox" id="primarySenior"> I'm a Senior Citizen or PWD (20% discount with a valid ID)</label>

          <div>
            <label for="partySize">How many guests in total, including you?</label>
            <div class="stepper" style="margin-top:4px;">
              <button type="button" id="partyMinus" aria-label="One fewer guest">&minus;</button>
              <output id="partySize">2</output>
              <button type="button" id="partyPlus" aria-label="One more guest">+</button>
            </div>
          </div>
          <div>
            <label>Your companions</label>
            <div class="guest-list" id="guestList"></div>
            <p class="field-hint" style="margin-top:8px;">Full name (first and last) as it appears on their ID &mdash; all guests present a valid ID at check-in.</p>
          </div>
          <div class="capacity-meter" id="capacityMeter" hidden></div>
        </div>

        <div class="stay-step">
          <div class="stay-step-head"><span class="stay-step-num">4</span><div><h2>A few more details</h2></div></div>
          <div id="seniorIdWrap" hidden>
            <label for="seniorIdFiles">Senior Citizen / PWD ID photo(s)</label>
            <input id="seniorIdFiles" type="file" accept="image/*" multiple>
            <p class="field-hint">One photo per senior citizen / PWD (or one photo with all IDs) &mdash; needed for the 20% discount. Please bring the ID(s) too.</p>
          </div>
          <div>
            <label for="petCount">Bringing any pets?</label>
            <input id="petCount" type="number" min="0" max="2" value="0">
            <p class="field-hint">Dogs or cats only &mdash; up to two per reservation, &#8369;750 per pet per night.</p>
          </div>
          <div id="petWrap" hidden>
            <label for="petVaxFiles">Pet vaccination card(s)</label>
            <input id="petVaxFiles" type="file" accept="image/*,application/pdf" multiple>
            <p class="field-hint">A clear photo of each pet's vaccination card showing a current anti-rabies vaccination.</p>
            <details class="pet-policy">
              <summary>Read the Pet Policy</summary>
              <ol>
{PET_POLICY_ITEMS}
              </ol>
            </details>
            <label class="field-hint pet-agree"><input type="checkbox" id="petPolicyAgree"> I agree to the Resort's Pet Policy and confirm my pet(s) are vaccinated, healthy and free of fleas and ticks.</label>
          </div>
          <div class="row-2">
            <div>
              <label for="occasion">Celebrating anything?</label>
              <select id="occasion">
                <option value="">Nothing in particular</option>
                <option value="birthday">Birthday</option>
                <option value="anniversary">Anniversary</option>
                <option value="honeymoon">Honeymoon</option>
                <option value="reunion">Reunion</option>
                <option value="other">Other</option>
              </select>
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
          </div>
          <div><label for="notes">Special requests</label><textarea id="notes" placeholder="Dietary needs, arrival time, celebration details&hellip;"></textarea></div>
        </div>

        <div class="stay-step">
          <div class="stay-step-head"><span class="stay-step-num">5</span><div><h2>Your quotation</h2><p>All prices include 12% VAT and service charge.</p></div></div>
          <div id="billSummary" class="bill-summary"><div class="bill-lines"><div class="bill-row"><span>Choose dates, casita(s) and guests to see your total</span><span>&mdash;</span></div></div></div>
          <label class="inline-check"><input type="checkbox" id="agreeTerms"> I understand the full-board meal package is required for every guest, and I agree to the <a class="text-link" href="../assets/docs/VBR-Reservations-Agreement.pdf" target="_blank" rel="noopener">Reservations Agreement</a> (cancellation: free 15+ days before arrival; 50% within 14 days; 100% within 7 days or no-show).</label>
          <label class="inline-check" style="font-size:0.85rem !important; color:var(--ink-soft) !important;"><input type="checkbox" id="marketingOptIn" checked> Send me occasional promos and updates from Virgin Beach Resort.</label>
          <div class="form-error-box" id="formError" hidden></div>
          <button class="btn btn-primary" type="submit" id="submitBtn">Request Booking</button>
          <p class="field-hint">Your casita is held while you pay: you'll get the quotation and bank details by email right away, and full payment within 24 hours confirms the booking.</p>
        </div>
      </form>
    </div>
    <div id="stayStatus" class="form-status" hidden></div>
  </div>
</section>

<section class="band-tint center">
  <div class="wrap" style="max-width:560px; margin:0 auto;">
    <span class="eyebrow">Already booked?</span>
    <h2>Upload your payment</h2>
    <p class="prose mx-auto mt-lg">Paid already? Send us proof of payment using the Order ID from your quotation email.</p>
    <a class="btn btn-ghost mt-lg" href="../pay/index.html">Upload Payment Proof</a>
  </div>
</section>

<section class="center">
  <div class="wrap" style="max-width:560px; margin:0 auto;">
    <span class="eyebrow">Prefer to talk?</span>
    <h2>Call or message us</h2>
    <p class="prose mx-auto mt-lg">Mobile: <a class="text-link" href="tel:+639177920712">+63 917 792 0712</a> (Globe) &middot;
    <a class="text-link" href="tel:+639294309109">+63 929 430 9109</a> (Smart) &middot;
    <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></p>
  </div>
</section>

<script src="https://unpkg.com/@supabase/supabase-js@2"></script>
<script src="../assets/js/booking-config.js?v={asset_v('assets/js/booking-config.js')}"></script>
<script src="../assets/js/stay-booking.js?v={asset_v('assets/js/stay-booking.js')}"></script>
"""

page("book-stay/index.html", "Book Your Stay",
     "Book an overnight casita at Virgin Beach Resort directly — live availability, instant quotation, full-board meals included.",
     body, cta_label="Book a Day Trip", cta_href="../day-packages/index.html")
