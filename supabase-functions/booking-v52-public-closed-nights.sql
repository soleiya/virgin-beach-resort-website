-- ============================================================================
-- booking-v52 — public list of nights closed in Cloudbeds (per casita type)
--
-- The guest booking calendar greys out nights that can't be booked online and
-- shows "Blocked" for nights closed in Cloudbeds (e.g. 2027 weekends and
-- holidays), as opposed to nights that are simply booked up. Only dates and
-- casita types — no guest data. Follows the same rule as public_villa_holds
-- (v51): only nights on/after booking_settings.cloudbeds_rates_from, and only
-- while cloudbeds_rates is on.
-- Run in Supabase → SQL Editor. Safe to run more than once.
-- ============================================================================
create or replace view public_closed_nights as
  select r.night, v.room_type
    from cb_rates r
    join (select distinct room_type, cb_room_type_id from villas where active and cb_room_type_id is not null) v
      on v.cb_room_type_id = r.cb_room_type_id
    join booking_settings s on s.id = 1 and s.cloudbeds_rates
   where (s.cloudbeds_rates_from is null or r.night >= s.cloudbeds_rates_from)
     and (coalesce(r.rate, 0) <= 0 or coalesce(r.rooms_available, 1) <= 0);
grant select on public_closed_nights to anon, authenticated;

select 'v52 applied' as status, (select count(*) from public_closed_nights where night < date '2027-02-01') as closed_type_nights_january;
