-- ============================================================================
-- booking-v43 — villa Senior Citizen / PWD discount follows the Reservations
-- team's Discount Template (Nov 2026). Day trips are not changed (v39).
--   Meals:  ₱2,695 − ₱2,695 ÷ 1.22 × 0.32 = ₱1,988.11 per senior per night
--   Casita: rate per pax = casita rate ÷ number of guests staying,
--           × nights × no. of SC/PWD, ÷ 1.22 × 0.32 = discount
--   e.g. Bamboo Casita ₱12,925, 3 guests, 1 senior: ₱12,925 ÷ 3 ÷ 1.22 × 0.32 = ₱1,130.05
-- Quote lines simply read "Senior Citizen / PWD discount".
-- Same as v36's quote_overnight otherwise. Safe to run more than once.
-- ============================================================================

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

select 'v43 applied' as status;
