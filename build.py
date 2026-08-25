#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Static site generator for the Virgin Beach Resort rebuild.
Keeps header/footer/head DRY across every page; content per page is
authored below using the exact copy pulled from virginbeachresort.com."""

import os

ROOT = os.path.dirname(os.path.abspath(__file__))

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
    ("half_day", "Half-day Tour"),
    ("day_picnic", "Day Picnic"),
    ("corporate", "Corporate Outing"),
]


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
    return f"""
<div id="bookingFormWrap">
  <form class="inquiry" id="bookingForm">
    <div>
      <label for="stayType">What are you booking?</label>
      <select id="stayType">
            {type_options}
      </select>
    </div>

    <div>
      <label for="checkIn" id="checkInLabel">Preferred Date</label>
      <input id="checkIn" type="date" required>
    </div>

    <div id="cabanaStep" hidden>
      <label id="cabanaStepLabel">Choose your cabana(s)</label>
      <p class="field-hint" id="cabanaHint">Pick a date above first — availability updates live for that day, and you can select more than one cabana.</p>
      <div class="cabana-map-wrap">
        <div id="cabanaMapStatus" class="cabana-map-status">Pick a date to see availability.</div>
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
      <label for="seniorCount">How many are Senior Citizens?</label>
      <input id="seniorCount" type="number" min="0" value="0">
      <p class="field-hint">Included in your Adults count above &mdash; each gets 20% off their own share.</p>
    </div>
    <div id="seniorIdWrap" hidden>
      <label for="seniorIdFiles">Senior Citizen ID photo(s)</label>
      <input id="seniorIdFiles" type="file" accept="image/*" multiple>
      <p class="field-hint">One photo per senior citizen (or one photo with all IDs) &mdash; needed before we can apply the discount.</p>
      <p class="field-hint" id="seniorIdError" style="color:var(--rose,#9c4a3f);" hidden>Please attach at least one senior citizen ID photo.</p>
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
      <div><label for="country">Country</label><input id="country" type="text"></div>
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
    <p class="field-hint">This secures your request &mdash; it isn't confirmed until our team follows up with availability and payment details.</p>
  </form>
</div>
<div id="bookingStatus" class="form-status" hidden></div>
"""


def booking_scripts():
    """Script tags the booking form (and the live cabana map inside it) need
    — include once, at the bottom of any page that embeds booking_form_section()."""
    return """
<script src="https://unpkg.com/@supabase/supabase-js@2"></script>
<script src="../assets/js/booking-config.js"></script>
<script src="../assets/js/cabana-map.js"></script>
<script src="../assets/js/booking.js"></script>
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
<link rel="stylesheet" href="{base}assets/css/style.css">
</head>
"""


def nav_html(base, current_path, solid=False):
    def is_current(path):
        return path == current_path

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
    <a class="wordmark" href="{base}index.html"><img class="wordmark-icon" src="{base}assets/brand/logo-mark.png" alt=""><b>Virgin</b> <span>Beach Resort</span></a>
    <nav>
      <ul class="nav-links">{nav_links}</ul>
    </nav>
    <div class="nav-cta">
      <a class="btn {"btn-primary" if solid else "btn-on-dark"}" id="bookBtn" href="{CLOUDBEDS_URL}">Book Now</a>
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
          <li><a href="tel:+639177920712">+63 917 792 0712</a></li>
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


def page(path, title, description, body, solid_header=True):
    """path: e.g. 'index.html' or 'overnight/index.html' or 'overnight/deluxe-king-casita/index.html'"""
    depth = path.count("/")
    base = "../" * depth
    html = head(base, title, description, path)
    html += "<body>\n"
    html += nav_html(base, path, solid=solid_header)
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
