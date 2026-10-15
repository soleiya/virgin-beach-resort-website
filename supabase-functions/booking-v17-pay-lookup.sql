-- ============================================================================
-- Booking rules v17 — Upload Payment page: show the guest where they stand
--
-- get_booking_uploads() (matched on Booking ID + the email on the booking)
-- now also returns what the page needs to show a summary before upload:
-- first name, dates, the deadline to secure the booking (24-hour rule) and
-- the payment summary (total, verified, being verified, balance, due date).
-- Re-runnable.
-- ============================================================================
create or replace function get_booking_uploads(p_order_code text, p_guest_email text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order_code', b.order_code,
    'first_name', split_part(trim(coalesce(b.guest_name, '')), ' ', 1),
    'status', b.status,
    'stay_type', b.stay_type,
    'stay_label', coalesce(b.stay_type_label, b.stay_type),
    'check_in', b.check_in,
    'check_out', b.check_out,
    'senior_count', coalesce(b.senior_count, 0),
    'senior_ids', coalesce(array_length(b.senior_id_paths, 1), 0),
    'pet_count', coalesce(b.pet_count, 0),
    'pet_cards', coalesce(array_length(b.pet_vaccination_paths, 1), 0),
    'pet_policy_agreed', b.pet_policy_agreed_at is not null,
    'payment_uploaded', b.payment_uploaded_at is not null,
    'online_discount', coalesce(b.online_discount, 0),
    -- pay by this time to secure the booking (only while nothing is paid yet)
    'secure_by', case when b.status in ('pending', 'pending_payment') and b.payment_uploaded_at is null then d.final_at end,
    'pay', booking_payment_summary(b.id)
  )
  from booking_requests b
  left join lateral booking_deadlines(b.created_at, b.check_in) d on true
  where b.order_code = upper(trim(p_order_code))
    and lower(b.guest_email) = lower(trim(p_guest_email))
    and not b.cb_owned
  limit 1;
$$;
revoke all on function get_booking_uploads(text, text) from public;
grant execute on function get_booking_uploads(text, text) to anon, authenticated;
