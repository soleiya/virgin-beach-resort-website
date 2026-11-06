-- ============================================================================
-- booking-v40 — website day trips must include at least one cabana
-- (Front Office: cabanas are required for all Day Trip guests).
-- Same as v39's submit_daytrip_booking plus one check. Corporate requests are
-- quoted by hand and aren't affected. Safe to run more than once.
-- ============================================================================

-- website day-trip booking (v39 + at least one cabana) --------------------------------
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

  -- v40: every day trip / half-day needs at least one cabana
  if payload->>'stay_type' in ('day_trip', 'half_day') and v_dining + v_lounge < 1 then
    raise exception 'Every day trip needs at least one cabana — please add a Dining or Lounge Cabana.' using errcode = 'P0001';
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

select 'v40 applied' as status;
