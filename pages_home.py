# -*- coding: utf-8 -*-
from build import page, CASITAS, book_link, CLOUDBEDS_URL

RATES = {
    "deluxe-king-casita": "18,525",
    "double-queen-casita": "18,525",
    "sunrise-casita": "15,525",
    "louver-window-casita": "14,525",
    "bamboo-king-casita": "9,225",
    "bamboo-casita": "9,225",
}
CASITA_IMG = {
    "deluxe-king-casita": "casita-king-exterior.jpg",
    "double-queen-casita": "casita-queen-exterior.jpg",
    "sunrise-casita": "sunrise-casita-sunset.jpg",
    "louver-window-casita": "casita-louver-exterior.jpg",
    "bamboo-king-casita": "bamboo-casita-day.jpg",
    "bamboo-casita": "bamboo-basita.jpg",
}
CASITA_META = {
    "deluxe-king-casita": "2 Persons · King Bed",
    "double-queen-casita": "4 Persons · 2 Queen Beds",
    "sunrise-casita": "4 Persons · 2 Queen Beds",
    "louver-window-casita": "4 Persons · 2 Queen Beds",
    "bamboo-king-casita": "2 Persons · King Bed",
    "bamboo-casita": "4 Persons · 2 Queen Beds",
}

base = "" if True else ""  # base computed inside page(); images referenced relative to page's base

casita_cards = ""
for slug, name in CASITAS:
    casita_cards += f'''
      <a class="card" href="overnight/{slug}/index.html">
        <div class="card-media"><img src="assets/images/{CASITA_IMG[slug]}" alt="{name} at Virgin Beach Resort" loading="lazy"></div>
        <div class="card-body">
          <span class="meta">{CASITA_META[slug]}</span>
          <h3>{name}</h3>
          <div class="price">Starts at <b>&#8369;{RATES[slug]}</b> / night</div>
        </div>
      </a>'''

body = f"""
<section class="hero">
  <img src="assets/images/drone-hero.jpg" alt="Aerial view of Virgin Beach Resort's cove, casitas lined along a curving white sand beach">
  <div class="wrap hero-content">
    <span class="eyebrow">Laiya &middot; San Juan &middot; Batangas</span>
    <h1>Manila&rsquo;s Quick Escape to Pure Unspoiled Paradise</h1>
    <p class="lede">Leave the city hustle behind for a secluded stretch of pristine white sand, bespoke beachside service, and quiet luxury&mdash;just a few hours&rsquo; drive away.</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="{CLOUDBEDS_URL}">Book Now</a>
      <a class="btn btn-on-dark" href="overnight/index.html">View Casitas</a>
    </div>
  </div>
</section>

<section class="section-tight">
  <div class="wrap center">
    <p class="prose mx-auto" style="font-size:1.2rem; font-family:var(--font-display); color:var(--ink);">
      The beautiful landscape, clear blue waters, and rustic casitas sprawled over a stretch of creamy white sand
      beach combine into a picturesque setting one would usually find in far-away exotic destinations. You would
      think you are on a beautiful island, not somewhere just a few hours away from Metro Manila.
    </p>
    <p class="prose mx-auto" style="margin-top:18px;">If you are appreciative of such a place, then come and experience Virgin Beach Resort.</p>
  </div>
</section>

<section>
  <div class="wrap stack">
    <div class="feature-row">
      <div class="feature-media"><img src="assets/images/Day-Trip-Area-with-mountains-at-the-back.jpg" alt="Aerial view of Sigayan Bay and the mountains of Daguldol and Lobo"></div>
      <div>
        <span class="eyebrow">Paradise within reach</span>
        <h2>Paradise within reach</h2>
        <p class="prose" style="margin-top:18px;">Located in Laiya, San Juan, Batangas, Virgin Beach Resort is a convenient 3-hour drive from Metro
        Manila. The resort sits on a cove facing southeast adjacent to Sigayan Bay, watched over by the majestic
        mountains of Daguldol and Lobo. Sigayan Bay is known to be one of the cleanest bays in the country and is
        part of the Verde Passage, identified as the earth's center of marine biodiversity.</p>
      </div>
    </div>

    <div class="feature-row reverse">
      <div class="feature-media"><img src="assets/images/private-villas-tucked-in.jpg" alt="Aerial view of private villas nestled amidst the tree canopy"></div>
      <div>
        <span class="eyebrow">Privacy &amp; Serenity</span>
        <h2>Privacy &amp; Serenity.</h2>
        <p class="prose" style="margin-top:18px;">The resort features only oceanfront accommodations, sprawled out and nestled amidst a variety of
        trees, strategically designed so that one can enjoy the utmost privacy.</p>
      </div>
    </div>
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="two-col-head">
      <div>
        <span class="eyebrow">Overnight</span>
        <h2>Rest, easy.</h2>
      </div>
      <p class="prose" style="max-width:44ch;">Bring yourself to the perfect tropical getaway and stay in any of our oceanfront accommodations. Our
      rooms come with an understated elegance that feels like home.</p>
    </div>
    <div class="grid-3">{casita_cards}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="feature-row">
      <div class="feature-media wide"><img src="assets/images/dining.jpg" alt="Candlelit tables set for dinner on the beach at The Pavilion"></div>
      <div>
        <span class="eyebrow">Dining</span>
        <h2>Dining at <em style="font-style:italic;">The Pavilion</em></h2>
        <p class="prose" style="margin-top:18px;">Enjoy al fresco dining by the beachfront while taking in beautiful ocean views. Choose from a
        selection of local and international dishes made with fresh, homegrown, and seasonal ingredients from our Green Light District edibles garden.</p>
        <a class="btn btn-ghost mt-lg" href="dining/index.html">Explore Dining</a>
      </div>
    </div>

    <div class="feature-row reverse mt-lg">
      <div class="feature-media wide"><img src="assets/images/day-trip.jpg" alt="Aerial view of dining cabanas lining the beach"></div>
      <div>
        <span class="eyebrow">Day Activities</span>
        <h2>Spend the day with us</h2>
        <p class="prose" style="margin-top:18px;">For guests who would like to spend the day here, we offer Day Trip and Corporate packages. Stay in
        one of our cabanas, soak up the sun, and take a dip along the shore.</p>
        <div class="hero-actions" style="margin-top:22px;">
          <a class="btn btn-ghost" href="day-packages/index.html">Day Trip Packages</a>
          <a class="btn btn-ghost" href="corporate/index.html">Corporate Outings</a>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="band-dark">
  <div class="wrap">
    <div class="two-col-head">
      <div>
        <span class="eyebrow">Celebrations</span>
        <h2>Celebrate with us</h2>
      </div>
      <p class="prose" style="max-width:44ch;">Turn your most meaningful events into moments that everyone will remember.</p>
    </div>
    <div class="grid-2">
      <div class="feature-media wide"><img src="assets/images/mother-tree.jpg" alt="The resort's illuminated mother tree glowing at night"></div>
      <div class="feature-media wide"><img src="assets/images/fire-tree-and-coastline.jpg" alt="Wide aerial view of the shoreline suited for a beach ceremony"></div>
    </div>
    <p class="prose mt-lg" style="color:rgba(238,231,214,0.85);">Tie the knot on a picturesque beach as the sound of waves become the perfect tune to the exact moment
    you and your loved one become one.</p>
    <div class="feature-row mt-lg" style="align-items:flex-start;">
      <div>
        <h3 style="color:#fff;">Private Dinner</h3>
        <p style="margin-top:10px; color:rgba(238,231,214,0.78);">Make special moments even more memorable with a private dinner by the beach. Whether it's in
        celebration of an event or each other, we are sure to make this dinner a memorable one.</p>
      </div>
      <div class="feature-media"><img src="assets/images/spa-towels-detail.jpg" alt="A quiet, candlelit table set for a private dinner"></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap center" style="max-width:720px;">
    <span class="eyebrow">Soft Opening</span>
    <h2>We are happy to announce we are now accepting bookings during our soft opening.</h2>
    <p class="prose mx-auto" style="margin-top:18px;">While we work on getting our website up and running, please direct all inquiries to our email address:
    <a class="text-link" href="mailto:virginbeachresortreservations@gmail.com">virginbeachresortreservations@gmail.com</a></p>
    <p class="prose mx-auto" style="margin-top:10px;">Thank you and we look forward to your visit! &mdash; <strong>Virgin Beach Resort Management</strong></p>
    <a class="btn btn-primary mt-lg" href="{CLOUDBEDS_URL}">Book Now</a>
  </div>
</section>
"""

page("index.html", "Home", "A tranquil, natural beach escape in Laiya, San Juan, Batangas — a 3-hour drive from Metro Manila.", body, solid_header=False)
