-- ============================================================================
-- booking-v51 — 2027: casitas follow Cloudbeds from 1 Jan 2027, and booking
--               REQUESTS (inquiries) for dates past the online window
--
-- What changes
--   * booking_settings.cloudbeds_rates_from (new): with cloudbeds_rates ON, the
--     website follows Cloudbeds (prices, closed nights, closed-to-arrival /
--     departure, minimum stay) ONLY for nights on/after this date. Earlier
--     nights keep the website's own rates and rules — 2026 is unchanged.
--   * New status 'inquiry' + submit_overnight_inquiry(): for stays past the
--     casita booking window the website takes a booking REQUEST instead of a
--     booking. A request holds no casita, takes no payment, is never sent to
--     Cloudbeds, is never auto-cancelled, and is priced at the website's own
--     (2026) rates as an estimate only. Staff see it in the dashboard as
--     "Booking Request" and reply / create the real booking / decline it.
--   * Emails: a request sends type INQUIRY_INSERT to send-booking-email (guest
--     "request received — subject to review" + staff alert). Status changes on
--     a request send INQUIRY_UPDATE, which the email function ignores — so no
--     quotation, payment reminder or cancellation email ever goes out for one.
--
-- How to run (Supabase → SQL Editor)
--   STEP 1 — run this line ON ITS OWN first (a new enum value has to be
--            committed before the functions below can use it):
--
--     alter type booking_status add value if not exists 'inquiry';
--
--   STEP 2 — run everything from "STEP 2" below to the end. Safe to run again.
--            Nothing changes for guests until STEP 3.
--
--   STEP 3 — switch on (after the new website files are published):
--     update booking_settings
--        set cloudbeds_rates = true,
--            cloudbeds_rates_from = date '2027-01-01',
--            villa_bookings_open_until = date '2027-01-31'
--      where id = 1;
--
--   Undo STEP 3 (back to today's behaviour; casitas follow the day-trip window):
--     update booking_settings set cloudbeds_rates = false, villa_bookings_open_until = null where id = 1;
-- ============================================================================

-- ================================ STEP 2 ====================================

-- 1. setting ------------------------------------------------------------------
alter table booking_settings add column if not exists cloudbeds_rates_from date;

-- 2. availability: nights closed in Cloudbeds only count from cloudbeds_rates_from
create or replace view public_villa_holds as
  select villa_id, check_in, check_out from booking_villas where active
  union all
  select v.id, r.night, r.night + 1
    from villas v
    join cb_rates r on r.cb_room_type_id = v.cb_room_type_id
    join booking_settings s on s.id = 1 and s.cloudbeds_rates
   where (s.cloudbeds_rates_from is null or r.night >= s.cloudbeds_rates_from)
     and (coalesce(r.rate, 0) <= 0 or coalesce(r.rooms_available, 1) <= 0);
grant select on public_villa_holds to anon, authenticated;

-- 3. overnight quotation (v43 + cloudbeds_rates_from + request pricing) --------
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
  -- v51: Cloudbeds is the master only for nights on/after cloudbeds_rates_from
  -- (null = every night). Earlier nights keep the website's own rates.
  v_cb_from date := (select bs.cloudbeds_rates_from from booking_settings bs where bs.id = 1);
  v_staff boolean := coalesce(auth.role(), '') in ('authenticated', 'service_role');
  v_avail_err text;
  c record;
  v_rate numeric;
  v_amounts jsonb;
  k text;
begin
  -- v51: a booking request (quote_overnight_inquiry) is priced at the website's
  -- own (2026) rates and never checks Cloudbeds availability.
  if coalesce(current_setting('vbr.quote_mode', true), '') = 'inquiry' then v_cb := false; end if;
  -- v51: a stay that ends before cloudbeds_rates_from runs exactly as before
  if v_cb and v_cb_from is not null and p_check_out is not null and p_check_out <= v_cb_from then v_cb := false; end if;
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
        if v_cb_from is not null and n.night < v_cb_from then
          -- v51: before cloudbeds_rates_from — the website's own weekday / weekend rate
          v_rate := case when n.weekend then v.weekend_rate else v.weekday_rate end;
        else
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
        end if;  -- v51
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

  if v_cb and not v_staff and v_avail_err is null and (v_cb_from is null or p_check_out >= v_cb_from) and exists (
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
  -- v43: Reservations team's Senior Citizen / PWD formula (Discount Template):
  -- price ÷ 1.22, then 20% discount + 12% VAT come off  →  price − price ÷ 1.22 × 0.32
  --   ₱2,695 meal → ₱1,988.11
  v_senior_meal := round(rt.meal_adult - rt.meal_adult / 1.22 * 0.32, 2);
  if v_regular > 0 then
    lines := lines || jsonb_build_object('kind', 'meal', 'desc', 'Full-board meal package — Adult (13 y.o. +)', 'rate', rt.meal_adult, 'qty', v_regular * v_nights, 'amount', rt.meal_adult * v_regular * v_nights, 'vat_exempt', false);
  end if;
  if v_seniors > 0 then
    lines := lines || jsonb_build_object('kind', 'meal', 'desc', 'Full-board meal package — Senior Citizen / PWD', 'rate', v_senior_meal, 'qty', v_seniors * v_nights, 'amount', v_senior_meal * v_seniors * v_nights, 'vat_exempt', true);
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
    -- v43 (Discount Template): rate per pax = casita rate ÷ guests staying;
    -- discount = rate per pax × nights × no. of SC/PWD ÷ 1.22 × 0.32
    v_share := round((v_room + v_extra_total) / v_guests * v_seniors, 2);
    v_sdisc := round(v_share / 1.22 * 0.32, 2);
    v_share_paid := v_share - v_sdisc;
    lines := lines || jsonb_build_object('kind', 'senior_room', 'desc', 'Senior Citizen / PWD discount',
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

-- 4. booking requests ---------------------------------------------------------
-- p_rooms: [{ "room_type": "bamboo-casita", "qty": 2 }, ...]
-- Returns the first <qty> active units of each type — used only to price a
-- request (no unit is held).
create or replace function inquiry_villa_ids(p_rooms jsonb) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare x jsonb; v_qty int; v_ids uuid[] := '{}'; v_got uuid[];
begin
  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array' then return null; end if;
  for x in select * from jsonb_array_elements(p_rooms) loop
    v_qty := least(greatest(coalesce(nullif(x->>'qty', '')::int, 0), 0), 6);
    if v_qty = 0 then continue; end if;
    select array_agg(id) into v_got from (
      select id from villas where active and room_type = x->>'room_type' order by sort limit v_qty) s;
    if v_got is null or array_length(v_got, 1) < v_qty then
      raise exception 'We only have % of the % — please request fewer.', coalesce(array_length(v_got, 1), 0),
        coalesce((select room_type_name from villas where room_type = x->>'room_type' limit 1), 'casita type picked')
        using errcode = 'P0001';
    end if;
    v_ids := v_ids || v_got;
  end loop;
  return case when array_length(v_ids, 1) is null then null else v_ids end;
end;
$$;

-- Estimate for a booking request: the website's own (2026) rates, no Cloudbeds
-- availability check, no discount code. Room lines name the casita type only.
create or replace function quote_overnight_inquiry(
  p_check_in date, p_check_out date, p_rooms jsonb,
  p_adults int, p_seniors int default 0, p_kids612 int default 0, p_kids05 int default 0,
  p_pets int default 0, p_add_ons jsonb default '[]'::jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_ids uuid[]; q jsonb;
begin
  v_ids := inquiry_villa_ids(p_rooms);
  if v_ids is null then
    return jsonb_build_object('ok', false, 'error', 'Choose at least one casita.', 'inquiry', true);
  end if;
  perform set_config('vbr.quote_mode', 'inquiry', true);
  q := quote_overnight(p_check_in, p_check_out, v_ids, p_adults, p_seniors, p_kids612, p_kids05, p_pets,
                       coalesce(p_add_ons, '[]'::jsonb), false, null, null);
  perform set_config('vbr.quote_mode', '', true);
  if q ? 'lines' then
    -- one line per casita type and price (no unit numbers — nothing is held)
    q := q || jsonb_build_object('lines', (
      with l as (
        select x, o, case when x->>'kind' = 'room' then regexp_replace(x->>'desc', ' \([^)]*\) — ', ' — ') end as d
          from jsonb_array_elements(q->'lines') with ordinality t(x, o)
      ), rooms as (
        select min(o) as o, jsonb_build_object('kind', 'room',
                 'desc', case when sum((x->>'qty')::numeric) > 1 and d ~ ' night$' then d || 's' else d end,
                 'rate', (x->>'rate')::numeric, 'qty', sum((x->>'qty')::numeric), 'amount', sum((x->>'amount')::numeric),
                 'vat_exempt', false) as x
          from l where d is not null group by d, x->>'rate'
      ), rest as (select o, x from l where d is null)
      select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (select * from rooms union all select * from rest) s));
  end if;
  return q || jsonb_build_object('inquiry', true, 'rooms_requested', p_rooms);
end;
$$;
grant execute on function quote_overnight_inquiry(date, date, jsonb, int, int, int, int, int, jsonb) to anon, authenticated;

-- Save a booking request. Same checks as submit_overnight_booking (dates,
-- contact details, full guest list), but: only for stays past the casita
-- window, no casita held (no booking_villas row → never sent to Cloudbeds),
-- status 'inquiry' (never auto-cancelled, no payment link).
create or replace function public.submit_overnight_inquiry(payload jsonb, p_rooms jsonb)
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
  v_pets int := least(greatest(coalesce(nullif(payload->>'pet_count', '')::int, 0), 0), 2);
  v_names text[];
  v_ids uuid[];
  v_until date;
  v_rooms text;
  q jsonb;
  v_id uuid; v_code text;
  v_email text := lower(trim(coalesce(payload->>'guest_email', '')));
begin
  select * into rt from overnight_rates where overnight_rates.id = 1;
  if v_in is null or v_out is null or v_out <= v_in then raise exception 'Please choose your check-in and check-out dates'; end if;
  if v_in < v_today then raise exception 'Check-in can''t be in the past'; end if;
  if v_out - v_in > rt.max_nights then raise exception 'Requests online are up to % nights — please contact us for longer stays', rt.max_nights; end if;
  if v_in > v_today + 550 then raise exception 'We take requests up to 18 months ahead'; end if;

  select coalesce(s.villa_bookings_open_until, s.bookings_open_until) into v_until from booking_settings s where s.id = 1;
  if v_until is not null and v_out - 1 <= v_until then
    raise exception 'These dates can be booked online right away — please use Book Now instead.' using errcode = 'P0001';
  end if;

  if nullif(trim(payload->>'guest_name'), '') is null or v_email = '' or nullif(trim(payload->>'guest_phone'), '') is null then
    raise exception 'Please fill in your name, email and phone';
  end if;
  -- a little spam protection
  if (select count(*) from booking_requests b where b.status::text = 'inquiry' and lower(b.guest_email) = v_email
        and b.created_at > now() - interval '1 day') >= 5 then
    raise exception 'We''ve already received several requests from this email today — our team will be in touch. Please email reservations@virginbeachresort.com for anything else.';
  end if;

  if jsonb_typeof(v_comp) <> 'array' then raise exception 'Invalid guest list'; end if;
  if jsonb_array_length(v_comp) > 40 then raise exception 'Too many guests for an online request'; end if;
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

  v_ids := inquiry_villa_ids(p_rooms);
  if v_ids is null then raise exception 'Please choose at least one casita'; end if;
  if array_length(v_ids, 1) > 6 then raise exception 'For more than 6 casitas, please contact our reservations team'; end if;
  select string_agg(n || ' × ' || nm, ', ' order by srt) into v_rooms from (
    select count(*) as n, min(v.room_type_name) as nm, min(v.sort) as srt
      from villas v where v.id = any(v_ids) group by v.room_type) s;

  q := quote_overnight_inquiry(v_in, v_out, p_rooms, v_adults, v_seniors, v_k612, v_k05, v_pets, coalesce(payload->'add_ons', '[]'::jsonb));
  if not coalesce((q->>'ok')::boolean, false) then raise exception '%', coalesce(q->>'error', 'Please check your request'); end if;

  perform set_config('vbr.inquiry_submit', 'on', true);
  insert into booking_requests (
    status, source, stay_type, stay_type_label, room_slug, room_name, check_in, check_out,
    adults, children_6_12, children_0_5, senior_count, primary_is_senior, pet_count, companions, guest_names, extra_beds,
    guest_name, guest_email, guest_phone, country, how_heard, occasion, marketing_opt_in, notes, staff_notes,
    room_total, meal_total, extra_bed_total, pet_total, subtotal_people, senior_discount, total_amount, add_ons, add_on_total, online_discount
  ) values (
    'inquiry', 'website', 'overnight', 'Overnight Booking Request',
    (select string_agg(distinct v.room_type, ',') from villas v where v.id = any(v_ids)),
    v_rooms,
    v_in, v_out,
    v_adults, v_k612, v_k05, v_seniors, v_primary_senior, v_pets,
    (select jsonb_agg(jsonb_build_object('name', regexp_replace(trim(e->>'name'), '\s+', ' ', 'g'), 'age_group', e->>'age_group')) from jsonb_array_elements(v_comp) e),
    array_to_string(v_names, ', '),
    (q->>'extra_beds')::int,
    trim(payload->>'guest_name'), trim(payload->>'guest_email'), trim(payload->>'guest_phone'),
    payload->>'country', payload->>'how_heard', payload->>'occasion',
    coalesce((payload->>'marketing_opt_in')::boolean, false), payload->>'notes',
    'BOOKING REQUEST (inquiry) from the website — NOT a reservation. No casita held, nothing in Cloudbeds, no payment taken. ' ||
      'Website estimate at 2026 rates: ₱' || to_char((q->>'total')::numeric, 'FM999,999,990.00') || ' (guest was told 2027 rates are subject to change). ' ||
      'Check availability and the 2027 rate in Cloudbeds, then reply to the guest; create the booking if they go ahead, or set this request to Cancelled.',
    (q->>'room_total')::numeric, (q->>'meal_total')::numeric, (q->>'extra_bed_total')::numeric, (q->>'pet_total')::numeric,
    (q->>'meal_total')::numeric, (q->>'senior_discount')::numeric, (q->>'total')::numeric,
    (select jsonb_agg(jsonb_build_object('slug', l->>'slug', 'qty', (l->>'qty')::int)) from jsonb_array_elements(q->'lines') l where l->>'kind' = 'add_on'),
    (q->>'add_on_total')::numeric, 0
  )
  returning booking_requests.id, booking_requests.order_code into v_id, v_code;
  perform set_config('vbr.inquiry_submit', '', true);

  return query select v_id, v_code, (q->>'total')::numeric;
end;
$function$;
revoke all on function public.submit_overnight_inquiry(jsonb, jsonb) from public;
grant execute on function public.submit_overnight_inquiry(jsonb, jsonb) to anon, authenticated;

-- 5. a new booking normally always starts as 'pending' — except a request ----
create or replace function new_booking_starts_pending() returns trigger
language plpgsql as $$
begin
  if current_setting('vbr.cb_sync', true) = 'on' or new.cb_owned or coalesce(new.source, '') = 'sheet_import' then
    return new;
  end if;
  -- v51: submit_overnight_inquiry saves booking requests as 'inquiry'
  if current_setting('vbr.inquiry_submit', true) = 'on' and new.status::text = 'inquiry' then
    return new;
  end if;
  new.status := 'pending';
  return new;
end;
$$;

-- 6. the booking window lets requests through (they are for later dates) -----
create or replace function guard_booking_window() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_until date; v_last date;
begin
  if coalesce(auth.role(), '') <> 'anon' then return new; end if;
  -- v51: booking requests are meant for dates past the window
  if current_setting('vbr.inquiry_submit', true) = 'on' and new.status::text = 'inquiry' then return new; end if;
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

-- 7. requests are never sent to Cloudbeds -------------------------------------
create or replace function cb_claim_push(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b booking_requests%rowtype;
begin
  if not cb_push_enabled() then return null; end if;  -- test mode
  update booking_requests
     set cb_push_state = 'pushing', cb_push_at = now(), cb_push_attempts = cb_push_attempts + 1
   where id = p_booking_id
     and cb_reservation_id is null and not cb_owned and stay_type = 'overnight'
     and status not in ('declined', 'expired', 'completed', 'inquiry')  -- v51: requests never go to Cloudbeds
     and check_in is not null and check_out > check_in
     and created_at >= cb_push_from()
     and cb_push_attempts < 6
     and (cb_push_state is null or cb_push_state = 'error'
          or (cb_push_state = 'pushing' and cb_push_at < now() - interval '5 minutes'))
     and exists (select 1 from booking_villas where booking_id = p_booking_id)
  returning * into b;
  if not found then return null; end if;
  return to_jsonb(b) || jsonb_build_object(
    'villas', (select coalesce(jsonb_agg(jsonb_build_object('unit_label', v.unit_label, 'cb_room_id', v.cb_room_id,
                                                            'cb_room_type_id', v.cb_room_type_id) order by v.sort), '[]'::jsonb)
                 from booking_villas bv join villas v on v.id = bv.villa_id where bv.booking_id = b.id),
    -- add-ons with their names and prices (booking_requests.add_ons only has slug + qty)
    'addon_lines', (select coalesce(jsonb_agg(jsonb_build_object('slug', a.slug, 'name', a.name, 'price', a.price, 'qty', (x->>'qty')::int)), '[]'::jsonb)
                      from jsonb_array_elements(coalesce(b.add_ons, '[]'::jsonb)) x join add_ons a on a.slug = x->>'slug'),
    'nights', b.check_out - b.check_in);
end;
$$;

create or replace function cb_after_villa_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vbr.cb_sync', true) = 'on' or not cb_push_enabled() then return new; end if;
  if new.booking_id is not null and exists (
       select 1 from booking_requests b where b.id = new.booking_id
          and b.cb_reservation_id is null and not b.cb_owned and b.stay_type = 'overnight'
          and b.status not in ('declined', 'expired', 'inquiry')) then  -- v51
    perform cb_call('push', jsonb_build_object('booking_id', new.booking_id));
  end if;
  return new;
end;
$$;

-- 8. request emails -----------------------------------------------------------
create or replace function public.notify_booking_email() returns trigger
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_secret text;
  v_type text := tg_op;
begin
  -- v51: booking requests (status inquiry) get their own emails (type
  -- INQUIRY_INSERT / INQUIRY_UPDATE), never a quotation, payment or cancellation email.
  if new.status::text = 'inquiry' or (tg_op = 'UPDATE' and old.status::text = 'inquiry') then
    v_type := 'INQUIRY_' || tg_op;
  end if;
  -- Cloudbeds sync: only website bookings (or ones staff chose to email) can
  -- ever produce a guest email, so don't wake the email function for the rest.
  if current_setting('vbr.cb_sync', true) = 'on'
     and coalesce(new.source, 'website') <> 'website' and not coalesce(new.email_guest, false) then
    return new;
  end if;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is null then
    return new; -- emails not set up yet; never block a booking
  end if;
  -- pg_net queues this and sends it only after the booking (and its
  -- cabanas) have been committed, so the function always sees the full row.
  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'type', v_type,
      'table', tg_table_name,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    ),
    timeout_milliseconds := 30000
  );
  return new;
exception when others then
  -- An email problem must never stop a guest's booking from saving.
  raise warning 'notify_booking_email failed: %', sqlerrm;
  return new;
end;
$function$;

-- 9. check --------------------------------------------------------------------
select 'v51 applied' as status,
       (select cloudbeds_rates from booking_settings where id = 1) as cloudbeds_rates_on,
       (select cloudbeds_rates_from from booking_settings where id = 1) as cloudbeds_from,
       (select villa_bookings_open_until from booking_settings where id = 1) as casitas_until,
       (select bookings_open_until from booking_settings where id = 1) as day_trips_until;
