-- ============================================================================
-- v46 — day-trip payment rules (Nov 7 2026). Safe to re-run. Needs v45.
--
-- Day trips (cabanas):
--   * unpaid: held 24 h from booking (never past 8:00 AM on the trip day),
--     reminder 4 h before (the 20th hour), then cancelled + released
--   * 50% paid: held until the trip day; if the balance still isn't recorded
--     by 5:00 PM that day the booking is closed (staff alerted, guest not emailed)
-- Villas (overnight): unchanged, per the website policy — held 24 h, reminder
--   (default 6 h before), balance due 15 days before arrival, within 14 days
--   paid in full; part-paid villas are never cancelled automatically.
-- Reminder + cancellation emails to guests are copied to reservations@
--   (send-booking-email) when the staff-alert option is on.
-- ============================================================================

alter table booking_settings add column if not exists daytrip_reminder_hours int not null default 4;
alter table booking_settings add column if not exists daytrip_balance_cancel boolean not null default true;
alter table booking_settings drop constraint if exists booking_settings_daytrip_reminder_hours_chk;
alter table booking_settings add constraint booking_settings_daytrip_reminder_hours_chk check (daytrip_reminder_hours between 0 and 23);
alter table booking_requests add column if not exists expire_reason text;

create or replace function public.process_booking_deadlines() returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_expired int := 0;
  v_due int := 0;
  v_overdue int := 0;
  v_remind int := 0;
  v_closed int := 0;
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

  -- v46: day trips with a down payment are held until the trip day; if the
  -- balance still isn't recorded by 5:00 PM that day, the booking is closed
  -- (staff are alerted; the guest is not emailed — they may be at the resort)
  if coalesce(st.daytrip_balance_cancel, true) then
    update booking_requests b
       set status = 'expired', expired_at = now(), expire_reason = 'balance_unpaid'
     where b.stay_type <> 'overnight'
       and b.status in ('confirmed', 'pending', 'pending_payment')
       and not b.cb_owned
       and coalesce(b.source, '') <> 'sheet_import'
       and b.check_in = manila_today()
       and (now() at time zone 'Asia/Manila')::time >= time '17:00'
       and coalesce(b.amount_paid, 0) > 0
       and b.total_amount is not null and b.amount_paid < b.total_amount - 0.5;
    get diagnostics v_closed = row_count;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is not null then
    -- v45: payment reminder N hours before the deadline (unpaid, still pending)
    if coalesce(st.auto_expire, true) then
      for x in
        select b.id from booking_requests b, lateral booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in) d,
               lateral (select case when b.stay_type = 'overnight' then coalesce(st.pay_reminder_hours, 0)
                                    else coalesce(st.daytrip_reminder_hours, 0) end as hrs) h
         where h.hrs > 0
           and b.status in ('pending', 'pending_payment')
           and not b.cb_owned
           and coalesce(b.source, '') <> 'sheet_import'
           and b.payment_reminder_sent_at is null
           and coalesce(b.guest_email, '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
           and not exists (select 1 from booking_payments p where p.booking_id = b.id and p.status in ('pending', 'verified'))
           and d.final_at is not null
           and now() < d.final_at
           and now() >= d.final_at - make_interval(hours => h.hrs)
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
  return jsonb_build_object('expired', v_expired, 'pay_reminders', v_remind, 'daytrip_balance_closed', v_closed, 'balance_reminders', v_due, 'balance_overdue', v_overdue);
end;
$function$;

select 'v46 applied' as status, daytrip_reminder_hours, pay_reminder_hours as villa_reminder_hours, daytrip_balance_cancel
  from booking_settings where id = 1;
