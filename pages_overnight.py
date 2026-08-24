# -*- coding: utf-8 -*-
from build import page, CASITAS, CLOUDBEDS_URL

FINE_PRINT = """
<div class="fine-print">
  <p>All prices are inclusive of 12% VAT and Service Charge.</p>
  <p>Room rates are exclusive of mandatory meal package.</p>
  <p>Peak season weekend rates will apply a day preceding long weekends, government declared holidays and holidays.</p>
  <p>Prices may be subject to change without prior notice.</p>
</div>
"""

RELATED_IMG = {
    "deluxe-king-casita": "casita-king-exterior.jpg",
    "double-queen-casita": "casita-queen-exterior.jpg",
    "sunrise-casita": "casita-sunrise-exterior.jpg",
    "louver-window-casita": "casita-louver-exterior.jpg",
    "bamboo-king-casita": "casita-bamboo-exterior.jpg",
    "bamboo-casita": "casita-bamboo-exterior-detail.jpg",
}


def related_rooms(current_slug):
    cards = ""
    for slug, name in CASITAS:
        if slug == current_slug:
            continue
        cards += f'''
      <a class="card" href="../{slug}/index.html">
        <div class="card-media"><img src="../../assets/images/{RELATED_IMG[slug]}" alt="{name}" loading="lazy"></div>
        <div class="card-body"><h3>{name}</h3><span class="text-link">See room</span></div>
      </a>'''
    return cards


def casita_page(slug, name, tagline, description, occupancy, beds, size, rate, features, images, note=None):
    hero_img, gallery_imgs = images[0], images[1:]
    gallery_html = "".join(
        f'<div class="feature-media"><img src="../../assets/images/{img}" alt="{name} — interior view" loading="lazy"></div>'
        for img in gallery_imgs
    )
    feature_tags = "".join(f"<span>{f}</span>" for f in features)
    note_html = f'<p class="prose" style="margin-top:14px;">{note}</p>' if note else ""

    body = f"""
<section class="page-hero">
  <img src="../../assets/images/{hero_img}" alt="{name} at Virgin Beach Resort">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Overnight &middot; Casita</span>
    <h1>{name}</h1>
    <p class="lede">{tagline}</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="feature-row">
      <div>
        <p class="prose" style="font-size:1.1rem; color:var(--ink);">{description}</p>
        {note_html}
        <ul class="spec-list mt-lg">
          <li><span class="k">Occupancy</span><span class="v">{occupancy}</span></li>
          <li><span class="k">Beds</span><span class="v">{beds}</span></li>
          <li><span class="k">Size</span><span class="v">{size}</span></li>
          <li><span class="k">Rate</span><span class="v">Starts at &#8369;{rate}</span></li>
        </ul>
        <div class="feature-tags">{feature_tags}</div>
        <div class="hero-actions" style="margin-top:30px;">
          <a class="btn btn-primary" href="{CLOUDBEDS_URL}">Book Now</a>
          <a class="btn btn-ghost" href="../../terms-and-conditions.html">See Terms and Conditions</a>
        </div>
      </div>
      <div class="feature-media"><img src="../../assets/images/{gallery_imgs[0] if gallery_imgs else hero_img}" alt="{name} interior"></div>
    </div>

    <div class="grid-2 mt-lg">{"".join(f'<div class="feature-media wide"><img src="../../assets/images/{img}" alt="{name} detail" loading="lazy"></div>' for img in gallery_imgs[1:])}
    </div>

    {FINE_PRINT}
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="two-col-head"><h2>Other Casitas</h2></div>
    <div class="grid-3">{related_rooms(slug)}
    </div>
  </div>
</section>
"""
    page(f"overnight/{slug}/index.html", name, f"{name} at Virgin Beach Resort — {tagline}", body)


# ---------------------------------------------------------------- overnight index

RATES = {
    "deluxe-king-casita": ("52 m&sup2;", "2 Persons", "18,525", "21,825"),
    "double-queen-casita": ("52 m&sup2;", "4 Persons", "18,525", "21,825"),
    "sunrise-casita": ("35 m&sup2;", "4 Persons", "15,525", "17,525"),
    "louver-window-casita": ("35 m&sup2;", "4 Persons", "14,525", "16,525"),
    "bamboo-king-casita": ("30 m&sup2;", "2 Persons", "9,225", "12,925"),
    "bamboo-casita": ("30 m&sup2;", "4 Persons", "9,225", "12,925"),
}
IMG = {
    "deluxe-king-casita": "casita-king-exterior.jpg",
    "double-queen-casita": "casita-queen-exterior.jpg",
    "sunrise-casita": "casita-sunrise-exterior.jpg",
    "louver-window-casita": "casita-louver-exterior.jpg",
    "bamboo-king-casita": "casita-bamboo-exterior.jpg",
    "bamboo-casita": "casita-bamboo-exterior-detail.jpg",
}
BLURB = {
    "deluxe-king-casita": "Perfect for couples out for a romantic getaway — sublime wooden furniture, a bathtub, and a private outdoor shower.",
    "double-queen-casita": "A quaint elegance for a small group or family, with a subtle modern touch.",
    "sunrise-casita": "Sliding glass doors in front make this casita suited for early risers who can't wait to get to the beach.",
    "louver-window-casita": "A wooden door and wooden jalousies provide a cozier ambiance for late risers.",
    "bamboo-king-casita": "Canopied and inspired by traditional Filipino architecture, with wide sliding doors toward the sea.",
    "bamboo-casita": "Canopied and inspired by traditional Filipino architecture, sized for a small family.",
}

rows = ""
cards = ""
for slug, name in CASITAS:
    size, occ, wd, we = RATES[slug]
    rows += f"""<tr><td>{name}</td><td class="num">{size}</td><td class="num">{occ}</td><td class="num">&#8369;{wd}</td><td class="num">&#8369;{we}</td></tr>"""
    cards += f'''
      <a class="card" href="{slug}/index.html">
        <div class="card-media"><img src="../assets/images/{IMG[slug]}" alt="{name}" loading="lazy"></div>
        <div class="card-body">
          <span class="meta">{occ}</span>
          <h3>{name}</h3>
          <p style="font-size:0.92rem;">{BLURB[slug]}</p>
          <div class="price">Starts at <b>&#8369;{wd}</b> / night</div>
        </div>
      </a>'''

overnight_body = f"""
<section class="page-hero">
  <img src="../assets/images/aerial-villas-cove.jpg" alt="Aerial view of Virgin Beach Resort's casitas along the cove">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Overnight</span>
    <h1>A perfect escape from the city.</h1>
    <p class="lede">Bring yourself to the perfect tropical getaway and stay in any of our oceanfront accommodations.</p>
  </div>
</section>

<section class="section-tight">
  <div class="wrap">
    <p class="prose" style="font-size:1.05rem;">Our rooms come with an understated elegance that feels like home. While the day away in one of our many
    lounge cabanas, hammocks, swings, and lounge chairs. This serene escape is the ultimate retreat to relax and destress.</p>
  </div>
</section>

<section class="section-tight">
  <div class="wrap">
    <div class="grid-3">{cards}
    </div>
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="two-col-head"><h2>Rates at a glance</h2></div>
    <div class="table-wrap">
      <table class="rate-table">
        <thead><tr><th>Casita</th><th class="num">Size</th><th class="num">Occupancy</th><th class="num">Weekday</th><th class="num">Weekend</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
    {FINE_PRINT}
  </div>
</section>
"""
page("overnight/index.html", "Overnight", "Oceanfront casitas at Virgin Beach Resort — rates, sizes, and room details.", overnight_body)


# ---------------------------------------------------------------- casita pages

casita_page(
    "deluxe-king-casita", "Deluxe King Casita",
    "Spend your most intimate moments in only the finest of accommodations.",
    "Our Deluxe King Casita is perfect for couples out for a romantic getaway. This lovely casita stuns on the inside with sublime wooden furniture and features a bathtub and private outdoor shower.",
    "2 Persons", "King-sized Bed", "52 m&sup2;", "18,525",
    ["Private Outdoor Shower", "Elevated Patio with sofa", "Daybed", "Bathtub", "Air-conditioning", "Satellite TV",
     "Writing Desk", "In-room Safe", "Mini-bar &amp; Refrigerator", "Complimentary Coffee and Tea", "Power Outlets (220v)",
     "Extra Person may be Added, Charges Apply"],
    ["casita-king-exterior.jpg", "casita-king-interior.jpg", "casita-king-patio.jpg", "casita-king-bathtub.jpg"],
)

casita_page(
    "double-queen-casita", "Deluxe Double Queen Casita",
    "Experience a quiet indulgence in our Deluxe Double Queen Casita.",
    "Perfect for a small group or family, our spacious Deluxe Double Queen Casita exudes a quaint elegance. Designed with a subtle modern touch, this room proves to be both functional and stylish in its simplicity.",
    "4 Persons", "2 Queen-sized Beds", "52 m&sup2;", "18,525",
    ["Private Outdoor Shower", "Elevated Patio with sofa", "Bathtub", "Air-conditioning", "Satellite TV",
     "Writing Desk", "In-room Safe", "Mini-bar &amp; Refrigerator", "Complimentary Coffee and Tea", "Power Outlets (220v)",
     "Extra Person may be Added, Charges Apply"],
    ["casita-queen-exterior.jpg", "casita-queen-interior.jpg", "casita-queen-interior-2.jpg", "casita-queen-bathroom.jpg"],
)

casita_page(
    "sunrise-casita", "Sunrise Casita",
    "Rise and shine, and let the light in your stylish casita.",
    "With sliding glass doors in front, along with its window treatment, this casita is suited for early risers who can't wait to get to the beach.",
    "4 Persons", "2 Queen-sized Beds", "35 m&sup2;", "15,525",
    ["Elevated Patio with sofa", "Air-conditioning", "Writing Desk", "In-room Safe", "Complimentary Coffee and Tea", "Power Outlets (220v)"],
    ["casita-sunrise-exterior.jpg", "casita-sunrise-interior.jpg", "casita-sunrise-bathroom.jpg"],
)

casita_page(
    "louver-window-casita", "Louver-Window Casita",
    "Create the perfect and intimate abode in our Louver-Window Casita.",
    "For late risers and those who want a bit more privacy, our Louver-Window Casita comes with a wooden door and wooden jalousies that provide a cozier ambiance.",
    "4 Persons", "2 Queen-sized Beds", "35 m&sup2;", "14,525",
    ["Elevated Patio with sofa", "Air-conditioning", "Writing Desk", "In-room Safe", "Complimentary Coffee and Tea", "Power Outlets (220v)", "Extra Person may be Added, Charges Apply"],
    ["casita-louver-exterior.jpg", "casita-louver-interior.jpg", "casita-louver-interior-2.jpg", "casita-louver-bathroom.jpg"],
)

casita_page(
    "bamboo-king-casita", "Bamboo King Casita",
    "Transport yourself to simpler days in our canopied bamboo casita.",
    "Inspired by traditional Filipino architecture with its bamboo build and cozy interiors, popular among our guests. Its wide floor-to-ceiling sliding doors can either be enclosed or left open to provide a view of the sea. Its elevated patio is the perfect spot to lounge.",
    "2 Persons", "1 King Bed", "30 m&sup2;", "9,225",
    ["Elevated Patio with sofa", "In-room Safe", "Complimentary Coffee and Tea", "Power Outlets (220v)", "Air-conditioning"],
    ["casita-bamboo-exterior.jpg", "casita-bamboo-king-interior.jpg", "casita-bamboo-exterior-detail.jpg"],
)

casita_page(
    "bamboo-casita", "Bamboo Casita",
    "Transport yourself to simpler days in our canopied bamboo casitas.",
    "Inspired by traditional Filipino architecture with its bamboo build and cozy interiors, popular among our guests. Its wide floor-to-ceiling sliding doors can either be enclosed or left open to provide a view of the sea. Its elevated patio is the perfect spot to lounge.",
    "4 Persons", "2 Queen Beds", "30 m&sup2;", "9,225",
    ["Elevated Patio with sofa", "In-room Safe", "Complimentary Coffee and Tea", "Power Outlets (220v)", "Air-conditioning"],
    ["casita-bamboo-exterior-detail.jpg", "casita-bamboo-interior.jpg", "casita-bamboo-interior-2.jpg", "casita-bamboo-shower.jpg"],
)
