-- =============================================================================
-- booking-v83 — Cloudbeds Manager's Report on the website (Cloudbeds is the
-- official data; the website only copies it and applies Cloudbeds' formulas).
--
-- Raw Cloudbeds data, kept by cloudbeds-sync (action "manager_sync"):
--   cb_transactions  posted folio transactions (Accounting API), by service date
--   cb_reservations  reservations (status, created / cancelled, stay dates)
--   cb_room_nights   one row per reservation room per night, with Cloudbeds'
--                    nightly room rate (detailedRoomRates, before taxes)
--   cb_room_blocks   Cloudbeds room blocks (blocked_dates / out_of_service /
--                    courtesy_hold)
--
-- cb_manager_nights(from, to)  per-night figures, Cloudbeds definitions
-- cb_manager_report(date)      Day / MTD / YTD, same rows as Cloudbeds
--
-- Cloudbeds definitions (myfrontdesk.cloudbeds.com, Manager's Report and
-- "Occupancy and Financial Reporting Calculations"):
--   Rooms Sold        rooms booked for the stay date; no-shows / cancelled out
--   Capacity          every room, blocked and out-of-service rooms included
--   Occupancy %       rooms sold / capacity
--   Adjusted Occ. %   rooms sold / (capacity − out of service − blocked)
--   Room Revenue      room rate + room revenue + no-show (codes 1000/1100/1200
--                     incl. adjustments + voids), taxes and fees excluded.
--                     Nights not yet through night audit = Cloudbeds' forecast:
--                     the reservation's nightly rate.
--   Other Revenue     items, add-ons, POS items, cancellation fees (codes
--                     2000/3000/4000/5000 incl. A/V), taxes and fees excluded
--   Misc. income      cancellation fees (5000)
--   ADR               room revenue / rooms sold
--   RevPAR            room revenue / capacity
-- Routed copies (codes ending in R) are not counted twice.
-- =============================================================================

create table if not exists public.cb_transactions (
  id                  text primary key,
  code                text not null,
  amount              numeric not null,
  currency            text,
  service_date        date,
  business_date       date,
  txn_at              timestamptz,
  source_kind         text,
  reservation_id      text,
  sub_reservation_id  text,
  relation_kind       text,
  relation_id         text,
  routed_from         text,
  parent_id           text,
  synced_at           timestamptz not null default now()
);
create index if not exists cb_transactions_service_date on public.cb_transactions (service_date);
create index if not exists cb_transactions_code on public.cb_transactions (code);

create table if not exists public.cb_reservations (
  id            text primary key,
  status        text,
  deleted       boolean not null default false,
  created_at    timestamptz,
  cancelled_at  timestamptz,
  check_in      date,
  check_out     date,
  source        text,
  modified_at   timestamptz,
  synced_at     timestamptz not null default now()
);
create index if not exists cb_reservations_created on public.cb_reservations (created_at);

create table if not exists public.cb_room_nights (
  reservation_id      text not null references public.cb_reservations (id) on delete cascade,
  sub_reservation_id  text not null,
  night               date not null,
  room_id             text,
  room_type_id        text,
  room_check_in       date,
  room_check_out      date,
  rate                numeric,
  adults              int not null default 0,
  children            int not null default 0,
  room_status         text,
  primary key (reservation_id, sub_reservation_id, night)
);
create index if not exists cb_room_nights_night on public.cb_room_nights (night);

create table if not exists public.cb_room_blocks (
  block_id    text primary key,
  type        text,
  reason      text,
  start_date  date not null,
  end_date    date not null,
  rooms       text[] not null default '{}',
  synced_at   timestamptz not null default now()
);

alter table public.cb_transactions enable row level security;
alter table public.cb_reservations enable row level security;
alter table public.cb_room_nights  enable row level security;
alter table public.cb_room_blocks  enable row level security;
-- no policies: only the sync (service role) and the security-definer RPCs below read them

-- ---------------------------------------------------------------- writers (sync only)
create or replace function public.cb_ledger_upsert(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  insert into cb_transactions (id, code, amount, currency, service_date, business_date, txn_at, source_kind,
                               reservation_id, sub_reservation_id, relation_kind, relation_id, routed_from, parent_id, synced_at)
  select x->>'id', x->>'code', (x->>'amount')::numeric, x->>'currency', (x->>'service_date')::date, (x->>'business_date')::date,
         (x->>'txn_at')::timestamptz, x->>'source_kind', x->>'reservation_id', x->>'sub_reservation_id',
         x->>'relation_kind', x->>'relation_id', x->>'routed_from', x->>'parent_id', now()
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
   where x->>'id' is not null and x->>'code' is not null
  on conflict (id) do update set
    code = excluded.code, amount = excluded.amount, currency = excluded.currency, service_date = excluded.service_date,
    business_date = excluded.business_date, txn_at = excluded.txn_at, source_kind = excluded.source_kind,
    reservation_id = excluded.reservation_id, sub_reservation_id = excluded.sub_reservation_id,
    relation_kind = excluded.relation_kind, relation_id = excluded.relation_id, routed_from = excluded.routed_from,
    parent_id = excluded.parent_id, synced_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- p: [{ id, status, deleted, created, cancelled, check_in, check_out, source, modified,
--       rooms: [{ sub, room_id, room_type_id, check_in, check_out, room_status, adults, children, rates: { "YYYY-MM-DD": n } }] }]
create or replace function public.cb_nights_apply(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; rm jsonb; k text; n_res int := 0; n_nights int := 0; i int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  for x in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    continue when x->>'id' is null;
    insert into cb_reservations (id, status, deleted, created_at, cancelled_at, check_in, check_out, source, modified_at, synced_at)
    values (x->>'id', x->>'status', coalesce((x->>'deleted')::boolean, false), (x->>'created')::timestamptz,
            (x->>'cancelled')::timestamptz, (x->>'check_in')::date, (x->>'check_out')::date, x->>'source',
            (x->>'modified')::timestamptz, now())
    on conflict (id) do update set status = excluded.status, deleted = excluded.deleted, created_at = excluded.created_at,
      cancelled_at = excluded.cancelled_at, check_in = excluded.check_in, check_out = excluded.check_out,
      source = excluded.source, modified_at = excluded.modified_at, synced_at = now();
    delete from cb_room_nights where reservation_id = x->>'id';
    n_res := n_res + 1;
    i := 0;
    for rm in select * from jsonb_array_elements(coalesce(x->'rooms', '[]'::jsonb)) loop
      i := i + 1;
      for k in select jsonb_object_keys(coalesce(rm->'rates', '{}'::jsonb)) loop
        continue when k !~ '^\d{4}-\d{2}-\d{2}$';
        insert into cb_room_nights (reservation_id, sub_reservation_id, night, room_id, room_type_id, room_check_in, room_check_out,
                                    rate, adults, children, room_status)
        values (x->>'id', coalesce(nullif(rm->>'sub', ''), 'room' || i), k::date, nullif(rm->>'room_id', ''), rm->>'room_type_id',
                (rm->>'check_in')::date, (rm->>'check_out')::date, nullif(rm->'rates'->>k, '')::numeric,
                coalesce(nullif(rm->>'adults', '')::int, 0), coalesce(nullif(rm->>'children', '')::int, 0), rm->>'room_status')
        on conflict (reservation_id, sub_reservation_id, night) do update set rate = excluded.rate;
        n_nights := n_nights + 1;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('reservations', n_res, 'nights', n_nights);
end $$;

-- p_from / p_to: the window that was read; blocks in it that Cloudbeds no longer has are removed
create or replace function public.cb_blocks_store(p_from date, p_to date, p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int; v_keep text[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  select coalesce(array_agg(x->>'block_id'), '{}') into v_keep from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x;
  insert into cb_room_blocks (block_id, type, reason, start_date, end_date, rooms, synced_at)
  select x->>'block_id', x->>'type', x->>'reason', (x->>'start')::date, (x->>'end')::date,
         coalesce((select array_agg(r) from jsonb_array_elements_text(coalesce(x->'rooms', '[]'::jsonb)) r), '{}'), now()
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
   where x->>'block_id' is not null and x->>'start' is not null and x->>'end' is not null
  on conflict (block_id) do update set type = excluded.type, reason = excluded.reason, start_date = excluded.start_date,
    end_date = excluded.end_date, rooms = excluded.rooms, synced_at = now();
  get diagnostics n = row_count;
  delete from cb_room_blocks where end_date >= p_from and start_date < p_to and not (block_id = any(v_keep));
  return n;
end $$;

-- ---------------------------------------------------------------- report
-- per night, Cloudbeds definitions (see header)
create or replace function public.cb_manager_nights(p_from date, p_to date)
returns table (night date, capacity int, rooms_sold int, arrivals int, departures int, no_shows int,
               out_of_service int, blocked int, adults int, children int,
               room_revenue numeric, other_revenue numeric, misc_income numeric, forecast boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_cap int; v_audit date;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'Pick a range of up to 400 nights'; end if;
  select count(distinct cb_room_id)::int into v_cap from villas where cb_room_id is not null;
  -- last night through Cloudbeds night audit = last night with a posted room rate
  select max(t.service_date) into v_audit from cb_transactions t where t.code = '1000';
  return query
  with d as (select g::date as n from generate_series(p_from, p_to, interval '1 day') g),
  live as (
    select rn.*, r.status
      from cb_room_nights rn join cb_reservations r on r.id = rn.reservation_id
     where not r.deleted and rn.night between p_from and p_to
  ), sold as (
    select l.night, count(*)::int c, sum(l.adults)::int a, sum(l.children)::int ch, coalesce(sum(l.rate), 0) rate
      from live l
     where l.status in ('confirmed', 'not_confirmed', 'checked_in', 'checked_out')
       and coalesce(l.room_status, '') <> 'cancelled'
     group by l.night
  ), rooms as (   -- each booked room once, with its own dates
    select distinct rn.reservation_id, rn.sub_reservation_id, r.status,
           coalesce(rn.room_check_in, r.check_in) ci, coalesce(rn.room_check_out, r.check_out) co, rn.room_status
      from cb_room_nights rn join cb_reservations r on r.id = rn.reservation_id
     where not r.deleted
  ), arr as (
    select ro.ci n, count(*) filter (where ro.status in ('confirmed', 'not_confirmed', 'checked_in', 'checked_out')
                                       and coalesce(ro.room_status, '') <> 'cancelled')::int a,
           count(*) filter (where ro.status = 'no_show')::int ns
      from rooms ro where ro.ci between p_from and p_to group by ro.ci
  ), dep as (
    select ro.co n, count(*)::int c from rooms ro
     where ro.co between p_from and p_to and ro.status in ('confirmed', 'not_confirmed', 'checked_in', 'checked_out')
       and coalesce(ro.room_status, '') <> 'cancelled'
     group by ro.co
  ), blk as (
    select g::date n, b.type, count(distinct rm)::int c
      from cb_room_blocks b
      cross join lateral generate_series(b.start_date, greatest(b.end_date, b.start_date + 1) - 1, interval '1 day') g
      cross join lateral unnest(b.rooms) rm
     where b.type in ('out_of_service', 'blocked_dates') and b.start_date <= p_to and greatest(b.end_date, b.start_date + 1) > p_from
     group by 1, 2
  ), tx as (
    select t.service_date n,
           sum(t.amount) filter (where t.code ~ '^1[012]00[AV]?$') room,
           sum(t.amount) filter (where t.code ~ '^[2345]000[AV]?$') other,
           sum(t.amount) filter (where t.code ~ '^5000[AV]?$') misc
      from cb_transactions t
     where t.service_date between p_from and p_to and t.routed_from is null
     group by t.service_date
  )
  select d.n, v_cap,
         coalesce(s.c, 0), coalesce(a.a, 0), coalesce(dp.c, 0), coalesce(a.ns, 0),
         coalesce((select b.c from blk b where b.n = d.n and b.type = 'out_of_service'), 0),
         coalesce((select b.c from blk b where b.n = d.n and b.type = 'blocked_dates'), 0),
         coalesce(s.a, 0), coalesce(s.ch, 0),
         round(case when v_audit is not null and d.n <= v_audit then coalesce(tx.room, 0) else coalesce(s.rate, 0) end, 2),
         round(coalesce(tx.other, 0), 2), round(coalesce(tx.misc, 0), 2),
         (v_audit is null or d.n > v_audit)
    from d
    left join sold s on s.night = d.n
    left join arr a on a.n = d.n
    left join dep dp on dp.n = d.n
    left join tx on tx.n = d.n
   order by d.n;
end $$;

create or replace function public.cb_manager_report(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '{}'; k text; f date; tot record; act record;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then raise exception 'not allowed'; end if;
  if p_date is null then raise exception 'Pick a date'; end if;
  foreach k in array array['day', 'mtd', 'ytd'] loop
    f := case k when 'day' then p_date when 'mtd' then date_trunc('month', p_date)::date else date_trunc('year', p_date)::date end;
    select sum(n.capacity) cap, sum(n.rooms_sold) sold, sum(n.arrivals) arr, sum(n.departures) dep, sum(n.no_shows) ns,
           sum(n.out_of_service) oos, sum(n.blocked) blk, sum(n.adults) ad, sum(n.children) ch,
           sum(n.room_revenue) room, sum(n.other_revenue) other, sum(n.misc_income) misc
      into tot from cb_manager_nights(f, p_date) n;
    select count(*) filter (where (r.cancelled_at at time zone 'Asia/Manila')::date between f and p_date and r.status = 'canceled') canc,
           count(*) filter (where (r.created_at at time zone 'Asia/Manila')::date between f and p_date) made,
           count(*) filter (where (r.created_at at time zone 'Asia/Manila')::date between f and p_date
                              and r.check_in = (r.created_at at time zone 'Asia/Manila')::date) same_day,
           coalesce(sum((select count(*) from cb_room_nights rn where rn.reservation_id = r.id))
                    filter (where (r.created_at at time zone 'Asia/Manila')::date between f and p_date), 0) rn_made
      into act from cb_reservations r where not r.deleted;
    v := v || jsonb_build_object(k, jsonb_build_object(
      'from', f, 'to', p_date,
      'arrivals', tot.arr, 'departures', tot.dep, 'no_shows', tot.ns, 'cancellations', act.canc,
      'reservations_made', act.made, 'stayovers', tot.sold - tot.arr, 'same_day_bookings', act.same_day,
      'room_nights_reserved', act.rn_made, 'rooms_sold', tot.sold, 'out_of_service', tot.oos, 'blocked', tot.blk,
      'capacity', tot.cap, 'capacity_minus_oos', tot.cap - tot.oos, 'capacity_minus_oos_blocked', tot.cap - tot.oos - tot.blk,
      'remaining', tot.cap - tot.sold, 'remaining_minus_oos_blocked', tot.cap - tot.sold - tot.oos - tot.blk,
      'occupancy', case when tot.cap > 0 then round(100.0 * tot.sold / tot.cap, 2) end,
      'adjusted_occupancy', case when tot.cap - tot.oos - tot.blk > 0 then round(100.0 * tot.sold / (tot.cap - tot.oos - tot.blk), 2) end,
      'adults', tot.ad, 'children', tot.ch, 'guests', tot.ad + tot.ch,
      'room_revenue', tot.room, 'other_revenue', tot.other, 'misc_income', tot.misc, 'total_revenue', tot.room + tot.other,
      'adr', case when tot.sold > 0 then round(tot.room / tot.sold, 2) end,
      'revpar', case when tot.cap > 0 then round(tot.room / tot.cap, 2) end));
  end loop;
  return v || jsonb_build_object(
    'audited_through', (select max(service_date) from cb_transactions where code = '1000'),
    'synced_at', greatest((select max(synced_at) from cb_transactions), (select max(synced_at) from cb_reservations)));
end $$;

revoke all on function public.cb_ledger_upsert(jsonb) from public, anon, authenticated;
revoke all on function public.cb_nights_apply(jsonb) from public, anon, authenticated;
revoke all on function public.cb_blocks_store(date, date, jsonb) from public, anon, authenticated;
revoke all on function public.cb_manager_nights(date, date) from public, anon;
revoke all on function public.cb_manager_report(date) from public, anon;
grant execute on function public.cb_manager_nights(date, date) to authenticated, service_role;
grant execute on function public.cb_manager_report(date) to authenticated, service_role;
grant execute on function public.cb_ledger_upsert(jsonb) to service_role;
grant execute on function public.cb_nights_apply(jsonb) to service_role;
grant execute on function public.cb_blocks_store(date, date, jsonb) to service_role;
