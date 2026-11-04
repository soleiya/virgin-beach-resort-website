# -*- coding: utf-8 -*-
"""404 page (served by Cloudflare Pages for any unknown address)."""
import os
from build import page, ROOT

body = """
<section class="page-hero" style="min-height:32vh;">
  <img src="assets/images/hero.jpg" alt="Virgin Beach Resort">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Page not found</span>
    <h1>This page has moved</h1>
    <p class="lede">The page you're looking for isn't here &mdash; our website has a new home.</p>
  </div>
</section>
<section class="center">
  <div class="wrap" style="max-width:560px;margin:0 auto;">
    <div class="hero-actions" style="justify-content:center;">
      <a class="btn btn-primary" href="book-stay/index.html">Book an overnight stay</a>
      <a class="btn btn-ghost" href="book/index.html">Book a day trip</a>
      <a class="btn btn-ghost" href="index.html">Home</a>
    </div>
  </div>
</section>
"""
page("404.html", "Page not found", "This page has moved — visit the Virgin Beach Resort home page.", body)
# any depth: resolve links from the site root
p = os.path.join(ROOT, "404.html")
s = open(p, encoding="utf-8").read()
s = s.replace("<head>", '<head>\n<base href="/">', 1)
s = s.replace('<meta name="viewport"', '<meta name="robots" content="noindex">\n<meta name="viewport"', 1)
open(p, "w", encoding="utf-8").write(s)
