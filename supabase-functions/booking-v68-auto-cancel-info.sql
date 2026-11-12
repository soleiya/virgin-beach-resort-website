-- =============================================================================
-- booking-v68: "when would this booking be cancelled automatically?"
--
-- booking_auto_cancel(booking) → { at, rule, note } for the staff dashboard,
-- shown next to the "Cancel booking…" button (staff-cancel.js). It mirrors
-- process_booking_deadlines() (v45–v64, every 10 minutes):
-- * villas (overnight): pending / payment-pending, booked 15+ days before
--   arrival, nothing paid or waiting to be checked → cancelled at the
--   payment deadline (24 h after booking, or 8 AM on arrival day if sooner).
--   Booked 14 days or less before arrival → never automatic (reminder only).
-- * day trips: made by the guest online (not walk-in), nothing paid and no
--   proof waiting → closed at 5:00 PM on the trip day.
-- * staff-made day trips, Cloudbeds-made villas, sheet imports, confirmed or
--   part-paid bookings → never automatic (with the reason why).
-- `at` is null when it won't be cancelled automatically. Read-only.
-- =============================================================================
create or replace function booking_auto_cancel(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b booking_requests%rowtype;
  st booking_settings%rowtype;
  d record;
  v_at timestamptz;
  v_paid boolean;
  v_waiting boolean;
  v_lead int;
  res jsonb;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then raise exception 'Staff only'; end if;
  select * into b from booking_requests where id = p_booking_id;
  if not found then return null; end if;
  select * into st from booking_settings where id = 1;
  v_waiting := exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'pending');
  v_paid := coalesce(b.amount_paid, 0) >= 0.5 or exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'verified');

  if b.status::text not in ('pending', 'pending_payment', 'confirmed') then
    return jsonb_build_object('at', null, 'note', 'Not active — nothing to cancel.');
  end if;
  if b.cb_owned then
    return jsonb_build_object('at', null, 'note', 'Made in Cloudbeds — never cancelled automatically.');
  end if;
  if coalesce(b.source, '') = 'sheet_import' then
    return jsonb_build_object('at', null, 'note', 'From the Day Trip sheet — never cancelled automatically.');
  end if;

  if b.stay_type = 'overnight' then
    if not coalesce(st.auto_expire, true) then
      return jsonb_build_object('at', null, 'note', 'Automatic cancellation is switched off.');
    end if;
    if b.status::text = 'confirmed' then
      return jsonb_build_object('at', null, 'note', 'Confirmed — never cancelled automatically.');
    end if;
    v_lead := b.check_in - (b.created_at at time zone 'Asia/Manila')::date;
    if v_lead < 15 then
      return jsonb_build_object('at', null, 'note', 'Booked ' || v_lead || ' day' || case when v_lead = 1 then '' else 's' end ||
        ' before arrival — full payment is needed, but it is never cancelled automatically (reminder only).');
    end if;
    if v_waiting then
      return jsonb_build_object('at', null, 'note', 'Payment proof waiting to be checked — not cancelled automatically.');
    end if;
    if v_paid then
      return jsonb_build_object('at', null, 'note', 'A payment is recorded — not cancelled automatically.');
    end if;
    select * into d from booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in);
    if d.final_at is null then return jsonb_build_object('at', null, 'note', 'No payment deadline — not cancelled automatically.'); end if;
    v_at := d.final_at;
    res := jsonb_build_object('at', v_at, 'rule', 'if still unpaid (24 hours after booking)');
  else
    if not coalesce(st.daytrip_balance_cancel, true) then
      return jsonb_build_object('at', null, 'note', 'Automatic 5 PM cancellation is switched off.');
    end if;
    if coalesce(b.booking_origin, '') <> 'site_guest' or coalesce(b.source, '') = 'walk_in' then
      return jsonb_build_object('at', null, 'note', 'Entered by staff — never cancelled automatically (it shows under Action needed).');
    end if;
    if b.total_amount is null then return jsonb_build_object('at', null, 'note', 'No total yet — not cancelled automatically.'); end if;
    if v_paid then
      return jsonb_build_object('at', null, 'note', 'A payment is recorded — not cancelled automatically.');
    end if;
    if v_waiting then
      return jsonb_build_object('at', null, 'note', 'Payment proof waiting to be checked — not cancelled while it waits.');
    end if;
    v_at := (b.check_in + time '17:00') at time zone 'Asia/Manila';
    res := jsonb_build_object('at', v_at, 'rule', 'if still unpaid (5:00 PM on the trip day)');
  end if;
  return res || jsonb_build_object('past', v_at <= now());
end;
$$;
revoke all on function booking_auto_cancel(uuid) from public, anon;
grant execute on function booking_auto_cancel(uuid) to authenticated, service_role;

select 'v68 applied' as status;
