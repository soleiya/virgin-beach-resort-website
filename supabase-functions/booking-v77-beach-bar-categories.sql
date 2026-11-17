-- =============================================================================
-- booking-v77: 4 day-trip cabana categories — Lounge, Dining, Beach Bar Lounge,
-- Beach Bar Dining.
--
-- * booking_requests.bb_dining_cabanas / bb_lounge_cabanas: how many of the
--   booking's dining / lounge cabanas are at the Beach Bar (staff only, same
--   price). dining_cabanas / lounge_cabanas stay the TOTALS, so pricing,
--   emails, reports and the sheet sync keep working unchanged.
-- * Existing bookings: filled in from the Beach Bar cabanas already assigned.
-- * Only signed-in staff can put a booking on the Beach Bar (same rule as v74).
-- * The website's daily stock never counts the Beach Bar: daytrip_cabanas_used()
--   leaves out Beach Bar cabanas (by count or by assigned number), and
--   daytrip_availability() ignores blocks on Beach Bar cabanas.
-- Re-runnable.
-- =============================================================================

alter table booking_requests add column if not exists bb_dining_cabanas integer not null default 0;
alter table booking_requests add column if not exists bb_lounge_cabanas integer not null default 0;
alter table booking_requests drop constraint if exists booking_requests_bb_cabanas_check;
alter table booking_requests add constraint booking_requests_bb_cabanas_check
  check (bb_dining_cabanas between 0 and 50 and bb_lounge_cabanas between 0 and 50);

-- bookings already on a Beach Bar cabana (v74–v76)
update booking_requests b set
  bb_dining_cabanas = greatest(b.bb_dining_cabanas, x.dining),
  bb_lounge_cabanas = greatest(b.bb_lounge_cabanas, x.lounge)
from (
  select bc.booking_id,
         count(*) filter (where c.cabana_type = 'dining_cabana')::int as dining,
         count(*) filter (where c.cabana_type = 'lounge_cabana')::int as lounge
  from booking_cabanas bc join cabanas c on c.id = bc.cabana_id
  where c.staff_only group by bc.booking_id) x
where x.booking_id = b.id
  and (b.bb_dining_cabanas < x.dining or b.bb_lounge_cabanas < x.lounge);

-- only signed-in staff can book the Beach Bar
create or replace function guard_bb_cabanas() returns trigger
language plpgsql set search_path = public as $$
begin
  if (coalesce(new.bb_dining_cabanas, 0) > 0 or coalesce(new.bb_lounge_cabanas, 0) > 0)
     and (tg_op = 'INSERT' or new.bb_dining_cabanas > coalesce(old.bb_dining_cabanas, 0) or new.bb_lounge_cabanas > coalesce(old.bb_lounge_cabanas, 0))
     and coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'Beach Bar cabanas can only be booked by the resort staff.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_bb_cabanas on booking_requests;
create trigger guard_bb_cabanas before insert or update of bb_dining_cabanas, bb_lounge_cabanas on booking_requests
  for each row execute function guard_bb_cabanas();

-- the website's stock: Beach Bar cabanas (by count or by number) don't count
create or replace function daytrip_cabanas_used(p_date date, p_exclude uuid default null)
returns table(dining integer, lounge integer)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(coalesce(b.dining_cabanas, 0)
           - greatest(least(coalesce(b.bb_dining_cabanas, 0), coalesce(b.dining_cabanas, 0)), so.dining), 0)), 0)::int,
         coalesce(sum(greatest(coalesce(b.lounge_cabanas, 0)
           - greatest(least(coalesce(b.bb_lounge_cabanas, 0), coalesce(b.lounge_cabanas, 0)), so.lounge), 0)), 0)::int
  from booking_requests b
  cross join lateral (
    select count(*) filter (where c.cabana_type = 'dining_cabana')::int as dining,
           count(*) filter (where c.cabana_type = 'lounge_cabana')::int as lounge
    from booking_cabanas bc join cabanas c on c.id = bc.cabana_id
    where bc.booking_id = b.id and c.staff_only) so
  where b.check_in = p_date
    and b.stay_type <> 'overnight'
    and b.status::text not in ('declined', 'expired')
    and (p_exclude is null or b.id <> p_exclude);
$$;

-- blocking a Beach Bar cabana doesn't take a cabana off the website
create or replace function daytrip_availability(p_from date, p_to date)
returns table(day date, dining_total integer, dining_left integer, lounge_total integer, lounge_left integer)
language sql stable security definer set search_path = public as $$
  with s as (select coalesce(dining_cabanas_per_day, 43) as d, coalesce(lounge_cabanas_per_day, 6) as l from booking_settings where id = 1),
  days as (select g::date as day from generate_series(p_from, least(p_to, p_from + 92), interval '1 day') g)
  select days.day,
         (select d from s), greatest((select d from s) - coalesce(bl.dining, 0) - u.dining, 0),
         (select l from s), greatest((select l from s) - coalesce(bl.lounge, 0) - u.lounge, 0)
  from days
  cross join lateral daytrip_cabanas_used(days.day) u
  left join lateral (
    select count(*) filter (where c.cabana_type = 'dining_cabana')::int as dining,
           count(*) filter (where c.cabana_type = 'lounge_cabana')::int as lounge
    from cabana_blocks k join cabanas c on c.id = k.cabana_id
    where days.day between k.start_date and k.end_date and not c.staff_only
  ) bl on true
  order by days.day;
$$;

select 'v77 applied' as status,
  (select count(*) from booking_requests where bb_dining_cabanas + bb_lounge_cabanas > 0) as bookings_on_beach_bar,
  (select lounge from daytrip_cabanas_used(((now() at time zone 'Asia/Manila')::date))) as lounges_used_today_online;
