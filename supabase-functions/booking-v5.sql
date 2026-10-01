-- ============================================================================
-- Booking rules v5 — staff-made bookings sent to the guest as a quotation,
-- guest self-service uploads (Senior/PWD IDs, pet vaccination cards) on /pay,
-- and Guest Name / Booked By locked once a booking exists.
-- Run in Supabase → SQL Editor (after booking-v4.sql).
-- ============================================================================

-- 1. Staff-made bookings: "send this to the guest" flag.
--    The dashboard inserts the booking, attaches its cabanas, THEN flips
--    email_guest to true — so the quotation email always lists the cabanas.
--    Once true, the booking gets the same emails as a website booking
--    (quotation, 24h reminder, proof received, confirmation).
alter table booking_requests add column if not exists email_guest boolean not null default false;

drop trigger if exists trg_booking_email_update on booking_requests;
create trigger trg_booking_email_update
  after update of status, payment_uploaded_at, email_guest on booking_requests
  for each row
  when (old.status is distinct from new.status
        or old.payment_uploaded_at is distinct from new.payment_uploaded_at
        or (new.email_guest and not old.email_guest))
  execute function notify_booking_email();

-- 2. Guest Name and Booked By can't be changed after a booking is made
--    (staff edits through the dashboard). The Edge Function / SQL Editor
--    (service role, postgres) can still correct them if ever needed.
create or replace function lock_booking_identity() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if new.guest_name is distinct from old.guest_name then
      raise exception 'Guest Name can''t be changed on an existing booking';
    end if;
    if new.booked_by is distinct from old.booked_by then
      raise exception 'Booked By can''t be changed on an existing booking';
    end if;
    -- a quotation, once sent, can't be "unsent"
    if old.email_guest and not new.email_guest then
      new.email_guest := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_booking_identity on booking_requests;
create trigger trg_lock_booking_identity
  before update on booking_requests
  for each row execute function lock_booking_identity();

-- 3. Close a gap: guests never insert into booking_requests directly (the
--    website uses submit_booking_request, which fixes status and source).
--    The old "anyone can insert" policy let a crafted request skip those rules.
drop policy if exists "Public can submit booking requests" on booking_requests;

-- 4. /pay page: what does this booking still need from the guest?
--    Matched on Order ID + the email on the booking, like submit_payment_proof.
create or replace function get_booking_uploads(p_order_code text, p_guest_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_code', order_code,
    'status', status,
    'senior_count', coalesce(senior_count, 0),
    'senior_ids', coalesce(array_length(senior_id_paths, 1), 0),
    'pet_count', coalesce(pet_count, 0),
    'pet_cards', coalesce(array_length(pet_vaccination_paths, 1), 0),
    'pet_policy_agreed', pet_policy_agreed_at is not null,
    'payment_uploaded', payment_uploaded_at is not null
  )
  from booking_requests
  where order_code = upper(trim(p_order_code))
    and lower(guest_email) = lower(trim(p_guest_email))
  limit 1;
$$;

revoke all on function get_booking_uploads(text, text) from public;
grant execute on function get_booking_uploads(text, text) to anon, authenticated;

-- 5. /pay page: attach Senior/PWD ID photos and pet vaccination cards that the
--    guest just uploaded to storage (guest/… paths). Pet cards need the Pet
--    Policy agreement. p_notify = true emails the team (the page sends false
--    when a payment proof is uploaded in the same go — that email covers it).
create or replace function submit_booking_documents(
  p_order_code text,
  p_guest_email text,
  p_senior_paths text[] default null,
  p_pet_paths text[] default null,
  p_pet_policy_agreed boolean default false,
  p_notify boolean default true
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r booking_requests%rowtype;
  v_secret text;
  v_s int := coalesce(array_length(p_senior_paths, 1), 0);
  v_p int := coalesce(array_length(p_pet_paths, 1), 0);
begin
  select * into r from booking_requests
    where order_code = upper(trim(p_order_code))
      and lower(guest_email) = lower(trim(p_guest_email))
    limit 1;
  if r.id is null then return false; end if;
  if r.status in ('declined', 'expired', 'completed') then
    raise exception 'This booking is no longer open for uploads';
  end if;
  if v_s = 0 and v_p = 0 then raise exception 'Nothing to upload'; end if;
  if v_s > 10 or v_p > 6 then raise exception 'Too many files'; end if;
  if exists (select 1 from unnest(coalesce(p_senior_paths, '{}') || coalesce(p_pet_paths, '{}')) x
             where x !~ '^guest/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'Invalid file path';
  end if;
  if v_s > 0 and coalesce(r.senior_count, 0) = 0 then
    raise exception 'This booking has no senior citizens or PWDs';
  end if;
  if v_p > 0 and coalesce(r.pet_count, 0) = 0 then
    raise exception 'This booking has no pets';
  end if;
  if v_p > 0 and r.pet_policy_agreed_at is null and not coalesce(p_pet_policy_agreed, false) then
    raise exception 'Please agree to the Pet Policy';
  end if;

  update booking_requests set
    senior_id_paths = case when v_s > 0 then coalesce(senior_id_paths, '{}') || p_senior_paths else senior_id_paths end,
    pet_vaccination_paths = case when v_p > 0 then coalesce(pet_vaccination_paths, '{}') || p_pet_paths else pet_vaccination_paths end,
    pet_policy_agreed_at = case when v_p > 0 or p_pet_policy_agreed then coalesce(pet_policy_agreed_at, now()) else pet_policy_agreed_at end
  where id = r.id;

  if p_notify then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
    if v_secret is not null then
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'DOCS', 'record', jsonb_build_object('id', r.id),
                                   'senior_ids', v_s, 'pet_cards', v_p, 'upload_id', gen_random_uuid()),
        timeout_milliseconds := 30000
      );
    end if;
  end if;
  return true;
end;
$$;

revoke all on function submit_booking_documents(text, text, text[], text[], boolean, boolean) from public;
grant execute on function submit_booking_documents(text, text, text[], text[], boolean, boolean) to anon, authenticated;

-- Handy checks:
--   select order_code, source, email_guest, booked_by from booking_requests where source <> 'website' order by created_at desc limit 10;
