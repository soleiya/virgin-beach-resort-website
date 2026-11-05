-- ============================================================================
-- booking-v36 — the website follows Cloudbeds for casita prices and open nights
--
-- Cloudbeds is the master. Every few minutes the cloudbeds-sync function copies
-- each casita type's nightly price and availability from Cloudbeds into
-- cb_rates (next 60 days every run, the full ~15 months every hour).
-- Once the switch booking_settings.cloudbeds_rates is ON:
--   * a website guest can only book nights that are on sale in Cloudbeds
--     (price above ₱0 and rooms left); closed nights (e.g. 2027 weekends and
--     holidays) show as unavailable on the website,
--   * the casita charge is Cloudbeds' own nightly price (so weekend, holiday and
--     any future 2027 rates are always the same as in Cloudbeds),
--   * Cloudbeds' "closed to arrival / departure" and minimum stay are respected.
--   Staff bookings from the dashboard are never blocked (they can still book a
--   closed night, e.g. a wedding), but use the Cloudbeds price when there is one.
-- The switch starts OFF. Turn it on only after checking the synced prices
-- (step 5 at the bottom), together with the casitas' 2027 booking window
-- (booking_settings.villa_bookings_open_until — day trips keep their own).
-- Run in Supabase → SQL Editor. Safe to run more than once.
-- ============================================================================

-- 1. nightly Cloudbeds prices per casita type --------------------------------
create table if not exists cb_rates (
  cb_room_type_id text not null,
  night date not null,
  rate numeric,
  rooms_available int,
  closed_arrival boolean not null default false,
  closed_departure boolean not null default false,
  min_los int,
  synced_at timestamptz not null default now(),
  primary key (cb_room_type_id, night)
);
alter table cb_rates enable row level security;
drop policy if exists "Staff can view Cloudbeds rates" on cb_rates;
create policy "Staff can view Cloudbeds rates" on cb_rates for select to authenticated using (true);

alter table booking_settings add column if not exists cloudbeds_rates boolean not null default false;
-- casitas can open further ahead than day trips (null = same as day trips)
alter table booking_settings add column if not exists villa_bookings_open_until date;

-- Guests (the website, anon) can't book past the window. Staff can.
create or replace function guard_booking_window() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_until date; v_last date;
begin
  if coalesce(auth.role(), '') <> 'anon' then return new; end if;
  select case when new.check_out is not null and new.check_out > new.check_in
              then coalesce(villa_bookings_open_until, bookings_open_until) else bookings_open_until end
    into v_until from booking_settings where id = 1;
  if v_until is null then return new; end if;
  v_last := case when new.check_out is not null and new.check_out > new.check_in then new.check_out - 1 else new.check_in end;
  if v_last is not null and v_last > v_until then
    raise exception 'We''re taking bookings up to % for now — later dates open soon. Please pick an earlier date or call us.',
      to_char(v_until, 'FMDD Mon YYYY') using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- 2. written by cloudbeds-sync (service role only) -----------------------------
-- p: [{ room_type_id, date, rate, rooms_available, cta, ctd, min_los }]
-- Every casita type × night in [p_from, p_to) gets a row; nights Cloudbeds
-- didn't return are saved as closed (price 0). rooms_available null = not
-- reported (the website's own per-casita holds decide).
create or replace function cb_apply_rates(p_from date, p_to date, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rows int; v_open int;
begin
  if p_to <= p_from then return jsonb_build_object('rows', 0); end if;
  with types as (
    select distinct cb_room_type_id as t from villas where active and cb_room_type_id is not null
  ), nights as (
    select d::date as night from generate_series(p_from, p_to - 1, interval '1 day') d
  ), given as (
    select x->>'room_type_id' as t, (x->>'date')::date as night,
           nullif(x->>'rate', '')::numeric as rate, nullif(x->>'rooms_available', '')::int as avail,
           coalesce((x->>'cta')::boolean, false) as cta, coalesce((x->>'ctd')::boolean, false) as ctd,
           nullif(x->>'min_los', '')::int as min_los
      from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
  )
  insert into cb_rates as r (cb_room_type_id, night, rate, rooms_available, closed_arrival, closed_departure, min_los, synced_at)
  select types.t, nights.night, coalesce(g.rate, 0), case when g.t is null then 0 else g.avail end, coalesce(g.cta, false), coalesce(g.ctd, false), g.min_los, now()
    from types cross join nights
    left join lateral (select * from given g where g.t = types.t and g.night = nights.night limit 1) g on true
  on conflict (cb_room_type_id, night) do update
    set rate = excluded.rate, rooms_available = excluded.rooms_available, closed_arrival = excluded.closed_arrival,
        closed_departure = excluded.closed_departure, min_los = excluded.min_los, synced_at = excluded.synced_at;
  get diagnostics v_rows = row_count;
  select count(*) into v_open from cb_rates where night >= p_from and night < p_to and rate > 0 and coalesce(rooms_available, 1) > 0;
  delete from cb_rates where night < current_date - 2;
  return jsonb_build_object('rows', v_rows, 'open_nights', v_open, 'from', p_from, 'to', p_to);
end;
$$;
revoke all on function cb_apply_rates(date, date, jsonb) from public, anon, authenticated;
grant execute on function cb_apply_rates(date, date, jsonb) to service_role;

-- 3. the website's availability also hides nights closed in Cloudbeds ---------
create or replace view public_villa_holds as
  select villa_id, check_in, check_out from booking_villas where active
  union all
  select v.id, r.night, r.night + 1
    from villas v
    join cb_rates r on r.cb_room_type_id = v.cb_room_type_id
    join booking_settings s on s.id = 1 and s.cloudbeds_rates
   where coalesce(r.rate, 0) <= 0 or coalesce(r.rooms_available, 1) <= 0;
grant select on public_villa_holds to anon, authenticated;

-- 4. overnight quotation (v28 + Cloudbeds prices / open nights) ----------------
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
  -- v36: Cloudbeds is the master for casita prices and open nights
  v_cb boolean := coalesce((select bs.cloudbeds_rates from booking_settings bs where bs.id = 1), false);
  v_staff boolean := coalesce(auth.role(), '') in ('authenticated', 'service_role');
  v_avail_err text;
  c record;
  v_rate numeric;
  v_amounts jsonb;
  k text;
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
    if v_cb then
      -- price each night from Cloudbeds; group nights that share a price
      v_amounts := '{}'::jsonb;
      for n in select d::date as night,
                      (extract(isodow from d) in (5, 6) or exists (select 1 from peak_dates pd where pd.night = d::date)) as weekend
               from generate_series(p_check_in, p_check_out - 1, interval '1 day') d
      loop
        select r.rate, r.rooms_available, r.closed_arrival, r.min_los into c
          from cb_rates r where r.cb_room_type_id = v.cb_room_type_id and r.night = n.night;
        if found and coalesce(c.rate, 0) > 0 and coalesce(c.rooms_available, 1) > 0 then
          v_rate := c.rate;
          if n.night = p_check_in and coalesce(c.closed_arrival, false) and v_avail_err is null and not v_staff then
            v_avail_err := 'Arrivals on ' || to_char(n.night, 'FMDay, FMMonth FMDD, YYYY') || ' aren''t open online. Please pick another check-in date, or contact our reservations team.';
          end if;
          if n.night = p_check_in and coalesce(c.min_los, 0) > v_nights and v_avail_err is null and not v_staff then
            v_avail_err := 'Stays starting ' || to_char(n.night, 'FMMon FMDD, YYYY') || ' need at least ' || c.min_los || ' nights.';
          end if;
        else
          -- closed / not on sale in Cloudbeds (or not synced yet)
          v_rate := case when n.weekend then v.weekend_rate else v.weekday_rate end;
          if v_avail_err is null and not v_staff then
            v_avail_err := 'Sorry — the ' || v.room_type_name || ' isn''t open for online booking on ' || to_char(n.night, 'FMDay, FMMonth FMDD, YYYY') ||
                           '. Please choose other dates, or contact our reservations team.';
          end if;
        end if;
        k := trim(to_char(v_rate, 'FM9999990.00'));
        v_amounts := v_amounts || jsonb_build_object(k, coalesce((v_amounts->>k)::int, 0) + 1);
      end loop;
      for k in select key from jsonb_each(v_amounts) order by key::numeric loop
        v_rate := k::numeric;
        lines := lines || jsonb_build_object('kind', 'room',
          'desc', v.room_type_name || ' (' || v.unit_label || ') — ' ||
                  case when v_rate = v.weekday_rate then 'weekday night' when v_rate = v.weekend_rate then 'weekend/peak night' else 'night' end ||
                  case when (v_amounts->>k)::int > 1 then 's' else '' end,
          'rate', v_rate, 'qty', (v_amounts->>k)::int, 'amount', v_rate * (v_amounts->>k)::int, 'vat_exempt', false);
        v_room := v_room + v_rate * (v_amounts->>k)::int;
      end loop;
    else
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
    end if;
  end loop;

  if v_cb and not v_staff and v_avail_err is null and exists (
       select 1 from villas vv join cb_rates r on r.cb_room_type_id = vv.cb_room_type_id and r.night = p_check_out
        where vv.id = any(coalesce(p_villa_ids, '{}')) and coalesce(r.closed_departure, false)) then
    v_avail_err := 'Check-outs on ' || to_char(p_check_out, 'FMDay, FMMonth FMDD, YYYY') || ' aren''t open online. Please pick another check-out date.';
  end if;

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
    'ok', v_guests <= v_base + v_maxextra and v_adults >= 1 and v_avail_err is null,
    'error', case when v_avail_err is not null then v_avail_err
                  when v_adults < 1 then 'At least one adult is required.'
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
$$;
grant execute on function quote_overnight(date, date, uuid[], int, int, int, int, int, jsonb, boolean, text, date) to anon, authenticated;

-- 5. CHECK, then switch on ----------------------------------------------------
-- After the first sync (the function's "rates" action), this shows what the
-- website would sell. Turn it on with:
--   update booking_settings set cloudbeds_rates = true, villa_bookings_open_until = date '2027-12-31' where id = 1;
-- Undo (back to the website's own rates; casitas follow the day-trip window again):
--   update booking_settings set cloudbeds_rates = false, villa_bookings_open_until = null where id = 1;
select 'v36 applied' as status,
       (select cloudbeds_rates from booking_settings where id = 1) as cloudbeds_rates_on,
       (select bookings_open_until from booking_settings where id = 1) as day_trips_until,
       (select villa_bookings_open_until from booking_settings where id = 1) as casitas_until,
       (select count(*) from cb_rates) as synced_rows,
       (select count(*) from villas where active and cb_room_type_id is null) as casitas_not_linked_to_cloudbeds;
