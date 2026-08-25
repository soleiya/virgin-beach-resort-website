# -*- coding: utf-8 -*-
from build import page

body = """
<section class="page-hero" style="min-height:44vh;">
  <img src="../assets/images/Private-villas-tucked-in-the-canopy-shade-of-the-surrounding-trees.jpg" alt="Aerial view of Virgin Beach Resort's cove">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Contact</span>
    <h1>Get in touch with us.</h1>
    <p class="lede">What can we help you with?</p>
  </div>
</section>

<section>
  <div class="wrap contact-grid">
    <div>
      <div class="contact-block">
        <h3>Reservations</h3>
        <p>Mobile (Globe): <a class="text-link" href="tel:+639177920712">+63 917 792 0712</a><br>
        Mobile (Smart): <a class="text-link" href="tel:+639294309109">+63 929 430 9109</a></p>
        <p style="margin-top:10px;">Email: <a class="text-link" href="mailto:virginbeachresortreservations@gmail.com">virginbeachresortreservations@gmail.com</a></p>
        <p style="margin-top:10px;">Office Hours: 9:00 AM &ndash; 4:00 PM, Monday &ndash; Friday</p>
      </div>
      <div class="contact-block">
        <h3>Corporate &amp; Events</h3>
        <p>Corporate: <a class="text-link" href="tel:+639292709724">+63 929 270 9724</a></p>
        <p style="margin-top:10px;">Email: <a class="text-link" href="mailto:virginbeach.events@gmail.com">virginbeach.events@gmail.com</a></p>
      </div>
      <div class="contact-block">
        <h3>Front Office (at the resort)</h3>
        <p>Front Office: <a class="text-link" href="tel:+639696234728">+63 969 623 4728</a></p>
        <p style="margin-top:10px;">Viber (Resort): +63 917 813 1301 &middot; +63 998 546 3139</p>
        <p style="margin-top:10px;">Office Hours: Mon &ndash; Fri, 9:00 AM &ndash; 5:00 PM</p>
      </div>
      <div class="contact-block">
        <h3>Resort Address</h3>
        <p>KM 23 Laiya, San Juan, Batangas, Philippines 4226</p>
      </div>
      <div class="contact-block">
        <h3>Reservations Office</h3>
        <p>E&amp;M Building, 5682 Dona Carmen St., Poblacion, Makati City, Philippines 1210</p>
      </div>
      <div class="contact-block">
        <h3>Follow</h3>
        <div class="social-row" style="color:var(--ink);">
          <a class="text-link" href="https://www.facebook.com/VirginbeachresortLaiya/">Facebook</a>
          <a class="text-link" href="https://www.instagram.com/virginbeachresort/">Instagram</a>
          <a class="text-link" href="https://www.tripadvisor.com.ph/Hotel_Review-g6620224-d850254-Reviews-Virgin_Beach_Resort-Laiya_San_Juan_Batangas_Province_Calabarzon_Region_Luzon.html">TripAdvisor</a>
        </div>
      </div>
    </div>

    <div>
      <div class="map-frame mb-lg" style="margin-bottom:28px;">
        <iframe src="https://maps.google.com/maps?q=Virgin%20Beach%20Resort&t=m&z=14&output=embed&iwloc=near" loading="lazy" title="Map to Virgin Beach Resort" allowfullscreen></iframe>
      </div>
      <form class="inquiry" onsubmit="return false;">
        <div class="row-2">
          <div><label for="fname">First Name</label><input id="fname" type="text" required></div>
          <div><label for="lname">Last Name</label><input id="lname" type="text" required></div>
        </div>
        <div class="row-2">
          <div><label for="cnum">Contact No.</label><input id="cnum" type="tel" required></div>
          <div><label for="email">Email</label><input id="email" type="email" required></div>
        </div>
        <div class="row-2">
          <div><label for="country">Country</label><input id="country" type="text" required></div>
          <div>
            <label for="inquiry">Type of Inquiry</label>
            <select id="inquiry">
              <option>General Inquiry</option>
              <option>Feedback on your stay</option>
              <option>Weddings</option>
              <option>Corporate</option>
            </select>
          </div>
        </div>
        <div><label for="msg">Message</label><textarea id="msg" required></textarea></div>
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
    </div>
  </div>
</section>
"""

page("contact/index.html", "Contact", "Contact Virgin Beach Resort — reservations, corporate events, address, and map to Laiya, San Juan, Batangas.", body)
