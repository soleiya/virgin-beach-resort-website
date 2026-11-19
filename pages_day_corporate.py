# -*- coding: utf-8 -*-
from build import page, booking_form_section, booking_scripts, asset_v

FINE_PRINT_A = """
<div class="fine-print">
  <p>Prices may be subject to change without prior notice.</p>
</div>
"""

# ---------------------------------------------------------------- Cabana gallery (Day Trip)
# Full-size photos in assets/images/daytrip/, grid thumbnails in daytrip/thumbs/.
DAYTRIP_GALLERY = [
    ("dining", "Dining Cabanas", "Open thatched pavilions with a long bamboo table and benches &mdash; lunch is served right here.", [
        ("dining-04", "Rows of thatched dining cabanas under the trees along the beach"),
        ("dining-02", "Inside a dining cabana: bamboo table under the thatched roof, sea beyond"),
        ("dining-06", "Two dining cabanas framing the path to the beach"),
        ("dining-05", "Looking out from a dining cabana down the row of pavilions"),
        ("dining-03", "Dining cabana roof and bamboo table with loungers on the shore"),
        ("dining-01", "A dining cabana by the water, seen through the trees"),
    ]),
    ("lounge", "Lounge Cabanas", "Curtained cabanas with a cushioned daybed &mdash; shade, privacy and a sea view for up to 4.", [
        ("lounge-02", "Lounge cabana daybed with white pillows inside drawn curtains"),
        ("lounge-12", "White lounge cabana on the sand facing the blue sea"),
        ("lounge-07", "Inside a lounge cabana with tan curtains, cushioned daybed and chairs"),
        ("lounge-05", "Lounge cabana with curtains tied back, daybed and chairs"),
        ("lounge-13", "Row of lounge cabanas with chairs along the beach"),
        ("lounge-21", "Lounge cabana on the beach at sunset"),
        ("lounge-03", "Lounge cabana interior with daybed mats, chairs and side table"),
        ("lounge-22", "Lounge cabana by the water under a clear sky"),
        ("lounge-11", "Lounge cabana lit up at dusk"),
        ("lounge-06", "Lounge cabana with curtains open and chairs on the sand"),
        ("lounge-10", "Daybed inside a lounge cabana looking out to sea"),
        ("lounge-01", "Lounge cabana with tan curtains and bamboo daybed"),
        ("lounge-04", "Row of tan-curtained cabanas beneath the trees"),
        ("lounge-15", "Cushioned daybed inside a lounge cabana with tan curtains"),
        ("lounge-09", "Lounge cabana among beach greenery with the sea behind"),
        ("lounge-19", "Lounge cabana on the shore seen from a neighbouring pavilion"),
        ("lounge-20", "Lounge cabana tucked among trees by the sea"),
        ("lounge-25", "Close view of a curtained lounge cabana on the sand"),
        ("lounge-14", "Lounge cabana framed by palms and trees"),
        ("lounge-16", "Lounge cabana with table and chairs, dining pavilions behind"),
        ("lounge-17", "Daybed mats inside a curtained lounge cabana"),
        ("lounge-08", "Row of lounge cabanas with white chairs"),
        ("lounge-26", "Path past a line of lounge cabanas"),
        ("lounge-23", "Tan-curtained cabanas under large shade trees"),
        ("lounge-27", "View of the sea through the tan curtains of a lounge cabana"),
        ("lounge-24", "Lounge cabana by the sea, seen through branches"),
    ]),
    ("beach", "The Beach", "White sand, clear water and loungers just steps from every cabana.", [
        ("beach-03", "Thatched umbrellas and loungers on the white sand beach"),
        ("beach-04", "Couple walking toward the clear blue water"),
        ("beach-02", "Beach umbrellas and loungers under big white clouds"),
        ("beach-05", "Sun loungers in front of the lounge cabanas"),
        ("beach-01", "Aerial view of the cabanas along the shoreline"),
    ]),
]

DAYTRIP_GALLERY_CSS = """
<style>
.cg-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 18px;}
.cg-tabs button{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:600 .92rem var(--font-body);padding:10px 18px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:background .2s,color .2s,border-color .2s;}
.cg-tabs button:hover{border-color:var(--lagoon);}
.cg-tabs button[aria-selected="true"]{background:var(--lagoon-deep);border-color:var(--lagoon-deep);color:#fff;}
.cg-tabs .cg-n{font-size:.75rem;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--sand-deep);color:var(--ink-soft);}
.cg-tabs button[aria-selected="true"] .cg-n{background:rgba(255,255,255,.18);color:#fff;}
.cg-blurb{margin:0 0 16px;}
.cg-mosaic{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:clamp(130px,15vw,200px);grid-auto-flow:dense;gap:10px;}
.cg-tile{display:block;overflow:hidden;border-radius:12px;background:var(--sand-deep);cursor:zoom-in;}
.cg-tile img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .6s ease;}
.cg-tile:hover img,.cg-tile:focus-visible img{transform:scale(1.05);}
.cg-tile.is-big{grid-column:span 2;grid-row:span 2;}
.cg-tile.is-wide{grid-column:span 2;}
.cg-mosaic.is-collapsed .cg-tile:nth-child(n+9){display:none;}
.cg-more{display:block;margin:18px auto 0;}
.cg-jump{display:inline-block;margin-top:10px;font-weight:600;font-size:.9rem;color:var(--lagoon-deep);}
@media (max-width:720px){.cg-mosaic{grid-template-columns:repeat(2,1fr);grid-auto-rows:34vw;gap:8px;}.cg-tabs button{padding:9px 14px;font-size:.86rem;}}
</style>
"""

DAYTRIP_GALLERY_JS = """
<script>
(function(){
  var root=document.getElementById('cabanaGallery'); if(!root) return;
  var tabs=[].slice.call(root.querySelectorAll('[role=tab]'));
  function select(t,focus){
    tabs.forEach(function(b){var on=b===t;b.setAttribute('aria-selected',on?'true':'false');b.tabIndex=on?0:-1;document.getElementById(b.getAttribute('aria-controls')).hidden=!on;});
    if(focus)t.focus();
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(){select(t);});
    t.addEventListener('keydown',function(e){var d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(d){e.preventDefault();select(tabs[(i+d+tabs.length)%tabs.length],true);}});
  });
  root.querySelectorAll('[data-more]').forEach(function(b){b.addEventListener('click',function(){b.previousElementSibling.classList.remove('is-collapsed');b.remove();});});
  document.querySelectorAll('[data-gallery-tab]').forEach(function(a){a.addEventListener('click',function(){var t=document.getElementById('cg-tab-'+a.getAttribute('data-gallery-tab'));if(t)select(t);});});
})();
</script>
"""


def _mosaic_shapes(n):
    """Tile shapes that fill a 4-column (and 2-column) grid with no gaps:
    blocks of 8 = big, 4 small, wide, 2 small (3 rows); the last partial block
    is padded by widening its trailing tiles."""
    shapes = []
    full, r = divmod(n, 8)
    for _ in range(full):
        shapes += ["big", "", "", "", "", "wide", "", ""]
    if r:
        tail = (["big"] if r >= 3 else []) + [""] * (r - (1 if r >= 3 else 0))
        cells = lambda t: sum(4 if x == "big" else 2 if x == "wide" else 1 for x in t)
        i = len(tail) - 1
        while cells(tail) % 4 and i >= 0:
            if tail[i] == "":
                tail[i] = "wide"
            i -= 1
        shapes += tail
    return shapes


def daytrip_gallery_html():
    tabs, panels = [], []
    for i, (key, label, blurb, photos) in enumerate(DAYTRIP_GALLERY):
        on = i == 0
        tabs.append(
            '<button type="button" role="tab" id="cg-tab-%s" aria-controls="cg-panel-%s" aria-selected="%s"%s>%s <span class="cg-n">%d</span></button>'
            % (key, key, "true" if on else "false", "" if on else ' tabindex="-1"', label, len(photos)))
        shapes = _mosaic_shapes(len(photos))
        items = "".join(
            '<a class="cg-tile%s" href="../assets/images/daytrip/%s.jpg"><img src="../assets/images/daytrip/thumbs/%s.jpg" alt="%s" loading="lazy" decoding="async"></a>'
            % ((" is-" + sh) if sh else "", f, f, alt) for (f, alt), sh in zip(photos, shapes))
        collapsed = len(photos) > 8
        more = ('<button type="button" class="btn btn-ghost cg-more" data-more>Show all %d photos</button>' % len(photos)) if collapsed else ""
        panels.append(
            '<div class="cg-panel" role="tabpanel" id="cg-panel-%s" aria-labelledby="cg-tab-%s"%s>\n'
            '      <p class="prose cg-blurb">%s</p>\n'
            '      <div class="cg-mosaic%s" data-lightbox>%s</div>\n'
            '      %s\n    </div>'
            % (key, key, "" if on else " hidden", blurb, " is-collapsed" if collapsed else "", items, more))
    return (
        '\n<section id="cabanaGallery" class="cabana-gallery">\n  <div class="wrap">\n'
        '    <div class="two-col-head"><div><span class="eyebrow">Gallery</span><h2>See the cabanas</h2></div>\n'
        '      <p class="prose" style="max-width:44ch;">Tap any photo to view it full screen, then swipe or use the arrows to browse.</p></div>\n'
        '    <div class="cg-tabs" role="tablist" aria-label="Cabana photos">' + "".join(tabs) + '</div>\n    '
        + "\n    ".join(panels) + '\n  </div>\n</section>\n' + DAYTRIP_GALLERY_CSS + DAYTRIP_GALLERY_JS)


# ---------------------------------------------------------------- Day Trip

day_body = """
<section class="page-hero day-hero">
  <img src="../assets/images/day-trip-area.jpg" alt="Aerial view of dining and lounge cabanas along the shoreline, mountains in the background">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Day Trip</span>
    <h1>A fleeting escape that will leave you wanting more.</h1>
    <p class="lede">Pick your date and party &mdash; see how many cabanas are free and your price right away.</p>

    <form class="quickbook" id="dayQuick" novalidate>
      <div class="qb-fields qb-day4">
        <label class="qb-field"><span>Date of your visit</span><input type="date" id="dqDate" required data-booking-date="visit"></label>
        <label class="qb-field qb-small"><span>Adults</span><select id="dqAdults"></select></label>
        <label class="qb-field qb-small"><span>Kids 6&ndash;12</span><select id="dqKids"></select></label>
        <label class="qb-field qb-small"><span>Kids 0&ndash;5</span><select id="dqKids05"></select></label>
        <button type="submit" class="btn btn-primary qb-go">See available cabanas</button>
      </div>
      <p class="qb-error" id="dqError" hidden></p>
    </form>
  </div>
</section>

<section class="center" id="planYourTrip" style="max-width:640px; margin:0 auto; padding-bottom:0;">
  <span class="eyebrow">Reservations</span>
  <h2>Plan your day trip</h2>
  <p class="prose mx-auto" style="margin-top:14px;">Choose how many cabanas you need, tell us who's coming, and your quotation with the full amount arrives by email right away. Prefer to talk first?
  Call <a class="text-link" href="tel:+639177920712">+63 917 792 0712</a> (Globe) or <a class="text-link" href="tel:+639294309109">+63 929 430 9109</a> (Smart), or email
  <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></p>
</section>

<section>
  <div class="wrap" style="max-width:760px;">
    {booking_form}
  </div>
</section>

<section class="section-tight center day-details-head" style="padding-bottom:0;">
  <div class="wrap" style="max-width:640px; margin:0 auto;">
    <span class="eyebrow">Good to know</span>
    <h2>What&rsquo;s included</h2>
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
          <tr><td>Pets</td><td class="num">&#8369;750.00</td></tr>
        </tbody>
      </table>
    </div>
    <p class="prose" style="margin-top:20px; font-size:0.92rem;">&Agrave; la carte dining and snacks are available for merienda upon request.</p>
  </div>
</section>

<section class="band-tint">
  <div class="wrap">
    <div class="two-col-head">
      <div><span class="eyebrow">Walk-Ins</span><h2>Half-Day Trip</h2></div>
      <p class="prose" style="max-width:44ch;">Inclusive of entrance and afternoon snacks, 1:00 PM &ndash; 5:00 PM. For same-day walk-ins only &mdash; choose today's date on the form below and the Half-Day option will appear.</p>
    </div>
    <div class="grid-2 mt-lg">
      <div class="card">
        <div class="card-body">
          <h3>Half-Day Trip <span class="field-hint" style="font-weight:400;">(same-day only)</span></h3>
          <p class="prose" style="margin:10px 0 16px; font-size:0.92rem;">A shorter afternoon at the same beach, same cabanas &mdash; with afternoon snacks included for every guest. Subject to availability on the day.</p>
          <div class="table-wrap">
            <table class="rate-table">
              <tbody>
                <tr><td>Adults</td><td class="num">&#8369;800.00</td></tr>
                <tr><td>Children (6&ndash;12)</td><td class="num">&#8369;550.00</td></tr>
                <tr><td>Pets</td><td class="num">&#8369;375.00</td></tr>
                <tr><td>Dining Cabana</td><td class="num">&#8369;750.00</td></tr>
                <tr><td>Lounge Cabana</td><td class="num">&#8369;1,000.00</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-body">
          <h3>Afternoon Snacks <span class="field-hint" style="font-weight:400;">(included)</span></h3>
          <p class="prose" style="margin:10px 0 16px; font-size:0.92rem;">Every Half-Day guest enjoys one snack set &mdash; a savoury dish, a sandwich and a classic Filipino cold dessert.</p>
          <ul class="snack-sets">
            <li><b>Set A</b><span>Penne Salsiccia &middot; Ham &amp; Cheese Sandwich &middot; Mais con Hielo</span></li>
            <li><b>Set B</b><span>Canton Guisado &middot; Tuna Sandwich &middot; Saba con Hielo</span></li>
            <li><b>Set C</b><span>Bihon Guisado &middot; Chicken Sandwich &middot; Halo-Halo</span></li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="two-col-head"><div><span class="eyebrow">Cabanas</span><h2>Available Facilities</h2></div></div>
    <div class="grid-2">
      <div class="card">
        <div class="card-media has-alt">
          <img class="is-active" src="../assets/images/dining-cabana-thatch.jpg" alt="Dining Cabana, seating under a thatched pavilion by the beach">
          <img src="../assets/images/dining-cabana-thatch-exterior.jpg" alt="Dining Cabana, exterior view of the thatched pavilion on the sand">
          <button type="button" class="card-media-toggle" data-label-primary="View exterior" data-label-alt="View interior">View exterior</button>
        </div>
        <div class="card-body"><span class="meta">10 Persons</span><h3>Dining Cabana</h3><div class="price"><b>&#8369;1,500</b></div><a class="cg-jump" href="#cabanaGallery" data-gallery-tab="dining">See all dining photos &rarr;</a></div>
      </div>
      <div class="card">
        <div class="card-media has-alt">
          <img class="is-active" src="../assets/images/lounge-cabana-canopy.jpg" alt="Lounge Cabana, curtained daybed facing the ocean">
          <img src="../assets/images/lounge-cabana-canopy-exterior.jpg" alt="Lounge Cabana, exterior view of the curtained cabana on the sand">
          <button type="button" class="card-media-toggle" data-label-primary="View exterior" data-label-alt="View interior">View exterior</button>
        </div>
        <div class="card-body"><span class="meta">4 Persons</span><h3>Lounge Cabana</h3><div class="price"><b>&#8369;2,000</b></div><a class="cg-jump" href="#cabanaGallery" data-gallery-tab="lounge">See all lounge photos &rarr;</a></div>
      </div>
    </div>
    {fine_print_1}
  </div>
</section>
{cabana_gallery}
<section class="band-tint center">
  <div class="wrap" style="max-width:560px; margin:0 auto;">
    <span class="eyebrow">Already booked?</span>
    <h2>Pay for your booking</h2>
    <p class="prose mx-auto mt-lg">Pay your down payment or balance online &mdash; card, GCash, Maya and more &mdash; with the Booking ID from your quotation email, and upload any Senior / PWD IDs or pet vaccination cards.</p>
    <a class="btn btn-ghost mt-lg" href="../pay/index.html">Pay online</a>
  </div>
</section>
{booking_scripts_html}
<script src="../assets/js/day-quick.js?v={dq_v}"></script>
""".format(fine_print_1=FINE_PRINT_A, cabana_gallery=daytrip_gallery_html(), dq_v=asset_v("assets/js/day-quick.js"), booking_form=booking_form_section("day_trip"), booking_scripts_html=booking_scripts())

page("day-packages/index.html", "Day Trip", "Day Trip packages at Virgin Beach Resort — dining and lounge cabanas, with instant online booking.", day_body, cta_label="Book a Day Trip", cta_href="#planYourTrip")


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
        <a class="btn btn-primary mt-lg" href="mailto:events@virginbeachresort.com?subject=Corporate%20Outing%20Proposal%20Request">Request for a Proposal</a>
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
  <p class="prose mx-auto" style="margin-top:14px;">For inquiries, call our reservations office at <a class="text-link" href="tel:+639177920712">+63 917 792 0712</a> (Globe) or <a class="text-link" href="tel:+639294309109">+63 929 430 9109</a> (Smart), or email
  <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></p>
  <a class="btn btn-primary mt-lg" href="mailto:events@virginbeachresort.com?subject=Corporate%20Outing%20Proposal%20Request">Request for a Proposal</a>
</section>
"""

page("corporate/index.html", "Corporate", "Corporate outings and team building packages at Virgin Beach Resort, for groups of 30 or more.", corp_body)
