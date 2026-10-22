# -*- coding: utf-8 -*-
"""Cloudbeds email templates in the website's email style.

Each template is plain HTML (Cloudbeds "HTML" design style) using Cloudbeds
merge tags ([first name], [conf number], [start date] …). Run:

    python3 cloudbeds-emails/build_emails.py

to write one .html per template here plus preview.html (sample values filled
in) for review. The bodies are pasted into Cloudbeds → Settings → Email →
Templates (see README.md in this folder).
"""
import html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
# Links point to the resort's domain; images are served from where the new
# website's files are hosted (switch ASSETS once virginbeachresort.com serves them).
SITE = "https://virginbeachresort.com"
ASSETS = "https://soleiya.github.io/virgin-beach-resort-website"
LOGO = ASSETS + "/assets/brand/logo-full.png"
HERO = ASSETS + "/assets/images/hero.jpg"
PAY_LINK = "https://payment.virginbeachresort.com/rsvn.php?reservation=[conf number]"
DIRECTIONS = "http://bit.ly/4hkxzcl"

C = dict(ink="#23241f", soft="#6b6559", line="#ddd2ba", sand="#f6f1e6", surface="#fffdf8",
         lagoon="#1f7a72", deep="#14524c", tint="#e4f1ee", warn="#8a4a1d", warnBg="#fde3d0", okBg="#dff3e4")
FONT = "font-family:Helvetica,Arial,sans-serif;"

BANKS = [("UnionBank", "002170016412", "Makati Ave."),
         ("BDO (Banco de Oro)", "005388015894", "Neptune – Makati Ave."),
         ("Metrobank", "3097309004473", "Kalayaan Bel-Air")]
ACCOUNT_NAME = "NTQ Hospitality and Resort Management Inc."


def shell(preheader, body, hero=True):
    hero_row = (f'<tr><td style="padding:0;"><img src="{HERO}" alt="Virgin Beach Resort" width="620" '
                f'style="display:block;width:100%;max-width:620px;height:auto;border:0;"></td></tr>') if hero else ""
    return f"""<div style="margin:0;padding:0;background:{C['sand']};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{C['sand']};"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:{C['surface']};border:1px solid {C['line']};border-radius:12px;overflow:hidden;">
<tr><td style="padding:22px 28px 14px;text-align:center;"><img src="{LOGO}" alt="Virgin Beach Resort" width="170" style="max-width:170px;height:auto;border:0;"></td></tr>
{hero_row}
<tr><td style="padding:22px 28px 28px;color:{C['ink']};{FONT}font-size:15px;line-height:1.55;">
{body}
{signature()}
</td></tr>
</table>
<p style="margin:14px 0 0;color:{C['soft']};{FONT}font-size:11.5px;">Virgin Beach Resort · Km 23 Laiya, San Juan, Batangas, Philippines</p>
</td></tr></table>
</div>"""


def h1(t):
    return f'<h1 style="margin:0 0 12px;font-family:Georgia,\'Times New Roman\',serif;font-size:24px;font-weight:normal;color:{C["deep"]};">{t}</h1>'


def h2(t):
    return f'<h2 style="margin:26px 0 10px;font-family:Georgia,\'Times New Roman\',serif;font-size:19px;font-weight:normal;color:{C["deep"]};">{t}</h2>'


def p(t, style=""):
    return f'<p style="margin:0 0 12px;{style}">{t}</p>'


def small(t):
    return p(t, f"font-size:13px;color:{C['soft']};")


def button(href, label):
    return (f'<a href="{href}" style="display:inline-block;background:{C["lagoon"]};color:#ffffff;text-decoration:none;'
            f'font-weight:bold;padding:12px 22px;border-radius:999px;{FONT}font-size:14px;margin:4px 6px 4px 0;">{label}</a>')


def status_box(rows, tone="info"):
    bg = C["okBg"] if tone == "ok" else C["warnBg"] if tone == "warn" else C["tint"]
    cells = "".join(
        f'<td style="padding:14px;vertical-align:top;"><div style="color:{C["soft"]};font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;">{k}</div>'
        f'<div style="font-size:16px;font-weight:bold;color:{C["deep"]};margin-top:2px;">{v}</div></td>' for k, v in rows)
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{bg};border-radius:10px;margin:16px 0;"><tr>{cells}</tr></table>'


def kv(rows):
    tr = "".join(
        f'<tr><td style="padding:7px 12px 7px 0;color:{C["soft"]};vertical-align:top;width:38%;border-bottom:1px solid {C["line"]};">{k}</td>'
        f'<td style="padding:7px 0;vertical-align:top;border-bottom:1px solid {C["line"]};">{v}</td></tr>' for k, v in rows)
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">{tr}</table>'


def ul(items):
    li = "".join(f'<li style="margin:0 0 7px;">{t}</li>' for t in items)
    return f'<ul style="margin:0;padding-left:20px;font-size:14px;">{li}</ul>'


def bank_table():
    rows = "".join(
        f'<tr><td style="padding:9px 12px;border-top:1px solid {C["line"]};font-weight:bold;">{b}</td>'
        f'<td style="padding:9px 12px;border-top:1px solid {C["line"]};font-family:\'Courier New\',monospace;font-size:15px;letter-spacing:.04em;white-space:nowrap;">{n}</td>'
        f'<td style="padding:9px 12px;border-top:1px solid {C["line"]};color:{C["soft"]};font-size:12.5px;">{br}</td></tr>' for b, n, br in BANKS)
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;border:1px solid {C["line"]};border-radius:8px;">'
            f'<tr><td colspan="3" style="padding:10px 12px;background:{C["tint"]};"><span style="color:{C["soft"]};font-size:12px;">Account Name</span><br><strong>{ACCOUNT_NAME}</strong></td></tr>{rows}</table>')


def signature():
    a = f'style="color:{C["deep"]};"'
    return f"""<div style="margin-top:28px;padding-top:16px;border-top:1px solid {C['line']};font-size:13px;color:{C['soft']};">
<p style="margin:0 0 10px;color:{C['ink']};"><strong>Reservations Team</strong><br>Virgin Beach Resort</p>
<p style="margin:0 0 10px;font-style:italic;">To help us keep track of your booking, please reply to this same email thread.</p>
<p style="margin:0 0 4px;"><strong>Office Hours:</strong> Monday–Friday | 9:00 AM–4:00 PM</p>
<p style="margin:0 0 4px;"><strong>Booking &amp; Inquiries:</strong> <a href="mailto:reservations@virginbeachresort.com" {a}>reservations@virginbeachresort.com</a></p>
<p style="margin:0 0 4px;"><strong>Reservations:</strong> +63 917 792 0712 (Globe) · +63 929 430 9109 (Smart)</p>
<p style="margin:0 0 4px;"><strong>Front Office (during your stay):</strong> +63 969 623 4728</p>
<p style="margin:0;"><strong>Website:</strong> <a href="{SITE}/" {a}>virginbeachresort.com</a></p>
</div>"""


GOOD_TO_KNOW = ul([
    "<strong>Check-in</strong> is from 2:00 PM and <strong>check-out</strong> is at 11:30 AM. Arriving early? You're welcome to relax at the Pavilion — your first meal is lunch. Early check-in (from 10:00 AM) and late check-out (until 3:00 PM) are subject to availability at ₱750 per hour.",
    "<strong>Full-board meals</strong> are required for every guest each night — lunch on arrival, dinner, and breakfast the next morning (Breakfast 7:00–10:00 AM · Lunch 12:00 NN–2:00 PM · Dinner 7:00–9:00 PM). If they aren't on your booking yet, they're settled at check-in: Adult (13+) ₱2,695 · Child (6–12) ₱1,347.50 · Child (0–5) free, per night.",
    "<strong>Every guest</strong> must be present at check-in with a valid government-issued ID. Senior Citizens / PWDs: please bring your ID for the 20% discount.",
    "<strong>Tourism Ecological Fee:</strong> ₱50.00 per visitor, collected by the Municipality of San Juan at its booth at Km 3, Buhay na Sapa, San Juan (or at our Front Office).",
    "<strong>Outside food &amp; drinks</strong> are not allowed, except chips, biscuits and bottled water. Corkage applies to specific beverages.",
    "<strong>Pets</strong> are welcome (max. two) with their vaccination card and our Pet Policy — ₱750 per pet, per night.",
    "<strong>Drivers, nannies &amp; bodyguards:</strong> ₱1,000 per night for quarters plus ₱750 per night for meals — please let us know in advance.",
])

GETTING_HERE = (h2("Getting here") +
                p(f"We're at <strong>Km 23 Laiya, San Juan, Batangas</strong> — about 3 hours from Metro Manila. "
                  f"We recommend the <strong>Ibaan Exit</strong>: it's the wider, faster route to Laiya.") +
                button(DIRECTIONS, "Get directions"))

CANCEL_POLICY = (h2("Cancellation &amp; rebooking") +
                 kv([("15 days or more before arrival", "Free of charge"),
                     ("14 days or less before arrival", "50% of booking value forfeited"),
                     ("7 days or less before arrival / no-show", "100% of booking value forfeited")]) +
                 small("One-time rescheduling within one (1) month of the original dates is possible for medical emergencies or a death in the immediate family (with documents); 20% is forfeited for other rebookings made 14+ days before arrival. Promotional bookings are non-refundable. Inclement weather: free rebooking at Signal No. 2 in San Juan, Batangas."))

# One booking number everywhere: website villa bookings take Cloudbeds'
# confirmation no. as their Booking ID, written VBR-<number> (booking-v25).
# vbr() prefixes every [conf number] shown to the guest (not the one inside the
# payment-link URL) and calls it "Booking ID", like the website's emails.
CONF = "[conf number]"


def vbr(s):
    s = re.sub(r"(?<![=\w-])\[conf number\]", "VBR-[conf number]", s)
    return s.replace(">Confirmation no.<", ">Booking ID<")


STAY_BOX = status_box([("Confirmation no.", CONF), ("Arrival", "[start date]"), ("Departure", "[end date]")])
ROOM_ROWS = kv([("Casita", "[room type]"), ("Nights", "[nights]"), ("Guest", "[full name]")])

TEMPLATES = {}

# 1. Reservation Confirmed (system — sent when a reservation becomes Confirmed)
TEMPLATES["655214"] = dict(
    name="Reservation Confirmed",
    subject="Your stay is confirmed — Virgin Beach Resort · [conf number]",
    body=shell("Your reservation is confirmed — here's everything you need before your stay.", f"""
{h1("You're all set, [first name]!")}
{p("Your reservation at Virgin Beach Resort is <strong>confirmed</strong>. We can't wait to welcome you to Laiya.")}
{status_box([("Confirmation no.", CONF), ("Arrival", "[start date]"), ("Departure", "[end date]")], "ok")}
{ROOM_ROWS}
{h2("Before you arrive")}
{ul(["If you haven't already, reply to this email with the <strong>full names and ages</strong> of everyone in your party, plus any <strong>food restrictions or allergies</strong>, so our kitchen can prepare.",
     "Paid 50%? Your <strong>balance is due 15 days before arrival</strong> — transfer it the same way and reply with the screenshot.",
     "Celebrating something? Tell us — we love making it special."])}
{h2("Good to know before your stay")}
{GOOD_TO_KNOW}
{GETTING_HERE}
{CANCEL_POLICY}
{p("See you at the beach!", "margin-top:18px;")}"""))

# 2. Pending Confirmation (system — reservation received, not yet confirmed)
TEMPLATES["655215"] = dict(
    name="Pending Confirmation",
    subject="We've received your reservation — please complete your payment · [conf number]",
    body=shell("Your reservation is held — complete your payment within 24 hours to confirm it.", f"""
{h1("Thank you, [first name] — we've received your reservation")}
{p("Your casita is <strong>held, but not confirmed yet</strong>. To secure it, please pay <strong>50% or 100% within 24 hours</strong> — unpaid reservations are released automatically.")}
{status_box([("Confirmation no.", CONF), ("Arrival", "[start date]"), ("Departure", "[end date]")], "warn")}
{ROOM_ROWS}
{h2("How to pay")}
{p("<strong>Option 1 — Card or e-wallet</strong>, through our secure payment page:")}
{button(PAY_LINK, "Pay online")}
{p("<strong>Option 2 — Bank or e-wallet transfer</strong> (InstaPay / PESONet; GCash and Maya can send via InstaPay) to:", "margin-top:14px;")}
{bank_table()}
{p("Then <strong>reply to this email with your payment screenshot</strong> — we'll confirm your booking once it's verified (office hours 9:00 AM–4:00 PM, Monday–Friday).", "margin-top:14px;")}
{small("Paid 50%? The balance is due 15 days before arrival. Bookings made within 14 days of arrival are paid in full.")}
{h2("Good to know")}
{ul(["<strong>Full-board meals</strong> are required for every guest each night. If they aren't on your booking yet, they're settled at check-in: Adult (13+) ₱2,695 · Child (6–12) ₱1,347.50 · Child (0–5) free, per night.",
     "<strong>Check-in</strong> from 2:00 PM · <strong>check-out</strong> at 11:30 AM."])}
{CANCEL_POLICY}"""))

# 3. Reservation Cancelled (system)
TEMPLATES["655216"] = dict(
    name="Reservation Cancelled",
    subject="Your reservation has been cancelled — Virgin Beach Resort · [canc number]",
    body=shell("Your reservation has been cancelled — details inside.", f"""
{h1("Your reservation has been cancelled")}
{p("Hi [first name], this is to let you know that your reservation for <strong>[start date] – [end date]</strong> has been cancelled.")}
{status_box([("Cancellation no.", "[canc number]"), ("Confirmation no.", CONF), ("Dates", "[start date] – [end date]")])}
{p("If the payment deadline passed before we received your payment, the casita was released automatically &mdash; you're welcome to book again, or reply to this email if you already paid.")}
{p("<strong>Didn't expect this?</strong> Please reply to this email or call +63 917 792 0712 right away and we'll look into it.")}
{p("Any refund follows the cancellation policy below and is processed to your original payment method; our team will email you the details.")}
[table]
{CANCEL_POLICY}
{h2("We'd love to see you another time")}
{p("When you're ready, pick new dates on our website — you'll see what's free and your price right away.")}
{button(SITE + "/", "Book a new stay")}"""))

# 4. Reservation Invoice (system)
TEMPLATES["655217"] = dict(
    name="Reservation Invoice",
    subject="Invoice [invoice number] for your stay — due [invoice datedue]",
    body=shell("Your invoice from Virgin Beach Resort.", f"""
{h1("Your invoice, [first name]")}
{p("Here's the invoice for your reservation at Virgin Beach Resort.")}
{status_box([("Invoice no.", "[invoice number]"), ("Due", "[invoice datedue]"), ("Confirmation no.", CONF)])}
{p("<strong>To pay</strong>, use our secure payment page or transfer to one of our accounts, then reply with the screenshot:")}
{button(PAY_LINK, "Pay online")}
<div style="height:10px;"></div>
{bank_table()}
{small("Questions about this invoice? Just reply to this email.")}""", hero=False))

# 5. Reservation Folio (system)
TEMPLATES["655220"] = dict(
    name="Reservation Folio",
    subject="Your folio — Virgin Beach Resort · [conf number]",
    body=shell("Your folio from Virgin Beach Resort.", f"""
{h1("Your folio, [first name]")}
{p("Thank you for staying with us. For your records, your folio for reservation <strong>[conf number]</strong> ([start date] – [end date]) is below.")}
[table]
{small("Anything that doesn't look right? Reply to this email and our team will check it for you.")}""", hero=False))

# 6. Reservation Credit Note (system) — also fixes the sender (was admin@cloudbeds.com)
TEMPLATES["655218"] = dict(
    name="Reservation Credit Note",
    subject="Credit note [credit note number] — Virgin Beach Resort",
    from_email="reservations@virginbeachresort.com",
    body=shell("A credit note has been issued for your reservation.", f"""
{h1("A credit note for your reservation")}
{p("Hi [first name], we've issued a credit note for your reservation <strong>[conf number]</strong>.")}
{kv([("Credit note no.", "[credit note number]"), ("Original invoice no.", "[invoice number]")])}
{small("Questions? Just reply to this email.")}""", hero=False))

# 7. Website Booking (Payment Link) — custom, sent by staff
TEMPLATES["672223"] = dict(
    name="Website Booking (Payment Link)",
    subject="Complete your payment to confirm your stay — [conf number]",
    body=shell("Your secure payment link — valid for 24 hours.", f"""
{h1("Almost there, [first name]")}
{p("We've received your reservation, but your payment didn't go through. Your casita is held for <strong>24 hours</strong> — complete your payment through our secure page to confirm it.")}
{status_box([("Confirmation no.", CONF), ("Arrival", "[start date]"), ("Departure", "[end date]")], "warn")}
{ROOM_ROWS}
{button(PAY_LINK, "Complete my payment")}
{small("The link is valid for 24 hours; after that the reservation is released automatically. Prefer a bank transfer? Reply to this email and we'll send our account details.")}
{h2("Good to know")}
{ul(["<strong>Full-board meals</strong> are required for every guest each night and are settled at check-in: Adult (13+) ₱2,695 · Child (6–12) ₱1,347.50 · Child (0–5) free, per night.",
     "<strong>Check-in</strong> from 2:00 PM (you're welcome to arrive early and relax at the Pavilion — your first meal is lunch) · <strong>check-out</strong> at 11:30 AM."])}"""))

# 8. Website Booking Confirmation — custom, sent by staff (booking-engine bookings, meals paid at check-in)
TEMPLATES["720038"] = dict(
    name="Website Booking Confirmation",
    subject="Your stay is confirmed — Virgin Beach Resort · [conf number]",
    body=shell("Your payment went through and your stay is confirmed.", f"""
{h1("You're all set, [first name]!")}
{p("Your room payment has gone through and your reservation is <strong>confirmed</strong>.")}
{status_box([("Confirmation no.", CONF), ("Arrival", "[start date]"), ("Departure", "[end date]")], "ok")}
{ROOM_ROWS}
{h2("Before you arrive")}
{ul(["If you haven't already, reply with the <strong>full names and ages</strong> of everyone in your party, plus any <strong>food restrictions or allergies</strong>.",
     "<strong>Full-board meals</strong> are on top of the room rate and settled at check-in: Adult (13+) ₱2,695 · Child (6–12) ₱1,347.50 · Child (0–5) free, per night."])}
{h2("Good to know before your stay")}
{GOOD_TO_KNOW}
{GETTING_HERE}
{CANCEL_POLICY}
{p("See you at the beach!", "margin-top:18px;")}"""))

# 9. OTA Booking (Pending Payment) — custom, sent by staff
TEMPLATES["1191702"] = dict(
    name="OTA Booking (Pending Payment)",
    subject="Your reservation — one quick step to secure it · [conf number]",
    body=shell("Please send us your email address so we can send your payment link.", f"""
{h1("Thank you for booking with us, [first name]")}
{p("We've received your reservation. <strong>No amount has been charged to your card on file yet.</strong>")}
{status_box([("Confirmation no.", "[conf number]"), ("Arrival", "[start date]"), ("Departure", "[end date]")], "warn")}
{ROOM_ROWS}
{p("To secure your stay, please <strong>reply with your personal email address</strong> and we'll send you a secure payment link right away.")}
{h2("Good to know")}
{ul(["<strong>Full-board meals</strong> are required for every guest each night and are settled at check-in: Adult (13+) ₱2,695 · Child (6–12) ₱1,347.50 · Child (0–5) free, per night.",
     "<strong>Check-in</strong> from 2:00 PM (arrive early and relax at the Pavilion — your first meal is lunch) · <strong>check-out</strong> at 11:30 AM.",
     "Every guest needs a valid government-issued ID at check-in."])}"""))

# New: pre-arrival + thank-you (for Email Scheduling)
TEMPLATES["new-prearrival"] = dict(
    name="Pre-arrival (3 days before)", type="prearrival",
    subject="See you soon, [first name] — your stay starts [start date]",
    body=shell("Your stay is almost here — a few things to know before you arrive.", f"""
{h1("See you in 3 days, [first name]!")}
{p("We're getting your casita ready. Here's a quick checklist for a smooth arrival.")}
{STAY_BOX}
{ul(["Bring a <strong>valid government-issued ID</strong> for every guest (and Senior Citizen / PWD IDs for the discount).",
     "Still have a balance? Please settle it before arrival and reply with the screenshot.",
     "Tell us your <strong>estimated arrival time</strong> and any food restrictions or allergies — just reply to this email.",
     "Pack for the beach: swimwear (no denim or jersey shirts in the pool), sunscreen, and something warm for the sea breeze at night."])}
{GETTING_HERE}
{h2("Good to know")}
{GOOD_TO_KNOW}"""))

TEMPLATES["new-thankyou"] = dict(
    name="Thank you (1 day after check-out)", type="post_checkout",
    subject="Thank you for staying with us, [first name]",
    body=shell("Thank you for staying at Virgin Beach Resort.", f"""
{h1("Thank you for staying with us, [first name]")}
{p("We hope Laiya gave you the slow, sunny days you came for. It was a pleasure having you at Virgin Beach Resort.")}
{p("Would you take a minute to tell others about your stay? Your review helps our small team a lot.")}
{button("https://www.google.com/search?q=Virgin+Beach+Resort+Laiya+reviews", "Leave a review")}
{h2("Come back soon")}
{p("Next time, book directly on our website — you'll see what's free and your price right away.")}
{button(SITE + "/", "Book your next stay")}"""))

SAMPLE = {
    "[first name]": "Benie", "[full name]": "Benie Deodor", "[conf number]": "5710739120892", "[canc number]": "C-5710739120892",
    "[start date]": "Nov 4, 2026", "[end date]": "Nov 7, 2026", "[room type]": "Bamboo King Casita", "[nights]": "3",
    "[invoice number]": "INV-0001", "[invoice datedue]": "Nov 1, 2026", "[credit note number]": "CN-0001",
    "[table]": f'<div style="border:1px dashed {C["line"]};padding:12px;color:{C["soft"]};font-size:13px;margin:12px 0;">[Cloudbeds fills in the reservation / folio table here]</div>',
}


def fill(s):
    for k, v in SAMPLE.items():
        s = s.replace(k, v)
    return s


def main():
    out = {}
    for tid, t in TEMPLATES.items():
        body = re.sub(r"\n\s*\n", "\n", t["body"]).strip()
        body = vbr(body)
        out[tid] = {"name": t["name"], "subject": vbr(t["subject"]), "body": body, "type": t.get("type"), "from_email": t.get("from_email")}
        with open(os.path.join(HERE, re.sub(r"[^a-z0-9]+", "-", t["name"].lower()).strip("-") + ".html"), "w", encoding="utf-8") as f:
            f.write(body)
    with open(os.path.join(HERE, "templates.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    nav = "".join(f'<a href="#t{tid}" style="margin:0 10px 6px 0;display:inline-block;color:{C["deep"]};">{html.escape(t["name"])}</a>' for tid, t in out.items())
    parts = "".join(
        f'<section id="t{tid}" style="margin:30px auto;max-width:700px;"><h2 style="font-family:Georgia,serif;color:{C["deep"]};margin:0 0 4px;">{html.escape(t["name"])}</h2>'
        f'<p style="font:14px Helvetica,Arial;color:{C["soft"]};margin:0 0 10px;"><b>Subject:</b> {html.escape(fill(t["subject"]))}</p>{fill(t["body"])}</section>'
        for tid, t in out.items())
    with open(os.path.join(HERE, "preview.html"), "w", encoding="utf-8") as f:
        f.write(f'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cloudbeds Email Templates</title></head>'
                f'<body style="margin:0;background:#ece5d6;"><div style="max-width:700px;margin:0 auto;padding:20px 12px;font:15px Helvetica,Arial;">'
                f'<h1 style="font-family:Georgia,serif;color:{C["deep"]};">Cloudbeds email templates — preview</h1><p>{nav}</p></div>{parts}</body></html>')
    print("wrote", len(out), "templates")


if __name__ == "__main__":
    main()
