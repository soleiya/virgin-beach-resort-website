-- ============================================================================
-- Booking rules v6 — staff discounts on the standard rate-sheet price.
-- The staff dashboard now prices manual bookings exactly like the website
-- (assets/js/pricing.js); a discount (percent or fixed amount) is the only
-- adjustment, and it's stored here so the emails show it as its own line.
-- Run in Supabase → SQL Editor (after booking-v5.sql).
-- ============================================================================

alter table booking_requests add column if not exists discount_type text;
alter table booking_requests add column if not exists discount_value numeric;
alter table booking_requests add column if not exists discount_amount numeric not null default 0;
alter table booking_requests add column if not exists discount_reason text;

alter table booking_requests drop constraint if exists booking_requests_discount_check;
alter table booking_requests add constraint booking_requests_discount_check check (
  (discount_type is null and coalesce(discount_value, 0) = 0 and discount_amount = 0)
  or (discount_type = 'percent' and discount_value > 0 and discount_value <= 100 and discount_amount >= 0)
  or (discount_type = 'amount' and discount_value > 0 and discount_amount >= 0)
);

-- Website bookings can never carry a discount: submit_booking_request lists
-- its columns explicitly, so these stay at their defaults for guests.

-- Handy check:
--   select order_code, total_amount, discount_type, discount_value, discount_amount, discount_reason
--   from booking_requests where discount_amount > 0 order by created_at desc;
