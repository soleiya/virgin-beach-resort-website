-- ============================================================================
-- booking-v30 — bring the Day Trip Calendar sheet into the website
--
--   Staff dashboard → Day Trips → Calendar → "Import from Sheet": pick the
--   2026 Day Trip Calendar .xlsx (File → Download → Microsoft Excel). The
--   page reads every month tab in the browser and sends the rows here:
--
--     daytrip_sheet_sync(rows, year, apply => false)  → preview only
--     daytrip_sheet_sync(rows, year, apply => true)   → make the changes
--
--   Each sheet row is matched to the booking it was imported as before
--   (same date + same guest name, in sheet order):
--     * new rows on the sheet          → added (source "sheet_import")
--     * rows whose numbers changed     → updated (pax, cabanas, total,
--                                        booker, remarks, package)
--     * rows no longer on the sheet    → set to Cancelled, with a note
--                                        (not deleted — reversible)
--     * a sheet row for a guest who already booked on the website / with
--       staff that day                 → skipped (no duplicate)
--   Assigned cabana numbers, payments, emails and anything entered on the
--   website stay as they are. No guest is emailed and the activity log isn't
--   flooded (email / log triggers are paused while it runs).
--   Staff (signed in) can run it from the dashboard; the website can't.
--
-- Contains no guest data. Run AFTER booking-v29. Re-runnable.
-- ============================================================================

alter table booking_requests add column if not exists legacy_source_row text;
alter table booking_requests add column if not exists sheet_row int;

create or replace function daytrip_name_key(p text) returns text
language sql immutable as $$
  select lower(regexp_replace(coalesce(p, ''), '[^[:alnum:]]+', '', 'g'));
$$;

create or replace function daytrip_sheet_sync(p_rows jsonb, p_year int, p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_prefix text := format('[Imported from %s Day Trip Calendar]', p_year);
  v_from date := make_date(p_year, 1, 1);
  v_to date := make_date(p_year + 1, 1, 1);
  v_months int[];
  v_stamp text := to_char(now() at time zone 'Asia/Manila', 'FMDD Mon YYYY');
  v_n int;
  x record;
  v_out jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No rows came through from the sheet.' using errcode = 'P0001';
  end if;
  if p_year < 2024 or p_year > 2030 then raise exception 'Unexpected year %', p_year using errcode = 'P0001'; end if;

  drop table if exists _sx;
  create temp table _sx on commit drop as
  select r.*,
         coalesce(nullif(trim(r.name), ''), '(no name on sheet)') as gname,
         daytrip_name_key(coalesce(nullif(trim(r.name), ''), '(no name on sheet)')) as nkey
    from jsonb_to_recordset(p_rows) as r(
      sheet text, row int, date date, booker text, name text, phone text, stay_type text,
      adults int, seniors int, kids int, kids05 int, pets int, dining int, lounge int,
      others numeric, total numeric, remarks text, notes text, exclusive boolean);

  if exists (select 1 from _sx where date is null or date < v_from or date >= v_to) then
    raise exception 'Some rows aren''t dated in % — is this the % sheet?', p_year, p_year using errcode = 'P0001';
  end if;
  if exists (select 1 from _sx where coalesce(stay_type, '') not in ('day_trip', 'half_day', 'flash_sale', 'all_inclusive_family', 'all_inclusive_barkada')) then
    raise exception 'Unknown package on some rows.' using errcode = 'P0001';
  end if;
  -- months the file covers (a month tab that's missing isn't treated as "everything removed")
  select array_agg(distinct extract(month from date)::int) into v_months from _sx;

  alter table _sx add column nth int;
  update _sx s set nth = q.n from (
    select ctid as c, row_number() over (partition by date, nkey order by sheet, row) as n from _sx
  ) q where q.c = s.ctid;

  -- the sheet's own bookings already on the website
  drop table if exists _ex;
  create temp table _ex on commit drop as
  select b.id, b.check_in, daytrip_name_key(b.guest_name) as nkey, b.status::text as status, b.staff_notes,
         row_number() over (partition by b.check_in, daytrip_name_key(b.guest_name)
                            order by (b.status::text in ('declined', 'expired')), coalesce(b.sheet_row, 2147483647), b.created_at,
                                     length(coalesce(b.legacy_source_row, '')), b.legacy_source_row, b.id)::int as nth
    from booking_requests b
   where b.source = 'sheet_import' and coalesce(b.stay_type, '') <> 'overnight'
     and b.check_in >= v_from and b.check_in < v_to;

  -- guests already booked that day on the website / by staff (not from the sheet)
  drop table if exists _web;
  create temp table _web on commit drop as
  select distinct b.check_in, daytrip_name_key(b.guest_name) as nkey
    from booking_requests b
   where coalesce(b.source, '') <> 'sheet_import' and coalesce(b.stay_type, '') <> 'overnight'
     and b.status::text not in ('declined', 'expired')
     and b.check_in >= v_from and b.check_in < v_to;

  -- what each sheet row should look like as a booking
  drop table if exists _m;
  create temp table _m on commit drop as
  select s.*, e.id as booking_id,
         case when e.id is not null then 'match' when w.nkey is not null then 'skip' else 'insert' end as action,
         case
           when e.id is not null and e.status in ('declined', 'expired') and coalesce(e.staff_notes, '') not like '%[Removed from the sheet%' then e.status
           when s.date < v_today then 'completed'
           when coalesce(s.remarks, '') ~* '\m(hold|on hold|unpaid|tentative|not yet paid)\M' then 'pending'
           else 'confirmed'
         end as new_status,
         trim(v_prefix || ' ' || concat_ws(' · ', nullif(trim(coalesce(s.remarks, '')), ''), nullif(trim(coalesce(s.notes, '')), ''))) as new_notes,
         case s.stay_type
           when 'half_day' then 'Half-Day Trip' when 'flash_sale' then 'Flash Sale Day Trip'
           when 'all_inclusive_family' then 'All Inclusive — Family Package'
           when 'all_inclusive_barkada' then 'All Inclusive — Barkada Package'
           else case when s.exclusive then 'Exclusive booking' else 'Day Trip (Full Day)' end
         end as new_label,
         'sheet:' || p_year || ':' || s.sheet || ':' || s.row as new_ref
    from _sx s
    left join _ex e on e.check_in = s.date and e.nkey = s.nkey and e.nth = s.nth
    left join _web w on w.check_in = s.date and w.nkey = s.nkey;

  -- matched rows: which fields change
  alter table _m add column changed text[];
  update _m m set changed = array_remove(array[
      case when b.guest_name is distinct from m.gname then 'name' end,
      case when coalesce(b.booked_by, '') is distinct from coalesce(nullif(trim(m.booker), ''), '') then 'booker' end,
      case when b.stay_type is distinct from m.stay_type then 'package' end,
      case when coalesce(b.adults, 0) <> coalesce(m.adults, 0) or coalesce(b.senior_count, 0) <> coalesce(m.seniors, 0)
             or coalesce(b.children_6_12, 0) <> coalesce(m.kids, 0) or coalesce(b.children_0_5, 0) <> coalesce(m.kids05, 0)
             or coalesce(b.pet_count, 0) <> coalesce(m.pets, 0) then 'guests' end,
      case when coalesce(b.dining_cabanas, 0) <> coalesce(m.dining, 0) or coalesce(b.lounge_cabanas, 0) <> coalesce(m.lounge, 0) then 'cabanas' end,
      case when coalesce(b.total_amount, -1) <> coalesce(m.total, -1) or coalesce(b.add_on_total, 0) <> coalesce(m.others, 0) then 'total' end,
      case when coalesce(b.staff_notes, '') is distinct from m.new_notes then 'remarks' end,
      case when b.status::text is distinct from m.new_status then 'status' end,
      case when b.guest_phone is null and nullif(m.phone, '') is not null then 'phone' end
    ], null)
    from booking_requests b where b.id = m.booking_id;

  -- previously imported rows that aren't on the sheet any more (only in months the file has)
  drop table if exists _gone;
  create temp table _gone on commit drop as
  select e.id, e.check_in from _ex e
   where not exists (select 1 from _m m where m.booking_id = e.id)
     and e.status not in ('declined', 'expired')
     and extract(month from e.check_in)::int = any(v_months);

  if p_apply then
    -- pause guest emails, the activity log, Cloudbeds status pushes and the
    -- "name / booked-by can't change" lock for this bulk change (the sheet is
    -- the source here); they're switched back on below, and if anything fails
    -- the whole call rolls back with them still on
    for x in
      select t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'booking_requests'::regclass and not t.tgisinternal
         and (p.proname ilike '%email%' or p.proname ilike '%log%' or p.proname ilike '%notify%' or p.proname ilike '%audit%'
              or p.proname in ('lock_booking_identity', 'cb_after_status_change'))
    loop
      execute format('alter table booking_requests disable trigger %I', x.tgname);
    end loop;

    insert into booking_requests (
      status, source, stay_type, stay_type_label, guest_name, guest_phone, check_in, booked_by,
      adults, senior_count, children_6_12, children_0_5, pet_count, dining_cabanas, lounge_cabanas,
      add_on_total, total_amount, staff_notes, legacy_source_row, sheet_row,
      email_guest, marketing_opt_in, discount_amount)
    select m.new_status::booking_status, 'sheet_import', m.stay_type, m.new_label, m.gname, nullif(m.phone, ''), m.date,
           nullif(trim(m.booker), ''), coalesce(m.adults, 0), least(coalesce(m.seniors, 0), coalesce(m.adults, 0)),
           coalesce(m.kids, 0), coalesce(m.kids05, 0), coalesce(m.pets, 0),
           least(coalesce(m.dining, 0), 60), least(coalesce(m.lounge, 0), 20),
           nullif(m.others, 0), m.total, m.new_notes, m.new_ref, m.row, false, false, 0
      from _m m where m.action = 'insert'
     order by m.date, m.sheet, m.row;

    update booking_requests b set
      guest_name = m.gname,
      guest_phone = coalesce(b.guest_phone, nullif(m.phone, '')),
      booked_by = nullif(trim(m.booker), ''),
      stay_type = m.stay_type, stay_type_label = m.new_label,
      adults = coalesce(m.adults, 0), senior_count = least(coalesce(m.seniors, 0), coalesce(m.adults, 0)),
      children_6_12 = coalesce(m.kids, 0), children_0_5 = coalesce(m.kids05, 0), pet_count = coalesce(m.pets, 0),
      dining_cabanas = least(coalesce(m.dining, 0), 60), lounge_cabanas = least(coalesce(m.lounge, 0), 20),
      add_on_total = nullif(m.others, 0), total_amount = m.total,
      staff_notes = m.new_notes, status = m.new_status::booking_status,
      legacy_source_row = m.new_ref, sheet_row = m.row
      from _m m
     where m.booking_id = b.id and m.action = 'match' and cardinality(m.changed) > 0;
    -- keep the sheet order even when nothing else changed
    update booking_requests b set sheet_row = m.row, legacy_source_row = m.new_ref
      from _m m where m.booking_id = b.id and m.action = 'match' and cardinality(m.changed) = 0
       and (b.sheet_row is distinct from m.row or b.legacy_source_row is distinct from m.new_ref);

    update booking_requests b set
      status = 'declined',
      staff_notes = trim(coalesce(b.staff_notes, '') || ' · [Removed from the sheet ' || v_stamp || ']')
      from _gone g where g.id = b.id;

    for x in
      select t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'booking_requests'::regclass and not t.tgisinternal
         and (p.proname ilike '%email%' or p.proname ilike '%log%' or p.proname ilike '%notify%' or p.proname ilike '%audit%'
              or p.proname in ('lock_booking_identity', 'cb_after_status_change'))
    loop
      execute format('alter table booking_requests enable trigger %I', x.tgname);
    end loop;
  end if;

  select jsonb_build_object(
    'applied', p_apply,
    'year', p_year,
    'rows', (select count(*) from _sx),
    'insert', (select count(*) from _m where action = 'insert'),
    'update', (select count(*) from _m where action = 'match' and cardinality(changed) > 0),
    'same', (select count(*) from _m where action = 'match' and cardinality(changed) = 0),
    'skip', (select count(*) from _m where action = 'skip'),
    'removed', (select count(*) from _gone),
    'details', jsonb_build_object(
      'insert', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'name', gname, 'booker', booker) order by date, sheet, row)
                            from (select * from _m where action = 'insert' order by date, sheet, row limit 400) q), '[]'),
      'update', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'name', gname, 'fields', changed) order by date, sheet, row)
                            from (select * from _m where action = 'match' and cardinality(changed) > 0 order by date, sheet, row limit 400) q), '[]'),
      'skip', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'name', gname) order by date, sheet, row)
                          from _m where action = 'skip'), '[]'),
      'removed', coalesce((select jsonb_agg(jsonb_build_object('date', b.check_in, 'name', b.guest_name, 'booker', b.booked_by) order by b.check_in)
                             from _gone g join booking_requests b on b.id = g.id), '[]')
    )
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function daytrip_sheet_sync(jsonb, int, boolean) from public, anon;
grant execute on function daytrip_sheet_sync(jsonb, int, boolean) to authenticated;

select 'v30 applied' as status,
       (select count(*) from booking_requests where source = 'sheet_import') as sheet_bookings_now;
