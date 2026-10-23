# -*- coding: utf-8 -*-
from build import page, stay_link

# ---------------------------------------------------------------- Dining

DINING_PHOTOS = [
    ("dining-pavilion.jpg", "The Pavilion's open-air dining hall facing the beach"),
    ("dining-hero.jpg", "Wooden tables under the high roof of The Pavilion"),
    ("dining-kare-kare.jpg", "Kare-kare with crispy pork belly, vegetables and bagoong"),
    ("dining-pasta.jpg", "Shrimp and tomato pasta served on the beach"),
    ("dining-bread.jpg", "Freshly baked breads at the breakfast buffet"),
    ("dining-burger.jpg", "Burger and fries on the sand"),
    ("dining-food.jpg", "Pizza baking in the wood-fired oven"),
]
dining_gallery = "".join(
    f'<a class="cg-item" href="../assets/images/dining/{f}"><img src="../assets/images/dining/{f}" alt="{alt}" loading="lazy"></a>'
    for f, alt in DINING_PHOTOS if f in ("dining-food.jpg", "dining-burger.jpg", "dining-pavilion.jpg", "dining-kare-kare.jpg")
)

dining_body = f"""
<section class="page-hero">
  <img src="../assets/images/dining/dining-pavilion.jpg" alt="The Pavilion's open-air dining hall facing the beach">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Dining &middot; Full Board</span>
    <h1>Every meal of your stay, <em style="font-style:italic;">taken care of.</em></h1>
    <p class="lede">Every overnight stay is full board &mdash; buffet breakfast, lunch and dinner are served at The Pavilion, steps from the sand.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="two-col-head">
      <div><span class="eyebrow">Full Board</span><h2>Three buffet meals, every day of your stay</h2></div>
      <p class="prose" style="max-width:46ch;">No menus to plan and no bills at every meal. Your first meal is lunch on the day you arrive, followed by dinner,
      then breakfast the next morning &mdash; and the same again for every night you stay.</p>
    </div>
    <div class="grid-3 meal-cards">
      <article class="card">
        <div class="card-media"><img src="../assets/images/dining/dining-bread.jpg" alt="Freshly baked breads at the breakfast buffet" loading="lazy"></div>
        <div class="card-body"><span class="meta">7:00 &ndash; 10:00 AM</span><h3>Buffet Breakfast</h3>
        <p class="prose" style="margin-top:8px; font-size:0.92rem;">Start slow with freshly baked bread and a spread of local and international favourites before your first swim.</p></div>
      </article>
      <article class="card">
        <div class="card-media"><img src="../assets/images/dining/dining-kare-kare.jpg" alt="Kare-kare with crispy pork belly and vegetables" loading="lazy"></div>
        <div class="card-body"><span class="meta">12:00 NN &ndash; 2:00 PM</span><h3>Buffet Lunch</h3>
        <p class="prose" style="margin-top:8px; font-size:0.92rem;">Waiting for you when you arrive &mdash; local classics and international dishes, served with a view of the cove.</p></div>
      </article>
      <article class="card">
        <div class="card-media"><img src="../assets/images/dining/dining-pasta.jpg" alt="Shrimp and tomato pasta served by the beach" loading="lazy"></div>
        <div class="card-body"><span class="meta">7:00 &ndash; 9:00 PM</span><h3>Buffet Dinner</h3>
        <p class="prose" style="margin-top:8px; font-size:0.92rem;">End the day al fresco under the Pavilion lights, with the sound of the waves just beyond your table.</p></div>
      </article>
    </div>
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="feature-row">
      <div>
        <span class="eyebrow">Meal Package</span>
        <h2>One simple rate per guest, per night</h2>
        <p class="prose" style="margin-top:16px;">The full-board meal package is part of every overnight stay, so everyone in your group is fed from arrival
        to check-out. It is added per guest, per night, on top of your casita rate &mdash; you'll see it itemised in your quotation before you pay.</p>
        <p class="prose" style="margin-top:12px;">For example, two adults staying one night enjoy six buffet meals between them for &#8369;5,390.</p>
        <div class="hero-actions" style="margin-top:24px;">
          <a class="btn btn-primary" href="{stay_link("../")}">Book Your Stay</a>
          <a class="btn btn-ghost" href="../overnight/index.html">See the Casitas</a>
        </div>
      </div>
      <div class="table-wrap">
        <table class="rate-table">
          <thead><tr><th>Guest</th><th class="num">Per night</th></tr></thead>
          <tbody>
            <tr><td>Adult (13 and up)</td><td class="num">&#8369;2,695</td></tr>
            <tr><td>Child (ages 6 to 12)</td><td class="num">&#8369;1,347.50</td></tr>
            <tr><td>Child (ages 0 to 5)</td><td class="num">Free</td></tr>
          </tbody>
        </table>
        <div class="fine-print">
          <p>Includes buffet breakfast, lunch and dinner. Senior Citizens and PWDs receive their 20% discount with a valid ID.</p>
          <p>All prices are inclusive of 12% VAT and Service Charge. Prices may be subject to change without prior notice.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="feature-row">
      <div class="feature-media"><img src="../assets/images/dining/dining-hero.jpg" alt="Wooden tables under the high roof of The Pavilion" loading="lazy"></div>
      <div>
        <span class="eyebrow">The Pavilion</span>
        <h2>Dine al fresco, right on the beach</h2>
        <p class="prose" style="margin-top:16px;">All meals are served at The Pavilion, our open-air dining hall facing the sea. The buffet changes through
        the day, mixing Filipino favourites with international fare, and every table comes with a view of the cove.</p>
        <p class="prose" style="margin-top:12px;">Pair your meal with fresh juices, cocktails and other drinks from the bar.</p>
      </div>
    </div>
  </div>
</section>

<section class="section-tight">
  <div class="wrap">
    <div class="two-col-head"><div><span class="eyebrow">Beyond the Buffet</span><h2>Cravings in between</h2></div></div>
    <div class="grid-3">
      <div><h3>&Agrave; la carte</h3><p class="prose" style="margin-top:8px;">Wood-fired pizza, burgers, pasta and more are available to order any time, in addition to your full-board meals.</p></div>
      <div><h3>Private dinner on the beach</h3><p class="prose" style="margin-top:8px;">Celebrating? Book a candlelit table for two by the shore. <a class="text-link" href="../experiences/index.html">See Experiences</a></p></div>
      <div><h3>Meals for your staff</h3><p class="prose" style="margin-top:8px;">Travelling with a driver or nanny? Meals for guests' staff are available at &#8369;825 per day.</p></div>
    </div>
    <div class="casita-gallery gallery-4 mt-lg" data-lightbox>{dining_gallery}
    </div>
    <p class="prose" style="margin-top:22px; font-size:0.92rem;">Coming for the day instead? Lunch is included in our <a class="text-link" href="../day-packages/index.html">Day Trip Package</a>.</p>
  </div>
</section>

<section class="center band-tint">
  <div class="wrap" style="max-width:640px; margin:0 auto;">
    <span class="eyebrow">Full board, every stay</span>
    <h2>Just bring your appetite</h2>
    <p class="prose mx-auto" style="margin-top:14px;">Choose your casita and we'll take care of breakfast, lunch and dinner.</p>
    <div class="hero-actions" style="justify-content:center; margin-top:20px;">
      <a class="btn btn-primary" href="{stay_link("../")}">Book Your Stay</a>
    </div>
  </div>
</section>
"""

page("dining/index.html", "Dining", "Full board at Virgin Beach Resort — buffet breakfast, lunch and dinner at The Pavilion are part of every overnight stay.", dining_body)


# ---------------------------------------------------------------- Experiences

EXPERIENCES = [
    ("Private Dining", "Make special moments even more memorable with a private dinner by the beach. Let you and your loved ones be enveloped in a warm ambience coupled with a sunset backdrop. Whether it's in celebration of an event or each other, we are sure to make this dinner a memorable one.", "dining2.jpg"),
    ("Bonfire by the Beach", "Enjoy a memorable evening with family and friends while roasting marshmallows and watching the stars come alive.", "mother-tree.jpg"),
    ("Massage", "Our visiting wellness experts are here to skillfully relieve your aching muscles and to provide the most restful experience.", "virgin-beach-resort-experiences-massage.jpg"),
    ("Kayaking", "Row towards the horizon and set out into the sea, just don't forget to come back!", "virgin-beach-resort-experiences-kayaking.jpg"),
    ("Boat Trip", "Set out to sea to marvel at the azure water and sky or go snorkeling at one of Laiya's marine sanctuaries.", "drone-shot-hero.jpg"),
    ("Biking &amp; Bird Watching", "Go on a mini-adventure by exploring the many scenic trails and paths found around the property. The opportunities for a wheely great ride are endless. Take a ride, enjoy a cool ocean breeze and keep your eyes peeled for various species of birds.", "virgin-beach-resort-laiya-experiences-biking-bird-watching.jpg"),
    ("Snorkeling", "Get acquainted with the breathtaking world below in either of Laiya's marine sanctuaries as you surround yourself with corals teeming with undersea life. Snorkels, goggles, and full face masks are available for rent and at your disposal all day.", "virgin-beach-resort-experiences-snorkeling-scaled.jpg"),
    ("ATV Riding", "Experience a mini-adventure by exploring the many scenic trails and paths around the property. Excite your senses with the ultimate off-road experience with our All Terrain Vehicles.", "hero-atv.jpg"),
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
  <img src="../assets/images/reef-of-virgin-beach.jpg" alt="Aerial view of a turquoise reef along the shoreline">
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
