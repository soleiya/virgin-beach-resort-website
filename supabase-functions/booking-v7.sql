-- ============================================================================
-- Booking rules v7 — simpler payment deadline.
-- Unpaid bookings expire 24 hours after they're made (or at 8:00 AM on the
-- trip date, if that comes first) and their cabanas are released.
-- No reminder email / 12-hour extension any more.
-- Bookings made on/after 8:00 AM of the trip date itself (same-day walk-ins)
-- have no automatic deadline — staff handle them.
-- Run in Supabase → SQL Editor (replaces steps 4–5 of booking-v3.sql).
-- ============================================================================

create or replace function booking_deadlines(p_created timestamptz, p_check_in date,
  out reminder_at timestamptz, out final_at timestamptz)
language sql stable as $$
  with t as (
    select p_created + interval '24 hours' as due,
           case when p_check_in is null then null
                else (p_check_in + time '08:00') at time zone 'Asia/Manila' end as trip8
  )
  select
    null::timestamptz,  -- reminder_at: no reminders any more
    case when trip8 is not null and trip8 <= p_created then null
         else least(due, coalesce(trip8, due)) end
  from t;
$$;

-- The cron job (every 10 min): expire overdue unpaid bookings. A booking with
-- a payment proof uploaded is never expired automatically (staff verify it).
create or replace function process_booking_deadlines() returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_expired int := 0;
begin
  with due as (
    select b.id
    from booking_requests b, lateral booking_deadlines(b.created_at, b.check_in) d
    where b.status in ('pending', 'pending_payment')
      and b.payment_uploaded_at is null
      and d.final_at is not null and now() >= d.final_at
  )
  update booking_requests b set status = 'expired', expired_at = now()
  from due where b.id = due.id;
  get diagnostics v_expired = row_count;
  return jsonb_build_object('expired', v_expired);
end;
$$;

revoke all on function process_booking_deadlines() from public, anon, authenticated;

-- Handy check — what expires next:
--   select order_code, created_at, check_in, d.final_at
--   from booking_requests b, lateral booking_deadlines(b.created_at, b.check_in) d
--   where status in ('pending','pending_payment') and payment_uploaded_at is null
--   order by d.final_at;
