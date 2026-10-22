-- ============================================================================
-- booking-v29 — day-trip cabanas by count (no more map)
--
--   * Guests book HOW MANY Dining / Lounge cabanas they want; the website
--     checks how many of each are still free that day:
--       stock per day (booking_settings: 43 dining, 6 lounge to start)
--       − cabanas staff have blocked that day
--       − cabanas already booked that day (each booking's counts).
--   * Staff assign the actual cabana numbers later (optional, any time) —
--     booking_cabanas now means "assigned cabanas". A cabana can't be given
--     to two groups on the same day.
--   * The Google Sheet mirror uses the counts, with assigned numbers in Remarks.
-- Run AFTER booking-v28. Re-runnable.
-- ============================================================================

-- 1. daily stock (staff change it in the dashboard → Booking Window) -----------
alter table booking_settings add column if not exists dining_cabanas_per_day int not null default 43;
alter table booking_settings add column if not exists lounge_cabanas_per_day int not null default 6;

-- 2. how many cabanas each booking has ---------------------------------------------
alter table booking_requests add column if not exists dining_cabanas int not null default 0;
alter table booking_requests add column if not exists lounge_cabanas int not null default 0;
alter table booking_requests drop constraint if exists booking_requests_cabana_counts_check;
alter table booking_requests add constraint booking_requests_cabana_counts_check
  check (dining_cabanas between 0 and 60 and lounge_cabanas between 0 and 20);

-- backfill: assigned cabanas, or the 2026-sheet counts for imported rows
-- (activity-log / email triggers paused for this one-off fill; the whole
--  script runs as one transaction, so they're back on even if it fails)
alter table booking_requests disable trigger user;
do $$
declare has_legacy boolean := exists (select 1 from information_schema.columns
                                       where table_name = 'booking_requests' and column_name = 'legacy_dining_cabanas');
begin
  execute format($f$
    update booking_requests b set
      dining_cabanas = greatest(b.dining_cabanas, coalesce(c.dining, 0) %1$s),
      lounge_cabanas = greatest(b.lounge_cabanas, coalesce(c.lounge, 0) %2$s)
    from (select b2.id,
                 (select count(*) from booking_cabanas bc join cabanas cb on cb.id = bc.cabana_id
                   where bc.booking_id = b2.id and cb.cabana_type = 'dining_cabana') as dining,
                 (select count(*) from booking_cabanas bc join cabanas cb on cb.id = bc.cabana_id
                   where bc.booking_id = b2.id and cb.cabana_type = 'lounge_cabana') as lounge
            from booking_requests b2 where b2.stay_type <> 'overnight') c
   where c.id = b.id
     and (b.dining_cabanas < greatest(coalesce(c.dining, 0) %1$s) or b.lounge_cabanas < greatest(coalesce(c.lounge, 0) %2$s))
  $f$,
    case when has_legacy then ', coalesce(b.legacy_dining_cabanas, 0)' else '' end,
    case when has_legacy then ', coalesce(b.legacy_lounge_cabanas, 0)' else '' end);
end $$;
alter table booking_requests enable trigger user;

-- 3. availability ----------------------------------------------------------------
-- cabanas in use on a day (bookings that aren't cancelled / expired)
create or replace function daytrip_cabanas_used(p_date date, p_exclude uuid default null)
returns table(dining int, lounge int)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(b.dining_cabanas), 0)::int, coalesce(sum(b.lounge_cabanas), 0)::int
    from booking_requests b
   where b.check_in = p_date and b.stay_type <> 'overnight'
     and b.status::text not in ('declined', 'expired')
     and (p_exclude is null or b.id <> p_exclude);
$$;
revoke all on function daytrip_cabanas_used(date, uuid) from public, anon;
grant execute on function daytrip_cabanas_used(date, uuid) to authenticated;

-- Public: how many of each are free per day (no names, no numbers)
create or replace function daytrip_availability(p_from date, p_to date)
returns table(day date, dining_total int, dining_left int, lounge_total int, lounge_left int)
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
       where days.day between k.start_date and k.end_date
    ) bl on true
   order by days.day;
$$;
revoke all on function daytrip_availability(date, date) from public;
grant execute on function daytrip_availability(date, date) to anon, authenticated;

-- 4. website day-trip booking (replaces the v28 version) -------------------------
create or replace function public.submit_daytrip_booking(payload jsonb, cabana_ids uuid[] default null)
returns table(id uuid, order_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(nullif(trim(coalesce(payload->>'discount_code', '')), ''));
  v_date date := nullif(payload->>'check_in', '')::date;
  v_dining int := least(greatest(coalesce(nullif(payload->>'dining_cabanas', '')::int, 0), 0), 60);
  v_lounge int := least(greatest(coalesce(nullif(payload->>'lounge_cabanas', '')::int, 0), 0), 20);
  av record;
  chk jsonb;
  v_id uuid; v_order text;
begin
  if v_date is not null and (v_dining > 0 or v_lounge > 0) then
    -- one booking at a time per day, so two guests can't take the last cabana
    perform pg_advisory_xact_lock(hashtext('vbr-cabanas-' || v_date::text));
    select * into av from daytrip_availability(v_date, v_date);
    if v_dining > coalesce(av.dining_left, 0) then
      raise exception 'Sorry — only % dining cabana% left on that day. Please pick fewer or another date.',
        coalesce(av.dining_left, 0), case when coalesce(av.dining_left, 0) = 1 then ' is' else 's are' end using errcode = 'P0001';
    end if;
    if v_lounge > coalesce(av.lounge_left, 0) then
      raise exception 'Sorry — only % lounge cabana% left on that day. Please pick fewer or another date.',
        coalesce(av.lounge_left, 0), case when coalesce(av.lounge_left, 0) = 1 then ' is' else 's are' end using errcode = 'P0001';
    end if;
  end if;
  if v_code is not null then
    chk := quote_daytrip_code(v_code, v_date,
                              nullif(payload->>'cabana_total', '')::numeric, nullif(payload->>'total_amount', '')::numeric);
    if not coalesce((chk->>'ok')::boolean, false) then
      raise exception '%', chk->>'error' using errcode = 'P0001';
    end if;
    perform set_config('vbr.daytrip_code', chk::text, true);
  end if;
  select s.id, s.order_code into v_id, v_order
    from submit_booking_request(payload - 'discount_code' - 'dining_cabanas' - 'lounge_cabanas', null) s;
  update booking_requests set dining_cabanas = v_dining, lounge_cabanas = v_lounge where booking_requests.id = v_id;
  return query select v_id, v_order;
end;
$$;
revoke all on function public.submit_daytrip_booking(jsonb, uuid[]) from public;
grant execute on function public.submit_daytrip_booking(jsonb, uuid[]) to anon, authenticated;

-- 5. assigned cabanas ----------------------------------------------------------------
-- Guests no longer attach cabanas themselves.
drop policy if exists "Public can attach cabanas to their own new booking" on booking_cabanas;
drop policy if exists "Authenticated staff can update booking cabanas" on booking_cabanas;

-- One group per cabana per day.
create or replace function guard_cabana_one_group() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_date date; v_other text; v_label text;
begin
  select check_in into v_date from booking_requests where id = new.booking_id;
  if v_date is null then return new; end if;
  select coalesce(b.guest_name, 'another group') || coalesce(' (' || b.order_code || ')', '') into v_other
    from booking_cabanas bc join booking_requests b on b.id = bc.booking_id
   where bc.cabana_id = new.cabana_id and bc.booking_id <> new.booking_id
     and b.check_in = v_date and b.status::text not in ('declined', 'expired')
   limit 1;
  if v_other is not null then
    select label into v_label from cabanas where id = new.cabana_id;
    raise exception 'Cabana not available: % is already assigned to % on %', coalesce(v_label, 'that cabana'), v_other,
      to_char(v_date, 'Mon DD, YYYY') using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_cabana_one_group on booking_cabanas;
create trigger trg_guard_cabana_one_group before insert or update of cabana_id, booking_id on booking_cabanas
  for each row execute function guard_cabana_one_group();

-- 6. Google Sheet mirror: counts, plus the assigned numbers in Remarks ----------------
create or replace function daytrip_sheet_rows(p_token text, p_year int) returns jsonb
language plpgsql stable security definer set search_path = public, vault as $$
declare v_ok boolean;
begin
  select exists (select 1 from vault.decrypted_secrets where name = 'sheet_export_token' and decrypted_secret = p_token)
    into v_ok;
  if not coalesce(v_ok, false) then raise exception 'not allowed'; end if;
  return (
    select coalesce(jsonb_agg(r order by r->>'date', r->>'created'), '[]'::jsonb) from (
      select jsonb_build_object(
        'date', b.check_in,
        'created', b.created_at,
        'month', extract(month from b.check_in)::int,
        'day', extract(day from b.check_in)::int,
        'booker', coalesce(b.booked_by, case when b.source = 'website' then 'Website' else b.source end),
        'name', b.guest_name,
        'kind', b.stay_type,
        'adults', greatest(b.adults - coalesce(b.senior_count, 0), 0),
        'kids', coalesce(b.children_6_12, 0),
        'kids05', coalesce(b.children_0_5, 0),
        'seniors', coalesce(b.senior_count, 0),
        'pets', coalesce(b.pet_count, 0),
        'dining', greatest(coalesce(b.dining_cabanas, 0), coalesce(c.dining, 0)),
        'lounge', greatest(coalesce(b.lounge_cabanas, 0), coalesce(c.lounge, 0)),
        'family', case when b.stay_type = 'all_inclusive_family' then 1 else 0 end,
        'barkada', case when b.stay_type = 'all_inclusive_barkada' then 1 else 0 end,
        'others', b.add_on_total,
        'total', b.total_amount,
        'status', b.status,
        'order', b.order_code,
        'remarks', concat_ws(' · ',
           case when b.status in ('pending', 'pending_payment') then 'UNPAID' end,
           c.numbers,
           nullif(regexp_replace(coalesce(b.staff_notes, ''), '^\[Imported from 2026 Day Trip Calendar\]\s*', ''), ''),
           nullif(b.notes, ''),
           case when b.children_0_5 > 0 then b.children_0_5 || ' kid(s) 0-5' end,
           b.order_code)
      ) as r
        from booking_requests b
        left join lateral (
          select count(*) filter (where cb.cabana_type = 'dining_cabana') as dining,
                 count(*) filter (where cb.cabana_type = 'lounge_cabana') as lounge,
                 string_agg(cb.section || '-' || cb.number || case when cb.cabana_type = 'lounge_cabana' then 'L' else '' end, ', '
                            order by cb.section, cb.number) as numbers
            from booking_cabanas bc join cabanas cb on cb.id = bc.cabana_id
           where bc.booking_id = b.id
          having count(*) > 0
        ) c on true
       where b.stay_type <> 'overnight'
         and b.check_in >= make_date(p_year, 1, 1) and b.check_in < make_date(p_year + 1, 1, 1)
         and b.status not in ('declined', 'expired')
    ) x
  );
end;
$$;
revoke all on function daytrip_sheet_rows(text, int) from public;
grant execute on function daytrip_sheet_rows(text, int) to anon, authenticated;

select 'v29 applied' as status,
       (select dining_cabanas_per_day || ' dining / ' || lounge_cabanas_per_day || ' lounge per day' from booking_settings where id = 1) as stock,
       (select count(*) from booking_requests where stay_type <> 'overnight' and (dining_cabanas > 0 or lounge_cabanas > 0)) as day_trips_with_cabanas;
