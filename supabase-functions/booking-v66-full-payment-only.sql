-- =============================================================================
-- booking-v66: full payment only (Nov 12, 2026, owner's request)
--
-- Guests can no longer choose a 50% down payment: half_allowed() is the single
-- switch the pay page (booking_payment_summary), proof uploads
-- (submit_payment_proof) and Xendit invoices (xendit_invoice_start) use, so
-- every new payment is the full amount. Bookings that already paid 50% can
-- still pay their remaining balance. Staff can still record a partial payment
-- taken at the desk (staff_attach_proof). The website pages and the booking
-- emails (send-booking-email payTerms) say "pay in full" to match.
-- Undo: restore the old body:
--   select p_check_in is not null and balance_due_date(p_check_in) > manila_today()
-- =============================================================================
create or replace function public.half_allowed(p_check_in date) returns boolean
language sql stable as $function$ select false $function$;

select 'v66 applied' as status, half_allowed(current_date + 60) as half_allowed_60_days_out;
