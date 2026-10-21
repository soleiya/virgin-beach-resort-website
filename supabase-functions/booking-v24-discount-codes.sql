-- ============================================================================
-- Booking rules v24 — discount codes replace the Convenience Discount
--
--   * New villa bookings no longer get the 5% Convenience Discount (bookings
--     that already have it keep it — their quotation is unchanged).
--   * Discount codes (villa bookings: the website's booking page and the staff
--     villa form). A code takes a % off
--       - "rooms":   the casita nightly rates (not meals, mattress, pets, add-ons)
--       - "add_ons": the add-ons, when the casita charges are over a minimum
--       - "all":     the whole stay
--     It can start / expire on a date (or never expire) and be switched off.
--     Codes are checked against the day the booking is made.
--   * Starter codes: EXCLUSIVE (50% off casita rates) and ADD-ONS (50% off
--     add-ons with casita charges over ₱50,000), no expiry.
--   * Staff manage codes in the dashboard (Discount Codes window).
-- Re-runnable.
-- ============================================================================

-- 1. codes ---------------------------------------------------------------------
create table if not exists discount_codes (
  code text primary key check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'),
  label text,
  applies_to text not null check (applies_to in ('rooms', 'add_ons', 'all')),
  percent numeric not null check (percent > 0 and percent <= 100),
  min_room_total numeric not null default 0 check (min_room_total >= 0),
  starts_on date,
  expires_on date,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  check (expires_on is null or starts_on is null or expires_on >= starts_on)
);
alter table discount_codes enable row level security;
drop policy if exists discount_codes_staff_read on discount_codes;
create policy discount_codes_staff_read on discount_codes for select to authenticated using (true);
drop policy if exists discount_codes_staff_write on discount_codes;
create policy discount_codes_staff_write on discount_codes for all to authenticated using (true) with check (true);
grant select, insert, update on discount_codes to authenticated;
revoke all on discount_codes from anon;

create or replace function discount_codes_touch() returns trigger language plpgsql as $$
begin
  new.code := upper(trim(new.code));
  new.updated_at := now();
  if tg_op = 'INSERT' then
    begin new.created_by := coalesce(new.created_by, auth.jwt() ->> 'email'); exception when others then null; end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_discount_codes_touch on discount_codes;
create trigger trg_discount_codes_touch before insert or update on discount_codes
  for each row execute function discount_codes_touch();

insert into discount_codes (code, label, applies_to, percent, min_room_total, note) values
  ('EXCLUSIVE', '50% off all casita rates', 'rooms', 50, 0, 'No discount on meals or add-ons. No expiry.'),
  ('ADD-ONS', '50% off all add-ons', 'add_ons', 50, 50000, 'Casita charges must be over ₱50,000 combined. No discount on rooms. No expiry.')
on conflict (code) do nothing;

alter table booking_requests add column if not exists discount_code text;
alter table booking_requests add column if not exists code_discount numeric not null default 0;

-- how often each code was used (cancelled / expired bookings not counted)
create or replace function discount_code_usage() returns table(code text, bookings bigint, discount numeric, last_used timestamptz)
language sql stable security definer set search_path = public as $$
  select b.discount_code, count(*), coalesce(sum(b.code_discount), 0), max(b.created_at)
    from booking_requests b
   where b.discount_code is not null and b.status not in ('declined', 'expired')
   group by b.discount_code;
$$;
revoke all on function discount_code_usage() from public, anon;
grant execute on function discount_code_usage() to authenticated;

-- 2. the quotation -------------------------------------------------------------
drop function if exists quote_overnight(date, date, uuid[], int, int, int, int, int, jsonb, boolean);
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

  -- discount code (v24): EXCLUSIVE-style codes take a % off the casita nightly
  -- rates; ADD-ONS-style codes a % off the add-ons when the casita charges are
  -- over the code's minimum. Seniors' share of the casita already has its
  -- 20% off (RA 9994: no double discount), so it's left out of a rooms code.
  if v_code is not null then
    select * into dc from discount_codes where code = v_code;
    if not found or not dc.active then v_code_err := 'That discount code isn''t valid.';
    elsif dc.starts_on is not null and v_code_on < dc.starts_on then v_code_err := 'That discount code isn''t valid yet.';
    elsif dc.expires_on is not null and v_code_on > dc.expires_on then v_code_err := 'That discount code has expired.';
    elsif v_room <= coalesce(dc.min_room_total, 0) then
      v_code_err := 'Code ' || dc.code || ' needs casita charges over ₱' || to_char(dc.min_room_total, 'FM999,999,990') ||
                    ' (this stay: ₱' || to_char(v_room, 'FM999,999,990') || ').';
    elsif dc.applies_to = 'add_ons' and v_addon <= 0 then
      v_code_err := 'Code ' || dc.code || ' takes ' || trim(to_char(dc.percent, 'FM990.##')) || '% off add-ons — add one to use it.';
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
      v_code_disc := round(greatest(v_code_base, 0) * dc.percent / 100, 2);
      lines := lines || jsonb_build_object('kind', 'code_discount', 'code', dc.code,
        'desc', 'Discount code ' || dc.code || ' — ' || trim(to_char(dc.percent, 'FM990.##')) || '% ' || v_code_label,
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

-- an existing booking's quotation: same Convenience Discount it had, same code
-- (checked against the day it was booked)
create or replace function quote_booking_overnight(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select quote_overnight(b.check_in, b.check_out,
    (select array_agg(villa_id) from booking_villas bv where bv.booking_id = b.id),
    b.adults, b.senior_count, b.children_6_12, b.children_0_5, b.pet_count,
    coalesce(b.add_ons, '[]'::jsonb), coalesce(b.online_discount, 0) > 0,
    b.discount_code, (b.created_at at time zone 'Asia/Manila')::date)
  from booking_requests b where b.id = p_booking_id;
$$;
revoke all on function quote_booking_overnight(uuid) from public, anon;
grant execute on function quote_booking_overnight(uuid) to authenticated, service_role;

-- 3. guest booking (website) -----------------------------------------------------
create or replace function public.submit_overnight_booking(payload jsonb, villa_ids uuid[])
returns table(id uuid, order_code text, total numeric)
language plpgsql security definer set search_path to 'public' as $function$
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
  v_dcode text := upper(nullif(trim(coalesce(payload->>'discount_code', '')), ''));
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

  -- v24: no Convenience Discount for new bookings; a discount code instead
  q := quote_overnight(v_in, v_out, v_ids, v_adults, v_seniors, v_k612, v_k05, v_pets, coalesce(payload->'add_ons', '[]'::jsonb), false, v_dcode, v_today);
  if not (q->>'ok')::boolean then raise exception '%', q->>'error'; end if;
  if v_dcode is not null and q->>'code_error' is not null then raise exception '%', q->>'code_error'; end if;

  insert into booking_requests (
    status, source, stay_type, stay_type_label, room_slug, room_name, check_in, check_out,
    adults, children_6_12, children_0_5, senior_count, primary_is_senior, pet_count, companions, guest_names, extra_beds,
    guest_name, guest_email, guest_phone, country, how_heard, occasion, marketing_opt_in, notes,
    room_total, meal_total, extra_bed_total, pet_total, subtotal_people, senior_discount, total_amount, add_ons, add_on_total, online_discount,
    discount_code, code_discount,
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
    (select jsonb_agg(jsonb_build_object('slug', l->>'slug', 'qty', (l->>'qty')::int)) from jsonb_array_elements(q->'lines') l where l->>'kind' = 'add_on'),
    (q->>'add_on_total')::numeric, (q->>'online_discount')::numeric,
    q->>'discount_code', coalesce((q->>'code_discount')::numeric, 0),
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
$function$;

-- 4. staff villa form --------------------------------------------------------------
create or replace function public.staff_save_overnight(p_id uuid, payload jsonb, p_villa_ids uuid[])
returns table(id uuid, order_code text, total numeric)
language plpgsql security definer set search_path to 'public' as $function$
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
  v_dcode text := upper(nullif(trim(coalesce(payload->>'discount_code', '')), ''));
  v_old booking_requests%rowtype;
  v_online boolean := false;
  v_code_on date := (now() at time zone 'Asia/Manila')::date;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then raise exception 'not allowed'; end if;
  if v_in is null or v_out is null or v_out <= v_in then raise exception 'Check-out must be after check-in'; end if;
  if nullif(trim(payload->>'guest_name'), '') is null then raise exception 'Guest name is required'; end if;
  if v_pets > 2 then raise exception 'A maximum of two pets are permitted per reservation'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_villa_ids, '{}')) x;
  if v_ids is null then raise exception 'Pick at least one villa'; end if;

  if p_id is not null then
    select * into v_old from booking_requests b where b.id = p_id;
    -- an existing booking keeps the Convenience Discount it had; its code is
    -- checked against the day it was booked (so a code that expired since still holds)
    v_online := coalesce(v_old.online_discount, 0) > 0;
    if v_dcode is not distinct from v_old.discount_code then v_code_on := (v_old.created_at at time zone 'Asia/Manila')::date; end if;
  end if;

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

  q := quote_overnight(v_in, v_out, v_ids, v_adults, v_seniors, v_k612, v_k05, v_pets,
                       coalesce(payload->'add_ons', '[]'::jsonb), v_online, v_dcode, v_code_on);
  if not (q->>'ok')::boolean and not (coalesce((payload->>'allow_over_capacity')::boolean, false) and v_adults >= 1) then
    raise exception '%', q->>'error';
  end if;
  if v_dcode is not null and q->>'code_error' is not null then raise exception '%', q->>'code_error'; end if;

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
    add_ons = (select jsonb_agg(jsonb_build_object('slug', l->>'slug', 'qty', (l->>'qty')::int)) from jsonb_array_elements(q->'lines') l where l->>'kind' = 'add_on'),
    add_on_total = (q->>'add_on_total')::numeric, online_discount = (q->>'online_discount')::numeric,
    discount_code = q->>'discount_code', code_discount = coalesce((q->>'code_discount')::numeric, 0),
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
$function$;

select 'v24 applied' as status, (select count(*) from discount_codes) as codes;
