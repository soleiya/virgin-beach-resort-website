-- ============================================================================
-- Booking rules v16 — 50% / 100% payments, balance before arrival
--
-- Consistent with the Reservations Agreement / FAQ (full payment guarantees
-- the reservation; 50% is forfeited from 14 days before arrival):
--   * Within 24 hours of booking (as before) the guest pays at least 50% —
--     or 100% — and uploads the proof. That secures the booking.
--   * The remaining balance is due 15 days before arrival (the day before the
--     50% cancellation charge starts). Bookings made 14 days or less before
--     arrival pay 100% within the 24 hours.
--   * Applies to day trips and villas booked on the website (not to stays
--     made in Cloudbeds — Cloudbeds keeps their folio).
--   * Every upload is a row in booking_payments (what the guest says they
--     paid). Staff verify it in the dashboard; amount_paid is the verified sum.
--   * Balance not in by the due date: the guest gets reminders (3 days before,
--     and on the day after it's overdue) and staff get an alert — staff then
--     decide; nothing is cancelled automatically.
-- Re-runnable.
-- ============================================================================

alter table booking_requests add column if not exists amount_paid numeric not null default 0;  -- verified by staff
alter table booking_requests add column if not exists payment_plan text;                         -- 'half' | 'full'
alter table booking_requests add column if not exists balance_reminder_at timestamptz;
alter table booking_requests add column if not exists balance_overdue_at timestamptz;
alter table booking_requests add column if not exists paid_in_full_at timestamptz;
alter table booking_requests add column if not exists amount_pending numeric not null default 0;  -- uploaded, not yet verified

create table if not exists booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking_requests(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'full', 'balance', 'other')),
  amount numeric not null check (amount >= 0),       -- what the guest says they paid (or staff recorded)
  method text not null default 'transfer',           -- transfer | link | cash | card | other
  proof_path text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  created_by text,                                    -- null = the guest on the website
  verified_at timestamptz,
  verified_by text
);
create index if not exists booking_payments_booking_idx on booking_payments (booking_id, created_at);
alter table booking_payments enable row level security;
drop policy if exists booking_payments_staff_read on booking_payments;
create policy booking_payments_staff_read on booking_payments for select to authenticated using (true);

-- ---------------------------------------------------------------- rules
-- Manila "today"
create or replace function manila_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- Balance due date: 15 days before arrival.
create or replace function balance_due_date(p_check_in date) returns date
language sql immutable as $$ select p_check_in - 15 $$;

-- May the guest pay 50% now? Only while the balance date is still ahead.
create or replace function half_allowed(p_check_in date) returns boolean
language sql stable as $$ select p_check_in is not null and balance_due_date(p_check_in) > manila_today() $$;

-- Everything the pay page, emails and dashboard need to know about payments.
create or replace function booking_payment_summary(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', b.total_amount,
    'paid', b.amount_paid,
    'claimed', coalesce((select sum(amount) from booking_payments p where p.booking_id = b.id and p.status <> 'rejected'), 0),
    'pending', coalesce((select sum(amount) from booking_payments p where p.booking_id = b.id and p.status = 'pending'), 0),
    'balance', greatest(coalesce(b.total_amount, 0) - b.amount_paid, 0),
    'deposit', round(coalesce(b.total_amount, 0) / 2, 2),
    'half_allowed', half_allowed(b.check_in),
    'balance_due', case when b.check_in is not null then balance_due_date(b.check_in) end,
    'plan', b.payment_plan,
    'last', (select jsonb_build_object('kind', p.kind, 'amount', p.amount, 'method', p.method, 'status', p.status, 'at', p.created_at)
               from booking_payments p where p.booking_id = b.id order by p.created_at desc limit 1),
    'fully_paid', b.total_amount is not null and b.amount_paid >= b.total_amount - 0.5
  )
  from booking_requests b where b.id = p_booking_id;
$$;
revoke all on function booking_payment_summary(uuid) from public, anon;
grant execute on function booking_payment_summary(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- pay page
-- What does this booking still need from the guest? (adds the amounts)
create or replace function get_booking_uploads(p_order_code text, p_guest_email text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order_code', order_code,
    'status', status,
    'stay_type', stay_type,
    'check_in', check_in,
    'senior_count', coalesce(senior_count, 0),
    'senior_ids', coalesce(array_length(senior_id_paths, 1), 0),
    'pet_count', coalesce(pet_count, 0),
    'pet_cards', coalesce(array_length(pet_vaccination_paths, 1), 0),
    'pet_policy_agreed', pet_policy_agreed_at is not null,
    'payment_uploaded', payment_uploaded_at is not null,
    'online_discount', coalesce(online_discount, 0),
    'pay', booking_payment_summary(id)
  )
  from booking_requests
  where order_code = upper(trim(p_order_code))
    and lower(guest_email) = lower(trim(p_guest_email))
    and not cb_owned
  limit 1;
$$;
revoke all on function get_booking_uploads(text, text) from public;
grant execute on function get_booking_uploads(text, text) to anon, authenticated;

-- Guest uploads a proof. p_kind: 'deposit' (50%), 'full' (100%) or 'balance'.
-- The amount is worked out here from the booking, not trusted from the page.
drop function if exists submit_payment_proof(text, text, text, text);
create or replace function submit_payment_proof(p_order_code text, p_guest_email text, p_storage_path text, p_kind text default 'full')
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  b booking_requests%rowtype;
  v_kind text := coalesce(nullif(p_kind, ''), 'full');
  v_amount numeric;
  v_claimed numeric;
begin
  select * into b from booking_requests
   where order_code = upper(trim(p_order_code)) and lower(guest_email) = lower(trim(p_guest_email))
   limit 1;
  if not found then return false; end if;
  if b.status in ('declined', 'expired', 'completed') then
    raise exception 'This booking is no longer open for payment — please contact us';
  end if;
  select coalesce(sum(amount), 0) into v_claimed from booking_payments where booking_id = b.id and status <> 'rejected';
  if v_kind = 'deposit' and not half_allowed(b.check_in) then
    v_kind := 'full';  -- within 14 days of arrival: 100% is required
  end if;
  if v_kind not in ('deposit', 'full', 'balance') then v_kind := 'full'; end if;
  if v_kind = 'balance' and v_claimed = 0 then v_kind := 'full'; end if;
  v_amount := case v_kind
    when 'deposit' then round(coalesce(b.total_amount, 0) / 2, 2)
    when 'full' then greatest(coalesce(b.total_amount, 0) - v_claimed, 0)
    else greatest(coalesce(b.total_amount, 0) - greatest(v_claimed, b.amount_paid), 0) end;

  insert into booking_payments (booking_id, kind, amount, method, proof_path)
  values (b.id, v_kind, v_amount, 'transfer', p_storage_path);

  update booking_requests
     set payment_screenshot_path = p_storage_path,
         payment_uploaded_at = now(),
         amount_pending = coalesce((select sum(amount) from booking_payments p where p.booking_id = b.id and p.status = 'pending'), 0),
         payment_plan = coalesce(payment_plan, case when v_kind = 'deposit' then 'half' else 'full' end),
         status = case when status = 'pending' then 'pending_payment' else status end
   where id = b.id;
  return true;
end;
$$;
revoke all on function submit_payment_proof(text, text, text, text) from public;
grant execute on function submit_payment_proof(text, text, text, text) to anon, authenticated;
-- the old 3-argument version
drop function if exists submit_payment_proof(text, text, text);

-- ---------------------------------------------------------------- staff
create or replace function recalc_amount_paid(p_booking_id uuid) returns numeric
language sql security definer set search_path = public as $$
  update booking_requests b
     set amount_paid = coalesce((select sum(amount) from booking_payments p where p.booking_id = b.id and p.status = 'verified'), 0),
         amount_pending = coalesce((select sum(amount) from booking_payments p where p.booking_id = b.id and p.status = 'pending'), 0)
   where b.id = p_booking_id
  returning amount_paid;
$$;

-- Staff verify (or correct the amount of) a guest's payment, or reject it.
-- Verifying the first payment confirms the booking (→ confirmation email);
-- the payment that completes the total sends the "paid in full" email.
create or replace function staff_verify_payment(p_payment_id uuid, p_amount numeric default null, p_reject boolean default false, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  p booking_payments%rowtype;
  b booking_requests%rowtype;
  v_paid numeric;
  v_full boolean;
  v_secret text;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'not allowed'; end if;
  select * into p from booking_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  update booking_payments
     set status = case when p_reject then 'rejected' else 'verified' end,
         amount = coalesce(p_amount, amount),
         note = coalesce(nullif(trim(p_note), ''), note),
         verified_at = now(), verified_by = auth.jwt() ->> 'email'
   where id = p_payment_id;
  v_paid := recalc_amount_paid(p.booking_id);
  select * into b from booking_requests where id = p.booking_id;
  v_full := b.total_amount is not null and v_paid >= b.total_amount - 0.5;

  if not p_reject and v_paid > 0 and b.status in ('pending', 'pending_payment') then
    update booking_requests set status = 'confirmed', paid_in_full_at = case when v_full then now() end where id = b.id;
  elsif not p_reject and v_full and b.paid_in_full_at is null then
    update booking_requests set paid_in_full_at = now() where id = b.id;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
    if v_secret is not null then
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'PAID_IN_FULL', 'record', jsonb_build_object('id', b.id), 'payment_id', p_payment_id),
        timeout_milliseconds := 30000);
    end if;
  end if;
  return booking_payment_summary(b.id);
end;
$$;
revoke all on function staff_verify_payment(uuid, numeric, boolean, text) from public, anon;
grant execute on function staff_verify_payment(uuid, numeric, boolean, text) to authenticated;

-- Staff record a payment taken some other way (cash, card link, transfer
-- seen in the bank without an upload). Recorded payments are verified.
create or replace function staff_record_payment(p_booking_id uuid, p_amount numeric, p_kind text, p_method text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'not allowed'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount received'; end if;
  insert into booking_payments (booking_id, kind, amount, method, note, created_by)
  values (p_booking_id, case when p_kind in ('deposit', 'full', 'balance', 'other') then p_kind else 'other' end,
          p_amount, coalesce(nullif(p_method, ''), 'other'), nullif(trim(p_note), ''), auth.jwt() ->> 'email')
  returning id into v_id;
  return staff_verify_payment(v_id, p_amount, false, p_note);
end;
$$;
revoke all on function staff_record_payment(uuid, numeric, text, text, text) from public, anon;
grant execute on function staff_record_payment(uuid, numeric, text, text, text) to authenticated;

-- Staff set a booking to Confirmed by hand (status dropdown): count the
-- payments the guest uploaded as verified, so the confirmation shows them.
create or replace function booking_confirm_payments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' and old.status in ('pending', 'pending_payment') and not new.cb_owned then
    update booking_payments set status = 'verified', verified_at = now(), verified_by = coalesce(auth.jwt() ->> 'email', 'status change')
     where booking_id = new.id and status = 'pending';
    new.amount_paid := coalesce((select sum(amount) from booking_payments p where p.booking_id = new.id and p.status = 'verified'), 0);
    new.amount_pending := 0;
    if new.total_amount is not null and new.amount_paid >= new.total_amount - 0.5 and new.paid_in_full_at is null then
      new.paid_in_full_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_booking_confirm_payments on booking_requests;
create trigger trg_booking_confirm_payments before update of status on booking_requests
  for each row execute function booking_confirm_payments();

-- ---------------------------------------------------------------- reminders
-- process_booking_deadlines (every 10 min): the 24-hour expiry as before,
-- plus balance reminders. Nothing is cancelled for an unpaid balance.
create or replace function public.process_booking_deadlines() returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_expired int := 0;
  v_due int := 0;
  v_overdue int := 0;
  v_secret text;
  x record;
begin
  with due as (
    select b.id
      from booking_requests b, lateral booking_deadlines(b.created_at, b.check_in) d
     where b.status in ('pending', 'pending_payment')
       and not b.cb_owned
       and b.payment_uploaded_at is null
       and d.final_at is not null
       and now() >= d.final_at
  )
  update booking_requests b
     set status = 'expired', expired_at = now()
    from due
   where b.id = due.id;
  get diagnostics v_expired = row_count;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is not null then
    -- 3 days before the balance date
    for x in
      select b.id from booking_requests b
       where b.status = 'confirmed' and not b.cb_owned and b.amount_paid > 0
         and b.total_amount is not null and b.amount_paid < b.total_amount - 0.5
         and b.check_in > manila_today()
         and manila_today() >= balance_due_date(b.check_in) - 3
         and manila_today() <= balance_due_date(b.check_in)
         and b.balance_reminder_at is null
       limit 50
    loop
      update booking_requests set balance_reminder_at = now() where id = x.id;
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'BALANCE_DUE', 'record', jsonb_build_object('id', x.id)),
        timeout_milliseconds := 30000);
      v_due := v_due + 1;
    end loop;
    -- the day after the balance date: guest reminder + staff alert
    for x in
      select b.id from booking_requests b
       where b.status = 'confirmed' and not b.cb_owned and b.amount_paid > 0
         and b.total_amount is not null and b.amount_paid < b.total_amount - 0.5
         and b.check_in >= manila_today()
         and manila_today() > balance_due_date(b.check_in)
         and b.balance_overdue_at is null
       limit 50
    loop
      update booking_requests set balance_overdue_at = now() where id = x.id;
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'BALANCE_OVERDUE', 'record', jsonb_build_object('id', x.id)),
        timeout_milliseconds := 30000);
      v_overdue := v_overdue + 1;
    end loop;
  end if;
  return jsonb_build_object('expired', v_expired, 'balance_reminders', v_due, 'balance_overdue', v_overdue);
end;
$function$;

-- Bookings already confirmed before this change count as fully paid
-- (they were confirmed under the full-payment rule). Done with the email and
-- activity-log triggers paused — it's bookkeeping, not a change to report.
begin;
alter table booking_requests disable trigger trg_booking_email_update;
alter table booking_requests disable trigger trg_log_booking_change;
update booking_requests
   set amount_paid = total_amount, paid_in_full_at = coalesce(paid_in_full_at, created_at)
 where status in ('confirmed', 'completed') and not cb_owned and total_amount is not null and amount_paid = 0;
alter table booking_requests enable trigger trg_booking_email_update;
alter table booking_requests enable trigger trg_log_booking_change;
commit;
