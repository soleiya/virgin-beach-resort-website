-- booking-v86-2027-weekends-holidays-closed.sql
-- 2027: weekends and holidays are not open online — no booking and no booking
-- request. Weekday casita bookings open through Mar 31, 2027. The booking
-- calendar shows the nightly casita rate (public_night_prices).
--
--  * booking_settings.closed_weekends_from / closed_weekends_until: in this
--    period every Friday and Saturday night, and every night in peak_dates
--    (holidays, their eves, Holy Week), is closed for guests on the website.
--    Staff bookings from the dashboard are not affected.
--  * peak_dates gets the 2027 holidays (Proclamation 1427) + the night before
--    each, and Holy Week + Easter Sunday (Mar 21–28). Staff can add/remove nights there as before;
--    (Cloudbeds stays the master too: Jan 3 "CLOSED OUT DATES" and the Holy Week /
--    Easter blocks through Mar 31 are kept — a night closed in Cloudbeds is never bookable.)
--    peak nights are priced at the weekend rate where the website sets the price.
--  * night_closed_reason(d) / stay_closed_message(in, out) — the one rule,
--    used by quote_overnight() (online bookings AND requests) and
--    submit_overnight_inquiry(); public_stay_rules lists the closed nights for
--    the booking calendar.
--  * v63 is undone: a night closed in Cloudbeds inside the online window can
--    no longer be sent as a booking request.
--  * public_night_prices: casita rate per night and type — Cloudbeds rates from
--    cloudbeds_rates_from (rate > 0), else the website's weekday/weekend rates.
--  * villa_bookings_open_until → 2027-03-31.

alter table booking_settings add column if not exists closed_weekends_from date;
alter table booking_settings add column if not exists closed_weekends_until date;
comment on column booking_settings.closed_weekends_from is 'v86: from this night, Fri/Sat nights and peak_dates nights are closed for guests online (bookings and requests)';
comment on column booking_settings.closed_weekends_until is 'v86: last night of the weekend/holiday closure (null = no end)';

update booking_settings
   set closed_weekends_from = '2027-01-01', closed_weekends_until = '2027-12-31',
       villa_bookings_open_until = '2027-03-31', updated_at = now()
 where id = 1;

-- 2027 holidays (Proclamation 1427) + the night before each + Holy Week
insert into peak_dates (night, label) values
  ('2027-01-01', 'New Year''s Day'),
  ('2027-02-05', 'Eve of Chinese New Year'), ('2027-02-06', 'Chinese New Year'),
  ('2027-03-21', 'Holy Week'), ('2027-03-22', 'Holy Week'), ('2027-03-23', 'Holy Week'),
  ('2027-03-24', 'Holy Week'), ('2027-03-25', 'Maundy Thursday'), ('2027-03-26', 'Good Friday'),
  ('2027-03-27', 'Black Saturday'), ('2027-03-28', 'Easter Sunday'),
  ('2027-04-08', 'Eve of Araw ng Kagitingan'), ('2027-04-09', 'Araw ng Kagitingan'),
  ('2027-04-30', 'Eve of Labor Day'), ('2027-05-01', 'Labor Day'),
  ('2027-06-11', 'Eve of Independence Day'), ('2027-06-12', 'Independence Day'),
  ('2027-08-20', 'Eve of Ninoy Aquino Day'), ('2027-08-21', 'Ninoy Aquino Day'),
  ('2027-08-29', 'Eve of National Heroes Day'), ('2027-08-30', 'National Heroes Day'),
  ('2027-10-31', 'Eve of All Saints'' Day'), ('2027-11-01', 'All Saints'' Day'), ('2027-11-02', 'All Souls'' Day'),
  ('2027-11-29', 'Eve of Bonifacio Day'), ('2027-11-30', 'Bonifacio Day'),
  ('2027-12-07', 'Eve of the Immaculate Conception'), ('2027-12-08', 'Feast of the Immaculate Conception'),
  ('2027-12-23', 'Eve of Christmas Eve'), ('2027-12-24', 'Christmas Eve'), ('2027-12-25', 'Christmas Day'),
  ('2027-12-29', 'Eve of Rizal Day'), ('2027-12-30', 'Rizal Day'), ('2027-12-31', 'Last Day of the Year')
on conflict (night) do nothing;

-- why a night is closed for guests online (null = not closed by this rule)
create or replace function public.night_closed_reason(p_night date)
returns text language sql stable security definer set search_path = public as $$
  select case
    when s.closed_weekends_from is null or p_night is null or p_night < s.closed_weekends_from
         or (s.closed_weekends_until is not null and p_night > s.closed_weekends_until) then null
    when exists (select 1 from peak_dates pd where pd.night = p_night)
      then coalesce((select nullif(trim(pd.label), '') from peak_dates pd where pd.night = p_night), 'Holiday')
    when extract(isodow from p_night) in (5, 6) then 'Weekend'
  end
  from booking_settings s where s.id = 1;
$$;

-- guest-facing message if any night of [in, out) is closed, else null
create or replace function public.stay_closed_message(p_in date, p_out date)
returns text language sql stable security definer set search_path = public as $$
  select 'Weekend and holiday nights in ' || to_char(x.n, 'YYYY') || ' aren''t open for booking yet (' ||
         to_char(x.n, 'Dy, Mon FMDD') || ' — ' || x.r || '). Please choose weekday dates.'
  from (select g.n::date as n, night_closed_reason(g.n::date) as r
          from generate_series(p_in, p_out - 1, interval '1 day') g(n)
         where p_in is not null and p_out is not null and p_out > p_in
           and night_closed_reason(g.n::date) is not null
         order by g.n limit 1) x;
$$;

grant execute on function public.night_closed_reason(date) to anon, authenticated;
grant execute on function public.stay_closed_message(date, date) to anon, authenticated;

-- closed nights for the booking calendar
create or replace view public.public_stay_rules as
  select g.n::date as night, night_closed_reason(g.n::date) as reason
    from booking_settings s,
         generate_series(s.closed_weekends_from, coalesce(s.closed_weekends_until, s.closed_weekends_from + 550), interval '1 day') g(n)
   where s.id = 1 and s.closed_weekends_from is not null
     and night_closed_reason(g.n::date) is not null;
grant select on public.public_stay_rules to anon, authenticated;

-- casita rate per night and type for the booking calendar
create or replace view public.public_night_prices as
  select r.night, v.room_type, r.rate
    from cb_rates r
    join (select distinct room_type, cb_room_type_id from villas where active and cb_room_type_id is not null) v
      on v.cb_room_type_id = r.cb_room_type_id
    join booking_settings s on s.id = 1 and s.cloudbeds_rates
   where (s.cloudbeds_rates_from is null or r.night >= s.cloudbeds_rates_from)
     and coalesce(r.rate, 0) > 0
  union all
  select g.n::date, v.room_type,
         case when extract(isodow from g.n) in (5, 6) or exists (select 1 from peak_dates pd where pd.night = g.n::date)
              then max(v.weekend_rate) else max(v.weekday_rate) end
    from booking_settings s
    cross join generate_series((now() at time zone 'Asia/Manila')::date,
                               case when s.cloudbeds_rates and s.cloudbeds_rates_from is not null
                                    then s.cloudbeds_rates_from - 1
                                    else (now() at time zone 'Asia/Manila')::date + 550 end, interval '1 day') g(n)
    cross join villas v
   where s.id = 1 and v.active
   group by g.n, v.room_type;
grant select on public.public_night_prices to anon, authenticated;

-- quote_overnight: guests (bookings and requests) can't pick closed nights
do $mig$
declare n text := pg_get_functiondef('public.quote_overnight(date, date, uuid[], integer, integer, integer, integer, integer, jsonb, boolean, text, date)'::regprocedure);
        a text := E'  v_guests := v_adults + v_k612 + v_k05;\n';
begin
  if position('v86:' in n) = 0 then
    if position(a in n) = 0 then raise exception 'v86: quote_overnight anchor not found'; end if;
    n := replace(n, a, a || $b$
  -- v86: weekends and holidays in the closure period (booking_settings
  -- closed_weekends_from/until + peak_dates) are not open to guests online —
  -- neither bookings nor booking requests. Staff bookings are not affected.
  if not v_staff and stay_closed_message(p_check_in, p_check_out) is not null then
    return jsonb_build_object('ok', false, 'closed', true, 'error', stay_closed_message(p_check_in, p_check_out));
  end if;
$b$);
    execute n;
  end if;

  -- submit_overnight_inquiry: closed nights can't be requested; v63 undone
  n := pg_get_functiondef('public.submit_overnight_inquiry(jsonb, jsonb)'::regprocedure);
  if position('v86:' in n) = 0 then
    if (select count(*) from regexp_matches(n, '\s*-- v63: a night closed in Cloudbeds.*?where v\.active\)\)', 'g')) <> 1 then
      raise exception 'v86: submit_overnight_inquiry v63 clause not found';
    end if;
    n := regexp_replace(n, '\s*-- v63: a night closed in Cloudbeds.*?where v\.active\)\)', '');
    a := E'  select coalesce(s.villa_bookings_open_until, s.bookings_open_until) into v_until';
    if position(a in n) = 0 then raise exception 'v86: submit_overnight_inquiry anchor not found'; end if;
    n := replace(n, a, $b$  -- v86: weekend and holiday nights in the closure period can't be requested either
  if stay_closed_message(v_in, v_out) is not null then
    raise exception '%', stay_closed_message(v_in, v_out) using errcode = 'P0001';
  end if;
$b$ || a);
    execute n;
  end if;
end $mig$;
