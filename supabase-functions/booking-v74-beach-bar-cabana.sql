-- =============================================================================
-- booking-v74: the Beach Bar lounge cabana — staff only.
--
-- Front office asked to reserve the Beach Bar area as a lounge cabana for
-- walk-in day trips when the 6 regular lounge cabanas are full.
-- * cabanas.staff_only: cabanas only staff can book. The Beach Bar is added
--   as one staff-only lounge cabana, same price as a regular lounge cabana
--   (₱2,000), capacity 4. It isn't on the cabana map artwork.
-- * The website's daily stock stays as set in booking_settings (6 lounges):
--   daytrip_cabanas_used() no longer counts a lounge that's on the Beach Bar,
--   so using it doesn't take a regular lounge away from online guests.
-- * A guard stops anyone but signed-in staff from putting a booking on a
--   staff-only cabana.
-- * The staff dashboard adds staff-only cabanas to the day's stock
--   (Lounge … / 7) and lists the Beach Bar under "Assign".
-- Re-runnable.
-- =============================================================================

alter table cabanas add column if not exists staff_only boolean not null default false;

alter table cabanas drop constraint if exists cabanas_section_check;
alter table cabanas add constraint cabanas_section_check check (section in ('A', 'B', 'Beach Bar'));

insert into cabanas (section, row_index, col_index, cabana_type, number, label, capacity, price, staff_only)
select 'Beach Bar', 9, 0, 'lounge_cabana', 1, 'Beach Bar — Lounge Cabana (staff only)', 4, 2000, true
where not exists (select 1 from cabanas where section = 'Beach Bar' and cabana_type = 'lounge_cabana' and number = 1);

-- lounges on a staff-only cabana don't use up the website's stock
create or replace function daytrip_cabanas_used(p_date date, p_exclude uuid default null)
returns table(dining integer, lounge integer)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(coalesce(b.dining_cabanas, 0) - so.dining, 0)), 0)::int,
         coalesce(sum(greatest(coalesce(b.lounge_cabanas, 0) - so.lounge, 0)), 0)::int
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

-- only signed-in staff can put a booking on a staff-only cabana
create or replace function guard_staff_only_cabana() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from cabanas c where c.id = new.cabana_id and c.staff_only)
     and coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'That cabana can only be booked by the resort staff.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_staff_only_cabana on booking_cabanas;
create trigger guard_staff_only_cabana before insert or update of cabana_id on booking_cabanas
  for each row execute function guard_staff_only_cabana();

select 'v74 applied' as status, (select count(*) from cabanas where staff_only) as staff_only_cabanas,
  (select lounge from daytrip_cabanas_used('2026-11-17')) as lounges_used_today_online;
