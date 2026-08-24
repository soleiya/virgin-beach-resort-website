# -*- coding: utf-8 -*-
from build import page, CLOUDBEDS_URL

GALLERY_IMAGES = [
    "hero-coastline-aerial.jpg", "casita-king-interior.jpg", "aerial-cabanas-shoreline.jpg",
    "casita-queen-interior.jpg", "dining-lanterns-evening.jpg", "aerial-villas-cove.jpg",
    "casita-bamboo-interior.jpg", "reef-turquoise-aerial.jpg", "casita-louver-interior.jpg",
    "night-beach-lounge.jpg", "casita-sunrise-interior.jpg", "aerial-bay-mountains.jpg",
    "dining-pizza.jpg", "casita-king-bathtub.jpg", "aerial-cabanas-wide.jpg",
    "spa-towels-detail.jpg", "casita-queen-bathroom.jpg", "aerial-beach-vertical.jpg",
    "pavilion-porch-seating.jpg", "casita-bamboo-shower.jpg", "aerial-road-coast.jpg",
    "lounge-corner-orange.jpg", "casita-louver-bathroom.jpg", "night-beach-tree.jpg",
    "casita-bamboo-exterior.jpg", "aerial-extra-03.jpg", "casita-sunrise-bathroom.jpg",
    "aerial-extra-08.jpg", "interior-twin-beds.jpg", "aerial-extra-14.jpg",
    "casita-king-patio.jpg", "aerial-extra-19.jpg", "interior-desk-tv.jpg",
    "cottage-exterior-alt1.jpg", "aerial-extra-24.jpg", "lounge-sofa-room.jpg",
]

imgs_html = "".join(
    f'<img src="../assets/images/{img}" alt="Virgin Beach Resort" loading="lazy">'
    for img in GALLERY_IMAGES
)

body = f"""
<section class="page-hero">
  <img src="../assets/images/aerial-extra-19.jpg" alt="Aerial view of the resort's coastline">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Gallery</span>
    <h1>Paradise awaits.</h1>
    <p class="lede">The ambience and beauty of the place cannot be captured in photographs. Start your journey now.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="masonry">{imgs_html}
    </div>
  </div>
</section>

<section class="band-tint center">
  <div class="wrap" style="max-width:640px; margin:0 auto;">
    <h2>See it for yourself</h2>
    <a class="btn btn-primary mt-lg" href="{CLOUDBEDS_URL}">Book Now</a>
  </div>
</section>
"""

page("gallery/index.html", "Gallery", "Photos of Virgin Beach Resort — casitas, dining, the coastline, and Laiya's cleanest bay.", body)
