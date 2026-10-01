#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Static site generator for the Virgin Beach Resort rebuild.
Keeps header/footer/head DRY across every page; content per page is
authored below using the exact copy pulled from virginbeachresort.com."""

import os

ROOT = os.path.dirname(os.path.abspath(__file__))


def asset_v(rel):
    """Cache-busting ?v= for an asset (short hash of its contents), so guests'
    browsers pick up a changed script/stylesheet right away."""
    import hashlib
    with open(os.path.join(ROOT, rel), "rb") as fh:
        return hashlib.sha1(fh.read()).hexdigest()[:10]

with open(os.path.join(ROOT, "assets/brand/favicon-b64.txt"), "r", encoding="utf-8") as _f:
    FAVICON_B64 = _f.read().strip()

CASITAS = [
    ("deluxe-king-casita", "Deluxe King Casita"),
    ("double-queen-casita", "Deluxe Double Queen Casita"),
    ("sunrise-casita", "Sunrise Casita"),
    ("louver-window-casita", "Louver-Window Casita"),
    ("bamboo-king-casita", "Bamboo King Casita"),
    ("bamboo-casita", "Bamboo Casita"),
]

NAV_ITEMS = [
    ("index.html", "Home", None),
    ("overnight/index.html", "Overnight", [(f"overnight/{slug}/index.html", name) for slug, name in CASITAS]),
    ("day-packages/index.html", "Day Trip", None),
    ("corporate/index.html", "Corporate", None),
    ("dining/index.html", "Dining", None),
    ("experiences/index.html", "Experiences", None),
    ("gallery/index.html", "Gallery", None),
    ("faq/index.html", "FAQ", None),
    ("contact/index.html", "Contact", None),
]

# Overnight room reservations go to Cloudbeds (same redirect the current
# virginbeachresort.com uses) — not handled by this site's own booking form.
CLOUDBEDS_URL = "https://booking.virginbeachresort.com"


def book_link(base, **params):
    """Link to the self-managed booking page (Day Trip / Corporate requests
    only — Overnight uses CLOUDBEDS_URL instead), optionally pre-filling it
    via query params."""
    url = f"{base}book/index.html"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url += f"?{qs}"
    return url


BOOKING_TYPE_LABELS = [
    ("day_trip", "Day Trip (Full Day)"),
    ("half_day", "Half-Day Trip (1:00 PM – 5:00 PM)"),
]

COUNTRIES = [
    "Philippines", "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia",
    "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Belarus", "Belgium",
    "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei",
    "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada", "Chile", "China",
    "Colombia", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Dominican Republic",
    "Ecuador", "Egypt", "El Salvador", "Estonia", "Ethiopia", "Fiji", "Finland", "France", "Georgia",
    "Germany", "Ghana", "Greece", "Guatemala", "Honduras", "Hong Kong", "Hungary", "Iceland", "India",
    "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan",
    "Kazakhstan", "Kenya", "Kuwait", "Laos", "Latvia", "Lebanon", "Libya", "Liechtenstein",
    "Lithuania", "Luxembourg", "Macao", "Malaysia", "Maldives", "Malta", "Mexico", "Moldova",
    "Monaco", "Mongolia", "Montenegro", "Morocco", "Myanmar", "Nepal", "Netherlands",
    "New Zealand", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan",
    "Panama", "Papua New Guinea", "Paraguay", "Peru", "Poland", "Portugal", "Qatar", "Romania",
    "Russia", "Rwanda", "Saudi Arabia", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia",
    "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Taiwan",
    "Tajikistan", "Tanzania", "Thailand", "Tunisia", "Turkey", "Ukraine", "United Arab Emirates",
    "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen",
]


PET_POLICY = [
    "Only dogs or cats are allowed as pets in the Resort. No other animals may be kept in the property.",
    "A maximum of two pets are permitted per reservation. Pets shall have a maximum height of 121 centimeters (4 ft.). Cats shall be limited to domestic or house cats.",
    "The guest shall pay the disinfection cleaning fee upon check-in. The fee is non-refundable: Overnight Stay &mdash; PHP 750 per pet per night; Day Trip &mdash; PHP 750 per pet per stay.",
    "Pet owners should provide the following: vaccination records, pet food, water bowls and leash.",
    "Pets are allowed only in the rooms in which they are registered.",
    "Keep your pet leashed at all times as you head out of your room; pets must be accompanied by their owners in public places at all times.",
    "All pet vaccinations must be current and valid, and must be presented upon check-in.",
    "Pets should not have been sick in the last seventy-two (72) hours.",
    "Dogs that are in heat are strictly not allowed on the resort premises.",
    "All pets must be clean, well-groomed, and completely free of fleas and ticks.",
    "Pet owners shall use only the entry and exit points in the main lobby as specified by the Resort Management.",
    "Pets are welcome to stay in designated garden or lawn areas, subject to availability. Owners are responsible for cleaning up after their pets.",
    "Burying pet waste in the sand is strictly prohibited. Dispose of pet waste using the bags provided upon check-in and place them in designated bins. Repeated violations: first &mdash; friendly reminder; second &mdash; PHP 1,000 fine; third &mdash; possible removal of the pet from common areas.",
    "Pets may not be left unattended. Pets left unattended for more than twenty-four (24) hours shall be considered abandoned and reported to the proper authorities; the registered guest shall indemnify Resort Management for any resulting costs, losses or damages.",
    "All equipment for the upkeep and feeding of pets is provided by the guest. Resort equipment, bathtubs, towels and linen may not be used for pets; stained linen is charged twice the regular laundry rate and permanently stained linen at replacement cost.",
    "Pet owners are expected to promptly and respectfully address concerns raised by fellow guests about noise or disturbances. A pet that is aggressive, excessively disruptive or deemed unsafe may be asked to leave the property immediately.",
    "Resort Management reserves the right to request room changes, require the removal of pet(s), or discontinue service &mdash; without refund &mdash; if a pet is found to be dangerous, unwell, disruptive, destructive, or if any pet guideline is not followed.",
    "During housekeeping service the guest is requested to remove their pet from the room; call Housekeeping to arrange a convenient time.",
    "Any damage caused by the pet(s) shall be charged to the registered guest and must be paid immediately upon presentation of an invoice.",
    "The Resort Management and its employees shall not be liable for any loss, injuries, or illness of any pet for any reason whatsoever.",
    "The guest accepts full responsibility for all liability, claims, losses, costs and expenses, including reasonable attorney fees, for personal injury or property damage caused by or attributed to their pet(s), and agrees to reimburse such damages on demand.",
    "The guest agrees to indemnify, hold harmless and defend the Resort Management, its owners and employees from all liability, claims, losses, costs and expenses, including reasonable attorney fees, arising from any claim for personal injury or property damage caused by or attributed to their pet(s).",
]
PET_POLICY_ITEMS = "\n".join(f"          <li>{t}</li>" for t in PET_POLICY)


def booking_form_section(default_type="day_trip"):
    """The actual booking form (date, cabana picker, live bill, guest/senior
    fields) — shared markup so it can be embedded on more than one page
    (currently: the dedicated Book page, and the Day Trip page itself) without
    the two copies drifting apart. `default_type` pre-selects the stay type,
    since a page can be embedded without the book page's own ?type= query
    param to fall back on."""
    type_options = "\n            ".join(
        f'<option value="{val}"{" selected" if val == default_type else ""}>{label}</option>'
        for val, label in BOOKING_TYPE_LABELS
    )
    # With only one booking type on offer, the picker is redundant — keep the
    # (hidden) select for booking.js to read from, but don't show a pointless
    # single-option dropdown to the guest.
    stay_type_field = (
        f'<select id="stayType" hidden>{type_options}</select>'
        if len(BOOKING_TYPE_LABELS) == 1 else
        f'''<div id="stayTypeField">
      <label for="stayType">Full Day or Half Day?</label>
      <select id="stayType">
            {type_options}
      </select>
    </div>'''
    )
    country_options = "\n            ".join(
        f'<option value="{c}"{" selected" if c == "Philippines" else ""}>{c}</option>'
        for c in COUNTRIES
    )
    return f"""
<div id="bookingFormWrap">
  <form class="inquiry" id="bookingForm">
    <div>
      <label for="checkIn" id="checkInLabel">Preferred Date</label>
      <input id="checkIn" type="date" required>
    </div>

    {stay_type_field}

    <div id="cabanaStep" hidden>
      <label id="cabanaStepLabel">Choose your cabana(s)</label>
      <p class="field-hint" id="cabanaHint">Tap the map to see exactly where each cabana sits — pick a date above to check live availability for that day, and you can select more than one cabana.</p>
      <p class="field-hint cabana-fineprint">Cabana numbers are <strong>preferred cabanas</strong>. To make sure every group has its own space, the resort may move your party to a comparable cabana if a large group books in &mdash; we'll always let you know.</p>
      <div class="cabana-map-wrap">
        <div id="cabanaMapStatus" class="cabana-map-status">Loading the cabana map…</div>
        <div id="cabanaMap"></div>
        <div id="cabanaSelectedNote" class="cabana-selected-note" hidden></div>
      </div>
    </div>

    <div class="row-2" style="grid-template-columns:1fr 1fr 1fr;">
      <div><label for="adults">Adults</label><input id="adults" type="number" min="1" value="2" required></div>
      <div><label for="kids612">Kids (6&ndash;12)</label><input id="kids612" type="number" min="0" value="0"></div>
      <div><label for="kids05">Kids (0&ndash;5)</label><input id="kids05" type="number" min="0" value="0"></div>
    </div>

    <div>
      <label for="seniorCount">How many are Senior Citizens or PWDs?</label>
      <input id="seniorCount" type="number" min="0" value="0">
      <p class="field-hint">Included in your Adults count above &mdash; each gets 20% off their own share.</p>
    </div>
    <div>
      <label for="petCount">Bringing any pets?</label>
      <input id="petCount" type="number" min="0" max="2" value="0">
      <p class="field-hint">Dogs or cats only &mdash; a maximum of two pets per reservation.</p>
    </div>
    <div id="petWrap" hidden>
      <label for="petVaxFiles">Pet vaccination card(s)</label>
      <input id="petVaxFiles" type="file" accept="image/*,application/pdf" multiple>
      <p class="field-hint">A clear photo of each pet's vaccination card, showing the pet's details and a current anti-rabies vaccination. Please bring the card(s) on the day too.</p>
      <details class="pet-policy">
        <summary>Read the Pet Policy</summary>
        <ol>
{PET_POLICY_ITEMS}
        </ol>
      </details>
      <label class="field-hint pet-agree">
        <input type="checkbox" id="petPolicyAgree">
        I agree to the Resort's Pet Policy and confirm my pet(s) are vaccinated, healthy and free of fleas and ticks.
      </label>
      <p class="field-hint" id="petError" style="color:var(--rose,#9c4a3f);" hidden></p>
    </div>
    <div id="packageNote" class="field-hint" hidden></div>
    <div id="seniorIdWrap" hidden>
      <label for="seniorIdFiles">Senior Citizen / PWD ID photo(s)</label>
      <input id="seniorIdFiles" type="file" accept="image/*" multiple>
      <p class="field-hint">One photo per senior citizen (or one photo with all IDs) &mdash; needed before we can apply the discount.</p>
      <p class="field-hint" id="seniorIdError" style="color:var(--rose,#9c4a3f);" hidden>Please attach at least one Senior Citizen or PWD ID photo.</p>
    </div>

    <div>
      <label for="guestNames">Names of everyone in your group</label>
      <textarea id="guestNames" placeholder="e.g. Juan Dela Cruz, Maria Santos, Pedro Reyes&hellip;"></textarea>
      <p class="field-hint">Just list them separated by commas &mdash; no need for a form field per person.</p>
    </div>

    <div class="row-2">
      <div><label for="guestName">Your Name (Primary Contact)</label><input id="guestName" type="text" required></div>
      <div><label for="guestPhone">Phone</label><input id="guestPhone" type="tel" required></div>
    </div>
    <div class="row-2">
      <div><label for="guestEmail">Email</label><input id="guestEmail" type="email" required></div>
      <div><label for="country">Country</label>
        <select id="country">
            {country_options}
        </select>
      </div>
    </div>

    <div id="billSummary" class="bill-summary" hidden></div>

    <div>
      <label for="hearAbout">How did you hear about us?</label>
      <select id="hearAbout">
        <option value="">Prefer not to say</option>
        <option value="facebook">Facebook / Instagram</option>
        <option value="google">Google Search</option>
        <option value="referral">Friend / Family Referral</option>
        <option value="repeat_guest">I've stayed before</option>
        <option value="travel_agent">Travel Agent</option>
        <option value="other">Other</option>
      </select>
    </div>
    <div>
      <label for="occasion">Any occasion we should know about?</label>
      <select id="occasion">
        <option value="">None in particular</option>
        <option value="birthday">Birthday</option>
        <option value="anniversary">Anniversary</option>
        <option value="team_building">Team Building / Company Outing</option>
        <option value="reunion">Reunion</option>
        <option value="other">Other</option>
      </select>
    </div>
    <div><label for="notes">Anything else we should know?</label><textarea id="notes" placeholder="Special requests, occasion, group size details, etc."></textarea></div>

    <label class="field-hint" style="display:flex; align-items:flex-start; gap:8px; font-size:0.85rem;">
      <input type="checkbox" id="marketingOptIn" style="margin-top:3px;" checked>
      Send me occasional promos and updates from Virgin Beach Resort.
    </label>

    <button class="btn btn-primary" type="submit" id="submitBtn">Send Request</button>
    <p class="field-hint">You'll get your quotation and bank details by email right away &mdash; your booking is confirmed once payment is verified.</p>
  </form>
</div>
<div id="bookingStatus" class="form-status" hidden></div>
"""


def booking_scripts():
    """Script tags the booking form (and the live cabana map inside it) need
    — include once, at the bottom of any page that embeds booking_form_section()."""
    return f"""
<script src="https://unpkg.com/@supabase/supabase-js@2"></script>
<script src="../assets/js/booking-config.js?v={asset_v('assets/js/booking-config.js')}"></script>
<script src="../assets/js/cabana-map.js?v={asset_v('assets/js/cabana-map.js')}"></script>
<script src="../assets/js/booking.js?v={asset_v('assets/js/booking.js')}"></script>
"""


def head(base, title, description, current_path):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title} · Virgin Beach Resort</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{description}">
<link rel="icon" type="image/png" href="data:image/png;base64,{FAVICON_B64}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..600&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{base}assets/css/style.css?v={asset_v('assets/css/style.css')}">
</head>
"""


def nav_html(base, current_path, solid=False, cta_label=None, cta_href=None):
    def is_current(path):
        return path == current_path

    cta_label = cta_label or "Book Now"
    cta_href = cta_href if cta_href is not None else CLOUDBEDS_URL

    links = []
    for path, label, sub in NAV_ITEMS:
        cls = "has-sub" if sub else ""
        sub_html = ""
        if sub:
            items = "".join(f'<li><a href="{base}{p}">{n}</a></li>' for p, n in sub)
            sub_html = f'<div class="sub"><ul>{items}</ul></div>'
        links.append(f'<li class="{cls}"><a href="{base}{path}">{label}</a>{sub_html}</li>')
    nav_links = "".join(links)

    mobile_links = []
    for path, label, sub in NAV_ITEMS:
        mobile_links.append(f'<li><a href="{base}{path}">{label}</a>')
        if sub:
            sub_items = "".join(f'<li><a href="{base}{p}">{n}</a></li>' for p, n in sub)
            mobile_links.append(f'<ul class="sub-list">{sub_items}</ul>')
        mobile_links.append('</li>')
    mobile_links_html = "".join(mobile_links)

    header_class = "site-header no-hero" if solid else "site-header"

    return f"""<header class="{header_class}">
  <div class="wrap">
    <a class="wordmark" href="{base}index.html"><img class="wordmark-icon" src="{base}assets/brand/logo-mark.png" alt="Virgin Beach Resort"></a>
    <nav>
      <ul class="nav-links">{nav_links}</ul>
    </nav>
    <div class="nav-cta">
      <a class="btn {"btn-primary" if solid else "btn-on-dark"}" id="bookBtn" href="{cta_href}">{cta_label}</a>
      <button class="nav-toggle" aria-label="Menu">&#9776;</button>
    </div>
  </div>
  <div class="mobile-panel">
    <ul>{mobile_links_html}</ul>
  </div>
</header>
"""


def footer_html(base):
    casita_links = "".join(f'<li><a href="{base}overnight/{slug}/index.html">{name}</a></li>' for slug, name in CASITAS)
    return f"""<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="footer-logo-link" href="{base}index.html"><img class="footer-logo" src="{base}assets/brand/logo-full-light.png" alt="Virgin Beach Resort"></a>
        <p>A tranquil and natural experience away from the crowds, on a private cove in Laiya, Batangas.</p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul>
          <li><a href="{base}overnight/index.html">Overnight</a></li>
          <li><a href="{base}day-packages/index.html">Day Trip</a></li>
          <li><a href="{base}corporate/index.html">Corporate</a></li>
          <li><a href="{base}dining/index.html">Dining</a></li>
          <li><a href="{base}experiences/index.html">Experiences</a></li>
          <li><a href="{base}gallery/index.html">Gallery</a></li>
        </ul>
      </div>
      <div>
        <h4>Casitas</h4>
        <ul>{casita_links}</ul>
      </div>
      <div>
        <h4>Reach Us</h4>
        <ul>
          <li><a href="tel:+639177920712">+63 917 792 0712</a> (Globe)</li>
          <li><a href="tel:+639294309109">+63 929 430 9109</a> (Smart)</li>
          <li><a href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a></li>
          <li><a href="{base}faq/index.html">FAQ</a></li>
          <li><a href="{base}contact/index.html">Contact &amp; Map</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <div>&copy; 2026 Virgin Beach Resort. All rights reserved. &middot;
        <a class="text-link" href="{base}terms-and-conditions.html">Terms</a> &middot;
        <a class="text-link" href="{base}privacy-policy.html">Privacy</a>
      </div>
      <div class="social-row">
        <a href="https://www.facebook.com/VirginbeachresortLaiya/" aria-label="Facebook">Facebook</a>
        <a href="https://www.instagram.com/virginbeachresort/" aria-label="Instagram">Instagram</a>
        <a href="https://www.tripadvisor.com.ph/Hotel_Review-g6620224-d850254-Reviews-Virgin_Beach_Resort-Laiya_San_Juan_Batangas_Province_Calabarzon_Region_Luzon.html" aria-label="TripAdvisor">TripAdvisor</a>
      </div>
    </div>
  </div>
</footer>
<script src="{base}assets/js/site.js"></script>
"""


def page(path, title, description, body, solid_header=True, cta_label=None, cta_href=None):
    """path: e.g. 'index.html' or 'overnight/index.html' or 'overnight/deluxe-king-casita/index.html'"""
    depth = path.count("/")
    base = "../" * depth
    html = head(base, title, description, path)
    html += "<body>\n"
    html += nav_html(base, path, solid=solid_header, cta_label=cta_label, cta_href=cta_href)
    html += body
    html += footer_html(base)
    html += "</body>\n</html>\n"
    full_path = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", path)
    return base


if __name__ == "__main__":
    print("build.py loaded — pages added by subsequent script")
