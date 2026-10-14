-- ============================================================================
-- One-time data load (Oct 2026): replace every booking with the real ones.
--
-- Everything entered on the site so far (website + staff) was test data. This
-- script:
--   1. pauses the email / activity-log triggers (no guest gets emailed,
--      the log isn't flooded with 16,000 "created" lines),
--   2. removes ALL bookings, villa holds/blocks, cabana links and their email
--      and activity-log rows (all test data),
--   3. loads the cleaned file — the 2026 Day Trip Calendar (live .xlsx) and
--      every Cloudbeds reservation since Dec 2021 — from the staging table
--      `vbr_import` (Table Editor → New table → Import data from CSV:
--      vbr_import.csv),
--   4. puts each non-cancelled stay on its casita(s) in the villa calendar,
--   5. turns the triggers back on and drops the staging table.
--
-- Contains no guest data itself — that lives only in the CSV / staging table.
-- Runs in one transaction: if anything fails, nothing changes.
-- ============================================================================
begin;

do $$ begin
  if to_regclass('public.vbr_import') is null then
    raise exception 'First import vbr_import.csv into a new table named vbr_import (Table Editor → New table → Import data from CSV).';
  end if;
end $$;

-- 1. pause email + logging triggers ------------------------------------------
create temp table _paused on commit drop as
  select c.relname as tbl, t.tgname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal
    and c.relname in ('booking_requests', 'booking_villas', 'booking_cabanas')
    and (p.proname ilike '%email%' or p.proname ilike '%log%' or p.proname ilike '%notify%');
do $$ declare x record; begin
  for x in select * from _paused loop execute format('alter table %I disable trigger %I', x.tbl, x.tgname); end loop;
end $$;

-- 2. remove all test data ------------------------------------------------------
-- (cascades to booking_villas, booking_cabanas, booking_email_log and any
-- other table that references a booking)
truncate table booking_requests cascade;
delete from booking_villas;          -- staff blocks (no booking) too

-- 3. load ------------------------------------------------------------------------
create temp table _src on commit drop as
select
  i.kind::text as kind, i.ikey::text as ikey, i.status::text as status, i.source::text as source,
  i.stay_type::text as stay_type, i.stay_type_label::text as stay_type_label,
  i.guest_name::text as guest_name, nullif(i.country::text, '') as country,
  nullif(i.check_in::text, '')::date as check_in, nullif(i.check_out::text, '')::date as check_out,
  coalesce(i.rooms::text, '') as rooms,
  coalesce(nullif(i.adults::text, '')::numeric, 0)::int as adults,
  coalesce(nullif(i.children_6_12::text, '')::numeric, 0)::int as children_6_12,
  coalesce(nullif(i.children_0_5::text, '')::numeric, 0)::int as children_0_5,
  coalesce(nullif(i.senior_count::text, '')::numeric, 0)::int as senior_count,
  coalesce(nullif(i.pet_count::text, '')::numeric, 0)::int as pet_count,
  coalesce(nullif(i.dining::text, '')::numeric, 0)::int as dining,
  coalesce(nullif(i.lounge::text, '')::numeric, 0)::int as lounge,
  nullif(i.total::text, '')::numeric as total,
  nullif(i.booked_by::text, '') as booked_by,
  nullif(i.created_at::text, '')::timestamptz as created_at,
  nullif(i.staff_notes::text, '') as staff_notes
from vbr_import i;

insert into booking_requests (
  status, source, stay_type, stay_type_label, guest_name, country, check_in, check_out,
  adults, children_6_12, children_0_5, senior_count, pet_count,
  legacy_dining_cabanas, legacy_lounge_cabanas, total_amount, booked_by, created_at,
  staff_notes, legacy_source_row, email_guest, marketing_opt_in, discount_amount, extra_beds, primary_is_senior
)
select
  s.status::booking_status, s.source, s.stay_type, s.stay_type_label, s.guest_name, s.country, s.check_in, s.check_out,
  s.adults, s.children_6_12, s.children_0_5, least(s.senior_count, s.adults), s.pet_count,
  s.dining, s.lounge, s.total, s.booked_by, coalesce(s.created_at, now()),
  s.staff_notes, s.ikey, false, false, 0, 0, false
from _src s;

-- 4. villa holds (non-cancelled stays only) ----------------------------------------
create temp table _clash (ikey text, room text, msg text) on commit drop;
do $$
declare x record; v uuid;
begin
  for x in
    select b.id as booking_id, s.ikey, split_part(r, '@', 1) as label,
           nullif(split_part(r, '@', 2), '')::date as ci, nullif(split_part(r, '@', 3), '')::date as co
    from _src s
    join booking_requests b on b.legacy_source_row = s.ikey
    cross join lateral unnest(string_to_array(s.rooms, '|')) as r
    where s.kind = 'cloudbeds' and s.status <> 'declined' and s.rooms <> ''
    order by s.check_in, s.ikey
  loop
    select id into v from villas where unit_label = x.label;
    if v is null then
      insert into _clash values (x.ikey, x.label, 'unknown casita'); continue;
    end if;
    begin
      insert into booking_villas (booking_id, villa_id, check_in, check_out) values (x.booking_id, v, x.ci, x.co);
    exception when exclusion_violation or unique_violation then
      insert into _clash values (x.ikey, x.label, 'already taken ' || x.ci || '→' || x.co);
    end;
  end loop;
end $$;

update booking_requests b
   set staff_notes = coalesce(b.staff_notes, '') || ' · ⚠ Villa not assigned on import (' || c.msgs || ') — assign one in the dashboard.'
  from (select ikey, string_agg(room || ': ' || msg, '; ') as msgs from _clash group by ikey) c
 where b.legacy_source_row = c.ikey;

-- 5. triggers back on, staging table gone ------------------------------------------
do $$ declare x record; begin
  for x in select * from _paused loop execute format('alter table %I enable trigger %I', x.tbl, x.tgname); end loop;
end $$;
drop table vbr_import;

commit;

-- Summary
select
  (select count(*) from booking_requests where source = 'sheet_import') as day_trips_from_sheet,
  (select count(*) from booking_requests where stay_type = 'overnight') as villa_bookings_from_cloudbeds,
  (select count(*) from booking_villas) as villa_holds,
  (select count(*) from booking_requests where staff_notes like '%Villa not assigned on import%') as stays_needing_a_villa,
  (select count(*) from booking_requests where stay_type = 'overnight' and status in ('confirmed', 'pending') and check_out >= current_date) as upcoming_stays;
