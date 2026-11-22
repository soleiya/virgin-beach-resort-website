-- booking-v85-inquiry-cloudbeds-link.sql
-- Website inquiries / bookings re-created by hand in Cloudbeds link to the
-- website record instead of becoming a second, Cloudbeds-only booking.
--
-- Why: on Nov 22 2026 inquiry VBR-27395 was booked by hand in Cloudbeds with
-- "Website Booking ID" = VBR-27395. Cloudbeds' getReservation does not return
-- that form field (thirdPartyIdentifier is empty), so cb_apply_reservation()
-- created a separate cb_owned booking (VBR-27712). Two Cloudbeds events for
-- the same new reservation also ran at once and the second hit a duplicate key.
--
-- cb_apply_reservation() now:
--  1. takes a per-reservation advisory lock, so simultaneous events for one
--     reservation are applied one after the other;
--  2. if no booking matches by reservation id or order code, links the one
--     open website booking/inquiry (inquiry, pending, pending_payment; not yet
--     in Cloudbeds) with the same guest email and check-in/check-out dates;
--  3. a linked inquiry becomes a booking awaiting payment (status pending) with
--     auto-cancel OFF until staff set the payment deadline in the dashboard
--     (tick "Email the guest" to send the payment link); the website quote
--     stays the price and no "booking changed" email goes out for the link;
--  4. a linked booking gets its folio lines (meals, extras, discounts) and the
--     website-details note posted to Cloudbeds, like a booking the website pushed.
-- The booking reference follows the usual rule (cb_ref_code → VBR-<Cloudbeds id>).
--
-- Applied as a patch of the live v84 function (each anchor must be found).

do $mig$
declare n text := pg_get_functiondef('public.cb_apply_reservation(jsonb)'::regprocedure);
begin
  if position('v85:' in n) > 0 then raise notice 'v85 already applied'; return; end if;
  if position($a1$  v_displaced text[] := '{}';     -- v59: Cloudbeds reservations whose stale hold was released
$a1$ in n) = 0 then raise exception 'v85: anchor 1 not found — cb_apply_reservation changed since v84'; end if;
  n := replace(n, $a1$  v_displaced text[] := '{}';     -- v59: Cloudbeds reservations whose stale hold was released
$a1$, $b1$  v_displaced text[] := '{}';     -- v59: Cloudbeds reservations whose stale hold was released
  v_linked boolean := false;      -- v85: this event linked an existing website booking / inquiry
  v_n int;
$b1$);
  if position($a2$  perform set_config('vbr.actor', 'Cloudbeds', true);
$a2$ in n) = 0 then raise exception 'v85: anchor 2 not found — cb_apply_reservation changed since v84'; end if;
  n := replace(n, $a2$  perform set_config('vbr.actor', 'Cloudbeds', true);
$a2$, $b2$  perform set_config('vbr.actor', 'Cloudbeds', true);
  -- v85: Cloudbeds sends several events for one new reservation at once (created,
  -- status_changed …); handle one reservation at a time so they can't both insert it.
  perform pg_advisory_xact_lock(hashtext('cb_res:' || v_id));
$b2$);
  if position($a3$    if v_found then
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;
    end if;
  end if;
$a3$ in n) = 0 then raise exception 'v85: anchor 3 not found — cb_apply_reservation changed since v84'; end if;
  n := replace(n, $a3$    if v_found then
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;
    end if;
  end if;
$a3$, $b3$    if v_found then
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;
      v_linked := true;
    end if;
  end if;
  -- v85: a website booking or inquiry that staff created by hand in Cloudbeds.
  -- Cloudbeds doesn't return the "Website Booking ID" typed in its form, so link
  -- the open website record with the same guest email and dates (only when
  -- exactly one matches) instead of creating a second, Cloudbeds-only record.
  if not v_found and v_cb not in ('canceled', 'no_show', 'deleted') and v_in is not null and v_out is not null
     and position('@' in coalesce(p->>'guest_email', '')) > 1 then
    select count(*) into v_n from booking_requests
     where cb_reservation_id is null and not cb_owned and stay_type = 'overnight'
       and status in ('inquiry', 'pending', 'pending_payment')
       and lower(trim(guest_email)) = lower(trim(p->>'guest_email'))
       and check_in = v_in and check_out = v_out;
    if v_n = 1 then
      select * into b from booking_requests
       where cb_reservation_id is null and not cb_owned and stay_type = 'overnight'
         and status in ('inquiry', 'pending', 'pending_payment')
         and lower(trim(guest_email)) = lower(trim(p->>'guest_email'))
         and check_in = v_in and check_out = v_out
       for update;
      v_found := true;
      v_linked := true;
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;
    end if;
  end if;
  if v_linked then
    -- An inquiry (status "inquiry") becomes a booking awaiting payment. It is never
    -- cancelled automatically until staff set its payment deadline (which also
    -- emails the guest the payment link). The website's quote stays the price.
    update booking_requests set
      status = case when status = 'inquiry' then 'pending'::booking_status else status end,
      pay_deadline_from = case when status = 'inquiry' then now() else pay_deadline_from end,
      hold_mode = case when status = 'inquiry' then 'off' else hold_mode end,
      hold_until = case when status = 'inquiry' then null else hold_until end,
      hold_set_by = case when status = 'inquiry' then 'Cloudbeds link' else hold_set_by end,
      hold_set_at = case when status = 'inquiry' then now() else hold_set_at end,
      hold_note = case when status = 'inquiry' then 'Inquiry booked in Cloudbeds — set the payment deadline and email the guest' else hold_note end,
      staff_notes = concat_ws(E'\n', nullif(staff_notes, ''),
        '[' || to_char(now() at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || ': Cloudbeds #' || v_id || ' linked' ||
        case when status = 'inquiry' then ' — inquiry turned booking, awaiting payment. Set the payment deadline (tick "Email the guest") to send the payment link.' else '' end || ']')
    where id = b.id
    returning * into b;
  end if;
$b3$);
  if position($a4$  v_stay_changed := not v_new and ($a4$ in n) = 0 then raise exception 'v85: anchor 4 not found — cb_apply_reservation changed since v84'; end if;
  n := replace(n, $a4$  v_stay_changed := not v_new and ($a4$, $b4$  v_stay_changed := not v_new and not v_linked and ($b4$);
  if position($a5$  if not v_owned and not v_new and v_target not in ('declined', 'expired') then$a5$ in n) = 0 then raise exception 'v85: anchor 5 not found — cb_apply_reservation changed since v84'; end if;
  n := replace(n, $a5$  if not v_owned and not v_new and v_target not in ('declined', 'expired') then$a5$, $b5$  if not v_owned and not v_new and not v_linked and v_target not in ('declined', 'expired') then$b5$);
  if position($a6$  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'villas_reset', v_reset,$a6$ in n) = 0 then raise exception 'v85: anchor 6 not found — cb_apply_reservation changed since v84'; end if;
  n := replace(n, $a6$  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'villas_reset', v_reset,$a6$, $b6$  -- v85: a linked website booking gets its folio lines (meals, extras, discounts)
  -- and the website-details note in Cloudbeds, exactly like one the website pushed.
  if v_linked then
    perform cb_call('refolio', jsonb_build_object('booking_id', b.id, 'discounts', true));
    perform cb_call('details', jsonb_build_object('booking_id', b.id));
  end if;

  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'linked', v_linked, 'villas_reset', v_reset,$b6$);
  execute n;
end $mig$;
