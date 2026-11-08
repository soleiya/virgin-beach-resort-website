-- ============================================================================
-- booking-v53 — limit how far ahead booking REQUESTS can be sent
--
-- booking_settings.requests_open_until (new): last night a guest can REQUEST
-- on the website (null = no limit beyond the usual 18 months). Online
-- (instant) booking still follows villa_bookings_open_until.
-- As set on 9 Nov 2026: instant booking up to 31 Dec 2026, requests for
-- stays up to 31 Dec 2027.
-- Run in Supabase → SQL Editor. Safe to run more than once.
-- ============================================================================
alter table booking_settings add column if not exists requests_open_until date;

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
  v_req_until date;
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
  -- v53: how far ahead requests are taken (null = no limit beyond the 18 months)
  select s.requests_open_until into v_req_until from booking_settings s where s.id = 1;
  if v_req_until is not null and v_out - 1 > v_req_until then
    raise exception 'We''re taking booking requests for stays up to % for now — please pick earlier dates.', to_char(v_req_until, 'FMDD Mon YYYY') using errcode = 'P0001';
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

update booking_settings set requests_open_until = date '2027-12-31' where id = 1;

select 'v53 applied' as status, villa_bookings_open_until as instant_booking_until, requests_open_until from booking_settings where id = 1;
