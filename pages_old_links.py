# -*- coding: utf-8 -*-
# Forwarding pages for the old WordPress addresses. GitHub Pages ignores
# _redirects, so each old path gets a tiny page that sends visitors (and
# search engines, via the canonical link) to the new page. On Cloudflare the
# _redirects file answers first, so these are never shown there.
import os
ROOT = os.path.dirname(os.path.abspath(__file__))
OLD = {
    "home": "", "photos": "gallery/", "privacy-policy": "privacy-policy.html",
    "terms-and-conditions": "terms-and-conditions.html", "advanced-booking": "book-stay/",
    "extended-stay": "overnight/", "day-packages/day-trip-booking": "book/", "dining/menu": "dining/",
    "romantic-dinner": "dining/", "bonfire": "experiences/", "events-inquiry": "corporate/",
    "corporate/request-for-proposal": "corporate/", "weddings": "contact/", "careers": "contact/",
    "soft-opening": "",
}
for old, new in OLD.items():
    url = "/" + new
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Virgin Beach Resort</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="https://virginbeachresort.com{url}">
<meta http-equiv="refresh" content="0; url={url}">
</head><body>
<p>This page has moved. <a href="{url}">Continue to Virgin Beach Resort</a>.</p>
</body></html>
"""
    path = os.path.join(ROOT, old, "index.html")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", old + "/index.html")
