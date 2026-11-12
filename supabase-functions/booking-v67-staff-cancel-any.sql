-- =============================================================================
-- booking-v67: "Cancel booking…" for every booking — villas and day trips,
-- made by guests on the website, by staff, or in Cloudbeds.
--
-- staff_cancel_booking(booking, reason, message, email_guest, note)
-- * staff only (view-only accounts are refused by the v56 guard)
-- * reason: guest_cancelled / not_paid / resort / duplicate / test / other
--   (a note is required for "other")
-- * the booking becomes Cancelled (status 'declined'); its casita / cabana is
--   released as with any cancellation; reason, note, who and when are kept on
--   the booking (cancel_reason / cancel_note / cancelled_by / cancelled_at)
--   and stamped in the staff notes
-- * the guest message is saved as email_custom.cancelled = { message, skip }:
--   with "email the guest" ticked, send-booking-email (v67) sends the
--   website's cancellation email opening with that message — for every kind
--   of booking, including ones in Cloudbeds. Unticked: no email at all.
-- * a villa that is in Cloudbeds is cancelled there too (v61 trigger +
--   cloudbeds-sync); Cloudbeds' own email is NOT sent (cancel_notify = false),
--   so the guest gets only the website's email with the staff's message.
-- * refused: already cancelled / expired / completed, booking requests
--   (inquiries), and villas already checked in at Cloudbeds.
-- Re-runnable.
-- =============================================================================

create or replace function staff_cancel_booking(p_booking_id uuid, p_reason text, p_message text default null,
  p_email_guest boolean default false, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b booking_requests%rowtype;
  v_by text := coalesce(nullif(lower(auth.jwt() ->> 'email'), ''), 'staff');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_email boolean := coalesce(p_email_guest, false);
  v_label text;
  v_ok_email boolean;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then raise exception 'Staff only'; end if;
  if coalesce(p_reason, '') not in ('guest_cancelled', 'not_paid', 'resort', 'duplicate', 'test', 'other') then
    raise exception 'Choose why the booking is cancelled';
  end if;
  if p_reason = 'other' and v_note is null then raise exception 'Add a short note for "Other"'; end if;
  select * into b from booking_requests where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status::text in ('declined', 'expired', 'completed') then raise exception 'This booking is already closed (%)', b.status; end if;
  if b.status::text = 'inquiry' then raise exception 'This is a booking request — decline it from the request instead'; end if;
  if b.stay_type = 'overnight' and coalesce(b.cb_info->>'status', '') in ('checked_in', 'checked_out') then
    raise exception 'The guest is already checked in at Cloudbeds — change it in Cloudbeds';
  end if;
  v_ok_email := coalesce(trim(b.guest_email), '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$';
  if v_email and not v_ok_email then raise exception 'There is no valid guest email on this booking — untick "Email the guest" or add the email first'; end if;
  if v_email and v_msg is null then raise exception 'Write the message to the guest'; end if;
  v_label := case p_reason when 'guest_cancelled' then 'Guest cancelled' when 'not_paid' then 'Not paid'
    when 'resort' then 'Cancelled by the resort' when 'duplicate' then 'Duplicate / correction'
    when 'test' then 'Test booking' else 'Other' end;

  update booking_requests set
    status = 'declined',
    cancel_reason = p_reason, cancel_note = v_note,
    cancel_notify = false,                 -- Cloudbeds stays silent; the website emails (below)
    cancelled_at = now(), cancelled_by = v_by,
    email_custom = coalesce(case when jsonb_typeof(email_custom) = 'object' then email_custom end, '{}'::jsonb)
      || jsonb_build_object('cancelled', jsonb_build_object('message', coalesce(v_msg, ''), 'skip', not v_email)),
    staff_notes = concat_ws(E'\n', nullif(staff_notes, ''),
      '[Cancelled ' || to_char(now() at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || ' by ' || v_by || ' — ' || v_label ||
      coalesce(': ' || v_note, '') || case when v_email then ' · guest emailed' else ' · guest not emailed' end || ']')
  where id = b.id;

  return jsonb_build_object('id', b.id, 'order_code', b.order_code, 'emailed', v_email,
    'cloudbeds', b.cb_reservation_id is not null, 'paid', coalesce(b.amount_paid, 0));
end;
$$;
revoke all on function staff_cancel_booking(uuid, text, text, boolean, text) from public, anon;
grant execute on function staff_cancel_booking(uuid, text, text, boolean, text) to authenticated;

select 'v67 applied' as status, to_regprocedure('staff_cancel_booking(uuid,text,text,boolean,text)') is not null as ok;
