# -*- coding: utf-8 -*-
from build import page, booking_form_section, booking_scripts

FINE_PRINT_A = """
<div class="fine-print">
  <p>All prices are inclusive of 12% VAT and Service Charge.</p>
  <p>Prices may be subject to change without prior notice.</p>
</div>
"""

# ---------------------------------------------------------------- Day Trip

day_body = """
<section class="page-hero">
  <img src="../assets/images/day-trip-area.jpg" alt="Aerial view of dining and lounge cabanas along the shoreline, mountains in the background">
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

<section>
  <div class="wrap">
    <div class="two-col-head"><div><span class="eyebrow">Cabanas</span><h2>Available Facilities</h2></div></div>
    <div class="grid-2">
      <div class="card">
        <div class="card-media"><img src="../assets/images/dining-cabana-thatch.jpg" alt="Dining Cabana"></div>
        <div class="card-body"><span class="meta">10 Persons</span><h3>Dining Cabana</h3><div class="price"><b>&#8369;1,500</b></div></div>
      </div>
      <div class="card">
        <div class="card-media"><img src="../assets/images/lounge-cabana-canopy.jpg" alt="Lounge Cabana"></div>
        <div class="card-body"><span class="meta">4 Persons</span><h3>Lounge Cabana</h3><div class="price"><b>&#8369;2,000</b></div></div>
      </div>
    </div>
    {fine_print_1}
  </div>
</section>

<section class="center" style="max-width:640px; margin:0 auto; padding-bottom:0;">
  <span class="eyebrow">Reservations</span>
  <h2>Plan your day trip</h2>
  <p class="prose mx-auto" style="margin-top:14px;">Fill in the form below and our reservations team will confirm availability directly with you. Prefer to talk first?
  Call (02) 8815 2584 or 87, or email
  <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></p>
</section>

<section>
  <div class="wrap" style="max-width:760px;">
    {booking_form}
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
{booking_scripts_html}
""".format(fine_print_1=FINE_PRINT_A, booking_form=booking_form_section("day_trip"), booking_scripts_html=booking_scripts())

page("day-packages/index.html", "Day Trip", "Day Trip packages at Virgin Beach Resort — dining and lounge cabanas, with instant online booking.", day_body)


# ---------------------------------------------------------------- Corporate

corp_body = """
<section class="page-hero">
  <img src="../assets/images/corporate-outing.jpg" alt="Aerial view of the outing area with a tour bus arriving beneath the trees">
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
        <a class="btn btn-primary mt-lg" href="mailto:virginbeach.events@gmail.com?subject=Corporate%20Outing%20Proposal%20Request">Request for a Proposal</a>
      </div>
      <div class="feature-media"><img src="../assets/images/path-way-to-the-beach.jpg" alt="Aerial view of the path leading down to the resort's beachfront outing area"></div>
    </div>
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="grid-2">
      <div class="feature-media wide"><img src="../assets/images/18-private-villas-only.jpg" alt="Aerial view of the resort's villas along the coastline"></div>
      <div class="feature-media wide"><img src="../assets/images/reef-of-virgin-beach.jpg" alt="Aerial view of the turquoise reef for group beach activities"></div>
    </div>
  </div>
</section>

<section class="center" style="max-width:640px; margin:0 auto;">
  <span class="eyebrow">Groups of 30+</span>
  <h2>Let's plan your outing</h2>
  <p class="prose mx-auto" style="margin-top:14px;">For inquiries, call our reservations office at (02) 8815 2584 or 87, or email
  <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></p>
  <a class="btn btn-primary mt-lg" href="mailto:virginbeach.events@gmail.com?subject=Corporate%20Outing%20Proposal%20Request">Request for a Proposal</a>
</section>
"""

page("corporate/index.html", "Corporate", "Corporate outings and team building packages at Virgin Beach Resort, for groups of 30 or more.", corp_body)
