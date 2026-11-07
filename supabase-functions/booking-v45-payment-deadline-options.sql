-- ============================================================================
-- v45 — payment deadlines: dashboard options, reminder before the deadline,
--       cancellation emails to every guest, staff alert. Safe to re-run.
--
-- Deadline rule is unchanged: 24 h from booking (or from a staff "extend"),
-- never later than 8:00 AM on the trip / arrival day (booking_deadlines, v7).
-- Unpaid bookings are then cancelled ("Canceled · payment not received") and
-- the cabanas / casitas released. New options (booking_settings, row 1):
--   auto_expire         cancel unpaid bookings at the deadline   (default on)
--   pay_reminder_hours  remind the guest N hours before, 0 = off (default 6)
--   expiry_email_all    cancellation email to every guest with an email —
--                       also staff-entered bookings and villas in Cloudbeds (on)
--   expiry_staff_alert  email the reservations team on each auto-cancel  (on)
-- The emails themselves are sent by send-booking-email (PAY_REMINDER, and the
-- status → expired webhook) and logged in booking_email_log.
-- ============================================================================

alter table booking_settings add column if not exists auto_expire boolean not null default true;
alter table booking_settings add column if not exists pay_reminder_hours int not null default 6;
alter table booking_settings add column if not exists expiry_email_all boolean not null default true;
alter table booking_settings add column if not exists expiry_staff_alert boolean not null default true;
alter table booking_settings drop constraint if exists booking_settings_pay_reminder_hours_chk;
alter table booking_settings add constraint booking_settings_pay_reminder_hours_chk check (pay_reminder_hours between 0 and 23);
alter table booking_requests add column if not exists payment_reminder_sent_at timestamptz;

create or replace function public.process_booking_deadlines() returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_expired int := 0;
  v_due int := 0;
  v_overdue int := 0;
  v_remind int := 0;
  st booking_settings%rowtype;
  v_secret text;
  x record;
begin
  select * into st from booking_settings where id = 1;
  -- v45: staff can switch automatic cancellation off in the dashboard
  if coalesce(st.auto_expire, true) then
  with due as (
    select b.id
      from booking_requests b, lateral booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in) d
     where b.status in ('pending', 'pending_payment')
       and not b.cb_owned
       -- v38: holds entered on the Day Trip sheet are managed by the team there
       and coalesce(b.source, '') <> 'sheet_import'
       and not exists (select 1 from booking_payments p where p.booking_id = b.id and p.status in ('pending', 'verified'))
       and d.final_at is not null
       and now() >= d.final_at
  )
  update booking_requests b
     set status = 'expired', expired_at = now()
    from due
   where b.id = due.id;
  get diagnostics v_expired = row_count;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is not null then
    -- v45: payment reminder N hours before the deadline (unpaid, still pending)
    if coalesce(st.pay_reminder_hours, 0) > 0 and coalesce(st.auto_expire, true) then
      for x in
        select b.id from booking_requests b, lateral booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in) d
         where b.status in ('pending', 'pending_payment')
           and not b.cb_owned
           and coalesce(b.source, '') <> 'sheet_import'
           and b.payment_reminder_sent_at is null
           and coalesce(b.guest_email, '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
           and not exists (select 1 from booking_payments p where p.booking_id = b.id and p.status in ('pending', 'verified'))
           and d.final_at is not null
           and now() < d.final_at
           and now() >= d.final_at - make_interval(hours => st.pay_reminder_hours)
           -- not right after booking: only if the booking is older than the reminder window
           and now() >= coalesce(b.pay_deadline_from, b.created_at) + interval '1 hour'
         limit 50
      loop
        update booking_requests set payment_reminder_sent_at = now() where id = x.id;
        perform net.http_post(
          url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
          body := jsonb_build_object('type', 'PAY_REMINDER', 'record', jsonb_build_object('id', x.id)),
          timeout_milliseconds := 30000);
        v_remind := v_remind + 1;
      end loop;
    end if;
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
  return jsonb_build_object('expired', v_expired, 'pay_reminders', v_remind, 'balance_reminders', v_due, 'balance_overdue', v_overdue);
end;
$function$;

select 'v45 applied' as status, auto_expire, pay_reminder_hours, expiry_email_all, expiry_staff_alert
  from booking_settings where id = 1;
