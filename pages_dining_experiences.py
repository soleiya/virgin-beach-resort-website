# -*- coding: utf-8 -*-
from build import page, CLOUDBEDS_URL

# ---------------------------------------------------------------- Dining

dining_body = f"""
<section class="page-hero">
  <img src="../assets/images/dining-lanterns-evening.jpg" alt="Candlelit dinner tables set up on the beach at The Pavilion">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Dining</span>
    <h1>Indulge in a selection of local and international cuisine at <em style="font-style:italic;">The Pavilion.</em></h1>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="prose" style="font-size:1.05rem;">Make every dining experience a memorable one. Wine and dine al fresco, sampling on delectable local and
    international fare. Cap off your meal and quench yourself with our various beverages, fresh juices and cocktails included. Best of all, you'll
    enjoy your meal accompanied with a pristine view of the beach that will surely satisfy all your senses.</p>
  </div>
</section>

<section class="band-tint">
  <div class="wrap grid-3">
    <div><h3>Breakfast</h3><p class="prose" style="margin-top:8px;">7:00 AM &ndash; 10:00 AM</p></div>
    <div><h3>Lunch</h3><p class="prose" style="margin-top:8px;">12:00 PM &ndash; 2:00 PM</p></div>
    <div><h3>Dinner</h3><p class="prose" style="margin-top:8px;">7:00 PM &ndash; 9:00 PM</p></div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="grid-2">
      <div class="feature-media wide"><img src="../assets/images/dining-pizza.jpg" alt="Wood-fired pizza fresh from the oven"></div>
      <div class="feature-media wide"><img src="../assets/images/pavilion-porch-seating.jpg" alt="Covered pavilion seating at The Pavilion"></div>
    </div>
    <div class="feature-row mt-lg">
      <div>
        <span class="eyebrow">Meal Arrangements</span>
        <h2>Full board, made easy</h2>
        <p class="prose" style="margin-top:16px;">The daily meal package includes three meals that are mandatory for the duration of our guests'
        overnight stay, comprised of lunch upon arrival, dinner, and breakfast the following morning, not necessarily in that order.</p>
        <p class="prose" style="margin-top:12px;">Our menu is made up of international and local cuisine served managed buffet style. &Agrave; la
        carte meals are available in addition to the mandatory full board meals availed during the stay. Meals for guests' staff are available for
        &#8369;750/day.</p>
      </div>
      <div class="table-wrap">
        <table class="rate-table">
          <thead><tr><th>Guest</th><th class="num">Rate</th></tr></thead>
          <tbody>
            <tr><td>Adult</td><td class="num">&#8369;2,450</td></tr>
            <tr><td>Child (Ages 6 to 12)</td><td class="num">&#8369;1,225</td></tr>
            <tr><td>Ages 0 to 5</td><td class="num">Free</td></tr>
          </tbody>
        </table>
        <div class="fine-print">
          <p>All prices are inclusive of 12% VAT and Service Charge.</p>
          <p>Room rates are exclusive of mandatory meal package.</p>
          <p>Prices may be subject to change without prior notice.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="center" style="max-width:640px; margin:0 auto;">
  <span class="eyebrow">The Pavilion</span>
  <h2>Reserve your table</h2>
  <div class="hero-actions" style="justify-content:center; margin-top:20px;">
    <a class="btn btn-primary" href="{CLOUDBEDS_URL}">Book Now</a>
    <a class="btn btn-ghost" href="../experiences/index.html">Private Dinner on the Beach</a>
  </div>
</section>
"""

page("dining/index.html", "Dining", "Al fresco dining at The Pavilion — local and international cuisine by the beach at Virgin Beach Resort.", dining_body)


# ---------------------------------------------------------------- Experiences

EXPERIENCES = [
    ("Private Dining", "Make special moments even more memorable with a private dinner by the beach. Let you and your loved ones be enveloped in a warm ambience coupled with a sunset backdrop. Whether it's in celebration of an event or each other, we are sure to make this dinner a memorable one.", "spa-towels-detail.jpg"),
    ("Bonfire by the Beach", "Enjoy a memorable evening with family and friends while roasting marshmallows and watching the stars come alive.", "night-beach-lounge.jpg"),
    ("Massage", "Our visiting wellness experts are here to skillfully relieve your aching muscles and to provide the most restful experience.", "aerial-extra-01.jpg"),
    ("Kayaking", "Row towards the horizon and set out into the sea, just don't forget to come back!", "reef-turquoise-aerial.jpg"),
    ("Boat Trip", "Set out to sea to marvel at the azure water and sky or go snorkeling at one of Laiya's marine sanctuaries.", "aerial-beach-vertical.jpg"),
    ("Biking &amp; Bird Watching", "Go on a mini-adventure by exploring the many scenic trails and paths found around the property. The opportunities for a wheely great ride are endless. Take a ride, enjoy a cool ocean breeze and keep your eyes peeled for various species of birds.", "aerial-road-coast.jpg"),
    ("Snorkeling", "Get acquainted with the breathtaking world below in either of Laiya's marine sanctuaries as you surround yourself with corals teeming with undersea life. Snorkels, goggles, and full face masks are available for rent and at your disposal all day.", "aerial-extra-05.jpg"),
    ("ATV Riding", "Experience a mini-adventure by exploring the many scenic trails and paths around the property. Excite your senses with the ultimate off-road experience with our All Terrain Vehicles.", "aerial-cabanas-wide.jpg"),
    ("Sunset Lounging", "Spend the afternoon lounging by the beach and taking in the ocean breeze. Let the golden hues of the setting sun paint a serene backdrop as you relax.", "lounge-corner-orange.jpg"),
]

cards = ""
for name, desc, img in EXPERIENCES:
    cards += f'''
      <div class="card">
        <div class="card-media"><img src="../assets/images/{img}" alt="{name}" loading="lazy"></div>
        <div class="card-body"><h3>{name}</h3><p style="font-size:0.92rem;">{desc}</p></div>
      </div>'''

exp_body = f"""
<section class="page-hero">
  <img src="../assets/images/reef-turquoise-aerial.jpg" alt="Aerial view of a turquoise reef along the shoreline">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Experiences</span>
    <h1>Go on a water adventure or take a moment of quiet contemplation.</h1>
    <p class="lede">Whether you choose to get your adrenaline pumping in the ocean or peacefully unwind by the shore, we've prepared a range of activities fit to your liking.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="grid-3">{cards}
    </div>
  </div>
</section>

<section class="band-dark">
  <div class="wrap center" style="max-width:640px;">
    <span class="eyebrow">Choose from a variety</span>
    <h2>Choose from a variety of recreational activities bound to make your stay with us an enjoyable one.</h2>
    <a class="btn btn-on-dark mt-lg" href="../day-packages/index.html">Plan Your Stay</a>
  </div>
</section>
"""

page("experiences/index.html", "Experiences", "Private dining, bonfires, kayaking, snorkeling, ATV riding, and more at Virgin Beach Resort.", exp_body)
