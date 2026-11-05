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

legal_page("terms-and-conditions.html", "Terms and Conditions")
page("privacy-policy.html", "Privacy Policy",
     "How Virgin Beach Resort collects, uses and protects your personal information.", PRIVACY_BODY)
