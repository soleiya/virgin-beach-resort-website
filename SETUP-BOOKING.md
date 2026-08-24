# Setting up your booking database (Supabase)

This covers **Day Trip, Half-day Tour, Day Picnic, and Corporate** requests only. Overnight casita reservations are handled separately, straight through Cloudbeds (see "Overnight stays" below) — they never touch this database.

Your site's Day Trip / Corporate request form writes straight to a real database you own — Supabase, a free hosted Postgres database with a built-in dashboard. No app to install, no server to run. This takes about 10 minutes, once.

## 1. Create your project

1. Go to **https://supabase.com** and sign up free (GitHub login works).
2. Click **New project**. Pick any name (e.g. "virgin-beach-resort"), set a database password (save it somewhere safe — you likely won't need it again), and choose the region closest to the Philippines (Singapore is usually the best pick).
3. Wait a minute or two for the project to finish provisioning.

## 2. Create the bookings table

1. In your new project, click **SQL Editor** in the left sidebar → **New query**.
2. Paste in the SQL below and click **Run**.

```sql
create extension if not exists pgcrypto;

create type booking_status as enum (
  'pending',
  'pending_payment',
  'confirmed',
  'declined',
  'completed'
);

create table booking_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status booking_status not null default 'pending',

  stay_type text not null,
  stay_type_label text,
  room_slug text,
  room_name text,
  check_in date,
  check_out date,
  adults int not null default 1,
  children_6_12 int not null default 0,
  children_0_5 int not null default 0,

  guest_name text not null,
  guest_email text not null,
  guest_phone text not null,
  country text,
  notes text,

  staff_notes text
);

alter table booking_requests enable row level security;

-- The public website can only ever ADD a new request — never read, edit,
-- or delete one. That's what makes the anon key below safe to publish.
create policy "Public can submit booking requests"
  on booking_requests for insert
  to anon
  with check (true);
```

That's it — no other tables or policies are needed. Because there's no `select`, `update`, or `delete` policy for the public `anon` role, nobody can read or change existing bookings through the website, even with the key that ships in your site's code. Only you, signed into the Supabase dashboard, can see and manage them (the dashboard uses your account's own access, which isn't restricted by these policies).

## 3. Connect your site to it

1. In the left sidebar, go to **Project Settings → API**.
2. Copy the **Project URL** and the **`anon` `public`** key (not the `service_role` key — never put that one in a website).
3. Open `assets/js/booking-config.js` in your site files and paste them in:

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxxxxxxxxxx.supabase.co",
  anonKey: "eyJhbGciOi...",
  fallbackEmail: "reservations@virginbeachresort.com",
};
```

4. Re-upload that file (or the whole site) to GitHub. That's the whole setup — every future booking request will now land in your `booking_requests` table.

## 4. Set up the staff dashboard

This is the tool your reservations team actually uses day to day — a simple, spreadsheet-like page at `staff/index.html` on your site. No Supabase account needed for staff; they sign in with one shared login you create.

**Run this SQL** (SQL Editor → New query), in addition to the table you already created:

```sql
alter table booking_requests add column if not exists source text not null default 'website';

create policy "Authenticated staff can view all bookings"
  on booking_requests for select
  to authenticated
  using (true);

create policy "Authenticated staff can insert bookings"
  on booking_requests for insert
  to authenticated
  with check (true);

create policy "Authenticated staff can update bookings"
  on booking_requests for update
  to authenticated
  using (true)
  with check (true);
```

This adds a `source` column (Website / Messenger / Phone / Email / Walk-in — so you can tell where a booking came from), and gives any **signed-in** user full access, while the public website keeps its insert-only access from before. Nothing changes for the public form.

**Create the shared staff login** (one-time):

1. In Supabase, go to **Authentication → Users → Add User**.
2. Email: `reservations@virginbeachresort.com` (or whatever inbox your team checks).
3. Password: pick one your team can remember and share — e.g. something like `SunriseCove2026!`.
4. Toggle **Auto Confirm User** on, so no confirmation email is required.
5. Click **Create User**.

Share that email and password with your reservations team — that's the login for the dashboard.

**The dashboard itself**: open `staff/index.html` on your site (e.g. `https://soleiya.github.io/virgin-beach-resort-website/staff/index.html`, or your own domain once connected). It isn't linked from the public site's menu, but it's not meant to be secret either — the login is what actually protects the data, not the URL. From there staff can:

- See every booking in one table — guest, contact, type, date, party size, status, source, notes.
- Filter with one click: **Today**, **This Week**, **This Month**, or **Unpaid** (pending + pending payment), or just search.
- Click **+ Add Booking** to log a request that came in through Messenger, a phone call, or a walk-in — same idea as filling in a spreadsheet row.
- Click a status badge to move it forward (Pending → Pending Payment → Confirmed → Declined/Completed) — no dropdowns, just a click.
- Type directly into the **Staff Notes** column — it saves automatically.
- Click **Export CSV** to download whatever's currently on screen as a spreadsheet file — handy for the "today's bookings" kind of file your team is used to pulling from Google Sheets.

## 5. Managing bookings day to day

The staff dashboard above is the everyday tool. Supabase's own **Table Editor** (Table Editor → `booking_requests`) is still there underneath if you ever want the raw view — same data, same columns — but your team shouldn't need it.

You can also invite teammates to your Supabase project itself (**Project Settings → Team**) if you want someone with their own Supabase login (separate from the shared staff dashboard login) to manage things at the database level.

## 6. Set up the visual cabana map, Order IDs, and payment-proof uploads

This is the newest layer: guests pick their actual cabana off a live map (like choosing a seat), every booking gets a short Order ID, and guests or staff can attach a payment screenshot — all without ever asking you to touch code again after this one-time setup.

**Run this SQL** (SQL Editor → New query), in addition to everything above:

```sql
-- 1. The cabana inventory itself, read straight from your Day Trip layout map.
create table if not exists cabanas (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('A','B')),
  row_index int not null,
  col_index int not null,
  cabana_type text not null check (cabana_type in ('dining_cabana','lounge_cabana')),
  number int not null,
  label text not null
);

alter table cabanas enable row level security;

create policy "Anyone can view the cabana list"
  on cabanas for select
  to anon, authenticated
  using (true);

-- Seed the 49 real units from VBR_Day_Trip_Layout.pdf — run once.
```

Then paste in and run the full `insert into cabanas (...) values (...)` statement from `cabana_seed.sql` (included alongside this file) — it's 49 rows, one per cabana on your map, so it's too long to repeat here twice.

```sql
-- 2. Link bookings to a specific cabana, and add an Order ID guests can quote.
alter table booking_requests add column if not exists cabana_id uuid references cabanas(id);
alter table booking_requests add column if not exists order_code text unique;
alter table booking_requests add column if not exists how_heard text;
alter table booking_requests add column if not exists occasion text;
alter table booking_requests add column if not exists marketing_opt_in boolean not null default true;
alter table booking_requests add column if not exists payment_screenshot_path text;
alter table booking_requests add column if not exists payment_uploaded_at timestamptz;

create sequence if not exists booking_order_seq start 1000;

create or replace function set_order_code() returns trigger
language plpgsql as $$
begin
  if new.order_code is null then
    new.order_code := 'VBR-' || nextval('booking_order_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_order_code on booking_requests;
create trigger trg_set_order_code
  before insert on booking_requests
  for each row execute function set_order_code();

-- 3. A narrow, PII-free window onto "which cabanas are taken on which date" —
-- this is what lets the public map show live availability without exposing
-- any guest's name, email, or phone to the public website.
create or replace view public_cabana_holds as
  select cabana_id, check_in
  from booking_requests
  where cabana_id is not null and status <> 'declined';

grant select on public_cabana_holds to anon, authenticated;

-- 4. Storage bucket for payment screenshots (private — nobody can browse it,
-- only fetch a specific file they already know the path to).
insert into storage.buckets (id, name, public)
  values ('payment-proofs', 'payment-proofs', false)
  on conflict (id) do nothing;

create policy "Anyone can upload a payment proof"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'payment-proofs');

create policy "Staff can view payment proofs"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'payment-proofs');

create policy "Staff can upload payment proofs"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'payment-proofs');

-- 5. The one narrow door that lets a guest (anon, no login) attach their
-- screenshot to their OWN booking — matched by Order ID + the email they
-- used — without opening up read/update access to every booking.
create or replace function submit_payment_proof(p_order_code text, p_guest_email text, p_storage_path text)
returns boolean
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  select id into v_id from booking_requests
    where order_code = p_order_code
      and lower(guest_email) = lower(p_guest_email)
    limit 1;
  if v_id is null then
    return false;
  end if;
  update booking_requests
    set payment_screenshot_path = p_storage_path,
        payment_uploaded_at = now(),
        status = case when status = 'pending' then 'pending_payment' else status end
    where id = v_id;
  return true;
end;
$$;

grant execute on function submit_payment_proof(text, text, text) to anon;
```

**What this gets you, with nothing more to configure:**

- The booking page (`book/index.html`) now shows a live seat-plan-style map of Section A and Section B once a guest picks a date — held cabanas are greyed out, and clicking an open one reserves the map slot as part of that request.
- Every submitted request gets a short **Order ID** like `VBR-1000`, shown on the confirmation screen.
- Guests can revisit `pay/index.html` any time, enter their Order ID + email, and upload a payment screenshot themselves — it lands in Supabase Storage and flips their status to Pending Payment automatically.
- On the staff dashboard, every row now shows its Order ID and assigned cabana (reassignable from a dropdown), and there's a **Mark Paid (Upload)** button per row for screenshots that come in over Messenger, email, or in person — uploading one automatically advances the status to Confirmed.
- Three new fields — **How did you hear about us**, **Occasion**, and a **marketing opt-in** checkbox — are now captured on every request and included in CSV exports, for your team's own marketing analysis later.

**A known limitation, since there's still no online payment gateway locking a slot**: two guests could theoretically pick the same open cabana for the same date a few minutes apart before either pays. This is the same trade-off as any manual-payment system — the dashboard's Cabana column makes a double-booking easy to spot and resolve by phone/message, exactly like it would be with a paper or spreadsheet chart.

## Overnight stays (Cloudbeds, not this database)

Every "Book Now" button tied to an overnight casita — the nav bar, the homepage hero, each casita's own page — links straight to `https://booking.virginbeachresort.com`, which redirects to your Cloudbeds reservation page. That's the same flow the current virginbeachresort.com site uses today. Nothing about that needs Supabase, and none of those bookings appear in the `booking_requests` table — manage them in Cloudbeds as you already do.

## If you skip this setup

The booking form still works without any of the above — it just falls back to opening the guest's email app with their request pre-filled, addressed to `reservations@virginbeachresort.com`. Nothing is lost either way; you just won't have the database/status-tracking workflow until you connect Supabase.

## A note on payment

This setup intentionally does **not** take payment online — no card fields, no payment gateway. Guests still pay you directly (bank transfer, GCash, etc.) exactly as before; the only thing that changed is that now a screenshot of that payment can be attached to the right booking, by the guest themselves or by staff, and that flips the status forward automatically. Nothing is charged, verified, or moved by the website — a human on your team still glances at every screenshot before treating a booking as paid. If you ever want guests to pay online (card, GCash, PayMongo, etc.) and have that update the status automatically without a human checking a screenshot, that's a separate, bigger project — happy to help if you want it later.

## What's next: automatic confirmation emails and a Google Drive backup of screenshots

Two pieces from this round aren't wired up yet because they need a decision from you first, not more code:

- **Automatic "here's your Order ID" email** the moment someone books. This needs a real email-sending service (I'd suggest Resend — simple, generous free tier) connected via a small Supabase Edge Function, and for that service to send convincingly "from" `reservations@virginbeachresort.com` without landing in spam, it needs to verify your domain, which means adding a couple of DNS records for `virginbeachresort.com`. Once you tell me you're OK signing up for that and have (or can get) access to your domain's DNS settings, I'll build it.
- **Copying payment screenshots into Google Drive.** I can do this myself using my own connected Google Drive access — either on request ("back up this week's payment screenshots to Drive") or on a schedule — but I'll need the shared staff login (the one from step 4 above) so I can read the Storage bucket the same way the dashboard does. Just share those credentials with me whenever you'd like this turned on.
