-- ============================================================================
-- booking-v63 — online booking for 2027 weekdays up to 21 March 2027
--
-- Cloudbeds (the master) has Sun–Thu nights open from 1 Jan to 21 Mar 2027
-- (Fri/Sat stay closed; Holy Week 22–31 Mar stays closed). This:
--   1. moves the casita online-booking window to 21 Mar 2027, so open nights
--      can be booked and paid right away at the Cloudbeds rates;
--   2. lets a booking REQUEST include nights that are closed in Cloudbeds
--      (e.g. a 2027 weekend) even inside that window — those nights stay
--      requestable as they are today, instead of becoming un-bookable.
-- The website files (booking-window.js, stay-calendar.js, stay-booking.js v63)
-- must be published first. Run in Supabase → SQL Editor. Safe to run again.
--
-- Undo: update booking_settings set villa_bookings_open_until = date '2026-12-31' where id = 1;
-- ============================================================================
do $$
declare d text;
begin
  d := pg_get_functiondef('public.submit_overnight_inquiry(jsonb, jsonb)'::regprocedure);
  if position('-- v63:' in d) = 0 then
    if position('if v_until is not null and v_out - 1 <= v_until then' in d) = 0 then
      raise exception 'v63: submit_overnight_inquiry has changed — patch it by hand';
    end if;
    d := replace(d, 'if v_until is not null and v_out - 1 <= v_until then',
      'if v_until is not null and v_out - 1 <= v_until
     -- v63: a night closed in Cloudbeds for every casita type (e.g. a 2027 weekend) can still be requested
     and not exists (select 1 from generate_series(v_in, v_out - 1, interval ''1 day'') g(n)
                      where (select count(distinct c.room_type) from public_closed_nights c where c.night = g.n::date)
                          >= (select count(distinct v.room_type) from villas v where v.active)) then');
    execute d;
  end if;
end $$;

update booking_settings set villa_bookings_open_until = date '2027-03-21' where id = 1;

select 'v63 applied' as status,
       (select villa_bookings_open_until from booking_settings where id = 1) as casitas_until,
       (select count(distinct night) from public_closed_nights where night between date '2027-01-01' and date '2027-03-21') as closed_nights_to_mar21;
