-- ============================================================================
-- Booking rules v9 — overnight add-ons + 3% book-direct bank-transfer discount
--
--   * add_ons            — massage, ATV rides… a price per unit (edit any time
--                          in Table Editor; a row with no price is hidden)
--   * Website overnight bookings get 3% off the whole bill (room, meals,
--     add-ons…) for booking on the website and paying by bank transfer.
--     overnight_rates.online_bank_discount_rate holds the 3%.
--     Paying by card / e-wallet instead = the price without the 3%.
--
-- Run in Supabase → SQL Editor (after booking-v8-villas.sql). Safe to re-run.
-- ============================================================================

create table if not exists add_ons (
  slug text primary key,
  name text not null,
  description text,
  unit text,                 -- "per person", "per ATV"
  price numeric,             -- null = not offered online yet
  sort int not null default 0,
  active boolean not null default true
);
alter table add_ons enable row level security;
drop policy if exists "Anyone can view add-ons" on add_ons;
create policy "Anyone can view add-ons" on add_ons for select to anon, authenticated using (true);

insert into add_ons (slug, name, description, unit, price, sort) values
  ('massage_60', 'Massage — 60 minutes', 'In-casita or beachside massage by our visiting wellness therapists.', 'per person', 500, 10),
  ('massage_90', 'Massage — 90 minutes', 'A longer, deeper session to fully unwind.', 'per person', 700, 20),
  ('atv_1', 'ATV ride — 40 minutes, 1 rider', 'Off-road ride along the scenic trails around the property.', 'per ATV', 1000, 30),
  ('atv_2', 'ATV ride — 40 minutes, 2 riders', 'Share one ATV with a companion on the trails around the property.', 'per ATV', 1200, 40)
on conflict (slug) do nothing;

alter table overnight_rates add column if not exists online_bank_discount_rate numeric not null default 0.03;

alter table booking_requests add column if not exists add_ons jsonb;          -- [{slug, qty}]
alter table booking_requests add column if not exists add_on_total numeric;
alter table booking_requests add column if not exists online_discount numeric;

-- quote_overnight() gains two parameters; drop the old 8-argument version so
-- calls aren't ambiguous.
drop function if exists quote_overnight(date, date, uuid[], int, int, int, int, int);

create or replace function quote_overnight(
  p_check_in date, p_check_out date, p_villa_ids uuid[],
  p_adults int, p_seniors int default 0, p_kids612 int default 0, p_kids05 int default 0,
  p_pets int default 0, p_add_ons jsonb default '[]'::jsonb, p_online_bank boolean default false
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
  v_addon numeric := 0; v_online numeric := 0; v_before numeric; a record;
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
  if coalesce(p_online_bank, false) and rt.online_bank_discount_rate > 0 then
    v_online := round(v_before * rt.online_bank_discount_rate, 2);
    lines := lines || jsonb_build_object('kind', 'online_discount',
      'desc', 'Convenience Discount (' || trim(to_char(rt.online_bank_discount_rate * 100, 'FM990.##')) || '%)',
      'rate', -v_online, 'qty', 1, 'amount', -v_online, 'vat_exempt', false);
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
    'total_before_online', v_before,
    'total', v_before - v_online,
    'rates', jsonb_build_object('meal_adult', rt.meal_adult, 'meal_child', rt.meal_child, 'extra_bed', rt.extra_bed,
                                'pet', rt.pet_per_night, 'check_in_time', rt.check_in_time, 'check_out_time', rt.check_out_time)
  );
end;
$$;
grant execute on function quote_overnight(date, date, uuid[], int, int, int, int, int, jsonb, boolean) to anon, authenticated;

-- Quote an existing booking from what's saved on it (used by the emails).
create or replace function quote_booking_overnight(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select quote_overnight(b.check_in, b.check_out,
           (select array_agg(villa_id) from booking_villas bv where bv.booking_id = b.id),
           b.adults, b.senior_count, b.children_6_12, b.children_0_5, b.pet_count,
           coalesce(b.add_ons, '[]'::jsonb), coalesce(b.online_discount, 0) > 0)
  from booking_requests b where b.id = p_booking_id;
$$;
revoke all on function quote_booking_overnight(uuid) from public, anon;
grant execute on function quote_booking_overnight(uuid) to authenticated, service_role;

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

  q := quote_overnight(v_in, v_out, v_ids, v_adults, v_seniors, v_k612, v_k05, v_pets, coalesce(payload->'add_ons', '[]'::jsonb), true);
  if not (q->>'ok')::boolean then raise exception '%', q->>'error'; end if;

  insert into booking_requests (
    status, source, stay_type, stay_type_label, room_slug, room_name, check_in, check_out,
    adults, children_6_12, children_0_5, senior_count, primary_is_senior, pet_count, companions, guest_names, extra_beds,
    guest_name, guest_email, guest_phone, country, how_heard, occasion, marketing_opt_in, notes,
    room_total, meal_total, extra_bed_total, pet_total, subtotal_people, senior_discount, total_amount, add_ons, add_on_total, online_discount,
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

  q := quote_overnight(v_in, v_out, v_ids, v_adults, v_seniors, v_k612, v_k05, v_pets,
         coalesce(payload->'add_ons', '[]'::jsonb), coalesce((payload->>'online_bank')::boolean, false));
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
    add_ons = (select jsonb_agg(jsonb_build_object('slug', l->>'slug', 'qty', (l->>'qty')::int)) from jsonb_array_elements(q->'lines') l where l->>'kind' = 'add_on'),
    add_on_total = (q->>'add_on_total')::numeric, online_discount = (q->>'online_discount')::numeric,
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

-- Handy check:
--   select slug, name, price, active from add_ons order by sort;
