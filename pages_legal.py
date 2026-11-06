# -*- coding: utf-8 -*-
from build import page

def legal_page(path, title):
    body = f"""
<section class="section-tight">
  <div class="wrap" style="max-width:720px; padding-top:60px;">
    <span class="eyebrow">Legal</span>
    <h1>{title}</h1>
    <p class="prose mt-lg">This page is a placeholder. Paste in the exact {title.lower()} text from your current site
    (or your legal team's latest version) before this page goes live &mdash; it wasn't part of the content pulled for this rebuild.</p>
    <a class="btn btn-ghost mt-lg" href="index.html">Back to Home</a>
  </div>
</section>
"""
    page(path, title, f"{title} for Virgin Beach Resort.", body)


PRIVACY_UPDATED = "November 5, 2026"

PRIVACY_BODY = f"""
<style>.legal h3{{margin-top:34px}} .legal li{{color:inherit;margin-bottom:6px}} .legal ul{{color:var(--ink-soft, inherit)}}</style>
<section class="section-tight">
  <div class="wrap prose legal" style="max-width:720px; padding-top:60px;">
    <span class="eyebrow">Legal</span>
    <h1>Privacy Policy</h1>
    <p class="mt-lg"><em>Last updated: {PRIVACY_UPDATED}</em></p>

    <p>This policy explains, in plain words, what personal information Virgin Beach Resort collects when you book with us
    or use virginbeachresort.com, why we need it, and how we look after it. We follow the Philippine
    Data Privacy Act of 2012 (Republic Act No. 10173).</p>

    <h3>What we collect</h3>
    <ul>
      <li><strong>Booking details:</strong> your name, email address, mobile number, the names of your guests, your dates,
      your choice of villa or day-trip package, and any notes or requests you send us.</li>
      <li><strong>Discount and entry documents:</strong> photos of Senior Citizen or PWD IDs (to apply the 20% discount)
      and pet vaccination cards, if you upload them.</li>
      <li><strong>Payment status:</strong> the amount you paid, the payment method and the payment reference.
      Your card, GCash or bank login details are entered on our payment provider's secure page; we never see or keep them.</li>
      <li><strong>Messages:</strong> anything you send us by email, phone or social media.</li>
    </ul>

    <h3>How we use it</h3>
    <ul>
      <li>To confirm, manage and change your booking, and to send you your quotation, receipts and reminders.</li>
      <li>To take payments and issue refunds or official receipts.</li>
      <li>To check discount eligibility and prepare for your arrival.</li>
      <li>To answer your questions and keep our guests and resort safe.</li>
      <li>To send you occasional news and promos, which you can unsubscribe from at any time.</li>
      <li>To meet our legal, tax and accounting duties.</li>
    </ul>
    <p>We don't sell your information. From time to time we may send you news and promos from the resort.
    Every promo email has an unsubscribe link, and you can also ask us to stop at any time.</p>

    <h3>Who we share it with</h3>
    <p>Only with the services that help us run your booking, and only what they need:</p>
    <ul>
      <li><strong>Cloudbeds</strong>, our reservations system for villas.</li>
      <li><strong>Xendit</strong>, our online payment provider (cards, GCash and other e-wallets, online banking).</li>
      <li><strong>Supabase</strong>, which securely stores our booking records.</li>
      <li><strong>Google</strong>, for our email, website fonts and the map on our Contact page.</li>
      <li><strong>Cloudflare</strong>, which hosts and protects this website.</li>
    </ul>
    <p>If you booked through an online travel site, that site's own privacy policy also applies.
    We may also share information when the law requires it.</p>

    <h3>Cookies</h3>
    <p>Our website does not use advertising or tracking cookies. Your browser may remember a few small settings, such as
    whether you last looked at day trips or overnight stays, to make the site easier to use. The website's host also keeps
    standard technical logs (such as IP address and browser type) to keep the site secure.</p>

    <h3>How long we keep it</h3>
    <p>We keep booking records for as long as needed to serve you and to meet our legal and tax requirements.
    ID photos are used only to check your discount and are not used for anything else.</p>

    <h3>Keeping it safe</h3>
    <p>Booking information is sent over secure (HTTPS) connections and is only seen by the people on our team
    who need it to handle your booking.</p>

    <h3>Your rights</h3>
    <p>You can ask us to show you the personal information we hold about you, correct it, or delete it when we no longer
    need it. You can also withdraw your consent or raise a concern with us at any time. If you are not satisfied with our
    reply, you may contact the National Privacy Commission (privacy.gov.ph).</p>

    <h3>Children</h3>
    <p>Bookings must be made by an adult. We only collect children's names when a parent or guardian lists them as guests.</p>

    <h3>Contact us</h3>
    <p>For any privacy question or request, email
    <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>
    or call <a class="text-link" href="tel:+639177920712">+63 917 792 0712</a>.<br>
    Virgin Beach Resort &middot; KM 23 Laiya, San Juan, Batangas, Philippines 4226</p>

    <p>We may update this policy from time to time. The latest version is always on this page.</p>

    <a class="btn btn-ghost mt-lg" href="index.html">Back to Home</a>
  </div>
</section>
"""


TERMS_UPDATED = "November 6, 2026"

TERMS_BODY = f"""
<style>.legal h3{{margin-top:34px}} .legal li{{color:inherit;margin-bottom:6px}} .legal ul{{color:var(--ink-soft, inherit)}} .legal .rate-table{{margin:12px 0 4px}}</style>
<section class="section-tight">
  <div class="wrap prose legal" style="max-width:720px; padding-top:60px;">
    <span class="eyebrow">Legal</span>
    <h1>Terms and Conditions</h1>
    <p class="mt-lg"><em>Last updated: {TERMS_UPDATED}</em></p>

    <p>These terms apply to every booking at Virgin Beach Resort &mdash; overnight stays and day trips, made on this website, by phone,
    email or Messenger, or through a travel site. They follow our <a class="text-link" href="assets/docs/VBR-Reservations-Agreement.pdf" target="_blank" rel="noopener">Reservations Agreement</a>.
    By booking, you agree to them for yourself and everyone in your party.</p>

    <h3>1. Booking and payment</h3>
    <ul>
      <li>Your booking is held for 24 hours while you pay. Pay at least 50%, or the full amount, online by card, GCash, Maya, QR Ph and more, through our payment partner Xendit.</li>
      <li>The balance is due 15 days before arrival. Bookings made 14 days or less before arrival are paid in full. Full payment guarantees your reservation.</li>
      <li>If no payment is received in time, the booking is cancelled and the dates are released.</li>
      <li>At the resort, incidental charges are settled at check-out in cash, or by credit or debit card. We don&rsquo;t accept cheques or bank transfers on-site.</li>
      <li>Rates may change without prior notice; the rate on your confirmed booking is the one you pay.</li>
    </ul>

    <h3>2. Cancellation</h3>
    <table class="rate-table"><tbody>
      <tr><td>15 days or more before arrival</td><td class="num">Free of charge</td></tr>
      <tr><td>14 days or less before arrival</td><td class="num">50% of the booking value is forfeited</td></tr>
      <tr><td>7 days or less before arrival, or no-show</td><td class="num">100% of the booking value is forfeited</td></tr>
    </tbody></table>
    <p>Promotional bookings can&rsquo;t be cancelled, rebooked or refunded.</p>

    <h3>3. Rebooking</h3>
    <ul>
      <li>Moving your dates 14 days or more before arrival: 20% of the booking value is forfeited.</li>
      <li>One free rebooking is allowed for a medical emergency or the death of an immediate family member of the main guest, with supporting documents.</li>
      <li>Bad weather in San Juan, Batangas: free rebooking for individual bookings at Signal No. 2, and for corporate bookings at Signal No. 1.</li>
      <li>New dates must fall within one month of the original date, and depend on availability and any rate difference.</li>
    </ul>

    <h3>4. Check-in and check-out</h3>
    <ul>
      <li><strong>Overnight:</strong> check-in 2:00 PM, check-out 11:30 AM. Early check-in (from 10:00 AM) and late check-out (until 3:00 PM) depend on availability and cost &#8369;750 per hour.</li>
      <li><strong>Day trip:</strong> 8:00 AM to 5:00 PM. Arrivals from 1:00 PM are charged the half-day rate.</li>
      <li>The main guest and all companions must be present at check-in with a valid government-issued ID. We may refuse entry to unregistered guests.</li>
      <li>Please bring your &#8369;50 ecological fee ticket from the San Juan tourism booth. If you miss it, you can settle it at our Front Office.</li>
    </ul>

    <h3>5. Meals and guest count</h3>
    <ul>
      <li>Every overnight guest takes the full-board meal package (lunch, dinner and breakfast): &#8369;2,695 per adult, &#8369;1,347.50 per child 6&ndash;12, free for 0&ndash;5, per night.</li>
      <li>Tell us about fewer guests at least 7 days before your stay. Unused meal packages become dining credits at The Pavilion; credits left at check-out are forfeited.</li>
      <li>For day trips, the guest count is final 7 days before the trip; reductions after that follow the cancellation policy.</li>
      <li>No outside food or drinks, except chips, biscuits and bottled water. Some drinks may be brought in with a corkage fee.</li>
    </ul>

    <h3>6. Extra guests, staff and pets</h3>
    <ul>
      <li>Casitas with two queen beds can take one extra guest on a floor mattress for &#8369;1,500 per night, plus meals. Maximum five guests per casita, regardless of age.</li>
      <li>Drivers, bodyguards and nannies: &#8369;1,000 per night for accommodation plus &#8369;825 per night for meals; &#8369;250 per meal on day trips. A standby area is provided during the day.</li>
      <li>Up to two pets per booking, at &#8369;750 per pet per night. You&rsquo;ll be asked to sign our Pet Policy Agreement.</li>
      <li>Outside suppliers (for events) need a signed gate pass and property pass, and pay a &#8369;5,000 corkage fee, plus &#8369;5,000 per food and beverage supplier or booth.</li>
    </ul>

    <h3>7. Resort rules</h3>
    <ul>
      <li>Please wear resort attire in common areas. Swimming in jerseys, denim and similar clothing isn&rsquo;t allowed.</li>
      <li>You are responsible for any loss or damage to resort property caused by you or your party.</li>
      <li>We may ask a guest to leave, without refund, for breaking resort rules, unsafe or illegal behavior, or disturbing other guests.</li>
      <li>In an emergency, staff may enter a casita without prior notice.</li>
      <li>We may cancel a booking made with false or incomplete information.</li>
    </ul>

    <h3>8. Events beyond our control</h3>
    <p>We are not liable if we can&rsquo;t provide your stay or services because of events beyond our control, such as natural calamities, fire,
    government orders or delays caused by others. Unused portions aren&rsquo;t refunded; we&rsquo;ll work with you to reschedule instead.</p>

    <h3>9. Your safety</h3>
    <p>You use the resort&rsquo;s facilities and equipment, including watercraft and vehicles, at your own risk. Virgin Beach Resort, its owners
    and staff are not liable for loss of or damage to personal belongings, or for injury arising from their use.</p>

    <h3>10. Questions</h3>
    <p>Call or text +63 917 792 0712 or email <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.
    How we handle your personal information is explained in our <a class="text-link" href="privacy-policy.html">Privacy Policy</a>.</p>

    <a class="btn btn-ghost mt-lg" href="index.html">Back to Home</a>
  </div>
</section>
"""

page("terms-and-conditions.html", "Terms and Conditions",
     "Booking, payment, cancellation and resort policies for Virgin Beach Resort.", TERMS_BODY)
page("privacy-policy.html", "Privacy Policy",
     "How Virgin Beach Resort collects, uses and protects your personal information.", PRIVACY_BODY)
