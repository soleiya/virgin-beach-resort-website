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

## Overnight stays (Cloudbeds, not this database)

Every "Book Now" button tied to an overnight casita — the nav bar, the homepage hero, each casita's own page — links straight to `https://booking.virginbeachresort.com`, which redirects to your Cloudbeds reservation page. That's the same flow the current virginbeachresort.com site uses today. Nothing about that needs Supabase, and none of those bookings appear in the `booking_requests` table — manage them in Cloudbeds as you already do.

## If you skip this setup

The booking form still works without any of the above — it just falls back to opening the guest's email app with their request pre-filled, addressed to `reservations@virginbeachresort.com`. Nothing is lost either way; you just won't have the database/status-tracking workflow until you connect Supabase.

## A note on payment

This setup intentionally does **not** take payment online — no card fields, no payment gateway, nothing guest-facing changes based on status. "Pending Payment" is purely an internal label for your team to track who still owes money and how. If you ever want guests to pay online (card, GCash, PayMongo, etc.) and have that update the status automatically, that's a separate, bigger project — happy to help if you want it later.
