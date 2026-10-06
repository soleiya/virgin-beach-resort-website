-- ============================================================================
-- Booking rules v8 — Overnight villa (casita) bookings on the website.
--
-- Replaces Cloudbeds for the 18 casitas:
--   * villas            — the 18 real units (from the Cloudbeds calendar) with
--                         their weekday / weekend rates and occupancy
--   * overnight_rates   — meal package, extra mattress, pet fee (one row)
--   * peak_dates        — nights charged at the weekend rate (holidays etc.)
--   * booking_villas    — which units a booking holds, for which nights. A
--                         database constraint makes a double booking
--                         IMPOSSIBLE (website, staff, or anyone else).
--                         Rows with no booking are staff blocks (repairs…).
--   * quote_overnight() — THE price calculation, used by the website, the
--                         staff dashboard and the emails, so all three agree.
--   * submit_overnight_booking() — the public website's only way in. Counts
--                         guests from the mandatory companion list itself.
--
-- Run in Supabase → SQL Editor (after booking-v7.sql). Safe to re-run.
-- ============================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Inventory
-- ---------------------------------------------------------------------------
create table if not exists villas (
  id uuid primary key default gen_random_uuid(),
  unit_label text not null unique,         -- "Casita 9", "B.Casita 4"
  room_type text not null,                 -- matches the site's casita page slug
  room_type_name text not null,
  base_occupancy int not null,             -- guests included in the room rate
  max_extra int not null default 0,        -- extra floor mattresses allowed
  weekday_rate numeric not null,           -- per night, Sun–Thu nights
  weekend_rate numeric not null,           -- per night, Fri & Sat nights + peak dates
  sort int not null default 0,
  active boolean not null default true
);

alter table villas enable row level security;
drop policy if exists "Anyone can view villas" on villas;
create policy "Anyone can view villas" on villas for select to anon, authenticated using (true);

-- The 18 units exactly as set up in Cloudbeds (Oct 2026). Rates per the
-- website / Cloudbeds rate plan, inclusive of 12% VAT and service charge.
-- Two-queen rooms: 4 guests + 1 extra mattress (Reservations Agreement).
insert into villas (unit_label, room_type, room_type_name, base_occupancy, max_extra, weekday_rate, weekend_rate, sort) values
  ('Casita 15',  'deluxe-king-casita',   'Deluxe King Casita',         2, 1, 18525, 21825, 10),
  ('Casita 14',  'double-queen-casita',  'Deluxe Double Queen Casita', 4, 1, 18525, 21825, 20),
  ('Casita 12',  'sunrise-casita',       'Sunrise Casita',             4, 1, 15525, 17525, 30),
  ('Casita 11',  'sunrise-casita',       'Sunrise Casita',             4, 1, 15525, 17525, 31),
  ('Casita 10',  'sunrise-casita',       'Sunrise Casita',             4, 1, 15525, 17525, 32),
  ('Casita 9',   'sunrise-casita',       'Sunrise Casita',             4, 1, 15525, 17525, 33),
  ('Casita 8',   'sunrise-casita',       'Sunrise Casita',             4, 1, 15525, 17525, 34),
  ('Casita 7',   'sunrise-casita',       'Sunrise Casita',             4, 1, 15525, 17525, 35),
  ('Casita 4',   'louver-window-casita', 'Louver-Window Casita',       4, 1, 14525, 16525, 40),
  ('Casita 3',   'louver-window-casita', 'Louver-Window Casita',       4, 1, 14525, 16525, 41),
  ('Casita 2',   'louver-window-casita', 'Louver-Window Casita',       4, 1, 14525, 16525, 42),
  ('Casita 1',   'louver-window-casita', 'Louver-Window Casita',       4, 1, 14525, 16525, 43),
  ('B.Casita 4', 'bamboo-king-casita',   'Bamboo King Casita',         2, 0,  9225, 12925, 50),
  ('B.Casita 2', 'bamboo-king-casita',   'Bamboo King Casita',         2, 0,  9225, 12925, 51),
  ('B.Casita 6', 'bamboo-casita',        'Bamboo Casita',              4, 1,  9225, 12925, 60),
  ('B.Casita 5', 'bamboo-casita',        'Bamboo Casita',              4, 1,  9225, 12925, 61),
  ('B.Casita 3', 'bamboo-casita',        'Bamboo Casita',              4, 1,  9225, 12925, 62),
  ('B.Casita 1', 'bamboo-casita',        'Bamboo Casita',              4, 1,  9225, 12925, 63)
on conflict (unit_label) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Rates that aren't per-room (one row — edit in Table Editor any time)
-- ---------------------------------------------------------------------------
create table if not exists overnight_rates (
  id int primary key default 1 check (id = 1),
  meal_adult numeric not null,          -- full board, per adult per night
  meal_child numeric not null,          -- ages 6–12, per night (0–5 free)
  extra_bed numeric not null,           -- floor mattress, per night
  pet_per_night numeric not null,
  senior_discount_rate numeric not null default 0.20,
  max_nights int not null default 14,
  check_in_time text not null default '2:00 PM',
  check_out_time text not null default '11:30 AM'
);
alter table overnight_rates enable row level security;
drop policy if exists "Anyone can view overnight rates" on overnight_rates;
create policy "Anyone can view overnight rates" on overnight_rates for select to anon, authenticated using (true);

insert into overnight_rates (id, meal_adult, meal_child, extra_bed, pet_per_night)
values (1, 2695, 1347.50, 1500, 750)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Peak dates — a night on one of these dates is charged the weekend rate
--    (e.g. the night before a long weekend or holiday). Staff manage these
--    from the dashboard.
-- ---------------------------------------------------------------------------
create table if not exists peak_dates (
  night date primary key,
  label text
);
alter table peak_dates enable row level security;
drop policy if exists "Anyone can view peak dates" on peak_dates;
create policy "Anyone can view peak dates" on peak_dates for select to anon, authenticated using (true);
drop policy if exists "Staff can add peak dates" on peak_dates;
create policy "Staff can add peak dates" on peak_dates for insert to authenticated with check (true);
drop policy if exists "Staff can remove peak dates" on peak_dates;
create policy "Staff can remove peak dates" on peak_dates for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. New booking columns (all nullable — Day Trips are untouched)
-- ---------------------------------------------------------------------------
alter table booking_requests add column if not exists companions jsonb;        -- [{name, age_group}]
alter table booking_requests add column if not exists primary_is_senior boolean not null default false;
alter table booking_requests add column if not exists extra_beds int not null default 0;
alter table booking_requests add column if not exists room_total numeric;
alter table booking_requests add column if not exists meal_total numeric;
alter table booking_requests add column if not exists extra_bed_total numeric;
alter table booking_requests add column if not exists pet_total numeric;

-- ---------------------------------------------------------------------------
-- 5. Which villa, which nights. check_out is the departure date (not a night).
-- ---------------------------------------------------------------------------
create table if not exists booking_villas (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references booking_requests(id) on delete cascade,
  villa_id uuid not null references villas(id),
  check_in date not null,
  check_out date not null,
  active boolean not null default true,      -- false once the booking is declined/expired
  block_reason text,                         -- staff block (no booking): "Roof repair"
  created_at timestamptz not null default now(),
  created_by text,
  constraint booking_villas_dates check (check_out > check_in),
  constraint booking_villas_owner check (booking_id is not null or nullif(trim(block_reason), '') is not null),
  constraint booking_villas_no_overlap exclude using gist (
    villa_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (active)
);
create index if not exists booking_villas_booking on booking_villas(booking_id);
create index if not exists booking_villas_dates on booking_villas(check_in, check_out);

alter table booking_villas enable row level security;
drop policy if exists "Staff can view booking villas" on booking_villas;
create policy "Staff can view booking villas" on booking_villas for select to authenticated using (true);
drop policy if exists "Staff can add booking villas" on booking_villas;
create policy "Staff can add booking villas" on booking_villas for insert to authenticated with check (true);
drop policy if exists "Staff can change booking villas" on booking_villas;
create policy "Staff can change booking villas" on booking_villas for update to authenticated using (true) with check (true);
drop policy if exists "Staff can remove booking villas" on booking_villas;
create policy "Staff can remove booking villas" on booking_villas for delete to authenticated using (true);
-- No anon policy: the website books through submit_overnight_booking().

-- A villa row attached to a booking always follows that booking's dates and
-- status — the dashboard only has to say which villa.
create or replace function booking_villas_follow_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare b booking_requests%rowtype;
begin
  if new.booking_id is not null then
    select * into b from booking_requests where id = new.booking_id;
    if b.check_in is null or b.check_out is null or b.check_out <= b.check_in then
      raise exception 'Set the check-in and check-out dates before assigning a villa';
    end if;
    new.check_in := b.check_in;
    new.check_out := b.check_out;
    new.active := b.status not in ('declined', 'expired');
  end if;
  if new.created_by is null then
    begin new.created_by := auth.jwt() ->> 'email'; exception when others then null; end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_booking_villas_follow on booking_villas;
create trigger trg_booking_villas_follow
  before insert or update on booking_villas
  for each row execute function booking_villas_follow_booking();

-- …and when a booking's dates or status change, its villas move with it.
-- If a villa is no longer free for the new dates (or an expired booking is
-- re-opened after its villa was re-sold) the change is refused.
create or replace function booking_sync_villas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.check_in is distinct from old.check_in
     or new.check_out is distinct from old.check_out
     or new.status is distinct from old.status then
    if exists (select 1 from booking_villas where booking_id = new.id) then
      if new.check_in is null or new.check_out is null or new.check_out <= new.check_in then
        raise exception 'An overnight booking needs a check-out date after the check-in date';
      end if;
      update booking_villas set check_in = new.check_in, check_out = new.check_out
        where booking_id = new.id;  -- the follow trigger recomputes active
    end if;
  end if;
  return new;
exception when exclusion_violation then
  raise exception 'That villa is already booked for some of those nights — pick other dates or another villa.'
    using errcode = 'P0001';
end;
$$;
drop trigger if exists trg_booking_sync_villas on booking_requests;
create trigger trg_booking_sync_villas
  after update of check_in, check_out, status on booking_requests
  for each row execute function booking_sync_villas();

-- Activity log for villa assignments and blocks (same table as everything else).
create or replace function log_villa_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_email text; r booking_villas%rowtype; v_action text; v_label text;
begin
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  begin v_email := auth.jwt() ->> 'email'; exception when others then v_email := null; end;
  r := coalesce(new, old);
  if tg_op = 'UPDATE' and new.villa_id = old.villa_id then return new; end if; -- date/active follow-ups are logged on the booking
  select unit_label into v_label from villas where id = r.villa_id;
  v_action := case
    when r.booking_id is null and tg_op = 'INSERT' then 'villa_blocked'
    when r.booking_id is null then 'villa_unblocked'
    when tg_op = 'INSERT' then 'villa_added'
    when tg_op = 'DELETE' then 'villa_removed'
    else 'villa_changed' end;
  insert into booking_audit_log (booking_id, order_code, guest_name, action, changed_by_id, changed_by_email, changes)
  select r.booking_id, b.order_code, coalesce(b.guest_name, 'BLOCK: ' || r.block_reason), v_action, v_uid, v_email,
         jsonb_build_object('villa_id', r.villa_id, 'villa', v_label, 'check_in', r.check_in, 'check_out', r.check_out,
                            'from_villa', case when tg_op = 'UPDATE' then (select unit_label from villas where id = old.villa_id) end,
                            'reason', r.block_reason)
  from (select 1) x left join booking_requests b on b.id = r.booking_id;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_log_villa_change on booking_villas;
create trigger trg_log_villa_change
  after insert or update or delete on booking_villas
  for each row execute function log_villa_change();

-- Public, PII-free availability: which unit is taken for which nights.
create or replace view public_villa_holds as
  select villa_id, check_in, check_out from booking_villas where active;
grant select on public_villa_holds to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The price. One function, used everywhere.
--    Room: each night at the weekday or weekend rate (Fri/Sat nights and
--    peak dates are weekend). Extra mattress for guests beyond the rooms'
--    base occupancy. Full-board meals for every guest, every night (0–5 free).
--    Senior/PWD: 20% off their own meals and their per-head share of the
--    room (room ÷ guests). Pets: per pet per night.
-- ---------------------------------------------------------------------------
create or replace function quote_overnight(
  p_check_in date, p_check_out date, p_villa_ids uuid[],
  p_adults int, p_seniors int default 0, p_kids612 int default 0, p_kids05 int default 0,
  p_pets int default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rt overnight_rates%rowtype;
  v_nights int;
  v_adults int := greatest(coalesce(p_adults, 0), 0);
  v_seniors int := least(greatest(coalesce(p_seniors, 0), 0), greatest(coalesce(p_adults, 0), 0));
  v_k612 int := greatest(coalesce(p_kids612, 0), 0);
  v_k05 int := greatest(coalesce(p_kids05, 0), 0);
  v_pets int := greatest(coalesce(p_pets, 0), 0);
  v_guests int;
  v_base int := 0; v_maxextra int := 0; v_extra int;
  v_room numeric := 0; v_extra_total numeric := 0; v_meal numeric := 0; v_pet numeric := 0; v_sdisc numeric := 0;
  v_wd int := 0; v_we int := 0;
  lines jsonb := '[]'::jsonb;
  v record;
  n record;
  v_villas jsonb := '[]'::jsonb;
  v_regular int;
  v_senior_meal numeric;
begin
  select * into rt from overnight_rates where id = 1;
  v_nights := p_check_out - p_check_in;
  if p_check_in is null or p_check_out is null or v_nights < 1 then
    return jsonb_build_object('ok', false, 'error', 'Pick a check-out date after the check-in date.');
  end if;
  v_guests := v_adults + v_k612 + v_k05;

  -- nights split by rate
  for n in select d::date as night,
                  (extract(isodow from d) in (5, 6) or exists (select 1 from peak_dates pd where pd.night = d::date)) as weekend
           from generate_series(p_check_in, p_check_out - 1, interval '1 day') d
  loop
    if n.weekend then v_we := v_we + 1; else v_wd := v_wd + 1; end if;
  end loop;

  for v in select * from villas where id = any(coalesce(p_villa_ids, '{}')) order by sort loop
    v_base := v_base + v.base_occupancy;
    v_maxextra := v_maxextra + v.max_extra;
    v_villas := v_villas || jsonb_build_object('id', v.id, 'unit_label', v.unit_label, 'room_type', v.room_type, 'room_type_name', v.room_type_name);
    if v_wd > 0 then
      lines := lines || jsonb_build_object('kind', 'room', 'desc', v.room_type_name || ' (' || v.unit_label || ') — weekday night' || case when v_wd > 1 then 's' else '' end,
                                           'rate', v.weekday_rate, 'qty', v_wd, 'amount', v.weekday_rate * v_wd, 'vat_exempt', false);
      v_room := v_room + v.weekday_rate * v_wd;
    end if;
    if v_we > 0 then
      lines := lines || jsonb_build_object('kind', 'room', 'desc', v.room_type_name || ' (' || v.unit_label || ') — weekend/peak night' || case when v_we > 1 then 's' else '' end,
                                           'rate', v.weekend_rate, 'qty', v_we, 'amount', v.weekend_rate * v_we, 'vat_exempt', false);
      v_room := v_room + v.weekend_rate * v_we;
    end if;
  end loop;

  if jsonb_array_length(v_villas) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Pick at least one casita.', 'nights', v_nights);
  end if;

  v_extra := greatest(v_guests - v_base, 0);
  if v_extra > 0 then
    v_extra_total := v_extra * rt.extra_bed * v_nights;
    lines := lines || jsonb_build_object('kind', 'extra_bed', 'desc', 'Extra person with floor mattress (' || v_extra || ' × ' || v_nights || ' night' || case when v_nights > 1 then 's' else '' end || ')',
                                         'rate', rt.extra_bed, 'qty', v_extra * v_nights, 'amount', v_extra_total, 'vat_exempt', false);
  end if;

  v_regular := v_adults - v_seniors;
  v_senior_meal := round(rt.meal_adult * (1 - rt.senior_discount_rate), 2);
  if v_regular > 0 then
    lines := lines || jsonb_build_object('kind', 'meal', 'desc', 'Full-board meal package — Adult (13 y.o. +)', 'rate', rt.meal_adult, 'qty', v_regular * v_nights, 'amount', rt.meal_adult * v_regular * v_nights, 'vat_exempt', false);
  end if;
  if v_seniors > 0 then
    lines := lines || jsonb_build_object('kind', 'meal', 'desc', 'Full-board meal package — Senior Citizen / PWD (20% off)', 'rate', v_senior_meal, 'qty', v_seniors * v_nights, 'amount', v_senior_meal * v_seniors * v_nights, 'vat_exempt', true);
  end if;
  if v_k612 > 0 then
    lines := lines || jsonb_build_object('kind', 'meal', 'desc', 'Full-board meal package — Child (6–12 y.o.)', 'rate', rt.meal_child, 'qty', v_k612 * v_nights, 'amount', rt.meal_child * v_k612 * v_nights, 'vat_exempt', false);
  end if;
  if v_k05 > 0 then
    lines := lines || jsonb_build_object('kind', 'meal', 'desc', 'Full-board meal package — Child (0–5 y.o.)', 'rate', 0, 'qty', v_k05 * v_nights, 'amount', 0, 'vat_exempt', false);
  end if;
  v_meal := rt.meal_adult * v_regular * v_nights + v_senior_meal * v_seniors * v_nights + rt.meal_child * v_k612 * v_nights;

  if v_pets > 0 then
    v_pet := rt.pet_per_night * v_pets * v_nights;
    lines := lines || jsonb_build_object('kind', 'pet', 'desc', 'Pet fee (per pet, per night)', 'rate', rt.pet_per_night, 'qty', v_pets * v_nights, 'amount', v_pet, 'vat_exempt', false);
  end if;

  if v_seniors > 0 and v_guests > 0 then
    v_sdisc := round((v_room + v_extra_total) / v_guests * v_seniors * rt.senior_discount_rate, 2);
    lines := lines || jsonb_build_object('kind', 'senior_room', 'desc', 'Senior Citizen / PWD discount — 20% of their share of the room (' || v_seniors || ' of ' || v_guests || ' guests)',
                                         'rate', -v_sdisc, 'qty', 1, 'amount', -v_sdisc, 'vat_exempt', false);
  end if;

  return jsonb_build_object(
    'ok', v_guests <= v_base + v_maxextra and v_adults >= 1,
    'error', case when v_adults < 1 then 'At least one adult is required.'
                  when v_guests > v_base + v_maxextra then
                    'Your party of ' || v_guests || ' is more than the casita' || case when jsonb_array_length(v_villas) > 1 then 's' else '' end ||
                    ' you picked can take (' || (v_base + v_maxextra) || ' incl. extra mattresses). Please add another casita.'
                  else null end,
    'nights', v_nights, 'weekday_nights', v_wd, 'weekend_nights', v_we,
    'guests', v_guests, 'adults', v_adults, 'seniors', v_seniors, 'kids612', v_k612, 'kids05', v_k05, 'pets', v_pets,
    'base_capacity', v_base, 'max_capacity', v_base + v_maxextra, 'extra_beds', v_extra,
    'villas', v_villas, 'lines', lines,
    'room_total', v_room, 'extra_bed_total', v_extra_total, 'meal_total', v_meal, 'pet_total', v_pet,
    'senior_discount', v_sdisc + (rt.meal_adult - v_senior_meal) * v_seniors * v_nights,
    'total', round(v_room + v_extra_total + v_meal + v_pet - v_sdisc, 2),
    'rates', jsonb_build_object('meal_adult', rt.meal_adult, 'meal_child', rt.meal_child, 'extra_bed', rt.extra_bed,
                                'pet', rt.pet_per_night, 'check_in_time', rt.check_in_time, 'check_out_time', rt.check_out_time)
  );
end;
$$;
grant execute on function quote_overnight(date, date, uuid[], int, int, int, int, int) to anon, authenticated;

-- Quote an existing booking from what's saved on it (used by the emails).
create or replace function quote_booking_overnight(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select quote_overnight(b.check_in, b.check_out,
           (select array_agg(villa_id) from booking_villas bv where bv.booking_id = b.id),
           b.adults, b.senior_count, b.children_6_12, b.children_0_5, b.pet_count)
  from booking_requests b where b.id = p_booking_id;
$$;
revoke all on function quote_booking_overnight(uuid) from public, anon;
grant execute on function quote_booking_overnight(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Website submit. The guest list is mandatory: every companion has a full
--    name and an age group, and the head-count (which drives the meal
--    package) is taken from that list — never from numbers the browser sent.
-- ---------------------------------------------------------------------------
create or replace function submit_overnight_booking(payload jsonb, villa_ids uuid[])
returns table(id uuid, order_code text, total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_in date := nullif(payload->>'check_in', '')::date;
  v_out date := nullif(payload->>'check_out', '')::date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  rt overnight_rates%rowtype;
  v_comp jsonb := coalesce(payload->'companions', '[]'::jsonb);
  c jsonb;
  v_name text;
  v_group text;
  v_primary_senior boolean := coalesce((payload->>'primary_is_senior')::boolean, false);
  v_adults int := 1; v_seniors int := 0; v_k612 int := 0; v_k05 int := 0;
  v_pets int := coalesce((payload->>'pet_count')::int, 0);
  v_pet_paths text[];
  v_names text[];
  q jsonb;
  v_id uuid; v_code text;
  v_ids uuid[];
begin
  select * into rt from overnight_rates where overnight_rates.id = 1;
  if v_in is null or v_out is null or v_out <= v_in then raise exception 'Please choose your check-in and check-out dates'; end if;
  if v_in < v_today then raise exception 'Check-in can''t be in the past'; end if;
  if v_out - v_in > rt.max_nights then raise exception 'Online bookings are up to % nights — please contact us for longer stays', rt.max_nights; end if;
  if v_in > v_today + 550 then raise exception 'Bookings open up to 18 months ahead'; end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(villa_ids, '{}')) x;
  if v_ids is null or array_length(v_ids, 1) = 0 then raise exception 'Please choose at least one casita'; end if;
  if array_length(v_ids, 1) > 6 then raise exception 'For more than 6 casitas, please contact our reservations team'; end if;
  if (select count(*) from villas where villas.id = any(v_ids) and active) <> array_length(v_ids, 1) then
    raise exception 'One of the casitas picked is not available for online booking';
  end if;

  if nullif(trim(payload->>'guest_name'), '') is null or nullif(trim(payload->>'guest_email'), '') is null
     or nullif(trim(payload->>'guest_phone'), '') is null then
    raise exception 'Please fill in your name, email and phone';
  end if;

  -- the guest list
  if jsonb_typeof(v_comp) <> 'array' then raise exception 'Invalid guest list'; end if;
  if jsonb_array_length(v_comp) > 40 then raise exception 'Too many guests for an online booking'; end if;
  v_names := array[trim(payload->>'guest_name')];
  if v_primary_senior then v_seniors := 1; end if;
  for c in select * from jsonb_array_elements(v_comp) loop
    v_name := regexp_replace(trim(coalesce(c->>'name', '')), '\s+', ' ', 'g');
    v_group := c->>'age_group';
    if length(v_name) < 3 or v_name !~ '\S+\s+\S+' then
      raise exception 'Please enter the full name (first and last) of every guest';
    end if;
    if v_group = 'adult' then v_adults := v_adults + 1;
    elsif v_group = 'senior' then v_adults := v_adults + 1; v_seniors := v_seniors + 1;
    elsif v_group = 'child_6_12' then v_k612 := v_k612 + 1;
    elsif v_group = 'child_0_5' then v_k05 := v_k05 + 1;
    else raise exception 'Please choose an age group for every guest';
    end if;
    v_names := v_names || v_name;
  end loop;

  -- pets: same rules as Day Trips
  if v_pets > 2 then raise exception 'A maximum of two pets are permitted per reservation'; end if;
  v_pet_paths := case when jsonb_typeof(payload->'pet_vaccination_paths') = 'array'
    then (select array_agg(x) from jsonb_array_elements_text(payload->'pet_vaccination_paths') x) else null end;
  if v_pets > 0 and (v_pet_paths is null or coalesce((payload->>'pet_policy_agreed')::boolean, false) is not true) then
    raise exception 'Pet vaccination card and Pet Policy agreement are required when bringing pets';
  end if;

  q := quote_overnight(v_in, v_out, v_ids, v_adults, v_seniors, v_k612, v_k05, v_pets);
  if not (q->>'ok')::boolean then raise exception '%', q->>'error'; end if;

  insert into booking_requests (
    status, source, stay_type, stay_type_label, room_slug, room_name, check_in, check_out,
    adults, children_6_12, children_0_5, senior_count, primary_is_senior, pet_count, companions, guest_names, extra_beds,
    guest_name, guest_email, guest_phone, country, how_heard, occasion, marketing_opt_in, notes,
    room_total, meal_total, extra_bed_total, pet_total, subtotal_people, senior_discount, total_amount,
    senior_id_paths, pet_vaccination_paths, pet_policy_agreed_at
  ) values (
    'pending', 'website', 'overnight', 'Overnight Stay',
    (select string_agg(distinct v->>'room_type', ',') from jsonb_array_elements(q->'villas') v),
    (select string_agg(v->>'unit_label', ', ') from jsonb_array_elements(q->'villas') v),
    v_in, v_out,
    v_adults, v_k612, v_k05, v_seniors, v_primary_senior, v_pets,
    (select jsonb_agg(jsonb_build_object('name', regexp_replace(trim(e->>'name'), '\s+', ' ', 'g'), 'age_group', e->>'age_group')) from jsonb_array_elements(v_comp) e),
    array_to_string(v_names, ', '),
    (q->>'extra_beds')::int,
    trim(payload->>'guest_name'), trim(payload->>'guest_email'), trim(payload->>'guest_phone'),
    payload->>'country', payload->>'how_heard', payload->>'occasion',
    coalesce((payload->>'marketing_opt_in')::boolean, false), payload->>'notes',
    (q->>'room_total')::numeric, (q->>'meal_total')::numeric, (q->>'extra_bed_total')::numeric, (q->>'pet_total')::numeric,
    (q->>'meal_total')::numeric, (q->>'senior_discount')::numeric, (q->>'total')::numeric,
    case when jsonb_typeof(payload->'senior_id_paths') = 'array'
      then (select array_agg(x) from jsonb_array_elements_text(payload->'senior_id_paths') x) else null end,
    v_pet_paths,
    case when v_pets > 0 then now() else null end
  )
  returning booking_requests.id, booking_requests.order_code into v_id, v_code;

  begin
    insert into booking_villas (booking_id, villa_id, check_in, check_out)
    select v_id, x, v_in, v_out from unnest(v_ids) x;
  exception when exclusion_violation then
    raise exception 'Sorry — one of the casitas you picked was just booked by someone else for those dates. Please refresh availability and try again.';
  end;

  return query select v_id, v_code, (q->>'total')::numeric;
end;
$$;
revoke all on function submit_overnight_booking(jsonb, uuid[]) from public;
grant execute on function submit_overnight_booking(jsonb, uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Day Trip submit must not be usable for overnight stays (it has no
--    villa checks). Guard the existing function's entry point.
-- ---------------------------------------------------------------------------
create or replace function guard_daytrip_submit_type() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'anon' and new.stay_type = 'overnight' and new.room_name is null then
    raise exception 'Overnight stays are booked through the villa booking page';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_daytrip_submit_type on booking_requests;
create trigger trg_guard_daytrip_submit_type
  before insert on booking_requests
  for each row execute function guard_daytrip_submit_type();

-- ---------------------------------------------------------------------------
-- 9. Staff create / edit of an overnight booking from the dashboard — one
--    atomic step (booking + villas), priced by quote_overnight(), so a
--    clash on a villa never leaves a half-saved booking behind.
--    payload: source, status, guest_name, booked_by, guest_phone, guest_email,
--      country, check_in, check_out, primary_is_senior, companions[], pet_count,
--      discount_type, discount_value, discount_reason, notes, staff_notes,
--      keep_total + total_amount (imports: keep the price agreed elsewhere),
--      allow_over_capacity
-- ---------------------------------------------------------------------------
create or replace function staff_save_overnight(p_id uuid, payload jsonb, p_villa_ids uuid[])
returns table(id uuid, order_code text, total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_in date := nullif(payload->>'check_in', '')::date;
  v_out date := nullif(payload->>'check_out', '')::date;
  v_comp jsonb := coalesce(payload->'companions', '[]'::jsonb);
  c jsonb;
  v_primary_senior boolean := coalesce((payload->>'primary_is_senior')::boolean, false);
  v_adults int := 1; v_seniors int := 0; v_k612 int := 0; v_k05 int := 0;
  v_pets int := coalesce(nullif(payload->>'pet_count', '')::int, 0);
  v_names text[];
  v_ids uuid[];
  q jsonb;
  v_total numeric; v_disc numeric := 0;
  v_dtype text := nullif(payload->>'discount_type', '');
  v_dval numeric := coalesce(nullif(payload->>'discount_value', '')::numeric, 0);
  v_id uuid; v_code text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then raise exception 'not allowed'; end if;
  if v_in is null or v_out is null or v_out <= v_in then raise exception 'Check-out must be after check-in'; end if;
  if nullif(trim(payload->>'guest_name'), '') is null then raise exception 'Guest name is required'; end if;
  if v_pets > 2 then raise exception 'A maximum of two pets are permitted per reservation'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_villa_ids, '{}')) x;
  if v_ids is null then raise exception 'Pick at least one villa'; end if;

  if jsonb_typeof(v_comp) <> 'array' then v_comp := '[]'::jsonb; end if;
  v_names := array[trim(payload->>'guest_name')];
  if v_primary_senior then v_seniors := 1; end if;
  for c in select * from jsonb_array_elements(v_comp) loop
    case c->>'age_group'
      when 'senior' then v_adults := v_adults + 1; v_seniors := v_seniors + 1;
      when 'child_6_12' then v_k612 := v_k612 + 1;
      when 'child_0_5' then v_k05 := v_k05 + 1;
      else v_adults := v_adults + 1;
    end case;
    v_names := v_names || coalesce(nullif(trim(c->>'name'), ''), '(name to follow)');
  end loop;

  q := quote_overnight(v_in, v_out, v_ids, v_adults, v_seniors, v_k612, v_k05, v_pets);
  if not (q->>'ok')::boolean and not (coalesce((payload->>'allow_over_capacity')::boolean, false) and v_adults >= 1) then
    raise exception '%', q->>'error';
  end if;

  if v_dtype = 'percent' and v_dval > 0 then v_disc := round((q->>'total')::numeric * least(v_dval, 100) / 100, 2);
  elsif v_dtype = 'amount' and v_dval > 0 then v_disc := least(v_dval, (q->>'total')::numeric);
  else v_dtype := null; v_dval := null; end if;
  v_total := case when coalesce((payload->>'keep_total')::boolean, false)
                  then nullif(payload->>'total_amount', '')::numeric
                  else (q->>'total')::numeric - v_disc end;

  if p_id is null then
    insert into booking_requests (status, source, stay_type, stay_type_label, guest_name, booked_by, email_guest,
      check_in, check_out)
    values (coalesce(nullif(payload->>'status', ''), 'pending')::booking_status, coalesce(nullif(payload->>'source', ''), 'other'),
      'overnight', 'Overnight Stay', trim(payload->>'guest_name'), nullif(payload->>'booked_by', ''), false, v_in, v_out)
    returning booking_requests.id into v_id;
  else
    v_id := p_id;
    if not exists (select 1 from booking_requests b where b.id = v_id and b.stay_type = 'overnight') then
      raise exception 'Booking not found';
    end if;
    -- free villas that are being dropped BEFORE the dates move
    delete from booking_villas bv where bv.booking_id = v_id and not (bv.villa_id = any(v_ids));
  end if;

  update booking_requests b set
    status = coalesce(nullif(payload->>'status', ''), b.status::text)::booking_status,
    source = coalesce(nullif(payload->>'source', ''), b.source),
    guest_phone = nullif(trim(payload->>'guest_phone'), ''),
    guest_email = nullif(trim(payload->>'guest_email'), ''),
    country = nullif(payload->>'country', ''),
    check_in = v_in, check_out = v_out,
    adults = v_adults, children_6_12 = v_k612, children_0_5 = v_k05, senior_count = v_seniors,
    primary_is_senior = v_primary_senior, pet_count = v_pets,
    companions = (select jsonb_agg(jsonb_build_object('name', trim(coalesce(e->>'name', '')), 'age_group', coalesce(e->>'age_group', 'adult'))) from jsonb_array_elements(v_comp) e),
    guest_names = array_to_string(v_names, ', '),
    room_slug = (select string_agg(distinct v->>'room_type', ',') from jsonb_array_elements(q->'villas') v),
    room_name = (select string_agg(v->>'unit_label', ', ') from jsonb_array_elements(q->'villas') v),
    extra_beds = coalesce((q->>'extra_beds')::int, 0),
    room_total = (q->>'room_total')::numeric, meal_total = (q->>'meal_total')::numeric,
    extra_bed_total = (q->>'extra_bed_total')::numeric, pet_total = (q->>'pet_total')::numeric,
    subtotal_people = (q->>'meal_total')::numeric, senior_discount = (q->>'senior_discount')::numeric,
    discount_type = v_dtype, discount_value = v_dval, discount_amount = v_disc,
    discount_reason = case when v_dtype is null then null else nullif(trim(payload->>'discount_reason'), '') end,
    total_amount = v_total,
    notes = nullif(trim(payload->>'notes'), ''),
    staff_notes = nullif(trim(coalesce(payload->>'staff_notes', '')), '')
  where b.id = v_id
  returning b.order_code into v_code;

  insert into booking_villas (booking_id, villa_id, check_in, check_out)
  select v_id, x, v_in, v_out from unnest(v_ids) x
  where not exists (select 1 from booking_villas bv where bv.booking_id = v_id and bv.villa_id = x);

  return query select v_id, v_code, v_total;
exception when exclusion_violation then
  raise exception 'One of those villas is already booked for some of those nights — check the Villa Calendar.' using errcode = 'P0001';
end;
$$;
revoke all on function staff_save_overnight(uuid, jsonb, uuid[]) from public, anon;
grant execute on function staff_save_overnight(uuid, jsonb, uuid[]) to authenticated;

-- Handy checks:
--   select unit_label, room_type_name, weekday_rate, weekend_rate from villas order by sort;
--   select quote_overnight(current_date + 7, current_date + 9, array(select id from villas where unit_label='Casita 9'), 2, 0, 1, 0, 0);
--   select v.unit_label, bv.check_in, bv.check_out, b.order_code, b.guest_name, bv.block_reason
--     from booking_villas bv join villas v on v.id = bv.villa_id left join booking_requests b on b.id = bv.booking_id
--     where bv.active and bv.check_out >= current_date order by bv.check_in, v.sort;
