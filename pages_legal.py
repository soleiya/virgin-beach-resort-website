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

legal_page("terms-and-conditions.html", "Terms and Conditions")
legal_page("privacy-policy.html", "Privacy Policy")
