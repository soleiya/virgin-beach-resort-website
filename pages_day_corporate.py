# -*- coding: utf-8 -*-
from build import page

FINE_PRINT_A = """
<div class="fine-print">
  <p>All prices are inclusive of 12% VAT and Service Charge.</p>
  <p>Prices may be subject to change without prior notice.</p>
</div>
"""

# ---------------------------------------------------------------- Day Trip

day_body = """
<section class="page-hero">
  <img src="../assets/images/aerial-cabanas-shoreline.jpg" alt="Aerial view of dining and lounge cabanas along the shoreline">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Day Trip</span>
    <h1>A fleeting escape that will leave you wanting more.</h1>
    <p class="lede">For guests who would like to spend the day here, we offer Day Trip packages to suit your every need.</p>
  </div>
</section>

<section class="section-tight">
  <div class="wrap">
    <p class="prose" style="font-size:1.05rem;">Stay in one of our cabanas, soak up the sun, and take a dip along the shore. Spend the rest of your day
    taking in the enjoying the ocean breeze and breathtaking seascape. By sunset, we guarantee you will want to stay.</p>
    <p class="prose" style="margin-top:12px;">This magical paradise is just a short drive away.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="two-col-head">
      <div><span class="eyebrow">Full Day</span><h2>Day Trip Package</h2></div>
      <p class="prose" style="max-width:44ch;">Inclusive of Lunch, Entrance, and Parking Fees from 8:00 AM to 5:00 PM, unless staying for dinner.</p>
    </div>
    <p class="prose">Stay for the day at our day trip paradise and enjoy lunch served to your cabana.</p>
    <div class="table-wrap mt-lg">
      <table class="rate-table">
        <thead><tr><th>Guest</th><th class="num">Rate</th></tr></thead>
        <tbody>
          <tr><td>Adults</td><td class="num">&#8369;1,250.00</td></tr>
          <tr><td>Children (6&ndash;12 years old)</td><td class="num">&#8369;825.00</td></tr>
          <tr><td>Children (5 years old and below)</td><td class="num">Free</td></tr>
        </tbody>
      </table>
    </div>
    <p class="prose" style="margin-top:20px; font-size:0.92rem;">&Agrave; la carte dining and snacks are available for merienda upon request.</p>
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="two-col-head">
      <div><span class="eyebrow">Afternoon</span><h2>Half-day Tour Package</h2></div>
      <p class="prose" style="max-width:44ch;">Inclusive of Entrance and Parking Fees from 2:00 PM to 5:00 PM, unless staying for dinner.</p>
    </div>
    <p class="prose">Spend your afternoon at our overnight section. &Agrave; la carte dining and snacks are available for merienda.</p>
    <div class="table-wrap mt-lg">
      <table class="rate-table">
        <thead><tr><th>Guest</th><th class="num">Rate</th></tr></thead>
        <tbody>
          <tr><td>Adults</td><td class="num">&#8369;630.00</td></tr>
          <tr><td>Children (6&ndash;12 years old)</td><td class="num">&#8369;315.00</td></tr>
          <tr><td>Children (5 years old and below)</td><td class="num">Free</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="two-col-head"><div><span class="eyebrow">Cabanas</span><h2>Available Facilities</h2></div></div>
    <div class="grid-3">
      <div class="card">
        <div class="card-media"><img src="../assets/images/lounge-corner-orange.jpg" alt="Lounge Cabana"></div>
        <div class="card-body"><span class="meta">4 Persons</span><h3>Lounge Cabana</h3><div class="price"><b>&#8369;2,000</b></div></div>
      </div>
      <div class="card">
        <div class="card-media"><img src="../assets/images/day-trip-cabanas-path.jpg" alt="Dining Cabana"></div>
        <div class="card-body"><span class="meta">10 Persons</span><h3>Dining Cabana</h3><div class="price"><b>&#8369;1,500</b></div></div>
      </div>
      <div class="card">
        <div class="card-media"><img src="../assets/images/pavilion-porch-seating.jpg" alt="Bed Parasol"></div>
        <div class="card-body"><span class="meta">3 Persons</span><h3>Bed Parasol</h3><div class="price"><b>&#8369;1,750</b></div></div>
      </div>
    </div>
    {fine_print_1}
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="feature-row">
      <div class="feature-media wide"><img src="../assets/images/night-beach-lounge.jpg" alt="Beachfront picnic setting under string lights"></div>
      <div>
        <span class="eyebrow">Bring Your Own</span>
        <h2>Day Picnic Package</h2>
        <p class="prose" style="margin-top:16px;">Inclusive of Entrance and Corkage from 8:00 AM to 5:00 PM. Our outing area is open to picnickers when
        there are no scheduled company outings. Guests may bring in food and drinks and enjoy grilling and having lunch by the beach.</p>
      </div>
    </div>
    <div class="table-wrap mt-lg">
      <table class="rate-table">
        <thead><tr><th>Guest</th><th class="num">Rate</th></tr></thead>
        <tbody>
          <tr><td>Adults</td><td class="num">&#8369;400.00</td></tr>
          <tr><td>Children (9 years old and below)</td><td class="num">&#8369;400.00</td></tr>
        </tbody>
      </table>
    </div>
    <div class="two-col-head mt-lg"><div><h3>Dining Parasol</h3></div></div>
    <p class="prose">Capacity 12 persons &middot; &#8369;1,575 php</p>

    <div class="two-col-head mt-lg"><div><h3>Other Charges for Day Picnic</h3></div></div>
    <div class="table-wrap">
      <table class="rate-table">
        <tbody>
          <tr><td>Electricity Fee (For appliances)</td><td class="num">&#8369;210.00 / Unit</td></tr>
          <tr><td>Parking Fee &mdash; Car</td><td class="num">&#8369;60.00</td></tr>
          <tr><td>Parking Fee &mdash; SUV, Van</td><td class="num">&#8369;125.00</td></tr>
          <tr><td>Parking Fee &mdash; Coaster, Bus</td><td class="num">&#8369;370.00</td></tr>
        </tbody>
      </table>
    </div>
    <div class="fine-print">
      <p>Prices are inclusive of 12% VAT and 5% service charge.</p>
      <p>Prices may be subject to change without prior notice.</p>
    </div>
  </div>
</section>

<section class="center" style="max-width:640px; margin:0 auto;">
  <span class="eyebrow">Reservations</span>
  <h2>Plan your day trip</h2>
  <p class="prose mx-auto" style="margin-top:14px;">For inquiries, call our reservations office at (02) 8815 2584 or 87, or email
  <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></p>
  <a class="btn btn-primary mt-lg" href="../book/index.html?type=day_trip">Request for a Quotation</a>
</section>
""".format(fine_print_1=FINE_PRINT_A)

page("day-packages/index.html", "Day Trip", "Day Trip, Half-day Tour, and Day Picnic packages at Virgin Beach Resort.", day_body)


# ---------------------------------------------------------------- Corporate

corp_body = """
<section class="page-hero">
  <img src="../assets/images/day-trip-cabanas-path.jpg" alt="Outing area with dining cabanas beneath the trees">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Corporate</span>
    <h1>Give your company outings a <em style="font-style:italic;">tropical touch.</em></h1>
    <p class="lede">Celebrate with your team and spend a day with your colleagues by the seaside.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="feature-row">
      <div>
        <span class="eyebrow">Team Building</span>
        <h2>Organize your outing with us</h2>
        <p class="prose" style="margin-top:18px;">Organize your company team buildings with us to give the best outdoor experience. We provide a range
        of activities for everyone and a selection of buffet menus for the entire day.</p>
        <p class="prose" style="margin-top:14px;">Our spacious outing area with its wide beachfront, cleverly-designed cabanas and more than adequate
        toilet &amp; bath facilities is an ideal venue for corporate outings and team building activities. Packages are available for groups of 30
        persons or more.</p>
        <a class="btn btn-primary mt-lg" href="../book/index.html?type=corporate">Request for a Proposal</a>
      </div>
      <div class="feature-media"><img src="../assets/images/aerial-cabanas-wide.jpg" alt="Wide aerial view of the resort's beachfront outing area"></div>
    </div>
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="grid-2">
      <div class="feature-media wide"><img src="../assets/images/aerial-road-coast.jpg" alt="Coastal road winding through the property"></div>
      <div class="feature-media wide"><img src="../assets/images/pavilion-porch-seating.jpg" alt="Covered pavilion seating for group gatherings"></div>
    </div>
  </div>
</section>

<section class="center" style="max-width:640px; margin:0 auto;">
  <span class="eyebrow">Groups of 30+</span>
  <h2>Let's plan your outing</h2>
  <p class="prose mx-auto" style="margin-top:14px;">For inquiries, call our reservations office at (02) 8815 2584 or 87, or email
  <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></p>
  <a class="btn btn-primary mt-lg" href="../book/index.html?type=corporate">Request for a Proposal</a>
</section>
"""

page("corporate/index.html", "Corporate", "Corporate outings and team building packages at Virgin Beach Resort, for groups of 30 or more.", corp_body)
