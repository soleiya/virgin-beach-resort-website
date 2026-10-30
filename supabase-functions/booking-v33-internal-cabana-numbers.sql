-- ============================================================================
-- Booking rules v33 — day-trip cabana numbers are internal
--
--   Staff can still assign cabana numbers in the dashboard (and move parties
--   on the Cabana Map) to keep a record of which guest sat in which cabana.
--   Guests only see the numbers — in their emails, and get "your cabana
--   changed" emails — when staff tick "Include cabana numbers in emails to
--   the guest" on the booking. Off by default; website bookings stay off.
-- Re-runnable.
-- ============================================================================

alter table booking_requests add column if not exists email_cabana_numbers boolean not null default false;

select 'v33 applied' as status;
