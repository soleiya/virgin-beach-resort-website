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

## 4. Managing bookings day to day

You don't need a custom admin page — Supabase's own **Table Editor** is your booking dashboard:

1. In your Supabase project, click **Table Editor** in the sidebar, then the `booking_requests` table.
2. Every request appears as a row, newest first if you sort by `created_at`.
3. Click a row's `status` cell to change it. Your workflow, from left to right:
   - **pending** — just came in, availability not checked yet
   - **pending_payment** — you've confirmed availability and are waiting for the guest to pay (bank transfer, GCash, on arrival — however you already collect payment; this is a status only, there's no online payment built in)
   - **confirmed** — payment received, booking locked in
   - **declined** — no availability, or the guest didn't follow through
   - **completed** — the stay or visit has happened
4. Use the `staff_notes` column for anything internal (e.g. "paid via GCash 8/24", "asked for late checkout") — guests never see this.
5. Filter or sort using the controls above the table (e.g. filter `status = pending` to see what needs action), or use the search bar.

You can also invite teammates to your Supabase project (**Project Settings → Team**) so more than one person can manage bookings, with their own login.

## Overnight stays (Cloudbeds, not this database)

Every "Book Now" button tied to an overnight casita — the nav bar, the homepage hero, each casita's own page — links straight to `https://booking.virginbeachresort.com`, which redirects to your Cloudbeds reservation page. That's the same flow the current virginbeachresort.com site uses today. Nothing about that needs Supabase, and none of those bookings appear in the `booking_requests` table — manage them in Cloudbeds as you already do.

## If you skip this setup

The booking form still works without any of the above — it just falls back to opening the guest's email app with their request pre-filled, addressed to `reservations@virginbeachresort.com`. Nothing is lost either way; you just won't have the database/status-tracking workflow until you connect Supabase.

## A note on payment

This setup intentionally does **not** take payment online — no card fields, no payment gateway, nothing guest-facing changes based on status. "Pending Payment" is purely an internal label for your team to track who still owes money and how. If you ever want guests to pay online (card, GCash, PayMongo, etc.) and have that update the status automatically, that's a separate, bigger project — happy to help if you want it later.
