# -*- coding: utf-8 -*-
from build import page

def item(q, a_html):
    return f'''<details class="faq-item">
  <summary>{q}</summary>
  <div class="faq-answer">{a_html}</div>
</details>'''

before_stay = [
    ("Where is Virgin Beach Resort located?",
     "<p>Virgin Beach Resort is located at Km. 23.5 of the Laiya-Lobo Highway, Barangay Laiya, San Juan, Batangas. It sits on a cove facing "
     "southeast and Sigayan Bay, while the majestic mountains of Daguldol and Lobo lie behind it. Sigayan Bay is known to be one of the cleanest "
     "bays in the country and is part of the Verde Passage, identified as the earth's center of marine biodiversity.</p>"),
    ("How do I get there?",
     "<p>Virgin Beach Resort is accessible by land from Metro Manila. See our Contact page for the map and directions.</p>"),
    ("How long is the drive from Metro Manila?",
     "<p>The travel time by car is normally 3 hours from Metro Manila, depending on traffic and road conditions.</p>"),
    ("What payment methods do you accept?",
     "<p>We require full payment to secure your booking. We accept cash (Philippine Peso or USD) or credit card (Visa or Mastercard) or bank "
     "deposit (Unionbank). Check payments are not allowed.</p>"),
    ("What are your check-in and check-out times?",
     "<p>For overnight guests: Check-in &mdash; 2:00 PM, Check-out &mdash; 11:30 AM. For Day Trip guests: Check-in &mdash; 8:00 AM, "
     "Check-out &mdash; 5:00 PM.</p><p>Day Tour guests may avail of dinner at our overnight section. Should you wish to stay for dinner, kindly "
     "inform our front office beforehand. Seating is subject to table availability.</p>"),
    ("Can I get an early check-in or late check-out?",
     "<p>We accommodate early check-in or late check-out options subject to room availability. Early check-in can commence from 9:00 AM onwards, "
     "with an hourly charge of &#8369;750. Late check-out is permissible until 3:00 PM, also with an hourly charge of &#8369;750. Staying beyond "
     "3:00 PM will incur charges equivalent to another night's stay. If you wish to avail of these options, please feel free to inquire with our "
     "Front Office.</p>"),
]

policies = [
    ("What is your cancellation policy?",
     "<p>For promotional offers, reservations are non-rebookable and non-refundable.</p>"
     "<table class='rate-table'><tbody>"
     "<tr><td>15+ days prior</td><td class='num'>Free of charge</td></tr>"
     "<tr><td>14 days or less</td><td class='num'>50% of booking value forfeited</td></tr>"
     "<tr><td>7 days or less / No Show</td><td class='num'>100% forfeited</td></tr>"
     "</tbody></table>"),
    ("Can I postpone my reservation?",
     "<p>Please note that a one-time rescheduling can be arranged and the set date should occur within one (1) month of the original date, "
     "after which any and all deposits will be forfeited. Rebooking is subject to availability, seasonal rate difference and increase in "
     "published rates when applicable.</p>"
     "<table class='rate-table'><tbody>"
     "<tr><td>14+ days prior</td><td class='num'>20% forfeited</td></tr>"
     "<tr><td>Inclement weather (Corporate)</td><td class='num'>Free if Signal No. 1</td></tr>"
     "<tr><td>Inclement weather (Individual)</td><td class='num'>Free if Signal No. 2</td></tr>"
     "</tbody></table>"),
    ("How are refunds processed?",
     "<p>For cash payments, a refund check will be issued in 7 working days. For credit card payments, provided the credit card company has not "
     "yet issued a refund, a refund check net of credit card charges and fees will be issued in 14 working days.</p>"),
    ("Do you offer Senior Citizen or PWD discounts?",
     "<p>Senior Citizens and PWD are entitled to a 20% discount on their accommodation and meals provided they present their OSCA Identification "
     "Card. Discounts for accommodations and meals apply only to the individual with a valid OSCA ID. This discount cannot be combined with any "
     "other discounts or promotions and is not available on our booking engine. Please secure your reservation through our reservations office "
     "if you wish to avail of this discount. We also honor SC and PWD discounts for walk-in guests who pay upon check-in.</p>"),
    ("Do you honor VAT exemption for foreign missions?",
     "<p>We grant VAT exemption to non-residents who are affiliated with foreign embassies in the Philippines and their dependents, provided "
     "they present a photocopy of their VAT Exemption certificate and Department of Foreign Affairs (DFA) issued Identification Card upon "
     "payment. VAT Exemption is not available on our booking engine. Please secure your reservation through our reservations office if you wish "
     "to avail of the exemption. We also honor VAT exemption for walk-in guests who pay upon check-in.</p>"),
]

dining = [
    ("What are your dining hours?",
     "<p>The Pavilion is open from 7:00 AM to 10:00 PM. Dining hours are as follows:</p>"
     "<table class='rate-table'><tbody>"
     "<tr><td>Breakfast</td><td class='num'>7:00 AM &ndash; 9:00 AM</td></tr>"
     "<tr><td>Lunch</td><td class='num'>12:00 PM &ndash; 2:00 PM</td></tr>"
     "<tr><td>Dinner</td><td class='num'>7:00 PM &ndash; 9:00 PM</td></tr>"
     "</tbody></table>"),
    ("What does the meal package include?",
     "<p>The daily meal package includes three meals that are mandatory for the duration of our guests' overnight stay, comprised of lunch upon "
     "arrival, dinner, and breakfast the following morning, not necessarily in that order. Our menu is made up of international and local cuisine "
     "served managed buffet style. &Agrave; la carte meals are available in addition to the mandatory full board meals availed during the stay. "
     "Meals for guests' staff are available for &#8369;750/day.</p>"
     "<table class='rate-table'><tbody>"
     "<tr><td>Adult</td><td class='num'>&#8369;2,450.00</td></tr>"
     "<tr><td>Child (6&ndash;12)</td><td class='num'>&#8369;1,225.00</td></tr>"
     "<tr><td>Ages 0&ndash;5</td><td class='num'>Free</td></tr>"
     "</tbody></table><p style='font-size:0.85rem; margin-top:10px;'>*All prices are inclusive of 12% VAT and Service Charge.</p>"),
    ("What if my guest count decreases?",
     "<p>When there is a decrease in the number of confirmed guests, payments made towards the overnight meal package may be consumed as dining "
     "credits in the Pavilion, otherwise remaining credits are forfeited.</p>"),
    ("Can you accommodate dietary restrictions?",
     "<p>We can accommodate your dietary restrictions to the best of our ability. To ensure that our kitchen can plan and prepare your meals in "
     "time, we do require that guests inform our reservations office ahead of their stay.</p>"),
    ("Can I bring outside food and beverages?",
     "<p>No prepared food and beverages from sources other than the Resort's dining services are permitted on the resort premises. Wines and "
     "spirits are allowed but subject to corkage fees.</p>"),
]

general = [
    ("Do you have PWD-accessible rooms?",
     "<p>At the moment, these rooms are not available. However, we do our best to accommodate PWD guests by offering them our most accessible "
     "rooms. Kindly inform our reservations office or front office if you are traveling with a PWD guest.</p>"),
    ("Do you have quarters for drivers and bodyguards?",
     "<p>Quarters are available for &#8369;1,750.00 per person per night, inclusive of mattress and beddings with plated breakfast, lunch, and "
     "dinner.</p>"),
    ("Are extra person charges available?",
     "<p>Guests may only add up to 1 additional guest in our Deluxe Double Queen, Sunrise, Louver-Window, and Bamboo Casitas, regardless of age. "
     "An extra person charge with a mattress will apply, along with full board meals. See our Terms &amp; Conditions for more information.</p>"),
    ("Is Wi-Fi available?",
     "<p>Complimentary Wi-Fi is available for our overnight and day tour guests at The Pavilion.</p>"),
    ("What is your pet policy?",
     "<p>We value the safety and convenience of all our guests. During your stay, you and your pet are very welcome to experience enriching "
     "moments at the resort. Guests will be requested to comply and sign the Pet Policy Agreement and a &#8369;750 per pet/night sanitation "
     "fee.</p>"),
    ("Is parking available?",
     "<p>Virgin Beach Resort provides ample parking space for its guests. Complimentary parking is available for overnight and Day Trip "
     "guests.</p>"),
    ("Where can I go snorkeling?",
     "<p>There is a nearby reef formation just along the coastline at the northernmost part of the resort.</p>"),
]

def group(title, items):
    html = f'<div class="faq-group"><h2>{title}</h2>'
    for q, a in items:
        html += item(q, a)
    html += "</div>"
    return html

body = f"""
<section class="page-hero" style="min-height:44vh;">
  <img src="../assets/images/aerial-extra-14.jpg" alt="Aerial view of Virgin Beach Resort">
  <div class="wrap page-hero-content">
    <span class="eyebrow">FAQ</span>
    <h1>Frequently Asked Questions</h1>
  </div>
</section>

<section>
  <div class="wrap" style="max-width:820px;">
    {group("Before Your Stay", before_stay)}
    {group("Policies", policies)}
    {group("Dining", dining)}
    {group("General", general)}
  </div>
</section>

<section class="band-tint center">
  <div class="wrap" style="max-width:560px; margin:0 auto;">
    <h2>Still have questions?</h2>
    <p class="prose mx-auto mt-lg">Our reservations team is happy to help with anything not covered here.</p>
    <a class="btn btn-primary mt-lg" href="../contact/index.html">Contact Us</a>
  </div>
</section>
"""

page("faq/index.html", "FAQ", "Frequently asked questions about staying at Virgin Beach Resort — policies, dining, and general information.", body)
