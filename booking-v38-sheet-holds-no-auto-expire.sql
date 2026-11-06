-- ============================================================================
-- booking-v38 — Day Trip sheet bookings are never auto-expired
--
-- The website cancels its own unpaid bookings 24 hours after they're made.
-- Bookings imported from the Day Trip sheet are holds the team manages on
-- the sheet ("Hold until 11/6", etc.), so:
--   1. process_booking_deadlines() now skips them (source = 'sheet_import').
--   2. The sheet import no longer keeps an "expired" status: it takes the
--      status from the sheet again (a guest marked paid there is confirmed).
--      Bookings staff cancelled ("declined") stay cancelled, as before.
--   3. Re-run Import from Sheet afterwards to bring back any sheet booking
--      that was auto-expired (e.g. a hold that was paid later).
-- Includes the v37 row-shift fix. Run in Supabase → SQL Editor. Re-runnable.
-- ============================================================================

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
  if exists (select 1 from _sx where coalesce(stay_type, '') not in ('day_trip', 'half_day', 'flash_sale', 'all_inclusive_family', 'all_inclusive_barkada', 'other')) then
    raise exception 'Unknown package on some rows.' using errcode = 'P0001';
  end if;
  -- months the file covers (a month tab that's missing isn't treated as "everything removed")
  select array_agg(distinct extract(month from date)::int) into v_months from _sx;

  -- the sheet's own bookings already on the website
  drop table if exists _ex;
  create temp table _ex on commit drop as
  select b.id, b.check_in, daytrip_name_key(b.guest_name) as nkey, b.status::text as status, b.staff_notes,
         b.total_amount, coalesce(b.adults, 0) as adults, b.sheet_row, b.created_at, b.legacy_source_row
    from booking_requests b
   where b.source = 'sheet_import' and coalesce(b.stay_type, '') <> 'overnight'
     and b.check_in >= v_from and b.check_in < v_to;

  -- pair sheet rows with those bookings: first the ones whose total and
  -- adults are unchanged (so two rows for the same guest on the same day
  -- never swap), then whatever is left, in sheet order
  drop table if exists _pair;
  create temp table _pair (sheet text, row int, booking_id uuid) on commit drop;
  insert into _pair
  select s.sheet, s.row, e.id from
    (select sheet, row, date, nkey, total, coalesce(adults, 0) as adults,
            row_number() over (partition by date, nkey, total, coalesce(adults, 0) order by sheet, row) as k from _sx) s
    join (select id, check_in, nkey, total_amount, adults,
                 row_number() over (partition by check_in, nkey, total_amount, adults
                                    order by (status in ('declined', 'expired')), coalesce(sheet_row, 2147483647), created_at,
                                             length(coalesce(legacy_source_row, '')), legacy_source_row, id) as k from _ex) e
      on e.check_in = s.date and e.nkey = s.nkey and e.total_amount is not distinct from s.total and e.adults = s.adults and e.k = s.k;
  insert into _pair
  select s.sheet, s.row, e.id from
    (select sx2.sheet, sx2.row, sx2.date, sx2.nkey, row_number() over (partition by sx2.date, sx2.nkey order by sx2.sheet, sx2.row) as k
       from _sx sx2 where not exists (select 1 from _pair p where p.sheet = sx2.sheet and p.row = sx2.row)) s
    join (select ex2.id, ex2.check_in, ex2.nkey,
                 row_number() over (partition by ex2.check_in, ex2.nkey
                                    order by (ex2.status in ('declined', 'expired')), coalesce(ex2.sheet_row, 2147483647), ex2.created_at,
                                             length(coalesce(ex2.legacy_source_row, '')), ex2.legacy_source_row, ex2.id) as k
            from _ex ex2 where not exists (select 1 from _pair p where p.booking_id = ex2.id)) e
      on e.check_in = s.date and e.nkey = s.nkey and e.k = s.k;

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
           when e.id is not null and e.status = 'declined' and coalesce(e.staff_notes, '') not like '%[Removed from the sheet%' then e.status
           when s.date < v_today then 'completed'
           when coalesce(s.remarks, '') ~* '\m(hold|on hold|unpaid|tentative|not yet paid)\M' then 'pending'
           else 'confirmed'
         end as new_status,
         trim(v_prefix || ' ' || concat_ws(' · ', nullif(trim(coalesce(s.remarks, '')), ''), nullif(trim(coalesce(s.notes, '')), ''))) as new_notes,
         case when s.exclusive then 'Exclusive booking' else case s.stay_type
           when 'half_day' then 'Half-Day Trip' when 'flash_sale' then 'Flash Sale Day Trip'
           when 'all_inclusive_family' then 'All-Inclusive Family Day Trip'
           when 'all_inclusive_barkada' then 'All-Inclusive Barkada Day Trip'
           when 'other' then 'Other / Add-on'
           else 'Day Trip (Full Day)' end
         end as new_label,
         'sheet:' || p_year || ':' || s.sheet || ':' || s.row as new_ref
    from _sx s
    left join _pair pr on pr.sheet = s.sheet and pr.row = s.row
    left join _ex e on e.id = pr.booking_id
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

    -- v37: rows added in the middle of a month shift the sheet's row numbers,
    -- so a sheet-row id this run hands out can still be held by another
    -- booking until that booking is moved to its own new row below. Park
    -- those ids first (each booking gets a unique placeholder), so the
    -- inserts and moves never clash on booking_requests_legacy_source_row_uidx.
    update booking_requests b set legacy_source_row = 'moved:' || b.id
     where b.legacy_source_row in (select new_ref from _m)
       and not exists (select 1 from _m m where m.booking_id = b.id and m.new_ref = b.legacy_source_row);

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
      expired_at = case when m.new_status = 'expired' then b.expired_at end,
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

-- 1. the 24-hour expiry skips sheet bookings ------------------------------
create or replace function public.process_booking_deadlines() returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_expired int := 0;
  v_due int := 0;
  v_overdue int := 0;
  v_secret text;
  x record;
begin
  with due as (
    select b.id
      from booking_requests b, lateral booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in) d
     where b.status in ('pending', 'pending_payment')
       and not b.cb_owned
       -- v38: holds entered on the Day Trip sheet are managed by the team there
       and coalesce(b.source, '') <> 'sheet_import'
       and not exists (select 1 from booking_payments p where p.booking_id = b.id and p.status in ('pending', 'verified'))
       and d.final_at is not null
       and now() >= d.final_at
  )
  update booking_requests b
     set status = 'expired', expired_at = now()
    from due
   where b.id = due.id;
  get diagnostics v_expired = row_count;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is not null then
    -- 3 days before the balance date
    for x in
      select b.id from booking_requests b
       where b.status = 'confirmed' and not b.cb_owned and b.amount_paid > 0
         and b.total_amount is not null and b.amount_paid < b.total_amount - 0.5
         and b.check_in > manila_today()
         and manila_today() >= balance_due_date(b.check_in) - 3
         and manila_today() <= balance_due_date(b.check_in)
         and b.balance_reminder_at is null
       limit 50
    loop
      update booking_requests set balance_reminder_at = now() where id = x.id;
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'BALANCE_DUE', 'record', jsonb_build_object('id', x.id)),
        timeout_milliseconds := 30000);
      v_due := v_due + 1;
    end loop;
    -- the day after the balance date: guest reminder + staff alert
    for x in
      select b.id from booking_requests b
       where b.status = 'confirmed' and not b.cb_owned and b.amount_paid > 0
         and b.total_amount is not null and b.amount_paid < b.total_amount - 0.5
         and b.check_in >= manila_today()
         and manila_today() > balance_due_date(b.check_in)
         and b.balance_overdue_at is null
       limit 50
    loop
      update booking_requests set balance_overdue_at = now() where id = x.id;
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'BALANCE_OVERDUE', 'record', jsonb_build_object('id', x.id)),
        timeout_milliseconds := 30000);
      v_overdue := v_overdue + 1;
    end loop;
  end if;
  return jsonb_build_object('expired', v_expired, 'balance_reminders', v_due, 'balance_overdue', v_overdue);
end;
$function$;


select 'v38 applied' as status,
       (select count(*) from booking_requests where source = 'sheet_import' and status = 'expired'
          and check_in >= (now() at time zone 'Asia/Manila')::date) as sheet_bookings_expired_upcoming;
