-- ============================================================================
-- Booking rules v15 — Convenience Discount 3% → 5%
-- Book on the website + pay by bank transfer: 5% off the whole stay
-- (casita, meals, add-ons). quote_overnight() reads the rate from
-- overnight_rates, so new quotations use 5% straight away; bookings already
-- quoted keep the total they were quoted. Re-runnable.
-- ============================================================================
alter table overnight_rates alter column online_bank_discount_rate set default 0.05;
update overnight_rates set online_bank_discount_rate = 0.05 where online_bank_discount_rate is distinct from 0.05;
select online_bank_discount_rate from overnight_rates;
