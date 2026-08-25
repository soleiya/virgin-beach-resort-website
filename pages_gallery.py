# -*- coding: utf-8 -*-
from build import page, CLOUDBEDS_URL

GALLERY_IMAGES = [
    "drone-hero.jpg", "casita-king-interior.jpg", "ATV-and-view.jpg",
    "Hero-Virgin-vertical.jpg", "dining-area1.jpg", "casita-queen-interior.jpg",
    "reef-of-virgin.jpg", "bamboo-casita-romantic.jpg", "18-private-villas-only.jpg",
    "mother-tree.jpg", "casita-sunrise-interior.jpg", "Day-Trip-Area-with-mountains-at-the-back.jpg",
    "our-service.jpg", "hero-image-vertical.jpg",
    "virgin-beach-resort-experiences-massage.jpg", "path-way-to-the-beach.jpg",
    "dining2.jpg", "Private-Duluxe-Villa.jpg", "fire-tree-and-coastline.jpg",
    "virgin-beach-resort-experiences-kayaking.jpg", "roads-inside-virgin-beach.jpg",
    "bamboo-casita-day.jpg", "Hero-Day-Trip-vertical.jpg",
    "hero-atv.jpg", "interior-twin-beds.jpg", "corporate-outing.jpg",
    "sunrise-casita-sunset.jpg", "virgin-beach-resort-laiya-experiences-hero.jpg", "interior-desk-tv.jpg",
    "cottage-exterior-alt1.jpg", "Private-villas-tucked-in-the-canopy-shade-of-the-surrounding-trees.jpg", "lounge-sofa-room.jpg",
    "virgin-beach-resort-experiences-snorkeling-scaled.jpg", "ATV-ride.jpg", "day-trip-area.jpg",
    "virgin-beach-resort-laiya-experiences-biking-bird-watching.jpg", "Hero-Day-Trip-vertical-2.jpg", "drone-shot-hero.jpg",
    "private-villas-tucked-in.jpg", "bamboo-basita.jpg", "Private-Cabana-Day-Trip-with-family.jpg",
    "hero-drone-vertical.jpg", "reef-of-virgin-beach.jpg", "deluxe-room.jpg",
    "Day-trip-cabanass.jpg", "day-trip-cabanas.jpg", "day-trip.jpg",
]

imgs_html = "".join(
    f'<img src="../assets/images/{img}" alt="Virgin Beach Resort" loading="lazy">'
    for img in GALLERY_IMAGES
)

body = f"""
<section class="page-hero">
  <img src="../assets/images/hero.jpg" alt="Aerial view of the resort's coastline">
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
