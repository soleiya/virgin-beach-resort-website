-- ============================================================================
-- v49 — the 5:00 PM trip-day rule only closes day trips that guests booked
-- online (Nov 7 2026: walk-ins paid at the gate but not yet recorded were
-- closed). Staff-entered bookings are never closed automatically. Needs v48.
-- ============================================================================

create or replace function public.process_booking_deadlines() returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_expired int := 0;
  v_due int := 0;
  v_overdue int := 0;
  v_remind int := 0;
  v_closed int := 0;
  v_notice int := 0;
  v_full int := 0;
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
       -- v47: only villas expire after 24 h; day trips are kept until the trip day
       and b.stay_type = 'overnight'
       -- v48: villas booked 14 days or less before arrival are not cancelled automatically
       and b.check_in - (b.created_at at time zone 'Asia/Manila')::date >= 15
  )
  update booking_requests b
     set status = 'expired', expired_at = now()
    from due
   where b.id = due.id;
  get diagnostics v_expired = row_count;
  end if;

  -- v47: day trips are never cancelled before the trip day. At 5:00 PM on the
  -- trip day, a day trip that is still unpaid or part-paid (balance not recorded)
  -- is closed and the guest gets the cancellation email (copy to reservations@).
  -- Proof uploads still waiting for verification are left for staff.
  if coalesce(st.daytrip_balance_cancel, true) then
    update booking_requests b
       set status = 'expired', expired_at = now(), expire_reason = 'trip_day_unpaid'
     where b.stay_type <> 'overnight'
       -- v49: only bookings guests made online. Staff-entered bookings (walk-ins,
       -- phone, Messenger…) are never closed automatically — they show under
       -- "Action needed" in the dashboard instead.
       and coalesce(b.booking_origin, '') = 'site_guest'
       and coalesce(b.source, '') <> 'walk_in'
       and b.status in ('confirmed', 'pending', 'pending_payment')
       and not b.cb_owned
       and coalesce(b.source, '') <> 'sheet_import'
       and b.check_in = manila_today()
       and (now() at time zone 'Asia/Manila')::time >= time '17:00'
       and b.total_amount is not null and coalesce(b.amount_paid, 0) < b.total_amount - 0.5
       and not exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'pending');
    get diagnostics v_closed = row_count;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is not null then
    -- v48: villas booked 14 days or less before arrival need full payment;
    -- not fully paid at the 24-hour mark → one reminder (staff cancel manually)
    for x in
      select b.id from booking_requests b, lateral booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in) d
       where b.stay_type = 'overnight'
         and b.status in ('pending', 'pending_payment', 'confirmed')
         and not b.cb_owned
         and b.check_in - (b.created_at at time zone 'Asia/Manila')::date < 15
         and b.check_in >= manila_today()
         and b.full_pay_reminder_at is null
         and b.total_amount is not null and coalesce(b.amount_paid, 0) < b.total_amount - 0.5
         and not exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'pending')
         and coalesce(b.guest_email, '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
         and now() >= coalesce(d.final_at, coalesce(b.pay_deadline_from, b.created_at) + interval '24 hours')
       limit 50
    loop
      update booking_requests set full_pay_reminder_at = now() where id = x.id;
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'FULL_PAY_REMINDER', 'record', jsonb_build_object('id', x.id)),
        timeout_milliseconds := 30000);
      v_full := v_full + 1;
    end loop;

    -- v47: 8:00 AM on the trip day — "we're expecting you" to day-trip guests
    -- who still owe something (unpaid or balance), so they know the cabana can
    -- be released if they don't come
    if coalesce(st.daytrip_arrival_notice, true) and (now() at time zone 'Asia/Manila')::time >= time '08:00'
       and (now() at time zone 'Asia/Manila')::time < time '17:00' then
      for x in
        select b.id from booking_requests b
         where b.stay_type <> 'overnight'
           and b.status in ('confirmed', 'pending', 'pending_payment')
           and not b.cb_owned
           and coalesce(b.source, '') <> 'sheet_import'
           and b.check_in = manila_today()
           and b.arrival_notice_at is null
           and b.total_amount is not null and coalesce(b.amount_paid, 0) < b.total_amount - 0.5
           and coalesce(b.guest_email, '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
         limit 50
      loop
        update booking_requests set arrival_notice_at = now() where id = x.id;
        perform net.http_post(
          url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
          body := jsonb_build_object('type', 'ARRIVAL_NOTICE', 'record', jsonb_build_object('id', x.id)),
          timeout_milliseconds := 30000);
        v_notice := v_notice + 1;
      end loop;
    end if;
    -- v45: payment reminder N hours before the deadline (unpaid, still pending)
    if coalesce(st.auto_expire, true) then
      for x in
        select b.id from booking_requests b, lateral booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in) d,
               lateral (select case when b.stay_type = 'overnight' then coalesce(st.pay_reminder_hours, 0)
                                    else coalesce(st.daytrip_reminder_hours, 0) end as hrs) h
         where h.hrs > 0
           and not (b.stay_type = 'overnight' and b.check_in - (b.created_at at time zone 'Asia/Manila')::date < 15)
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
  return jsonb_build_object('expired', v_expired, 'pay_reminders', v_remind, 'daytrip_closed_5pm', v_closed, 'arrival_notices', v_notice, 'villa_full_reminders', v_full, 'balance_reminders', v_due, 'balance_overdue', v_overdue);
end;
$function$;

select 'v49 applied' as status;
