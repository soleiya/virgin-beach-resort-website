-- ============================================================================
-- booking-v28 — discount code manager, booking window, day-trip codes
--
--   1. Booking window: guests can only book up to booking_settings
--      .bookings_open_until (31 Dec 2026 to start). Staff change it in the
--      dashboard (Booking Window). Staff can still enter later bookings.
--   2. Discount codes get:
--        * % off OR a fixed ₱ amount off
--        * which bookings: overnight stays and/or day trips
--        * stay-date window (check-in between two dates) and minimum nights
--        * casita types (overnight)
--        * usage limits: maximum total uses, once per guest email
--   3. Day trips can take codes (website booking page): % or ₱ off the
--      cabana rental or the whole day trip. Stored in the booking's discount
--      fields, so the dashboard, emails and payments already show it.
-- Re-runnable.
-- ============================================================================

-- 1. booking window -------------------------------------------------------------
create table if not exists booking_settings (
  id int primary key default 1 check (id = 1),
  bookings_open_until date,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into booking_settings (id, bookings_open_until) values (1, date '2026-12-31') on conflict (id) do nothing;
alter table booking_settings enable row level security;
drop policy if exists booking_settings_read on booking_settings;
create policy booking_settings_read on booking_settings for select to anon, authenticated using (true);
drop policy if exists booking_settings_staff_write on booking_settings;
create policy booking_settings_staff_write on booking_settings for update to authenticated using (true) with check (true);
grant select on booking_settings to anon, authenticated;
grant update on booking_settings to authenticated;

create or replace function booking_settings_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  begin new.updated_by := auth.jwt() ->> 'email'; exception when others then null; end;
  return new;
end;
$$;
drop trigger if exists trg_booking_settings_touch on booking_settings;
create trigger trg_booking_settings_touch before update on booking_settings
  for each row execute function booking_settings_touch();

-- Guests (the website, anon) can't book past the window. Staff can.
create or replace function guard_booking_window() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_until date; v_last date;
begin
  if coalesce(auth.role(), '') <> 'anon' then return new; end if;
  select bookings_open_until into v_until from booking_settings where id = 1;
  if v_until is null then return new; end if;
  v_last := case when new.check_out is not null and new.check_out > new.check_in then new.check_out - 1 else new.check_in end;
  if v_last is not null and v_last > v_until then
    raise exception 'We''re taking bookings up to % for now — later dates open soon. Please pick an earlier date or call us.',
      to_char(v_until, 'FMDD Mon YYYY') using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_booking_window on booking_requests;
create trigger trg_guard_booking_window before insert on booking_requests
  for each row execute function guard_booking_window();

-- 2. discount codes: new settings --------------------------------------------------
alter table discount_codes add column if not exists discount_kind text not null default 'percent';
alter table discount_codes add column if not exists amount_off numeric;
alter table discount_codes add column if not exists booking_kinds text[] not null default '{overnight}';
alter table discount_codes add column if not exists stay_from date;
alter table discount_codes add column if not exists stay_to date;
alter table discount_codes add column if not exists min_nights int not null default 0;
alter table discount_codes add column if not exists room_types text[];
alter table discount_codes add column if not exists max_uses int;
alter table discount_codes add column if not exists once_per_guest boolean not null default false;
alter table discount_codes alter column percent drop not null;

do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'discount_codes'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ~* '(percent|discount_kind|amount_off|booking_kinds|stay_to|min_nights|max_uses)'
  loop
    execute format('alter table discount_codes drop constraint %I', r.conname);
  end loop;
end $$;
alter table discount_codes add constraint discount_codes_amount_check check (
  (discount_kind = 'percent' and percent > 0 and percent <= 100)
  or (discount_kind = 'fixed' and amount_off > 0));
alter table discount_codes add constraint discount_codes_kinds_check check (
  cardinality(booking_kinds) >= 1 and booking_kinds <@ array['overnight', 'day_trip']);
alter table discount_codes add constraint discount_codes_stay_check check (
  stay_to is null or stay_from is null or stay_to >= stay_from);
alter table discount_codes add constraint discount_codes_limits_check check (
  min_nights >= 0 and (max_uses is null or max_uses >= 1));
-- Add-ons exist only on overnight stays.
alter table discount_codes add constraint discount_codes_addons_check check (
  applies_to <> 'add_ons' or booking_kinds = array['overnight']);

-- "50%" / "₱1,000"
create or replace function discount_code_amount_text(dc discount_codes) returns text
language sql immutable as $$
  select case when dc.discount_kind = 'fixed'
              then '₱' || to_char(dc.amount_off, 'FM999,999,990.##')
              else trim(to_char(dc.percent, 'FM990.##')) || '%' end;
$$;

-- the peso discount on a base amount (never more than the base)
create or replace function discount_code_amount(dc discount_codes, p_base numeric) returns numeric
language sql immutable as $$
  select case when coalesce(p_base, 0) <= 0 then 0
              when dc.discount_kind = 'fixed' then round(least(dc.amount_off, p_base), 2)
              else round(p_base * dc.percent / 100, 2) end;
$$;

-- Is this code usable for this booking? {"ok": true} or {"ok": false, "error": "..."}
-- p_live: also check "fully redeemed" (guest's live quote / new booking).
create or replace function discount_code_check(
  p_code text, p_kind text, p_on date, p_check_in date,
  p_nights int default null, p_room_types text[] default null, p_live boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  dc discount_codes%rowtype;
  v_on date := coalesce(p_on, (now() at time zone 'Asia/Manila')::date);
  v_used int;
  v_names text;
  e text;
begin
  select * into dc from discount_codes where code = upper(trim(coalesce(p_code, '')));
  if not found or not dc.active then e := 'That discount code isn''t valid.';
  elsif dc.starts_on is not null and v_on < dc.starts_on then e := 'That discount code isn''t valid yet.';
  elsif dc.expires_on is not null and v_on > dc.expires_on then e := 'That discount code has expired.';
  elsif not (p_kind = any(dc.booking_kinds)) then
    e := 'Code ' || dc.code || ' is for ' || case when p_kind = 'day_trip' then 'overnight stays' else 'day trips' end || ' only.';
  elsif p_check_in is not null and dc.stay_from is not null and p_check_in < dc.stay_from then
    e := 'Code ' || dc.code || ' is for ' || case when p_kind = 'day_trip' then 'visits' else 'check-ins' end || ' from ' || to_char(dc.stay_from, 'FMDD Mon YYYY') ||
         coalesce(' to ' || to_char(dc.stay_to, 'FMDD Mon YYYY'), ' onwards') || '.';
  elsif p_check_in is not null and dc.stay_to is not null and p_check_in > dc.stay_to then
    e := 'Code ' || dc.code || ' is for ' || case when p_kind = 'day_trip' then 'visits' else 'check-ins' end ||
         coalesce(' from ' || to_char(dc.stay_from, 'FMDD Mon YYYY'), '') || ' up to ' || to_char(dc.stay_to, 'FMDD Mon YYYY') || '.';
  elsif p_kind = 'overnight' and coalesce(dc.min_nights, 0) > 1 and coalesce(p_nights, 0) < dc.min_nights then
    e := 'Code ' || dc.code || ' needs a stay of at least ' || dc.min_nights || ' nights.';
  elsif p_kind = 'overnight' and dc.room_types is not null and cardinality(dc.room_types) > 0
        and p_room_types is not null and cardinality(p_room_types) > 0
        and not (p_room_types <@ dc.room_types) then
    select string_agg(distinct room_type_name, ', ') into v_names from villas where room_type = any(dc.room_types);
    e := 'Code ' || dc.code || ' is only for ' || coalesce(v_names, 'selected casitas') || '.';
  elsif p_live and dc.max_uses is not null then
    select count(*) into v_used from booking_requests b
     where b.discount_code = dc.code and b.status::text not in ('declined', 'expired');
    if v_used >= dc.max_uses then e := 'Sorry — code ' || dc.code || ' has been fully redeemed.'; end if;
  end if;
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  return jsonb_build_object('ok', true, 'code', dc.code, 'applies_to', dc.applies_to, 'discount_kind', dc.discount_kind,
                            'percent', dc.percent, 'amount_off', dc.amount_off, 'amount_text', discount_code_amount_text(dc));
end;
$$;
revoke all on function discount_code_check(text, text, date, date, int, text[], boolean) from public, anon;
grant execute on function discount_code_check(text, text, date, date, int, text[], boolean) to authenticated;

-- usage limits, enforced on every new booking (website or staff)
create or replace function guard_discount_code_usage() returns trigger
language plpgsql security definer set search_path = public as $$
declare dc discount_codes%rowtype; v_used int;
begin
  if new.discount_code is null then return new; end if;
  select * into dc from discount_codes where code = new.discount_code for update;
  if not found then return new; end if;
  if dc.max_uses is not null then
    select count(*) into v_used from booking_requests b
     where b.discount_code = dc.code and b.status::text not in ('declined', 'expired');
    if v_used >= dc.max_uses then
      raise exception 'Sorry — code % has been fully redeemed.', dc.code using errcode = 'P0001';
    end if;
  end if;
  if dc.once_per_guest and nullif(trim(coalesce(new.guest_email, '')), '') is not null and exists (
       select 1 from booking_requests b
        where b.discount_code = dc.code and b.status::text not in ('declined', 'expired')
          and lower(trim(b.guest_email)) = lower(trim(new.guest_email))) then
    raise exception 'Code % can be used once per guest, and it''s already on a booking for %.', dc.code, trim(new.guest_email) using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_dc_usage_guard on booking_requests;
create trigger trg_dc_usage_guard before insert on booking_requests
  for each row execute function guard_discount_code_usage();

-- usage: overnight codes store code_discount; day-trip codes the discount fields
create or replace function discount_code_usage() returns table(code text, bookings bigint, discount numeric, last_used timestamptz)
language sql stable security definer set search_path = public as $$
  select b.discount_code, count(*),
         coalesce(sum(case when coalesce(b.code_discount, 0) > 0 then b.code_discount else coalesce(b.discount_amount, 0) end), 0),
         max(b.created_at)
    from booking_requests b
   where b.discount_code is not null and b.status::text not in ('declined', 'expired')
   group by b.discount_code;
$$;
revoke all on function discount_code_usage() from public, anon;
grant execute on function discount_code_usage() to authenticated;

-- 3. overnight quotation (same as v24 + the new code settings) -------------------
create or replace function quote_overnight(
  p_check_in date, p_check_out date, p_villa_ids uuid[],
  p_adults int, p_seniors int default 0, p_kids612 int default 0, p_kids05 int default 0,
  p_pets int default 0, p_add_ons jsonb default '[]'::jsonb, p_online_bank boolean default false,
  p_code text default null, p_code_on date default null
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
  dc discount_codes%rowtype;
  v_code text := upper(nullif(trim(coalesce(p_code, '')), ''));
  v_code_on date := coalesce(p_code_on, (now() at time zone 'Asia/Manila')::date);
  v_code_err text;
  v_code_base numeric := 0;
  v_code_disc numeric := 0;
  v_code_label text;
  v_addon numeric := 0; v_online numeric := 0; v_before numeric; a record;
  v_share numeric := 0; v_share_paid numeric := 0; v_exempt numeric := 0;
  v_types text[] := '{}';
  v_chk jsonb;
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
    v_types := v_types || v.room_type;
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
  -- RA 9994 / RA 10754 + RR 7-2010: the senior's own consumption is VAT-exempt
  -- and gets 20% off the VAT-exclusive price. Rates include 12% VAT + 5% service
  -- charge on the net (net = price / 1.17); the service charge is kept as is.
  v_senior_meal := round(rt.meal_adult / (1 + rt.vat_rate + rt.service_charge_rate) * (1 - rt.senior_discount_rate + rt.service_charge_rate), 2);
  if v_regular > 0 then
    lines := lines || jsonb_build_object('kind', 'meal', 'desc', 'Full-board meal package — Adult (13 y.o. +)', 'rate', rt.meal_adult, 'qty', v_regular * v_nights, 'amount', rt.meal_adult * v_regular * v_nights, 'vat_exempt', false);
  end if;
  if v_seniors > 0 then
    lines := lines || jsonb_build_object('kind', 'meal', 'desc', 'Full-board meal package — Senior Citizen / PWD (VAT-exempt, 20% off)', 'rate', v_senior_meal, 'qty', v_seniors * v_nights, 'amount', v_senior_meal * v_seniors * v_nights, 'vat_exempt', true);
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
    -- the senior's per-head share of the casita (room + extra mattress ÷ guests)
    v_share := round((v_room + v_extra_total) / v_guests * v_seniors, 2);
    v_share_paid := round(v_share / (1 + rt.vat_rate + rt.service_charge_rate) * (1 - rt.senior_discount_rate + rt.service_charge_rate), 2);
    v_sdisc := v_share - v_share_paid;
    lines := lines || jsonb_build_object('kind', 'senior_room', 'desc', 'Senior Citizen / PWD discount on their share of the casita — VAT-exempt, 20% off (' || v_seniors || ' of ' || v_guests || ' guests)',
                                         'rate', -v_sdisc, 'qty', 1, 'amount', -v_sdisc, 'vat_exempt', false);
  end if;

  -- add-ons (massage, ATV…) — a fixed price per unit, not per night
  for a in select ao.slug, ao.name, ao.unit, ao.price, least(greatest(coalesce((x->>'qty')::int, 0), 0), 20) as qty
           from jsonb_array_elements(case when jsonb_typeof(p_add_ons) = 'array' then p_add_ons else '[]'::jsonb end) x
           join add_ons ao on ao.slug = x->>'slug' and ao.active and ao.price is not null
           order by ao.sort
  loop
    continue when a.qty = 0;
    lines := lines || jsonb_build_object('kind', 'add_on', 'slug', a.slug, 'desc', a.name || coalesce(' (' || a.unit || ')', ''),
                                         'rate', a.price, 'qty', a.qty, 'amount', a.price * a.qty, 'vat_exempt', false);
    v_addon := v_addon + a.price * a.qty;
  end loop;

  -- book direct on the website + pay by bank transfer: 3% off everything
  v_before := round(v_room + v_extra_total + v_meal + v_pet - v_sdisc + v_addon, 2);
  -- VAT-exempt sales = what the seniors pay for their own share and meals.
  v_exempt := v_share_paid + v_senior_meal * v_seniors * v_nights;
  -- No double discount (RA 9994 Sec. 4): the Convenience Discount applies to
  -- everything except the seniors' already-discounted share and meals.
  if coalesce(p_online_bank, false) and rt.online_bank_discount_rate > 0 then
    v_online := round((v_before - v_exempt) * rt.online_bank_discount_rate, 2);
    lines := lines || jsonb_build_object('kind', 'online_discount',
      'desc', 'Convenience Discount (' || trim(to_char(rt.online_bank_discount_rate * 100, 'FM990.##')) || '%)',
      'rate', -v_online, 'qty', 1, 'amount', -v_online, 'vat_exempt', false);
  end if;

  -- discount code (v24, extended in v28): % or fixed ₱ off the casita nightly
  -- rates, the add-ons, or the whole stay — with optional conditions (stay
  -- dates, minimum nights, casita types, usage limits) checked in
  -- discount_code_check(). Seniors' share of the casita already has its 20%
  -- off (RA 9994: no double discount), so it's left out of a rooms code.
  -- p_code_on is null only for the guest's live quote on the website, so the
  -- "fully redeemed" check runs there; a booking's own re-quote skips it.
  if v_code is not null then
    v_chk := discount_code_check(v_code, 'overnight', v_code_on, p_check_in, v_nights, v_types, p_code_on is null);
    select * into dc from discount_codes where code = v_code;
    if not coalesce((v_chk->>'ok')::boolean, false) then v_code_err := v_chk->>'error';
    elsif v_room <= coalesce(dc.min_room_total, 0) then
      v_code_err := 'Code ' || dc.code || ' needs casita charges over ₱' || to_char(dc.min_room_total, 'FM999,999,990') ||
                    ' (this stay: ₱' || to_char(v_room, 'FM999,999,990') || ').';
    elsif dc.applies_to = 'add_ons' and v_addon <= 0 then
      v_code_err := 'Code ' || dc.code || ' takes ' || discount_code_amount_text(dc) || ' off add-ons — add one to use it.';
    else
      if dc.applies_to = 'rooms' then
        v_code_base := v_room - case when v_seniors > 0 and v_guests > 0 then round(v_room / v_guests * v_seniors, 2) else 0 end;
        v_code_label := 'off casita rates';
      elsif dc.applies_to = 'add_ons' then
        v_code_base := v_addon;
        v_code_label := 'off add-ons';
      else
        v_code_base := v_before - v_exempt;
        v_code_label := 'off the stay';
      end if;
      v_code_disc := discount_code_amount(dc, v_code_base);
      lines := lines || jsonb_build_object('kind', 'code_discount', 'code', dc.code,
        'desc', 'Discount code ' || dc.code || ' — ' || discount_code_amount_text(dc) || ' ' || v_code_label,
        'rate', -v_code_disc, 'qty', 1, 'amount', -v_code_disc, 'vat_exempt', false);
    end if;
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
    'add_on_total', v_addon, 'online_discount', v_online, 'online_discount_rate', rt.online_bank_discount_rate,
    'total_before_online', v_before, 'vat_exempt_sales', v_exempt,
    'discount_code', case when v_code_err is null then v_code end, 'code_discount', v_code_disc, 'code_error', v_code_err,
    'total', v_before - v_online - v_code_disc,
    'rates', jsonb_build_object('meal_adult', rt.meal_adult, 'meal_child', rt.meal_child, 'extra_bed', rt.extra_bed,
                                'pet', rt.pet_per_night, 'check_in_time', rt.check_in_time, 'check_out_time', rt.check_out_time)
  );
end;
$$;grant execute on function quote_overnight(date, date, uuid[], int, int, int, int, int, jsonb, boolean, text, date) to anon, authenticated;

-- 4. day trips -------------------------------------------------------------------
-- The day-trip page shows the code's discount live, then sends the code with
-- the booking. "rooms" codes take the % / ₱ off the cabana rental; "all"
-- codes off the whole day trip. The booking stores it in its discount fields
-- (type / value / amount / reason) like a staff discount, plus discount_code.
create or replace function quote_daytrip_code(p_code text, p_check_in date, p_cabana_total numeric, p_total numeric)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  chk jsonb; dc discount_codes%rowtype;
  v_base numeric; v_disc numeric; v_label text;
begin
  chk := discount_code_check(p_code, 'day_trip', null, p_check_in, null, null, true);
  if not coalesce((chk->>'ok')::boolean, false) then return chk; end if;
  select * into dc from discount_codes where code = chk->>'code';
  if coalesce(dc.min_room_total, 0) > 0 and coalesce(p_total, 0) <= dc.min_room_total then
    return jsonb_build_object('ok', false, 'error', 'Code ' || dc.code || ' needs a day-trip total over ₱' || to_char(dc.min_room_total, 'FM999,999,990') || '.');
  end if;
  if dc.applies_to = 'rooms' then
    v_base := coalesce(p_cabana_total, 0); v_label := 'off the cabana rental';
    if v_base <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Code ' || dc.code || ' takes ' || discount_code_amount_text(dc) || ' off the cabana — pick one on the map to use it.');
    end if;
  else
    v_base := coalesce(p_total, 0); v_label := 'off the day trip';
  end if;
  v_disc := discount_code_amount(dc, v_base);
  return jsonb_build_object(
    'ok', true, 'code', dc.code, 'discount', v_disc,
    'desc', 'Discount code ' || dc.code || ' — ' || discount_code_amount_text(dc) || ' ' || v_label,
    -- how it's stored on the booking (same fields as a staff discount)
    'discount_type', case when dc.discount_kind = 'percent' and dc.applies_to = 'all' then 'percent' else 'amount' end,
    'discount_value', case when dc.discount_kind = 'percent' and dc.applies_to = 'all' then dc.percent else v_disc end,
    'reason', 'Code ' || dc.code || ' — ' || discount_code_amount_text(dc) || ' ' || v_label);
end;
$$;
revoke all on function quote_daytrip_code(text, date, numeric, numeric) from public;
grant execute on function quote_daytrip_code(text, date, numeric, numeric) to anon, authenticated;

-- applies a checked code to the day-trip booking being inserted (set by
-- submit_daytrip_booking below, for this transaction only)
create or replace function apply_daytrip_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text := current_setting('vbr.daytrip_code', true); j jsonb;
begin
  if v is null or v = '' then return new; end if;
  perform set_config('vbr.daytrip_code', '', true);  -- one booking only
  j := v::jsonb;
  if new.check_out is not null then return new; end if;  -- day trips only
  new.discount_code := j->>'code';
  new.discount_type := j->>'discount_type';
  new.discount_value := (j->>'discount_value')::numeric;
  new.discount_amount := (j->>'discount')::numeric;
  new.discount_reason := j->>'reason';
  new.total_amount := greatest(coalesce(new.total_amount, 0) - (j->>'discount')::numeric, 0);
  return new;
end;
$$;
drop trigger if exists trg_dc_apply_daytrip on booking_requests;
create trigger trg_dc_apply_daytrip before insert on booking_requests
  for each row execute function apply_daytrip_code();

-- The day-trip page calls this instead of submit_booking_request when the
-- guest entered a code: re-checks the code on the server, then books.
create or replace function public.submit_daytrip_booking(payload jsonb, cabana_ids uuid[] default null)
returns table(id uuid, order_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(nullif(trim(coalesce(payload->>'discount_code', '')), ''));
  chk jsonb;
begin
  if v_code is not null then
    chk := quote_daytrip_code(v_code, nullif(payload->>'check_in', '')::date,
                              nullif(payload->>'cabana_total', '')::numeric, nullif(payload->>'total_amount', '')::numeric);
    if not coalesce((chk->>'ok')::boolean, false) then
      raise exception '%', chk->>'error' using errcode = 'P0001';
    end if;
    perform set_config('vbr.daytrip_code', chk::text, true);
  end if;
  return query select s.id, s.order_code from submit_booking_request(payload - 'discount_code', cabana_ids) s;
end;
$$;
revoke all on function public.submit_daytrip_booking(jsonb, uuid[]) from public;
grant execute on function public.submit_daytrip_booking(jsonb, uuid[]) to anon, authenticated;

select 'v28 applied' as status,
       (select bookings_open_until from booking_settings where id = 1) as guests_can_book_until,
       (select count(*) from discount_codes) as codes;
