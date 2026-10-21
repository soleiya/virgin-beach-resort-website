# -*- coding: utf-8 -*-
from build import page, CASITAS, book_link, stay_link, rate_lines

CASITA_IMG = {s: f"casitas/{s}-01.jpg" for s, _ in CASITAS}
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
      <div class="card card-book">
        <a class="card-media" href="{stay_link("", slug)}"><img src="assets/images/{CASITA_IMG[slug]}" alt="{name} at Virgin Beach Resort" loading="lazy"></a>
        <div class="card-body">
          <span class="meta">{CASITA_META[slug]}</span>
          <h3><a href="{stay_link("", slug)}">{name}</a></h3>
          {rate_lines(slug)}
          <div class="card-actions">
            <a class="btn btn-primary btn-sm" href="{stay_link("", slug)}">Book this casita</a>
            <a class="text-link" href="overnight/{slug}/index.html">Photos &amp; details</a>
          </div>
        </div>
      </div>'''

body = f"""
<section class="hero hero-book">
  <img class="hero-slide is-active" src="assets/images/hero.jpg" alt="Aerial view of Virgin Beach Resort's cove, casitas lined along a curving white sand beach">
  <img class="hero-slide" src="assets/images/fire-tree-and-coastline.jpg" alt="Aerial view of the shoreline with flowering fire trees along the coast">
  <img class="hero-slide" src="assets/images/reef-of-virgin-beach.jpg" alt="Aerial view of the turquoise reef off Virgin Beach Resort">
  <div class="wrap hero-content">
    <span class="eyebrow">Laiya &middot; San Juan &middot; Batangas &middot; 3 hours from Manila</span>
    <h1>Book your beach escape</h1>
    <p class="lede">Oceanfront casitas with full-board meals, or a day on the sand. Pick your dates &mdash; see what&rsquo;s free and your price right away.</p>

    <form class="quickbook" id="quickBook" novalidate>
      <div class="qb-tabs" role="tablist">
        <button type="button" class="qb-tab is-on" role="tab" aria-selected="true" data-mode="stay">Overnight stay</button>
        <button type="button" class="qb-tab" role="tab" aria-selected="false" data-mode="day">Day trip</button>
      </div>
      <div class="qb-fields" data-mode="stay">
        <label class="qb-field"><span>Check-in</span><input type="date" id="qbIn" required></label>
        <label class="qb-field"><span>Check-out</span><input type="date" id="qbOut" required></label>
        <label class="qb-field qb-small"><span>Guests</span><select id="qbGuests"></select></label>
        <button type="submit" class="btn btn-primary qb-go">See available casitas</button>
      </div>
      <div class="qb-fields" data-mode="day" hidden>
        <label class="qb-field"><span>Date</span><input type="date" id="qbDate" required></label>
        <label class="qb-field qb-small"><span>Adults</span><select id="qbAdults"></select></label>
        <label class="qb-field qb-small"><span>Kids 6&ndash;12</span><select id="qbKids"></select></label>
        <button type="submit" class="btn btn-primary qb-go">Book a day trip</button>
      </div>
      <p class="qb-error" id="qbError" hidden></p>
      <a class="qb-paylink" href="pay/index.html"><span>Already booked?</span> <b>Upload your payment &rarr;</b></a>
    </form>
  </div>
</section>

<section class="section-tight how-book">
  <div class="wrap">
    <span class="eyebrow">How booking works</span>
    <h2>Book in a few minutes &mdash; that&rsquo;s it</h2>
    <ol class="steps-4">
      <li><b>Pick your dates</b><span>Choose your casita or your cabana on the beach map &mdash; you see the price right away.</span></li>
      <li><b>Get your quotation</b><span>It arrives by email instantly, with the amount and our bank details.</span></li>
      <li><b>Settle it online</b><span>Transfer 50% or 100% within 24 hours and upload your proof of payment. Paid 50%? The balance is due 15 days before arrival.</span><a class="step-link" href="pay/index.html">Upload Payment &rsaquo;</a></li>
      <li><b>You&rsquo;re booked</b><span>We verify your payment and email your confirmation. See you at the beach!</span></li>
    </ol>
  </div>
</section>

<section class="section-tight band-tint">
  <div class="wrap">
    <div class="two-col-head">
      <div>
        <span class="eyebrow">Stay the night</span>
        <h2>Choose your casita</h2>
      </div>
      <p class="prose" style="max-width:46ch;">Every stay includes full-board meals at The Pavilion &mdash; lunch, dinner and breakfast
      (&#8369;2,695 per adult per night, kids 6&ndash;12 half price, 0&ndash;5 free).</p>
    </div>
    <div class="grid-3">{casita_cards}
    </div>
  </div>
</section>

<section class="section-tight">
  <div class="wrap">
    <div class="feature-row">
      <div class="feature-media wide"><img src="assets/images/day-trip.jpg" alt="Aerial view of dining cabanas lining the beach"></div>
      <div>
        <span class="eyebrow">Day trip</span>
        <h2>Spend the day with us</h2>
        <p class="prose" style="margin-top:18px;">A full day on the beach from &#8369;1,250 per adult (kids 6&ndash;12 &#8369;825, 0&ndash;5 free),
        with your own dining cabana (&#8369;1,500, up to 10 people) or lounge cabana (&#8369;2,000, up to 4).
        Pick your cabana on the beach map when you book.</p>
        <div class="hero-actions" style="margin-top:22px;">
          <a class="btn btn-primary" href="book/index.html">Book a day trip</a>
          <a class="btn btn-ghost" href="day-packages/index.html">Packages &amp; rates</a>
          <a class="btn btn-ghost" href="corporate/index.html">Corporate outings</a>
        </div>
      </div>
    </div>
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
      <div class="feature-media wide"><img src="assets/images/wedding-ceremony-beachfront-guests.jpg" alt="Wedding party and guests gathered on the beach around a bamboo ceremony arch"></div>
      <div class="feature-media wide"><img src="assets/images/wedding-reception-pavilion-lanterns.jpg" alt="Reception pavilion at night draped in fabric with hanging lanterns and long banquet tables"></div>
    </div>
    <p class="prose mt-lg" style="color:rgba(238,231,214,0.85);">Tie the knot on a picturesque beach as the sound of waves become the perfect tune to the exact moment
    you and your loved one become one.</p>
    <div class="feature-row mt-lg" style="align-items:flex-start;">
      <div>
        <h3 style="color:#fff;">Private Dinner</h3>
        <p style="margin-top:10px; color:rgba(238,231,214,0.78);">Make special moments even more memorable with a private dinner by the beach. Whether it's in
        celebration of an event or each other, we are sure to make this dinner a memorable one.</p>
      </div>
      <div class="feature-media"><img src="assets/images/private-dinner-beachside-lanterns.jpg" alt="A beachside private dinner table set at night, lit by hanging lanterns beside the shore"></div>
    </div>
  </div>
</section>

<section class="band-tint">
  <div class="wrap center" style="max-width:720px;">
    <span class="eyebrow">Ready when you are</span>
    <h2>Ready to book? It takes a few minutes</h2>
    <p class="prose mx-auto" style="margin-top:18px;">Pick your dates, choose your casita or cabana, and get your quotation by email right away.
    Questions? Call <a class="text-link" href="tel:+639177920712">+63 917 792 0712</a> or email
    <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.</p>
    <div class="hero-actions" style="justify-content:center;">
      <a class="btn btn-primary" href="{stay_link("")}">Book an overnight stay</a>
      <a class="btn btn-ghost" href="book/index.html">Book a day trip</a>
      <a class="btn btn-ghost" href="pay/index.html">Upload Payment</a>
    </div>
  </div>
</section>
<script src="assets/js/quickbook.js"></script>
"""

page("index.html", "Home", "A tranquil, natural beach escape in Laiya, San Juan, Batangas — a 3-hour drive from Metro Manila.", body, solid_header=False)
