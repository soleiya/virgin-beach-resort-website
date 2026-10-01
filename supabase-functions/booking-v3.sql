-- ============================================================================
-- Booking rules v3 — payment deadlines, expiry, pet vaccination cards,
-- same-day-only Half-Day, and a locked-down public submit function.
-- Run in Supabase → SQL Editor. Step 0 must run on its own first (Postgres
-- can't use a new enum value in the same transaction that adds it).
-- ============================================================================

-- 0. (run alone) new status for bookings released after the payment deadline
-- alter type booking_status add value if not exists 'expired';

-- 1. New columns
alter table booking_requests add column if not exists pet_vaccination_paths text[];
alter table booking_requests add column if not exists pet_policy_agreed_at timestamptz;
alter table booking_requests add column if not exists payment_reminder_sent_at timestamptz;
alter table booking_requests add column if not exists expired_at timestamptz;

-- 2. Pet vaccination card uploads (private bucket, same rules as senior IDs)
insert into storage.buckets (id, name, public)
values ('pet-vaccinations', 'pet-vaccinations', false)
on conflict (id) do nothing;

drop policy if exists "Anyone can upload a pet vaccination card" on storage.objects;
create policy "Anyone can upload a pet vaccination card"
  on storage.objects for insert to anon
  with check (bucket_id = 'pet-vaccinations');

drop policy if exists "Staff can upload pet vaccination cards" on storage.objects;
create policy "Staff can upload pet vaccination cards"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-vaccinations');

drop policy if exists "Staff can view pet vaccination cards" on storage.objects;
create policy "Staff can view pet vaccination cards"
  on storage.objects for select to authenticated
  using (bucket_id = 'pet-vaccinations');

-- 3. Expired bookings release their cabanas, same as declined ones
create or replace view public_cabana_holds as
  select bc.cabana_id, br.check_in
  from booking_cabanas bc
  join booking_requests br on br.id = bc.booking_id
  where br.status not in ('declined', 'expired');

-- 4. Payment deadlines (Asia/Manila)
--    first  = booked + 24h            → guest gets a 12-hour extension reminder
--    final  = booked + 36h            → booking expires, cabanas released
--    …but never later than 8:00 AM on the trip date: if that comes first,
--    it becomes the final deadline (and the reminder is skipped if it would
--    land after it). Bookings made on/after 8:00 AM of the trip date itself
--    (same-day walk-ins) have no automatic deadline — staff handle them.
create or replace function booking_deadlines(p_created timestamptz, p_check_in date,
  out reminder_at timestamptz, out final_at timestamptz)
language sql stable as $$
  with t as (
    select p_created + interval '24 hours' as first_at,
           p_created + interval '36 hours' as ext_at,
           case when p_check_in is null then null
                else (p_check_in + time '08:00') at time zone 'Asia/Manila' end as trip8
  )
  select
    case when trip8 is not null and trip8 <= p_created then null
         when first_at < least(ext_at, coalesce(trip8, ext_at)) then first_at
         else null end,
    case when trip8 is not null and trip8 <= p_created then null
         else least(ext_at, coalesce(trip8, ext_at)) end
  from t;
$$;

-- 5. The job: send due reminders, expire overdue bookings. Runs every 10 min.
--    A booking with a payment proof uploaded is never expired automatically
--    (staff still need to verify it).
create or replace function process_booking_deadlines() returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_now timestamptz := now();
  v_reminded int := 0;
  v_expired int := 0;
  r record;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;

  for r in
    select b.id
    from booking_requests b, lateral booking_deadlines(b.created_at, b.check_in) d
    where b.status in ('pending', 'pending_payment')
      and b.payment_uploaded_at is null
      and b.payment_reminder_sent_at is null
      and d.reminder_at is not null and v_now >= d.reminder_at and v_now < d.final_at
  loop
    update booking_requests set payment_reminder_sent_at = v_now where id = r.id;
    v_reminded := v_reminded + 1;
    if v_secret is not null then
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'REMINDER', 'record', jsonb_build_object('id', r.id)),
        timeout_milliseconds := 30000
      );
    end if;
  end loop;

  with due as (
    select b.id
    from booking_requests b, lateral booking_deadlines(b.created_at, b.check_in) d
    where b.status in ('pending', 'pending_payment')
      and b.payment_uploaded_at is null
      and d.final_at is not null and v_now >= d.final_at
  )
  update booking_requests b set status = 'expired', expired_at = v_now
  from due where b.id = due.id;
  get diagnostics v_expired = row_count;

  return jsonb_build_object('reminded', v_reminded, 'expired', v_expired);
end;
$$;

revoke all on function process_booking_deadlines() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'booking-deadlines';
select cron.schedule('booking-deadlines', '*/10 * * * *', 'select public.process_booking_deadlines()');

-- 6. Public booking submit — status/source are fixed server-side (a guest can
--    never create a "confirmed" booking), Half-Day only for today (Manila),
--    max 2 pets with vaccination card(s) + Pet Policy agreement.
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

-- Handy checks:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='booking-deadlines') order by start_time desc limit 5;
--   select order_code, created_at, check_in, d.* from booking_requests b, lateral booking_deadlines(b.created_at, b.check_in) d where status in ('pending','pending_payment');
