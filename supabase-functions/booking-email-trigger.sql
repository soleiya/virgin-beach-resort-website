-- ============================================================================
-- Booking emails: log table + database trigger
-- Run once in Supabase → SQL Editor, AFTER deploying the send-booking-email
-- Edge Function. See SETUP-BOOKING.md section 7.
-- ============================================================================

-- 1. Email log — one row per email sent, and the guard that stops the same
--    email going out twice (e.g. if a request is retried).
create table if not exists booking_email_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  booking_id uuid not null references booking_requests(id) on delete cascade,
  kind text not null,          -- guest_quote, staff_new, proof_staff:<ts>, proof_guest, guest_confirmed
  recipient text,
  subject text,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  message_id text,
  error text,
  sent_at timestamptz
);

create unique index if not exists booking_email_log_once
  on booking_email_log (booking_id, kind)
  where status in ('sending', 'sent');

create index if not exists booking_email_log_booking on booking_email_log (booking_id, created_at desc);

alter table booking_email_log enable row level security;

drop policy if exists "Staff can view email log" on booking_email_log;
create policy "Staff can view email log"
  on booking_email_log for select
  to authenticated
  using (true);
-- No insert/update policy: only the Edge Function (service role) writes here.


-- 2. The webhook secret lives in Supabase Vault, never in this file (the
--    GitHub repo is public). Run this ONE line separately, replacing the text
--    with the same random string you set as WEBHOOK_SECRET on the function:
--
--    select vault.create_secret('PASTE-THE-SAME-RANDOM-STRING-HERE', 'booking_email_webhook_secret');


-- 3. Trigger: calls the Edge Function on a new booking, and when the status
--    or the payment screenshot changes. Staff edits to notes etc. don't fire.
create extension if not exists pg_net with schema extensions;

create or replace function notify_booking_email() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'booking_email_webhook_secret'
    limit 1;

  if v_secret is null then
    return new; -- emails not set up yet; never block a booking
  end if;

  -- pg_net queues this and sends it only after the booking (and its
  -- cabanas) have been committed, so the function always sees the full row.
  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'type', tg_op,
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
$$;

drop trigger if exists trg_booking_email_insert on booking_requests;
create trigger trg_booking_email_insert
  after insert on booking_requests
  for each row execute function notify_booking_email();

drop trigger if exists trg_booking_email_update on booking_requests;
create trigger trg_booking_email_update
  after update of status, payment_uploaded_at on booking_requests
  for each row
  when (old.status is distinct from new.status
        or old.payment_uploaded_at is distinct from new.payment_uploaded_at)
  execute function notify_booking_email();


-- Handy checks afterwards:
--   select created_at, kind, recipient, status, error from booking_email_log order by created_at desc limit 20;
--   select id, status_code, content from net._http_response order by created desc limit 10;
