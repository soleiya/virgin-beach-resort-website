-- ============================================================================
-- v47 — day trips are no longer cancelled 24 h after booking (Nov 7 2026).
-- Safe to re-run; includes everything from v46 (v46 can be skipped).
--
-- Day trips (cabanas):
--   * the booking stays on even if unpaid; a reminder is still sent before the
--     usual 24 h pay-by time (default 4 h before)
--   * 8:00 AM on the trip day: guests who still owe something get "we're
--     expecting you — if you don't arrive, the cabana may be released"
--   * 5:00 PM on the trip day: still unpaid / balance not recorded → closed,
--     cancellation email to the guest (copy to reservations@)
--   * online payment stays open until 5:00 PM on the trip day
-- Villas: unchanged (held 24 h, then cancelled; website policy for balances).
-- ============================================================================

alter table booking_settings add column if not exists daytrip_reminder_hours int not null default 4;
alter table booking_settings add column if not exists daytrip_balance_cancel boolean not null default true;
alter table booking_settings add column if not exists daytrip_arrival_notice boolean not null default true;
alter table booking_settings drop constraint if exists booking_settings_daytrip_reminder_hours_chk;
alter table booking_settings add constraint booking_settings_daytrip_reminder_hours_chk check (daytrip_reminder_hours between 0 and 23);
alter table booking_requests add column if not exists expire_reason text;
alter table booking_requests add column if not exists arrival_notice_at timestamptz;

create or replace function public.process_booking_deadlines() returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_expired int := 0;
  v_due int := 0;
  v_overdue int := 0;
  v_remind int := 0;
  v_closed int := 0;
  v_notice int := 0;
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
  return jsonb_build_object('expired', v_expired, 'pay_reminders', v_remind, 'daytrip_closed_5pm', v_closed, 'arrival_notices', v_notice, 'balance_reminders', v_due, 'balance_overdue', v_overdue);
end;
$function$;

create or replace function xendit_invoice_start(p_order_code text, p_guest_email text, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b booking_requests%rowtype;
  v_kind text := coalesce(nullif(p_kind, ''), 'full');
  v_paid numeric;
  v_amount numeric;
  v_expires timestamptz;
  v_open xendit_invoices%rowtype;
  v_id uuid;
begin
  select * into b from booking_requests
   where order_code = resolve_order_code(p_order_code)
     and lower(guest_email) = lower(trim(coalesce(p_guest_email, '')))
     and not cb_owned
   limit 1;
  if not found then return jsonb_build_object('error', 'We couldn''t find a booking with that Booking ID and email.'); end if;
  if not pays_with_xendit(b) then return jsonb_build_object('error', 'Online payment isn''t available for this booking — please contact us.'); end if;
  if b.status in ('declined', 'expired', 'completed') then
    return jsonb_build_object('error', 'This booking is no longer open for payment — please contact us.');
  end if;
  if b.total_amount is null or b.total_amount <= 0 then
    return jsonb_build_object('error', 'This booking has no amount to pay yet — please contact us.');
  end if;
  -- Only take money once Cloudbeds has accepted the reservation (it can refuse
  -- a stay the website thought was free, e.g. dates without rates).
  if b.stay_type = 'overnight' and cb_push_enabled() and b.cb_reservation_id is null then
    if b.cb_push_state = 'error' then
      return jsonb_build_object('error', 'We couldn''t confirm your casita for these dates in our reservations system, so we haven''t taken a payment. Please call +63 917 792 0712 or email reservations@virginbeachresort.com and our team will sort it out.');
    end if;
    return jsonb_build_object('error', 'We''re still securing your casita in our reservations system — please try again in a minute.', 'retry', true);
  end if;

  v_paid := coalesce((select sum(amount) from booking_payments where booking_id = b.id and status in ('verified', 'pending')), 0);
  if v_paid >= b.total_amount - 0.5 then return jsonb_build_object('error', 'This booking is already paid in full. Thank you!'); end if;
  if v_kind not in ('deposit', 'full', 'balance') then v_kind := 'full'; end if;
  if v_kind = 'deposit' and (v_paid > 0 or not half_allowed(b.check_in)) then v_kind := 'full'; end if;
  if v_kind = 'balance' and v_paid = 0 then v_kind := 'full'; end if;
  v_amount := case v_kind when 'deposit' then deposit_amount(b.total_amount)
                          else round(b.total_amount - v_paid, 2) end;
  if v_paid > 0 and v_kind = 'full' then v_kind := 'balance'; end if;

  -- how long the invoice stays open: the booking's payment hold while it's
  -- unpaid; otherwise 3 days (balance)
  if b.stay_type = 'overnight' then
    if b.status in ('pending', 'pending_payment') and v_paid = 0 then
      select final_at into v_expires from booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in);
    end if;
    v_expires := coalesce(v_expires, now() + interval '3 days');
  else
    -- v47: day trips can be paid online until 5:00 PM on the trip day
    v_expires := least(now() + interval '3 days', (b.check_in + time '17:00') at time zone 'Asia/Manila');
  end if;
  if v_expires < now() + interval '10 minutes' then
    return jsonb_build_object('error', 'The payment window for this booking has passed — please contact us.');
  end if;

  -- an open invoice for the same amount can be reused
  select * into v_open from xendit_invoices
   where booking_id = b.id and status = 'PENDING' and amount = v_amount and expires_at > now() + interval '5 minutes'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('reuse', true, 'invoice_url', v_open.invoice_url, 'amount', v_amount, 'kind', v_open.kind,
                              'order_code', b.order_code);
  end if;

  insert into xendit_invoices (booking_id, kind, amount, expires_at)
  values (b.id, v_kind, v_amount, v_expires) returning id into v_id;
  return jsonb_build_object(
    'xid', v_id, 'kind', v_kind, 'amount', v_amount, 'expires_at', v_expires,
    'order_code', b.order_code, 'guest_name', b.guest_name, 'guest_email', b.guest_email, 'guest_phone', b.guest_phone,
    'check_in', b.check_in, 'check_out', b.check_out, 'stay_type', b.stay_type,
    'stay_label', case when b.stay_type = 'overnight' then 'Overnight stay' else coalesce(nullif(b.stay_type_label, ''), 'Day trip') end, 'total', b.total_amount, 'paid', v_paid);
end;
$$;
revoke all on function xendit_invoice_start(text, text, text) from public, anon, authenticated;
grant execute on function xendit_invoice_start(text, text, text) to service_role;

select 'v47 applied' as status, daytrip_reminder_hours, pay_reminder_hours as villa_reminder_hours,
       daytrip_arrival_notice, daytrip_balance_cancel
  from booking_settings where id = 1;
