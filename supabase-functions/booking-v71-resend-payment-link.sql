-- =============================================================================
-- booking-v71: send the payment link again (e.g. after correcting a typo in
-- the guest's email address).
--
-- * staff_resend_payment_link(booking, message)  — the "Send payment link…"
--   button in the staff booking windows. Re-sends the quotation with the
--   Pay now button to the email that's on the booking NOW
--   (send-booking-email, type RESEND_QUOTE). Only for bookings still waiting
--   for payment (Pending / Awaiting payment) with nothing paid and no proof
--   waiting; not for view-only accounts or bookings made in Cloudbeds; at most
--   once every 2 minutes per booking. The deadline in the email is when the
--   booking really closes (booking_auto_cancel, v68). Stamped in staff notes.
-- * notify_booking_change(): also passes that deadline, so the "Changes to
--   your reservation" email of a still-unpaid booking shows the amount, the
--   deadline and the Pay now button (send-booking-email v71).
-- Re-runnable.
-- =============================================================================

create or replace function staff_resend_payment_link(p_booking_id uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b booking_requests%rowtype;
  v_by text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_secret text;
  v_deadline timestamptz;
  v_id uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'authenticated' then raise exception 'Staff only'; end if;
  if exists (select 1 from booking_settings s where v_by = any(s.readonly_staff_emails)) then
    raise exception 'This account is view-only (Accounting). Ask the reservations team to send it.' using errcode = '42501';
  end if;
  select * into b from booking_requests where id = p_booking_id;
  if not found then raise exception 'Booking not found'; end if;
  if b.status::text not in ('pending', 'pending_payment') then
    raise exception 'Only bookings waiting for payment can get a payment link (this one is %).', b.status;
  end if;
  if coalesce(b.cb_owned, false) then raise exception 'This booking was made in Cloudbeds — send the payment request from Cloudbeds.'; end if;
  if coalesce(b.amount_paid, 0) >= 0.5 or exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'verified') then
    raise exception 'A payment is already recorded on this booking — the balance reminder handles the rest.';
  end if;
  if exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'pending') then
    raise exception 'A payment proof is waiting to be checked — verify or reject it first.';
  end if;
  if coalesce(trim(b.guest_email), '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'There is no valid email on this booking — correct it and save first.';
  end if;
  if exists (select 1 from booking_email_log l where l.booking_id = b.id and l.kind like 'guest_quote_resend:%'
             and l.created_at > now() - interval '2 minutes') then
    raise exception 'A payment link was just sent to this booking — wait a couple of minutes before sending again.';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is null then raise exception 'Emails are not set up'; end if;
  v_deadline := nullif(booking_auto_cancel(b.id) ->> 'at', '')::timestamptz;

  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('type', 'RESEND_QUOTE', 'record', jsonb_build_object('id', b.id),
      'message', nullif(left(trim(coalesce(p_message, '')), 5000), ''), 'deadline', v_deadline,
      'resend_id', v_id, 'sent_by', v_by),
    timeout_milliseconds := 30000);

  update booking_requests set staff_notes = concat_ws(E'\n', nullif(staff_notes, ''),
    '[Payment link sent ' || to_char(now() at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || ' by ' || coalesce(nullif(v_by, ''), 'staff') ||
    ' to ' || trim(b.guest_email) || ']')
  where id = b.id;

  return jsonb_build_object('ok', true, 'to', trim(b.guest_email), 'order_code', b.order_code, 'deadline', v_deadline);
end;
$$;
revoke all on function staff_resend_payment_link(uuid, text) from public, anon;
grant execute on function staff_resend_payment_link(uuid, text) to authenticated;

-- the change email now knows the real deadline of an unpaid booking
create or replace function notify_booking_change(
  p_booking_id uuid,
  p_changes jsonb,
  p_old_check_in date default null,
  p_message text default null           -- staff's opening message (live since v33)
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_deadline timestamptz;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'not allowed';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 30 then
    raise exception 'changes must be a non-empty array (max 30)';
  end if;
  if not exists (select 1 from booking_requests where id = p_booking_id) then
    raise exception 'booking not found';
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is null then
    return; -- emails not set up
  end if;
  begin
    v_deadline := nullif(booking_auto_cancel(p_booking_id) ->> 'at', '')::timestamptz;
  exception when others then v_deadline := null;
  end;

  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'type', 'CHANGE',
      'record', jsonb_build_object('id', p_booking_id),
      'changes', p_changes,
      'old_check_in', p_old_check_in,
      'message', nullif(left(coalesce(p_message, ''), 5000), ''),
      'change_id', gen_random_uuid(),
      'changed_by', auth.jwt() ->> 'email',
      'deadline', v_deadline
    ),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function notify_booking_change(uuid, jsonb, date, text) from public, anon;
grant execute on function notify_booking_change(uuid, jsonb, date, text) to authenticated;

select 'v71 applied' as status;
