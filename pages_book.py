# -*- coding: utf-8 -*-
from build import page, CLOUDBEDS_URL, booking_form_section, booking_scripts

body = f"""
<section class="page-hero" style="min-height:40vh;">
  <img src="../assets/images/drone-shot-hero.jpg" alt="Aerial view of Virgin Beach Resort">
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
    {booking_form_section("day_trip")}
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
{booking_scripts()}
"""

page("book/index.html", "Request Your Day Trip", "Request a Day Trip or Corporate outing directly with Virgin Beach Resort. Booking an overnight casita? That's handled through our booking engine.", body)
