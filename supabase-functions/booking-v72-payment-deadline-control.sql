-- =============================================================================
-- booking-v72: staff control over payment deadlines / how long an unpaid
-- booking is held.
--
-- 1. Per booking ("Payment deadline…" in the booking window, next to the
--    automatic-cancellation line):
--      standard  — the usual rules (v45–v68)
--      until     — cancel automatically if still unpaid by a date & time staff
--                  choose (earlier OR later than the usual rule)
--      off       — never cancel automatically (staff follow up themselves)
--    Works for every booking the website holds (villas and day trips, made by
--    guests or by staff), not for bookings made in Cloudbeds or sheet imports.
--    staff_set_payment_deadline() saves it (who / when / note stamped in the
--    staff notes) and can email the guest the payment link with the new
--    deadline (staff_resend_payment_link, v71).
-- 2. A default for website day trips (Booking window & payment settings):
--    booking_settings.daytrip_hold_rule —
--      trip_day_5pm   unpaid → closed at 5:00 PM on the trip day (as before)
--      day_before_5pm unpaid → cancelled at 5:00 PM the day before the trip
--      hours_6 / hours_12 / hours_24 / hours_48
--                     unpaid → cancelled that many hours after booking
--    (never later than 5:00 PM on the trip day). Only for bookings made after
--    the rule was chosen (daytrip_hold_since), so older bookings keep what
--    their quotation told the guest.
-- 3. booking_auto_cancel() (v68) shows all of this; process_payment_holds()
--    runs every 5 minutes and cancels (status Expired → the usual "not paid"
--    email to the guest) what's due under 1. and 2. A guard stops the older
--    automatic job from cancelling a booking staff set to "off" or gave a
--    later deadline.
-- Nothing is ever cancelled automatically once a payment is recorded or a
-- payment proof is waiting to be checked.
-- Re-runnable.
-- =============================================================================

alter table booking_requests add column if not exists hold_mode text;
alter table booking_requests add column if not exists hold_until timestamptz;
alter table booking_requests add column if not exists hold_set_by text;
alter table booking_requests add column if not exists hold_set_at timestamptz;
alter table booking_requests add column if not exists hold_note text;
do $$ begin
  alter table booking_requests add constraint booking_requests_hold_mode_chk check (hold_mode is null or hold_mode in ('until', 'off'));
exception when duplicate_object then null; end $$;

alter table booking_settings add column if not exists daytrip_hold_rule text not null default 'trip_day_5pm';
alter table booking_settings add column if not exists daytrip_hold_since timestamptz;
do $$ begin
  alter table booking_settings add constraint booking_settings_daytrip_hold_rule_chk
    check (daytrip_hold_rule in ('trip_day_5pm', 'day_before_5pm', 'hours_6', 'hours_12', 'hours_24', 'hours_48'));
exception when duplicate_object then null; end $$;

-- the rule only applies to bookings made after it was chosen
create or replace function booking_settings_hold_since() returns trigger language plpgsql as $$
begin
  if new.daytrip_hold_rule is distinct from old.daytrip_hold_rule then new.daytrip_hold_since := now(); end if;
  return new;
end $$;
drop trigger if exists booking_settings_hold_since on booking_settings;
create trigger booking_settings_hold_since before update on booking_settings
  for each row execute function booking_settings_hold_since();

-- when the default day-trip rule would cancel this booking (null = not under it)
create or replace function daytrip_rule_deadline(p_created timestamptz, p_check_in date, p_rule text) returns timestamptz
language sql stable as $$
  select case
    when p_check_in is null or coalesce(p_rule, 'trip_day_5pm') = 'trip_day_5pm' then null
    when p_rule = 'day_before_5pm' then
      case when ((p_check_in - 1) + time '17:00') at time zone 'Asia/Manila' > p_created
           then ((p_check_in - 1) + time '17:00') at time zone 'Asia/Manila' end   -- booked later than that → trip-day rule
    else least(p_created + make_interval(hours => substring(p_rule from 'hours_(\d+)')::int),
               (p_check_in + time '17:00') at time zone 'Asia/Manila')
  end
$$;

-- ---------------------------------------------------------------------------
-- the automatic-cancellation answer for one booking (internal, no login check)
create or replace function booking_auto_cancel_info(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b booking_requests%rowtype;
  st booking_settings%rowtype;
  d record;
  v_at timestamptz;
  v_paid boolean;
  v_waiting boolean;
  v_lead int;
  v_rule_at timestamptz;
  res jsonb;
  v_by text;
begin
  select * into b from booking_requests where id = p_booking_id;
  if not found then return null; end if;
  select * into st from booking_settings where id = 1;
  v_waiting := exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'pending');
  v_paid := coalesce(b.amount_paid, 0) >= 0.5 or exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'verified');
  v_by := coalesce(nullif(split_part(coalesce(b.hold_set_by, ''), '@', 1), ''), 'staff');

  if b.status::text not in ('pending', 'pending_payment', 'confirmed') then
    return jsonb_build_object('at', null, 'note', 'Not active — nothing to cancel.', 'source', 'none');
  end if;
  if b.cb_owned then
    return jsonb_build_object('at', null, 'note', 'Made in Cloudbeds — never cancelled automatically.', 'source', 'none');
  end if;
  if coalesce(b.source, '') = 'sheet_import' then
    return jsonb_build_object('at', null, 'note', 'From the Day Trip sheet — never cancelled automatically.', 'source', 'none');
  end if;

  -- v72: what staff set on this booking comes first
  if b.hold_mode = 'off' then
    return jsonb_build_object('at', null, 'note', 'Set by ' || v_by || ' — never cancelled automatically' || coalesce(' (' || b.hold_note || ')', '') || '.',
      'source', 'staff', 'mode', 'off', 'set_by', b.hold_set_by, 'set_at', b.hold_set_at);
  end if;
  if b.hold_mode = 'until' and b.hold_until is not null then
    if v_paid then return jsonb_build_object('at', null, 'note', 'A payment is recorded — not cancelled automatically.', 'source', 'staff', 'mode', 'until', 'until', b.hold_until); end if;
    if v_waiting then return jsonb_build_object('at', null, 'note', 'Payment proof waiting to be checked — not cancelled while it waits.', 'source', 'staff', 'mode', 'until', 'until', b.hold_until); end if;
    return jsonb_build_object('at', b.hold_until, 'rule', 'if still unpaid (deadline set by ' || v_by || ')', 'source', 'staff', 'mode', 'until',
      'until', b.hold_until, 'set_by', b.hold_set_by, 'set_at', b.hold_set_at, 'past', b.hold_until <= now());
  end if;

  if b.stay_type = 'overnight' then
    if not coalesce(st.auto_expire, true) then
      return jsonb_build_object('at', null, 'note', 'Automatic cancellation is switched off.', 'source', 'standard');
    end if;
    if b.status::text = 'confirmed' then
      return jsonb_build_object('at', null, 'note', 'Confirmed — never cancelled automatically.', 'source', 'standard');
    end if;
    v_lead := b.check_in - (b.created_at at time zone 'Asia/Manila')::date;
    if v_lead < 15 then
      return jsonb_build_object('at', null, 'note', 'Booked ' || v_lead || ' day' || case when v_lead = 1 then '' else 's' end ||
        ' before arrival — full payment is needed, but it is never cancelled automatically (reminder only).', 'source', 'standard');
    end if;
    if v_waiting then return jsonb_build_object('at', null, 'note', 'Payment proof waiting to be checked — not cancelled automatically.', 'source', 'standard'); end if;
    if v_paid then return jsonb_build_object('at', null, 'note', 'A payment is recorded — not cancelled automatically.', 'source', 'standard'); end if;
    select * into d from booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in);
    if d.final_at is null then return jsonb_build_object('at', null, 'note', 'No payment deadline — not cancelled automatically.', 'source', 'standard'); end if;
    v_at := d.final_at;
    res := jsonb_build_object('at', v_at, 'rule', 'if still unpaid (24 hours after booking)', 'source', 'standard');
  else
    if not coalesce(st.daytrip_balance_cancel, true) then
      return jsonb_build_object('at', null, 'note', 'Automatic cancellation of day trips is switched off.', 'source', 'standard');
    end if;
    if coalesce(b.booking_origin, '') <> 'site_guest' or coalesce(b.source, '') = 'walk_in' then
      return jsonb_build_object('at', null, 'note', 'Entered by staff — not cancelled automatically unless you set a payment deadline.', 'source', 'standard');
    end if;
    if b.total_amount is null then return jsonb_build_object('at', null, 'note', 'No total yet — not cancelled automatically.', 'source', 'standard'); end if;
    if v_paid then return jsonb_build_object('at', null, 'note', 'A payment is recorded — not cancelled automatically.', 'source', 'standard'); end if;
    if v_waiting then return jsonb_build_object('at', null, 'note', 'Payment proof waiting to be checked — not cancelled while it waits.', 'source', 'standard'); end if;
    -- v72: the default rule for website day trips made after it was chosen
    if st.daytrip_hold_since is not null and b.created_at >= st.daytrip_hold_since then
      v_rule_at := daytrip_rule_deadline(b.created_at, b.check_in, st.daytrip_hold_rule);
    end if;
    if v_rule_at is not null then
      v_at := v_rule_at;
      res := jsonb_build_object('at', v_at, 'source', 'daytrip_rule', 'rule', 'if still unpaid (' ||
        case when st.daytrip_hold_rule = 'day_before_5pm' then '5:00 PM the day before the trip'
             else substring(st.daytrip_hold_rule from 'hours_(\d+)') || ' hours after booking' end || ')');
    else
      v_at := (b.check_in + time '17:00') at time zone 'Asia/Manila';
      res := jsonb_build_object('at', v_at, 'rule', 'if still unpaid (5:00 PM on the trip day)', 'source', 'standard');
    end if;
  end if;
  return res || jsonb_build_object('past', v_at <= now());
end;
$$;
revoke all on function booking_auto_cancel_info(uuid) from public, anon, authenticated;
grant execute on function booking_auto_cancel_info(uuid) to service_role;

-- v68's staff function, now from the above
create or replace function booking_auto_cancel(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then raise exception 'Staff only'; end if;
  return booking_auto_cancel_info(p_booking_id);
end;
$$;
revoke all on function booking_auto_cancel(uuid) from public, anon;
grant execute on function booking_auto_cancel(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- staff sets the deadline
create or replace function staff_set_payment_deadline(p_booking_id uuid, p_mode text, p_until timestamptz default null,
  p_note text default null, p_email_guest boolean default false, p_message text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b booking_requests%rowtype;
  v_by text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
  v_last timestamptz;
  v_label text;
  v_mail jsonb;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then raise exception 'Staff only'; end if;
  if exists (select 1 from booking_settings s where v_by = any(s.readonly_staff_emails)) then
    raise exception 'This account is view-only (Accounting). Ask the reservations team to change it.' using errcode = '42501';
  end if;
  if coalesce(p_mode, '') not in ('standard', 'until', 'off') then raise exception 'Choose how long to hold the booking'; end if;
  select * into b from booking_requests where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status::text not in ('pending', 'pending_payment', 'confirmed') then raise exception 'This booking is % — there is nothing to hold.', b.status; end if;
  if coalesce(b.cb_owned, false) then raise exception 'This booking was made in Cloudbeds — change its hold in Cloudbeds.'; end if;
  if coalesce(b.source, '') = 'sheet_import' then raise exception 'This booking is from the Day Trip sheet — manage it there.'; end if;

  if p_mode = 'until' then
    if p_until is null then raise exception 'Choose the date and time of the deadline'; end if;
    if p_until < now() + interval '10 minutes' then raise exception 'The deadline must be at least 10 minutes from now'; end if;
    v_last := case when b.stay_type = 'overnight' then (b.check_in + time '14:00') at time zone 'Asia/Manila'
                   else (b.check_in + time '17:00') at time zone 'Asia/Manila' end;
    if b.check_in is not null and p_until > v_last then
      raise exception 'The deadline can''t be after % (check-in).', to_char(v_last at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM');
    end if;
  end if;
  if p_mode = 'off' and v_note is null then raise exception 'Add a short note on why it shouldn''t be cancelled automatically'; end if;

  v_label := case p_mode when 'standard' then 'standard rule'
    when 'off' then 'never cancel automatically'
    else 'cancel if unpaid by ' || to_char(p_until at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') end;

  update booking_requests set
    hold_mode = case when p_mode = 'standard' then null else p_mode end,
    hold_until = case when p_mode = 'until' then p_until end,
    hold_set_by = nullif(v_by, ''), hold_set_at = now(), hold_note = v_note,
    staff_notes = concat_ws(E'\n', nullif(staff_notes, ''),
      '[Payment deadline ' || to_char(now() at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || ' by ' || coalesce(nullif(v_by, ''), 'staff') ||
      ': ' || v_label || coalesce(' — ' || v_note, '') || ']')
  where id = b.id;

  -- optionally email the guest the payment link with the new deadline
  if coalesce(p_email_guest, false) then
    if p_mode = 'off' then raise exception 'Untick "Email the guest" — there is no deadline to tell them about'; end if;
    v_mail := staff_resend_payment_link(b.id, p_message);
  end if;

  return booking_auto_cancel_info(b.id) || jsonb_build_object('emailed', v_mail is not null, 'to', v_mail ->> 'to');
end;
$$;
revoke all on function staff_set_payment_deadline(uuid, text, timestamptz, text, boolean, text) from public, anon;
grant execute on function staff_set_payment_deadline(uuid, text, timestamptz, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- the older automatic job must not cancel what staff chose to keep
create or replace function guard_payment_hold() returns trigger language plpgsql as $$
begin
  if new.status::text = 'expired' and old.status::text <> 'expired' and coalesce(auth.role(), '') <> 'authenticated'
     and coalesce(new.expire_reason, '') not in ('staff_deadline', 'daytrip_hold')
     and (old.hold_mode = 'off' or (old.hold_mode = 'until' and old.hold_until > now())) then
    new.status := old.status;
    new.expired_at := old.expired_at;
    new.expire_reason := old.expire_reason;
  end if;
  return new;
end $$;
drop trigger if exists a0_guard_payment_hold on booking_requests;
create trigger a0_guard_payment_hold before update of status on booking_requests
  for each row execute function guard_payment_hold();

-- every 5 minutes: cancel what's due under a staff deadline or the day-trip default
create or replace function process_payment_holds() returns jsonb
language plpgsql security definer set search_path = public as $$
declare x record; a jsonb; n_staff int := 0; n_rule int := 0;
begin
  for x in
    select b.id from booking_requests b
    where b.status::text in ('pending', 'pending_payment', 'confirmed')
      and not coalesce(b.cb_owned, false) and coalesce(b.source, '') <> 'sheet_import'
      and coalesce(b.amount_paid, 0) < 0.5
      and (b.hold_mode = 'until' and b.hold_until <= now()
           or (b.hold_mode is null and b.stay_type <> 'overnight' and b.status::text <> 'confirmed'
               and coalesce(b.booking_origin, '') = 'site_guest' and b.check_in >= manila_today() - 1))
    limit 200
  loop
    a := booking_auto_cancel_info(x.id);
    continue when a is null or a ->> 'at' is null or (a ->> 'at')::timestamptz > now();
    continue when coalesce(a ->> 'source', '') not in ('staff', 'daytrip_rule');
    update booking_requests set status = 'expired', expired_at = now(),
      expire_reason = case when a ->> 'source' = 'staff' then 'staff_deadline' else 'daytrip_hold' end
    where id = x.id and status::text in ('pending', 'pending_payment', 'confirmed');
    if a ->> 'source' = 'staff' then n_staff := n_staff + 1; else n_rule := n_rule + 1; end if;
  end loop;
  return jsonb_build_object('staff_deadline', n_staff, 'daytrip_rule', n_rule);
end;
$$;
revoke all on function process_payment_holds() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('payment-holds');
exception when others then null; end $$;
select cron.schedule('payment-holds', '*/5 * * * *', 'select process_payment_holds()');

select 'v72 applied' as status;
