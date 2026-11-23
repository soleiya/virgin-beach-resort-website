-- =============================================================================
-- booking-v87 — Executive briefing (virginbeachresort.com/exec/), live data.
--
-- The page has no data in it. It sends the 4-digit PIN to the edge function
-- exec-briefing, which checks it against the EXEC_PIN secret (with lockouts
-- recorded here) and returns exec_briefing(year), read with the service role.
--
-- Revenue basis (aligned with accounting / Sugar's sales summary):
--   casitas   = Cloudbeds Manager's Report figures (cb_manager_nights):
--               room revenue + other revenue, taxes and fees excluded.
--               Nights after the last night audit = Cloudbeds' forecast.
--   day trips = website / staff day-trip bookings (booking_requests, not
--               overnight, not Cloudbeds-made), confirmed or completed,
--               counted on the visit date.
--   Jan–Oct 2026: casitas + day trips = ₱103.01M vs Sugar ₱103.13M (0.1%).
--
-- Tables (RLS on, no policies: only the service role / definer RPCs read them):
--   exec_targets          monthly sales target + the figure accounting reported
--   exec_daytrip_history  monthly day-trip sales from the 2023–2025 Day Trip
--                         Calendar workbooks (each sheet's own TOTAL row)
--   exec_pin_attempts     wrong-PIN counters for the lockout
-- =============================================================================

create table if not exists public.exec_targets (
  year int not null, month int not null check (month between 1 and 12),
  target numeric not null,
  accounting_actual numeric,           -- as reported by accounting (Sugar); null until reported
  note text,
  updated_at timestamptz not null default now(),
  primary key (year, month)
);
create table if not exists public.exec_daytrip_history (
  year int not null, month int not null check (month between 1 and 12),
  sales numeric not null, guests int, bookings int,
  source text not null default 'Day Trip Calendar workbook',
  primary key (year, month)
);
create table if not exists public.exec_pin_attempts (
  key text primary key,                -- sha-256 of the caller's IP, or 'all'
  fails int not null default 0,
  locked_until timestamptz,
  last_at timestamptz not null default now()
);
alter table public.exec_targets enable row level security;
alter table public.exec_daytrip_history enable row level security;
alter table public.exec_pin_attempts enable row level security;
revoke all on public.exec_targets, public.exec_daytrip_history, public.exec_pin_attempts from anon, authenticated;

-- Sugar's 2026 summary (shared 19 Nov 2026)
insert into public.exec_targets (year, month, target, accounting_actual) values
  (2026, 1, 10167250.00, 8790535.35), (2026, 2, 11667640.00, 8472643.45), (2026, 3, 15152260.68, 10665901.00),
  (2026, 4, 20692184.23, 16557983.00), (2026, 5, 19366481.73, 17725621.00), (2026, 6, 16627250.00, 12544175.19),
  (2026, 7, 10704750.01, 8808103.95), (2026, 8, 8500000.00, 4730775.50), (2026, 9, 8341500.02, 6143733.43),
  (2026, 10, 8722750.00, 8694863.92), (2026, 11, 8642862.60, null), (2026, 12, 10578125.02, null)
on conflict (year, month) do update set target = excluded.target, accounting_actual = excluded.accounting_actual, updated_at = now();

insert into public.exec_daytrip_history (year, month, sales, guests, bookings) values
(2023,1,705356.86,228,83),
(2023,2,826136.6,164,110),
(2023,3,2039941.83,1015,140),
(2023,4,5436414.92,3475,298),
(2023,5,6538266.56,4189,198),
(2023,6,2421841.52,1932,136),
(2023,7,1341438.56,721,78),
(2023,8,1188461.82,471,70),
(2023,9,1359277.08,804,45),
(2023,10,534344.27,146,63),
(2023,11,798423.79,198,100),
(2023,12,953738.54,207,119),
(2024,1,860867.88,216,112),
(2024,2,1205656.59,787,151),
(2024,3,4930369.68,3493,349),
(2024,4,5383764.57,3588,321),
(2024,5,4841848.58,3484,217),
(2024,6,4728089.05,3049,207),
(2024,7,1770875.63,1261,102),
(2024,8,2268676.49,1663,229),
(2024,9,1322522.94,961,93),
(2024,10,1179691.52,844,119),
(2024,11,872440.29,557,117),
(2024,12,1417195.34,862,138),
(2025,1,1287417.49,811,155),
(2025,2,1921999.39,1480,158),
(2025,3,2934596.16,1950,256),
(2025,4,7230333.06,4765,490),
(2025,5,7274363.78,5529,379),
(2025,6,4048072.27,2844,179),
(2025,7,1658964.2,1035,77),
(2025,8,2480520.39,1863,118),
(2025,9,581133.27,457,62),
(2025,10,802886.91,606,90),
(2025,11,580370.75,398,73),
(2025,12,1583315.81,1036,181)
on conflict (year, month) do update set sales = excluded.sales, guests = excluded.guests, bookings = excluded.bookings;

-- ---------------------------------------------------------------- PIN lockout
-- 5 wrong PINs from one address → locked 15 min; 30 wrong PINs in total
-- within an hour → everyone locked 15 min. A right PIN clears that address.
create or replace function public.exec_pin_gate(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  select max(locked_until) into v from exec_pin_attempts where key in (p_key, 'all') and locked_until > now();
  return jsonb_build_object('locked', v is not null, 'retry_in', coalesce(ceil(extract(epoch from v - now())), 0));
end $$;

create or replace function public.exec_pin_record(p_key text, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f int; g int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  if p_ok then
    delete from exec_pin_attempts where key = p_key;
    return jsonb_build_object('ok', true);
  end if;
  insert into exec_pin_attempts as a (key, fails, last_at) values (p_key, 1, now())
  on conflict (key) do update set
    fails = case when a.last_at < now() - interval '1 hour' then 1 else a.fails + 1 end, last_at = now()
  returning fails into f;
  if f >= 5 then update exec_pin_attempts set locked_until = now() + interval '15 minutes', fails = 0 where key = p_key; end if;
  insert into exec_pin_attempts as a (key, fails, last_at) values ('all', 1, now())
  on conflict (key) do update set
    fails = case when a.last_at < now() - interval '1 hour' then 1 else a.fails + 1 end, last_at = now()
  returning fails into g;
  if g >= 30 then update exec_pin_attempts set locked_until = now() + interval '15 minutes', fails = 0 where key = 'all'; end if;
  return jsonb_build_object('ok', false, 'locked', f >= 5 or g >= 30);
end $$;

-- ---------------------------------------------------------------- the briefing
create or replace function public.exec_briefing(p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := make_date(p_year, 1, 1);
  v_to   date := make_date(p_year, 12, 31);
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_months jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;

  with m as (select g as mo from generate_series(1, 12) g),
  cb as (
    select extract(month from n.night)::int as mo,
           sum(n.room_revenue) filter (where not n.forecast) room_act,
           sum(n.other_revenue) filter (where not n.forecast) other_act,
           sum(n.room_revenue) filter (where n.forecast) room_fc,
           sum(n.other_revenue) filter (where n.forecast) other_fc,
           sum(n.capacity) cap, sum(n.rooms_sold) sold, sum(n.rooms_sold) filter (where not n.forecast) sold_act,
           sum(n.capacity) filter (where not n.forecast) cap_act,
           sum(n.out_of_service) oos, sum(n.blocked) blk,
           count(*) filter (where not n.forecast) nights_audited, count(*) nights
      from cb_manager_nights(v_from, v_to) n group by 1
  ), web as (
    select extract(month from w.night)::int as mo, sum(w.max_total) max_total, sum(w.achieved) achieved,
           sum(w.lost_blocked) lost_blocked, sum(w.pending) pending, sum(w.sold) sold, sum(w.casitas) nights
      from villa_revenue_days(v_from, v_to + 1) w group by 1
  ), dt as (
    select extract(month from b.check_in)::int as mo,
           sum(b.total_amount) filter (where b.check_in < v_today) done,
           sum(b.total_amount) filter (where b.check_in >= v_today) upcoming,
           sum(coalesce(b.adults, 0) + coalesce(b.children_6_12, 0)) filter (where b.check_in < v_today) guests_done,
           sum(coalesce(b.adults, 0) + coalesce(b.children_6_12, 0)) filter (where b.check_in >= v_today) guests_upcoming,
           count(*) bookings
      from booking_requests b
     where b.stay_type <> 'overnight' and not coalesce(b.cb_owned, false)
       and b.status in ('confirmed', 'completed')
       and b.check_in between v_from and v_to
     group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'month', m.mo,
           'target', t.target, 'accounting_actual', t.accounting_actual,
           'casita_room', round(coalesce(cb.room_act, 0), 2), 'casita_other', round(coalesce(cb.other_act, 0), 2),
           'casita_room_fc', round(coalesce(cb.room_fc, 0), 2), 'casita_other_fc', round(coalesce(cb.other_fc, 0), 2),
           'nights', coalesce(cb.nights, 0), 'nights_audited', coalesce(cb.nights_audited, 0),
           'capacity', coalesce(cb.cap, 0), 'rooms_sold', coalesce(cb.sold, 0),
           'capacity_audited', coalesce(cb.cap_act, 0), 'rooms_sold_audited', coalesce(cb.sold_act, 0),
           'out_of_service', coalesce(cb.oos, 0), 'blocked', coalesce(cb.blk, 0),
           'daytrip', round(coalesce(dt.done, 0), 2), 'daytrip_upcoming', round(coalesce(dt.upcoming, 0), 2),
           'daytrip_guests', coalesce(dt.guests_done, 0), 'daytrip_guests_upcoming', coalesce(dt.guests_upcoming, 0),
           'daytrip_bookings', coalesce(dt.bookings, 0),
           'max_gross', round(coalesce(web.max_total, 0), 2), 'booked_gross', round(coalesce(web.achieved, 0), 2),
           'blocked_gross', round(coalesce(web.lost_blocked, 0), 2), 'pending_gross', round(coalesce(web.pending, 0), 2),
           'web_sold', coalesce(web.sold, 0), 'web_nights', coalesce(web.nights, 0)
         ) order by m.mo)
    into v_months
    from m
    left join exec_targets t on t.year = p_year and t.month = m.mo
    left join cb on cb.mo = m.mo
    left join web on web.mo = m.mo
    left join dt on dt.mo = m.mo;

  return jsonb_build_object(
    'year', p_year,
    'today', v_today,
    'generated_at', now(),
    'audited_through', (select max(service_date) from cb_transactions where code = '1000'),
    'cloudbeds_synced_at', greatest((select max(synced_at) from cb_transactions), (select max(synced_at) from cb_reservations)),
    'casitas', (select count(*) from villas where active),
    'months', v_months,
    'daytrip_history', coalesce((select jsonb_agg(jsonb_build_object('year', h.year, 'month', h.month, 'sales', h.sales, 'guests', h.guests)
                                   order by h.year, h.month) from exec_daytrip_history h where h.year < p_year), '[]'::jsonb));
end $$;

revoke all on function public.exec_pin_gate(text) from public, anon, authenticated;
revoke all on function public.exec_pin_record(text, boolean) from public, anon, authenticated;
revoke all on function public.exec_briefing(int) from public, anon, authenticated;
grant execute on function public.exec_pin_gate(text) to service_role;
grant execute on function public.exec_pin_record(text, boolean) to service_role;
grant execute on function public.exec_briefing(int) to service_role;
