-- =============================================================================
-- booking-v84 — Manager's Report: match Cloudbeds exactly (checked against the
-- Cloudbeds Manager's Report for 20 Nov 2026).
--  * Nights not yet through night audit use Cloudbeds' pending charges
--    (Accounting API pending-transactions: room rate net of inclusive taxes),
--    not the gross nightly rate.
--  * Reservations made / same-day bookings / room nights reserved leave out
--    cancelled reservations; room nights = the reservation's nights.
--  * Stayovers: Day = rooms sold that night; MTD / YTD = rooms sold − arrivals
--    (as Cloudbeds shows them).
-- =============================================================================

create table if not exists public.cb_pending_transactions (like public.cb_transactions including all);
alter table public.cb_pending_transactions enable row level security;
create index if not exists cb_pending_transactions_service_date on public.cb_pending_transactions (service_date);

create or replace function public.cb_pending_replace(p_from date, p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  delete from cb_pending_transactions where service_date >= p_from or service_date is null;
  insert into cb_pending_transactions (id, code, amount, currency, service_date, business_date, txn_at, source_kind,
                                       reservation_id, sub_reservation_id, relation_kind, relation_id, routed_from, parent_id, synced_at)
  select x->>'id', x->>'code', (x->>'amount')::numeric, x->>'currency', (x->>'service_date')::date, (x->>'business_date')::date,
         (x->>'txn_at')::timestamptz, x->>'source_kind', x->>'reservation_id', x->>'sub_reservation_id',
         x->>'relation_kind', x->>'relation_id', x->>'routed_from', x->>'parent_id', now()
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
   where x->>'id' is not null and x->>'code' is not null and (x->>'service_date')::date >= p_from
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  -- a night that has been through audit is in cb_transactions: drop its pending copies
  delete from cb_pending_transactions where service_date <= (select max(service_date) from cb_transactions where code = '1000');
  return n;
end $$;
revoke all on function public.cb_pending_replace(date, jsonb) from public, anon, authenticated;
grant execute on function public.cb_pending_replace(date, jsonb) to service_role;

create or replace function public.cb_manager_nights(p_from date, p_to date)
returns table (night date, capacity int, rooms_sold int, arrivals int, departures int, no_shows int,
               out_of_service int, blocked int, adults int, children int,
               room_revenue numeric, other_revenue numeric, misc_income numeric, forecast boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_cap int; v_audit date; v_has_pending boolean;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'Pick a range of up to 400 nights'; end if;
  select count(distinct cb_room_id)::int into v_cap from villas where cb_room_id is not null;
  -- last night through Cloudbeds night audit = last night with a posted room rate
  select max(t.service_date) into v_audit from cb_transactions t where t.code = '1000';
  select exists (select 1 from cb_pending_transactions) into v_has_pending;
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
  ), pend as (   -- Cloudbeds' own forecast: pending room charges (net of inclusive taxes)
    select t.service_date n, sum(t.amount) filter (where t.code ~ '^1[012]00[AV]?$') room
      from cb_pending_transactions t
     where t.service_date between p_from and p_to and t.routed_from is null
     group by t.service_date
  )
  select d.n, v_cap,
         coalesce(s.c, 0), coalesce(a.a, 0), coalesce(dp.c, 0), coalesce(a.ns, 0),
         coalesce((select b.c from blk b where b.n = d.n and b.type = 'out_of_service'), 0),
         coalesce((select b.c from blk b where b.n = d.n and b.type = 'blocked_dates'), 0),
         coalesce(s.a, 0), coalesce(s.ch, 0),
         round(case when v_audit is not null and d.n <= v_audit then coalesce(tx.room, 0)
                    when v_has_pending then coalesce(pe.room, 0)
                    else coalesce(s.rate, 0) end, 2),
         round(coalesce(tx.other, 0), 2), round(coalesce(tx.misc, 0), 2),
         (v_audit is null or d.n > v_audit)
    from d
    left join sold s on s.night = d.n
    left join arr a on a.n = d.n
    left join dep dp on dp.n = d.n
    left join tx on tx.n = d.n
    left join pend pe on pe.n = d.n
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
    -- made / same-day / room nights reserved: reservations created in the period that are not cancelled,
    -- room nights = the reservation's nights (Cloudbeds' figures, checked against its Manager's Report)
    select count(*) filter (where (r.cancelled_at at time zone 'Asia/Manila')::date between f and p_date and r.status = 'canceled') canc,
           count(*) filter (where (r.created_at at time zone 'Asia/Manila')::date between f and p_date and r.status <> 'canceled') made,
           count(*) filter (where (r.created_at at time zone 'Asia/Manila')::date between f and p_date and r.status <> 'canceled'
                              and r.check_in = (r.created_at at time zone 'Asia/Manila')::date) same_day,
           coalesce(sum(r.check_out - r.check_in)
                    filter (where (r.created_at at time zone 'Asia/Manila')::date between f and p_date and r.status <> 'canceled'), 0) rn_made
      into act from cb_reservations r where not r.deleted;
    v := v || jsonb_build_object(k, jsonb_build_object(
      'from', f, 'to', p_date,
      'arrivals', tot.arr, 'departures', tot.dep, 'no_shows', tot.ns, 'cancellations', act.canc,
      'reservations_made', act.made, 'stayovers', case when k = 'day' then tot.sold else tot.sold - tot.arr end, 'same_day_bookings', act.same_day,
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
    'forecast_source', case when exists (select 1 from cb_pending_transactions) then 'cloudbeds_pending' else 'nightly_rates' end,
    'synced_at', greatest((select max(synced_at) from cb_transactions), (select max(synced_at) from cb_reservations)));
end $$;

-- every 10 minutes: Cloudbeds changes → cb_* copies (cloudbeds-sync action "manager_sync")
select cron.schedule('cloudbeds-manager-report', '7-59/10 * * * *', $$select public.cb_call('manager_sync')$$);
