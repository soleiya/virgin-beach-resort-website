-- ============================================================================
-- Booking rules v4 — the All-Inclusive Family / Barkada packages are retired.
-- Same as booking-v3.sql step 6, plus one check: public bookings can no longer
-- request an all_inclusive_* stay type. (Existing bookings keep theirs; staff
-- can still use those types from the dashboard.)
-- Run in Supabase → SQL Editor.
-- ============================================================================

create or replace function public.submit_booking_request(payload jsonb, cabana_ids uuid[] default null)
returns table(id uuid, order_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_order_code text;
  v_check_in date := nullif(payload->>'check_in','')::date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_pets int := coalesce((payload->>'pet_count')::int, 0);
  v_pet_paths text[];
begin
  if payload->>'stay_type' like 'all_inclusive%' then
    raise exception 'All-inclusive packages are no longer offered';
  end if;
  if payload->>'stay_type' = 'half_day' and v_check_in is distinct from v_today then
    raise exception 'Half-Day Trips are for same-day (walk-in) visits only';
  end if;
  if v_pets > 2 then
    raise exception 'A maximum of two pets are permitted per reservation';
  end if;
  v_pet_paths := case when payload ? 'pet_vaccination_paths' and jsonb_typeof(payload->'pet_vaccination_paths') = 'array'
    then (select array_agg(x) from jsonb_array_elements_text(payload->'pet_vaccination_paths') x) else null end;
  if v_pets > 0 and (v_pet_paths is null or coalesce((payload->>'pet_policy_agreed')::boolean, false) is not true) then
    raise exception 'Pet vaccination card and Pet Policy agreement are required when bringing pets';
  end if;

  insert into booking_requests (
    status, source, stay_type, stay_type_label, check_in, adults, children_6_12, children_0_5,
    guest_name, guest_names, guest_email, guest_phone, country, how_heard, occasion,
    marketing_opt_in, notes, senior_count, pet_count, subtotal_people, cabana_total,
    senior_discount, total_amount, senior_id_paths, pet_vaccination_paths, pet_policy_agreed_at
  )
  values (
    'pending',
    'website',
    payload->>'stay_type',
    payload->>'stay_type_label',
    v_check_in,
    coalesce((payload->>'adults')::int, 0),
    coalesce((payload->>'children_6_12')::int, 0),
    coalesce((payload->>'children_0_5')::int, 0),
    payload->>'guest_name',
    payload->>'guest_names',
    payload->>'guest_email',
    payload->>'guest_phone',
    payload->>'country',
    payload->>'how_heard',
    payload->>'occasion',
    coalesce((payload->>'marketing_opt_in')::boolean, false),
    payload->>'notes',
    coalesce((payload->>'senior_count')::int, 0),
    v_pets,
    (payload->>'subtotal_people')::numeric,
    (payload->>'cabana_total')::numeric,
    (payload->>'senior_discount')::numeric,
    (payload->>'total_amount')::numeric,
    case when payload ? 'senior_id_paths' and jsonb_typeof(payload->'senior_id_paths') = 'array'
      then (select array_agg(x) from jsonb_array_elements_text(payload->'senior_id_paths') x)
      else null end,
    v_pet_paths,
    case when v_pets > 0 then now() else null end
  )
  returning booking_requests.id, booking_requests.order_code into v_id, v_order_code;

  if cabana_ids is not null and array_length(cabana_ids,1) > 0 then
    insert into booking_cabanas (booking_id, cabana_id)
    select v_id, c from unnest(cabana_ids) as c;
  end if;

  return query select v_id, v_order_code;
end;
$function$;
