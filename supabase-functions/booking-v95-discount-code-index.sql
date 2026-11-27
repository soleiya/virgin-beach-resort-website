-- booking-v95: index booking_requests.discount_code
--
-- Campaigns → Codes showed "canceling statement due to statement timeout".
-- campaign_code_rows joins booking_requests by discount_code once per campaign
-- code (~6,000 codes after the Weekday 10% campaign) and there was no index, so
-- every lookup was a full scan of booking_requests (~17.7k rows): ~100M row
-- checks, over the 8s staff statement_timeout.
--
-- With the index, campaign_codes('{}') runs in ~0.6s.
-- Applied to production 2026-11-27. Run on its own (CONCURRENTLY can't run
-- inside a transaction block).

create index concurrently if not exists booking_requests_discount_code_idx
  on public.booking_requests (discount_code)
  where discount_code is not null;

analyze public.booking_requests;
