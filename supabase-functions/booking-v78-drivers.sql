-- =============================================================================
-- booking-v78: drivers on day trips (staff bookings).
-- booking_requests.driver_count — the guests' driver(s), ₱250 each
-- (assets/js/pricing.js DRIVER_RATE, send-booking-email). Not counted as
-- guests or toward cabana seats. Re-runnable.
-- =============================================================================
alter table booking_requests add column if not exists driver_count integer not null default 0;
alter table booking_requests drop constraint if exists booking_requests_driver_count_check;
alter table booking_requests add constraint booking_requests_driver_count_check check (driver_count between 0 and 50);

select 'v78 applied' as status, count(*) filter (where driver_count > 0) as bookings_with_drivers from booking_requests;
