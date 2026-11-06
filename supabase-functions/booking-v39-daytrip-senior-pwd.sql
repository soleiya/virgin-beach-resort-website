-- ============================================================================
-- booking-v39 — day-trip Senior Citizen / PWD pricing (Front Office formula)
--
--   * Discounted rate = price ÷ 1.17 (remove 12% VAT + 5% service charge),
--     20% off, then the 5% service charge on what's left:
--       ₱1,250 adult → ₱897.44 · ₱825 child (6–12) → ₱592.31
--       ₱800 half-day adult → ₱574.36 · ₱550 half-day child → ₱394.87
--   * PWD children (6–12) now get it too: new column pwd_kid_count.
--   * Cabanas and pets are never discounted. Villas are NOT changed.
-- Run in Supabase → SQL Editor BEFORE uploading the website files.
-- Safe to run more than once.
-- ============================================================================

alter table booking_requests add column if not exists pwd_kid_count int not null default 0;
do $$ begin
  alter table booking_requests add constraint booking_requests_pwd_kid_count_chk check (pwd_kid_count >= 0);
exception when duplicate_object then null; end $$;

-- 1. rate sheet, server side (replaces v35's 8-argument version) --------------
drop function if exists daytrip_server_price(text, int, int, int, int, int, int, int);
create or replace function daytrip_server_price(p_type text, p_adults int, p_kids612 int, p_kids05 int,
                                                p_seniors int, p_pets int, p_dining int, p_lounge int,
                                                p_pwd_kids int default 0)
returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_adult numeric; v_child numeric; v_pet numeric; v_dining numeric; v_lounge numeric;
  a int := greatest(coalesce(p_adults, 0), 0);
  k612 int := greatest(coalesce(p_kids612, 0), 0);
  s int := least(greatest(coalesce(p_seniors, 0), 0), greatest(coalesce(p_adults, 0), 0));
  pk int := least(greatest(coalesce(p_pwd_kids, 0), 0), greatest(coalesce(p_kids612, 0), 0));
  pets int := greatest(coalesce(p_pets, 0), 0);
  d int := greatest(coalesce(p_dining, 0), 0);
  l int := greatest(coalesce(p_lounge, 0), 0);
  v_senior numeric; v_pwd_kid numeric; v_people numeric; v_cabanas numeric; v_pets numeric;
begin
  if p_type = 'day_trip' then
    v_adult := 1250; v_child := 825; v_pet := 750; v_dining := 1500; v_lounge := 2000;
  elsif p_type = 'half_day' then
    v_adult := 800; v_child := 550; v_pet := 375; v_dining := 750; v_lounge := 1000;
  else
    return null;  -- no rate sheet (corporate, flash sale, other): quoted by hand
  end if;
  -- ÷ 1.17, 20% off, + 5% service charge (same as seniorPrice() in assets/js/pricing.js)
  v_senior := round(v_adult / 1.17 * 0.8 * 1.05, 2);
  v_pwd_kid := round(v_child / 1.17 * 0.8 * 1.05, 2);
  v_people := (a - s) * v_adult + s * v_senior + (k612 - pk) * v_child + pk * v_pwd_kid;
  v_pets := pets * v_pet;
  v_cabanas := d * v_dining + l * v_lounge;
  return jsonb_build_object(
    'subtotal_people', round(v_people, 2),
    'cabana_total', v_cabanas,
    'pet_total', v_pets,
    'senior_count', s,
    'pwd_kid_count', pk,
    'senior_discount', round(s * (v_adult - v_senior) + pk * (v_child - v_pwd_kid), 2),
    'total', round(v_people + v_pets + v_cabanas, 2));
end;
$$;
revoke all on function daytrip_server_price(text, int, int, int, int, int, int, int, int) from public;
grant execute on function daytrip_server_price(text, int, int, int, int, int, int, int, int) to anon, authenticated, service_role;

-- 2. website day-trip booking (v35 + PWD kids) --------------------------------
create or replace function public.submit_daytrip_booking(payload jsonb, cabana_ids uuid[] default null)
returns table(id uuid, order_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(nullif(trim(coalesce(payload->>'discount_code', '')), ''));
  v_date date := nullif(payload->>'check_in', '')::date;
  v_dining int := least(greatest(coalesce(nullif(payload->>'dining_cabanas', '')::int, 0), 0), 60);
  v_lounge int := least(greatest(coalesce(nullif(payload->>'lounge_cabanas', '')::int, 0), 0), 20);
  v_pwd_kids int := 0;
  v_price jsonb;
  av record;
  chk jsonb;
  v_id uuid; v_order text;
begin
  -- the database sets the price (whatever the browser sent)
  v_price := daytrip_server_price(payload->>'stay_type',
               nullif(payload->>'adults', '')::int, nullif(payload->>'children_6_12', '')::int,
               nullif(payload->>'children_0_5', '')::int, nullif(payload->>'senior_count', '')::int,
               nullif(payload->>'pet_count', '')::int, v_dining, v_lounge,
               nullif(payload->>'pwd_kid_count', '')::int);
  if v_price is null then
    payload := payload || jsonb_build_object('subtotal_people', null, 'cabana_total', null,
                                             'senior_discount', null, 'total_amount', null);
  else
    v_pwd_kids := coalesce((v_price->>'pwd_kid_count')::int, 0);
    payload := payload || jsonb_build_object('subtotal_people', v_price->'subtotal_people',
                                             'cabana_total', v_price->'cabana_total',
                                             'senior_count', v_price->'senior_count',
                                             'senior_discount', v_price->'senior_discount',
                                             'total_amount', v_price->'total');
  end if;

  if v_date is not null and (v_dining > 0 or v_lounge > 0) then
    -- one booking at a time per day, so two guests can't take the last cabana
    perform pg_advisory_xact_lock(hashtext('vbr-cabanas-' || v_date::text));
    select * into av from daytrip_availability(v_date, v_date);
    if v_dining > coalesce(av.dining_left, 0) then
      raise exception 'Sorry — only % dining cabana% left on that day. Please pick fewer or another date.',
        coalesce(av.dining_left, 0), case when coalesce(av.dining_left, 0) = 1 then ' is' else 's are' end using errcode = 'P0001';
    end if;
    if v_lounge > coalesce(av.lounge_left, 0) then
      raise exception 'Sorry — only % lounge cabana% left on that day. Please pick fewer or another date.',
        coalesce(av.lounge_left, 0), case when coalesce(av.lounge_left, 0) = 1 then ' is' else 's are' end using errcode = 'P0001';
    end if;
  end if;
  if v_code is not null then
    if v_price is null then
      raise exception 'Discount codes can''t be used on this booking type' using errcode = 'P0001';
    end if;
    -- checked against the database's own totals
    chk := quote_daytrip_code(v_code, v_date, (v_price->>'cabana_total')::numeric, (v_price->>'total')::numeric);
    if not coalesce((chk->>'ok')::boolean, false) then
      raise exception '%', chk->>'error' using errcode = 'P0001';
    end if;
    perform set_config('vbr.daytrip_code', chk::text, true);
  end if;
  select s.id, s.order_code into v_id, v_order
    from submit_booking_request(payload - 'discount_code' - 'dining_cabanas' - 'lounge_cabanas' - 'pwd_kid_count', null) s;
  update booking_requests set dining_cabanas = v_dining, lounge_cabanas = v_lounge, pwd_kid_count = v_pwd_kids
   where booking_requests.id = v_id;
  return query select v_id, v_order;
end;
$$;
revoke all on function public.submit_daytrip_booking(jsonb, uuid[]) from public;
grant execute on function public.submit_daytrip_booking(jsonb, uuid[]) to anon, authenticated;

-- 3. quick self-test (nothing is saved) ---------------------------------------
select 'v39 applied' as status,
       daytrip_server_price('day_trip', 1, 0, 0, 1, 0, 0, 0)->>'total' as senior_adult_expect_897_44,
       daytrip_server_price('day_trip', 1, 1, 0, 0, 0, 0, 0, 1)->>'total' as adult_plus_pwd_kid_expect_1842_31,
       daytrip_server_price('day_trip', 4, 2, 1, 1, 1, 1, 0, 1)->>'total' as mixed_expect_8314_75,
       daytrip_server_price('half_day', 2, 0, 0, 0, 0, 0, 1)->>'total' as half_day_expect_2600;
