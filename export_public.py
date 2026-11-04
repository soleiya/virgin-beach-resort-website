#!/usr/bin/env python3
"""Cloudflare Pages build step: copy only the public website into ./public.

Cloudflare Pages → Settings → Build:
  Build command:          python3 export_public.py
  Build output directory: public

Everything else in the repository (SQL, Edge Function code, Python page
builders, email-template sources, notes) stays out of the live site.
"""
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "public")

# folders that make up the site
SITE_DIRS = ["assets", "book", "book-stay", "contact", "corporate", "day-packages", "dining",
             "experiences", "faq", "gallery", "overnight", "pay", "staff"]
# single files at the top level
SITE_FILES = ["index.html", "404.html", "privacy-policy.html", "terms-and-conditions.html",
              "robots.txt", "sitemap.xml", "_headers", "_redirects", "favicon.ico"]
SKIP_EXT = {".py", ".pyc", ".sql", ".md", ".gs", ".ts", ".map"}

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

n = 0
for d in SITE_DIRS:
    src = os.path.join(ROOT, d)
    if not os.path.isdir(src):
        continue
    for root, dirs, files in os.walk(src):
        dirs[:] = [x for x in dirs if not x.startswith(".") and x != "__pycache__"]
        for f in files:
            if f.startswith(".") or os.path.splitext(f)[1].lower() in SKIP_EXT:
                continue
            rel = os.path.relpath(os.path.join(root, f), ROOT)
            dst = os.path.join(OUT, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(root, f), dst)
            n += 1
for f in SITE_FILES:
    if os.path.isfile(os.path.join(ROOT, f)):
        shutil.copy2(os.path.join(ROOT, f), os.path.join(OUT, f))
        n += 1
print(f"public/: {n} files")
