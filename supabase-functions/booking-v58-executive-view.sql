-- =============================================================================
-- booking-v58: data for the staff dashboard's "Executive" view
-- (staff-exec.js) — the website at a glance, refreshed every few seconds.
--
--   site_live()                 who's on the site right now, today so far vs
--                               the same time yesterday, visits by hour, a feed
--                               of booking-funnel activity, and today's website
--                               sales / online payments
--   site_sales(p_from, p_to)    bookings made on the website (by guests) in a
--                               period, with the previous period for comparison
--
-- Traffic for a period comes from site_insights() (booking-v44). Read-only;
-- staff accounts only.
-- =============================================================================

create index if not exists booking_requests_origin_created_idx on booking_requests (booking_origin, created_at);

create or replace function site_live() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  t_today timestamptz := (v_today::timestamp at time zone 'Asia/Manila');
  t_yday timestamptz := ((v_today - 1)::timestamp at time zone 'Asia/Manila');
  v_hour int := extract(hour from now() at time zone 'Asia/Manila')::int;
  r jsonb;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'Staff only';
  end if;

  with ev as materialized (
    select at, vid, sid, kind, path, device, order_code, data,
           coalesce(nullif(utm_source, ''), nullif(ref_host, ''), 'direct') as source,
           extract(hour from at at time zone 'Asia/Manila')::int as h,
           at >= t_today as is_today
      from site_events
     where at >= t_yday and kind not like 'staff_%'
  ),
  live as (
    select sid,
           max(at) as last_at, min(at) as first_at,
           (array_agg(path order by at desc) filter (where kind = 'page_view'))[1] as page,
           (array_agg(source order by at))[1] as source,
           (array_agg(device order by at))[1] as device,
           count(*) filter (where kind = 'page_view') as views,
           max(case when kind in ('st_booked', 'dt_booked', 'st_requested') then 6
                    when kind in ('pay_view', 'pay_click', 'pay_uploaded') then 7
                    when kind in ('st_submit', 'dt_submit') then 5
                    when kind in ('st_form', 'dt_form') then 4
                    when kind in ('st_casita', 'dt_cabana') then 3
                    when kind in ('st_dates', 'dt_date') then 2
                    when kind in ('st_view', 'dt_view') then 1 else 0 end) as stage,
           bool_or(kind like 'st\_%') as villa, bool_or(kind like 'dt\_%') as daytrip,
           (array_agg(order_code order by at desc) filter (where order_code is not null))[1] as order_code
      from ev where at >= v_now - interval '30 minutes' and sid is not null
     group by sid
  )
  select jsonb_build_object(
    'now', v_now,
    'hour', v_hour,
    'active_5', (select count(*) from live where last_at >= v_now - interval '5 minutes'),
    'active_30', (select count(*) from live),
    'sessions', (select coalesce(jsonb_agg(to_jsonb(l) order by l.last_at desc), '[]')
                   from (select * from live order by last_at desc limit 30) l),
    'today', (select jsonb_build_object('visitors', count(distinct vid), 'visits', count(distinct sid),
                     'views', count(*) filter (where kind = 'page_view'),
                     'booking_forms', count(distinct sid) filter (where kind in ('st_view', 'dt_view')))
                from ev where is_today),
    'yday_same_time', (select jsonb_build_object('visitors', count(distinct vid), 'visits', count(distinct sid),
                     'views', count(*) filter (where kind = 'page_view'),
                     'booking_forms', count(distinct sid) filter (where kind in ('st_view', 'dt_view')))
                from ev where not is_today and at < v_now - interval '1 day'),
    'yday_total', (select jsonb_build_object('visitors', count(distinct vid), 'visits', count(distinct sid)) from ev where not is_today),
    'by_hour', (select jsonb_agg(jsonb_build_object('h', g.h,
                     'today', (select count(distinct sid) from ev where is_today and ev.h = g.h),
                     'yday', (select count(distinct sid) from ev where not is_today and ev.h = g.h)) order by g.h)
                  from generate_series(0, 23) as g(h)),
    'feed', (select coalesce(jsonb_agg(to_jsonb(f) order by f.at desc), '[]') from (
               select at, kind, path, sid, device, source, order_code, data
                 from ev
                where kind not in ('page_view', 'scroll_25', 'scroll_50', 'scroll_75', 'scroll_100')
                   or path ~ '^/(book|book-stay|pay)(/|$)'
                order by at desc limit 50) f),
    'sales_today', (select jsonb_build_object(
                       'bookings', count(*) filter (where status::text <> 'inquiry'),
                       'requests', count(*) filter (where status::text = 'inquiry'),
                       'value', coalesce(sum(total_amount) filter (where status::text not in ('declined', 'expired', 'inquiry')), 0))
                     from booking_requests where booking_origin = 'site_guest' and created_at >= t_today),
    'sales_yday_same_time', (select jsonb_build_object(
                       'bookings', count(*) filter (where status::text <> 'inquiry'),
                       'value', coalesce(sum(total_amount) filter (where status::text not in ('declined', 'expired', 'inquiry')), 0))
                     from booking_requests where booking_origin = 'site_guest' and created_at >= t_yday and created_at < v_now - interval '1 day'),
    'paid_today', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0))
                     from booking_payments where method = 'xendit' and status = 'verified' and not coalesce(test, false) and created_at >= t_today),
    'paid_yday_same_time', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0))
                     from booking_payments where method = 'xendit' and status = 'verified' and not coalesce(test, false)
                      and created_at >= t_yday and created_at < v_now - interval '1 day')
  ) into r;
  return r;
end;
$$;
revoke all on function site_live() from public, anon;
grant execute on function site_live() to authenticated;

create or replace function site_sales(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t0 timestamptz := (p_from::timestamp at time zone 'Asia/Manila');
  t1 timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Manila');
  v_len int := p_to - p_from + 1;
  p0 timestamptz := ((p_from - v_len)::timestamp at time zone 'Asia/Manila');
  r jsonb;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'Staff only';
  end if;
  with b as materialized (
    select id, order_code, guest_name, stay_type, status::text as status, total_amount, amount_paid, created_at, check_in, check_out,
           coalesce(adults, 0) + coalesce(children_6_12, 0) + coalesce(children_0_5, 0) as pax,
           status::text not in ('declined', 'expired', 'inquiry') as live
      from booking_requests
     where booking_origin = 'site_guest' and created_at >= p0 and created_at < t1
  ),
  cur as (select * from b where created_at >= t0),
  prev as (select * from b where created_at < t0),
  pay as (select p.amount, p.created_at from booking_payments p
           where p.method = 'xendit' and p.status = 'verified' and not coalesce(p.test, false) and p.created_at >= p0 and p.created_at < t1)
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', p_from - v_len, 'prev_to', p_from - 1),
    'cur', (select jsonb_build_object(
        'bookings', count(*) filter (where status <> 'inquiry'),
        'live', count(*) filter (where live),
        'requests', count(*) filter (where status = 'inquiry'),
        'cancelled', count(*) filter (where status in ('declined', 'expired')),
        'value', coalesce(sum(total_amount) filter (where live), 0),
        'confirmed_value', coalesce(sum(total_amount) filter (where status in ('confirmed', 'completed')), 0),
        'collected', coalesce(sum(amount_paid) filter (where live), 0),
        'guests', coalesce(sum(pax) filter (where live), 0),
        'villa', count(*) filter (where live and stay_type = 'overnight'),
        'villa_value', coalesce(sum(total_amount) filter (where live and stay_type = 'overnight'), 0),
        'daytrip', count(*) filter (where live and stay_type <> 'overnight'),
        'daytrip_value', coalesce(sum(total_amount) filter (where live and stay_type <> 'overnight'), 0),
        'lead_days', round(avg(check_in - (created_at at time zone 'Asia/Manila')::date) filter (where live and check_in is not null)),
        'paid_online', (select coalesce(sum(amount), 0) from pay where created_at >= t0),
        'paid_online_count', (select count(*) from pay where created_at >= t0)) from cur),
    'prev', (select jsonb_build_object(
        'bookings', count(*) filter (where status <> 'inquiry'),
        'live', count(*) filter (where live),
        'requests', count(*) filter (where status = 'inquiry'),
        'value', coalesce(sum(total_amount) filter (where live), 0),
        'paid_online', (select coalesce(sum(amount), 0) from pay where created_at < t0)) from prev),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
                  'bookings', (select count(*) from cur where live and (created_at at time zone 'Asia/Manila')::date = d::date),
                  'value', (select coalesce(sum(total_amount), 0) from cur where live and (created_at at time zone 'Asia/Manila')::date = d::date)) order by d), '[]')
                 from generate_series(p_from, p_to, interval '1 day') d),
    'recent', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]') from (
                 select order_code, split_part(coalesce(guest_name, ''), ' ', 1) as first_name, stay_type, status, total_amount, amount_paid,
                        created_at, check_in, check_out, pax
                   from cur order by created_at desc limit 25) x)
  ) into r;
  return r;
end;
$$;
revoke all on function site_sales(date, date) from public, anon;
grant execute on function site_sales(date, date) to authenticated;

select 'v58 applied' as status;
