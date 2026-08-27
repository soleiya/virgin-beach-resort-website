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

## 7. Set up automatic "here's your Order ID" confirmation emails

This sends every guest an email the moment they submit a request, containing their Order ID — the same thing `pay/index.html` asks for. It needs a real email-sending service (not something Supabase does on its own), so there are a few one-time setup steps outside of SQL. The code is already written — `supabase-functions/send-booking-email/index.ts` (included alongside this file) — you're just connecting it.

**A. Sign up for Resend and verify your domain**

1. Go to **resend.com** and create a free account (100 emails/day, 3,000/month free — plenty for this).
2. In Resend, go to **Domains → Add Domain** and enter `virginbeachresort.com`.
3. Resend will show you 2–3 DNS records (usually TXT/CNAME for SPF and DKIM). Add those at wherever `virginbeachresort.com`'s DNS is managed. This can take a few minutes to a few hours to verify — Resend's dashboard will show "Verified" once it's done.
4. Go to **API Keys** in Resend and create one. Copy it — you'll paste it into Supabase next.

**B. Create the Edge Function in Supabase**

1. In your Supabase project, go to **Edge Functions** in the left sidebar → **Create a new function**.
2. Name it exactly `send-booking-email`.
3. Paste in the full contents of `supabase-functions/send-booking-email/index.ts`.
4. Turn **off** "Enforce JWT verification" for this function (there's a toggle when creating/editing it) — the function checks its own secret instead (see below), since the trigger calling it won't have a user login.
5. Under the function's **Secrets** (or Project Settings → Edge Functions → Secrets), add two:
   - `RESEND_API_KEY` — the key you copied from Resend.
   - `WEBHOOK_SECRET` — make up any random string, e.g. `vbr-hook-8f3k2p91` — just remember it for the next step.
6. Deploy the function.

**C. Wire it up with a Database Webhook**

1. In Supabase, go to **Database → Webhooks → Create a new webhook**.
2. Table: `booking_requests`. Events: **Insert** only.
3. Type: **Supabase Edge Functions** (or "HTTP Request" pointing at the function's URL, shown on the function's page — looks like `https://<your-project-ref>.functions.supabase.co/send-booking-email`).
4. Add a custom HTTP header: `x-webhook-secret` → the same random string you set as `WEBHOOK_SECRET` above.
5. Save it.

That's it — every new row in `booking_requests` now triggers an email to the guest with their Order ID. Test it by submitting a real request through the website with your own email address.

## 8. Multiple cabanas, automatic pricing, guest names, and the senior discount

This adds: picking more than one cabana per booking, a live running total shown to the guest as they fill out the form, a simple "type names separated by commas" field for the guest list, and the 20% senior citizen discount (applied only to each senior's own per-person fee, per how the discount law is normally applied — cabana rental isn't discounted since it's shared). A senior citizen ID photo upload is required the moment a guest says any of their party are seniors.

**Run this SQL** (SQL Editor → New query), in addition to everything above:

```sql
-- 1. Pricing lives on the cabana inventory itself, so you can change prices
-- any time by editing these two numbers — no code change needed.
alter table cabanas add column if not exists capacity int;
alter table cabanas add column if not exists price numeric;

update cabanas set capacity = 4, price = 2000 where cabana_type = 'lounge_cabana';
update cabanas set capacity = 10, price = 1500 where cabana_type = 'dining_cabana';

alter table cabanas alter column capacity set not null;
alter table cabanas alter column price set not null;

-- 2. A booking can now include more than one cabana — a join table instead
-- of the old single cabana_id column (still there, just no longer used by
-- new bookings).
create table if not exists booking_cabanas (
  booking_id uuid not null references booking_requests(id) on delete cascade,
  cabana_id uuid not null references cabanas(id),
  primary key (booking_id, cabana_id)
);

alter table booking_cabanas enable row level security;

create policy "Public can attach cabanas to their own new booking"
  on booking_cabanas for insert
  to anon
  with check (true);

create policy "Authenticated staff can view booking cabanas"
  on booking_cabanas for select
  to authenticated
  using (true);

create policy "Authenticated staff can insert booking cabanas"
  on booking_cabanas for insert
  to authenticated
  with check (true);

create policy "Authenticated staff can delete booking cabanas"
  on booking_cabanas for delete
  to authenticated
  using (true);

-- 3. The public availability view now reflects the join table instead of
-- the old single-cabana column.
create or replace view public_cabana_holds as
  select bc.cabana_id, br.check_in
  from booking_cabanas bc
  join booking_requests br on br.id = bc.booking_id
  where br.status <> 'declined';

-- 4. New fields: guest names (one simple text field — no rigid per-person
-- inputs), the senior citizen count and their ID photo(s), and the computed
-- bill so your team never has to re-calculate it by hand.
alter table booking_requests add column if not exists guest_names text;
alter table booking_requests add column if not exists senior_count int not null default 0;
alter table booking_requests add column if not exists senior_id_paths text[];
alter table booking_requests add column if not exists subtotal_people numeric;
alter table booking_requests add column if not exists cabana_total numeric;
alter table booking_requests add column if not exists senior_discount numeric;
alter table booking_requests add column if not exists total_amount numeric;

-- 5. Storage bucket for senior citizen ID photos — same private setup as
-- the payment-proofs bucket.
insert into storage.buckets (id, name, public)
  values ('senior-ids', 'senior-ids', false)
  on conflict (id) do nothing;

create policy "Anyone can upload a senior ID photo"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'senior-ids');

create policy "Staff can view senior ID photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'senior-ids');
```

**What this gets you:**

- On the booking page, guests can tap as many cabanas as they need — each one adds to a running list with its own rental fee, and a total capacity check gently flags it if the party is bigger than the cabanas selected can seat (it won't block the booking, just a heads-up).
- A live "Estimated Total" box updates as the guest fills in adults, kids, cabanas, and senior citizens — no surprises when your team follows up about payment.
- Guests type all attendee names into one plain text box ("Juan Dela Cruz, Maria Santos, ...") — nothing fussier than that. Your team can split it by comma whenever they need individual names.
- The moment a guest says 1 or more of their party are senior citizens, an ID upload appears and is required before they can submit — it's saved the same private way payment screenshots are.
- Every booking now stores its own computed breakdown (`subtotal_people`, `cabana_total`, `senior_discount`, `total_amount`) so the staff dashboard and CSV exports always show the real total without anyone doing mental math.
- On the staff dashboard, the Cabana column now shows every cabana attached to a booking (not just one), with a quick way to add or remove one.

**Corporate Outings keep their current manual "request a quote" flow** — no automatic pricing there, since those usually need a custom negotiated rate. Day Trip, Half-day, and Day Picnic all get the calculator.

## 9. Activity log, date-range/status filters, sorting, and summary stats

This adds a tamper-resistant activity log (since several staff now sign in with their own individual accounts, not one shared login), plus a filter row, sortable columns, and live summary stats on the dashboard. It also removes the old visual cabana map from the staff dashboard's Availability panel — that graphic still lives on the public booking page, but the dashboard now only shows the plain request table plus these controls.

**Run this SQL** (SQL Editor → New query), in addition to everything above:

```sql
create table if not exists booking_audit_log (
  id uuid primary key default gen_random_uuid(),
  logged_at timestamptz not null default now(),
  booking_id uuid,
  order_code text,
  guest_name text,
  action text not null,
  changed_by_id uuid,
  changed_by_email text,
  changes jsonb
);

create index if not exists idx_audit_log_booking on booking_audit_log(booking_id);
create index if not exists idx_audit_log_logged_at on booking_audit_log(logged_at desc);
create index if not exists idx_audit_log_email on booking_audit_log(changed_by_email);

alter table booking_audit_log enable row level security;

create policy "Authenticated staff can view audit log"
  on booking_audit_log for select
  to authenticated
  using (true);

-- Deliberately no insert/update/delete policy for anon or authenticated —
-- the only writer is the trigger function below (running as its owner,
-- which is exempt from RLS), so nobody can forge or erase log entries
-- through the dashboard or the API, even with a valid staff login.

create or replace function log_booking_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_changes jsonb;
begin
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  begin v_email := auth.jwt() ->> 'email'; exception when others then v_email := null; end;

  if tg_op = 'INSERT' then
    insert into booking_audit_log (booking_id, order_code, guest_name, action, changed_by_id, changed_by_email, changes)
    values (new.id, new.order_code, new.guest_name, 'insert', v_uid, v_email, to_jsonb(new));
    return new;

  elsif tg_op = 'UPDATE' then
    select jsonb_object_agg(t.key, jsonb_build_object('old', t.old_val, 'new', t.new_val))
      into v_changes
    from (
      select e.key as key,
             (to_jsonb(old) -> e.key) as old_val,
             (to_jsonb(new) -> e.key) as new_val
      from jsonb_each(to_jsonb(new)) as e(key, value)
      where (to_jsonb(old) -> e.key) is distinct from (to_jsonb(new) -> e.key)
    ) t;

    if v_changes is null then
      return new;
    end if;

    insert into booking_audit_log (booking_id, order_code, guest_name, action, changed_by_id, changed_by_email, changes)
    values (new.id, new.order_code, new.guest_name, 'update', v_uid, v_email, v_changes);
    return new;

  elsif tg_op = 'DELETE' then
    insert into booking_audit_log (booking_id, order_code, guest_name, action, changed_by_id, changed_by_email, changes)
    values (old.id, old.order_code, old.guest_name, 'delete', v_uid, v_email, to_jsonb(old));
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_log_booking_change on booking_requests;
create trigger trg_log_booking_change
  after insert or update or delete on booking_requests
  for each row execute function log_booking_change();

create or replace function log_cabana_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_booking_id uuid;
  v_cabana_id uuid;
  v_action text;
begin
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  begin v_email := auth.jwt() ->> 'email'; exception when others then v_email := null; end;

  if tg_op = 'INSERT' then
    v_booking_id := new.booking_id; v_cabana_id := new.cabana_id; v_action := 'cabana_added';
  else
    v_booking_id := old.booking_id; v_cabana_id := old.cabana_id; v_action := 'cabana_removed';
  end if;

  insert into booking_audit_log (booking_id, action, changed_by_id, changed_by_email, changes)
  values (v_booking_id, v_action, v_uid, v_email, jsonb_build_object('cabana_id', v_cabana_id));

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_cabana_change on booking_cabanas;
create trigger trg_log_cabana_change
  after insert or delete on booking_cabanas
  for each row execute function log_cabana_change();
```

**What this gets you:**

- **Activity Log**: every insert, edit, or delete on `booking_requests` (status changes, staff notes, payment uploads, cabana assignments — everything) is written automatically to `booking_audit_log` by a database trigger, recording who did it (their login email, captured server-side — not something the browser can fake), when, and exactly which fields changed, old value → new value. Staff can view it (read-only) from the **Activity Log** button on the dashboard, or per-row via the small clock icon in the new **Log** column, which pre-filters to just that booking. Nobody — not even a signed-in staff member — has permission to edit or delete a log entry; only the trigger can write to that table.
- **Date range search**: a "From" / "To" date filter that can apply to either the guest's preferred/check-in date or the date the row was entered into the system.
- **Filters**: dropdowns for Status, Booking Type, Booked By (staff member), and Source, on top of the existing quick pills and free-text search — all combine together, and a **Clear Filters** button resets everything at once.
- **Sorting**: click any underlined-on-hover column header (Order ID, Guest, Type, Booked By, Preferred Date, Party, Total, Status, Source, Date Entered) to sort by it; click again to reverse direction.
- **Date Entered**: the old "Received" column is now labeled **Date Entered** — it's always the real server timestamp of when the row was created (Postgres' own clock, not a staff member's browser), so it's a reliable record of when data was actually entered, going forward.
- **Summary stats**: a row of tiles above the table — Bookings Shown, Total Guests, Total Paid, Total Unpaid — recalculated live from whatever combination of filters is currently applied.
- **Visual map removed from the dashboard**: the Cabana Availability panel (the illustrated seat-map) has been removed from the staff dashboard to keep it focused on the request table; the map still appears for guests on the public booking page. Assigning/removing a cabana from a booking is still done inline in the table's Cabana(s) column, unchanged.

## What's next: a Google Drive backup of payment screenshots

Copying payment screenshots into your Google Drive is ready to turn on whenever you want — I can do it myself using my own connected Google Drive access, either on request ("back up this week's payment screenshots to Drive") or on a schedule. I'll just need the shared staff login (from step 4 in Section 4 above) so I can read the Storage bucket the same way the dashboard does. Just share those credentials with me whenever you're ready — no rush.
