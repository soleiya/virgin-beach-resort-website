-- ============================================================================
-- booking-v44 — first-party analytics + detailed activity log
--
--   * site_events: one row per thing that happens — page views on the public
--     site, every booking-funnel step (date picked, cabana / casita chosen,
--     form started, blocked, booked, payment started / returned), clicks from
--     booking emails, and staff actions in the dashboard.
--     No cookies, no names / emails / phone numbers: visitors are a random ID
--     kept in their browser. Staff actions carry the staff email.
--   * track_event(p) — the only way in (the website calls it). Validates and
--     trims everything, and caps how much one visit can write.
--   * site_insights(from, to) — everything the Insights page shows, staff only:
--     traffic, sources, devices, pages, both booking funnels, why bookings
--     were blocked, bookings by origin, payments, emails, staff activity.
-- Run in Supabase → SQL Editor. Safe to run more than once.
-- ============================================================================

create table if not exists site_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  vid text,                 -- anonymous visitor id (browser)
  sid text,                 -- visit id (30 minutes of activity)
  kind text not null,       -- page_view, dt_*, st_*, pay_*, staff_* …
  path text,
  title text,
  ref_host text,            -- where the visitor came from (host only)
  utm_source text, utm_medium text, utm_campaign text,
  device text, browser text, lang text,
  order_code text,
  actor text,               -- staff email (staff events only)
  data jsonb
);
create index if not exists site_events_at_idx on site_events (at);
create index if not exists site_events_kind_at_idx on site_events (kind, at);
create index if not exists site_events_sid_idx on site_events (sid, at);
alter table site_events enable row level security;
drop policy if exists site_events_staff_read on site_events;
create policy site_events_staff_read on site_events for select to authenticated using (true);
revoke insert, update, delete on site_events from anon, authenticated;

create or replace function track_event(p jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_kind text := lower(left(coalesce(p->>'kind', ''), 40));
  v_sid text := left(nullif(p->>'sid', ''), 40);
  v_staff boolean := coalesce(auth.role(), '') = 'authenticated';
  v_data jsonb := case when jsonb_typeof(p->'data') = 'object' then p->'data' else null end;
begin
  if v_kind !~ '^[a-z0-9_:.\-]+$' then return; end if;
  if v_kind like 'staff_%' and not v_staff then return; end if;
  if length(p::text) > 6000 then return; end if;
  if v_data is not null and length(v_data::text) > 3000 then v_data := jsonb_build_object('truncated', true); end if;
  -- one visit can't write more than 400 events an hour
  if v_sid is not null and (select count(*) from site_events e where e.sid = v_sid and e.at > now() - interval '1 hour') >= 400 then
    return;
  end if;
  insert into site_events (vid, sid, kind, path, title, ref_host, utm_source, utm_medium, utm_campaign,
                           device, browser, lang, order_code, actor, data)
  values (left(nullif(p->>'vid', ''), 40), v_sid, v_kind,
          left(nullif(p->>'path', ''), 200), left(nullif(p->>'title', ''), 150),
          left(nullif(lower(p->>'ref_host'), ''), 100),
          left(nullif(lower(p->>'utm_source'), ''), 60), left(nullif(lower(p->>'utm_medium'), ''), 60), left(nullif(p->>'utm_campaign', ''), 80),
          left(nullif(p->>'device', ''), 20), left(nullif(p->>'browser', ''), 30), left(nullif(p->>'lang', ''), 20),
          left(nullif(p->>'order_code', ''), 40),
          case when v_staff then left(auth.jwt() ->> 'email', 120) end,
          v_data);
exception when others then
  return;  -- analytics must never break the website
end;
$$;
revoke all on function track_event(jsonb) from public;
grant execute on function track_event(jsonb) to anon, authenticated;

-- ------------------------------------------------------------- insights
create or replace function site_insights(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t0 timestamptz := (p_from::timestamp at time zone 'Asia/Manila');
  t1 timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Manila');
  r jsonb;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'Staff only';
  end if;

  with ev as (select * from site_events where at >= t0 and at < t1 and kind not like 'staff_%'),
  sess as (  -- one row per visit: where it came from, device, and how far it got
    select sid,
           min(at) as started,
           (array_agg(coalesce(nullif(utm_source, ''), nullif(ref_host, ''), 'direct') order by at))[1] as source,
           (array_agg(utm_medium order by at))[1] as medium,
           (array_agg(device order by at))[1] as device,
           (array_agg(path order by at))[1] as landing,
           count(*) filter (where kind = 'page_view') as views,
           bool_or(kind in ('dt_booked', 'st_booked')) as booked
      from ev where sid is not null group by sid
  ),
  src as (
    select case
             when source in ('direct') then 'Direct / typed'
             when source ~ '(^|\.)google\.' then 'Google'
             when source ~ '(facebook|fb\.|messenger|m\.me)' then 'Facebook / Messenger'
             when source ~ 'instagram' then 'Instagram'
             when source ~ 'tiktok' then 'TikTok'
             when source = 'booking_email' or medium = 'email' then 'Booking emails'
             when source ~ 'virginbeachresort' then 'Direct / typed'
             else source end as name, *
      from sess
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', (select jsonb_build_object(
        'visitors', count(distinct vid), 'visits', count(distinct sid),
        'page_views', count(*) filter (where kind = 'page_view')) from ev),
    'by_day', (select coalesce(jsonb_agg(x order by x->>'day'), '[]') from (
        select jsonb_build_object('day', d::date,
          'visitors', (select count(distinct vid) from ev where (at at time zone 'Asia/Manila')::date = d::date),
          'visits', (select count(distinct sid) from ev where (at at time zone 'Asia/Manila')::date = d::date),
          'bookings', (select count(*) from booking_requests b where (b.created_at at time zone 'Asia/Manila')::date = d::date
                         and coalesce(b.source, '') <> 'sheet_import')) as x
        from generate_series(p_from, p_to, interval '1 day') d) z),
    'sources', (select coalesce(jsonb_agg(x order by (x->>'visits')::int desc), '[]') from (
        select jsonb_build_object('name', name, 'visits', count(*), 'booked', count(*) filter (where booked)) as x
          from src group by name order by count(*) desc limit 12) z),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(device, 'unknown'), 'visits', n) order by n desc), '[]')
        from (select device, count(*) n from sess group by device) z),
    'pages', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('path', path, 'views', count(*), 'visitors', count(distinct vid)) as x
          from ev where kind = 'page_view' group by path order by count(*) desc limit 15) z),
    'landing', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('path', landing, 'visits', count(*), 'booked', count(*) filter (where booked)) as x
          from sess group by landing order by count(*) desc limit 10) z),
    'funnel_daytrip', (select jsonb_build_array(
        jsonb_build_object('step', 'Saw the day-trip booking form', 'visits', count(distinct sid) filter (where kind = 'dt_view')),
        jsonb_build_object('step', 'Picked a date', 'visits', count(distinct sid) filter (where kind = 'dt_date')),
        jsonb_build_object('step', 'Chose a cabana', 'visits', count(distinct sid) filter (where kind = 'dt_cabana')),
        jsonb_build_object('step', 'Started their details', 'visits', count(distinct sid) filter (where kind = 'dt_form')),
        jsonb_build_object('step', 'Pressed Book Now', 'visits', count(distinct sid) filter (where kind = 'dt_submit')),
        jsonb_build_object('step', 'Booked', 'visits', count(distinct sid) filter (where kind = 'dt_booked')),
        jsonb_build_object('step', 'Went to pay', 'visits', count(distinct sid) filter (where kind = 'pay_click' and data->>'type' = 'daytrip')),
        jsonb_build_object('step', 'Paid', 'visits', count(distinct sid) filter (where kind = 'pay_return_ok' and data->>'type' = 'daytrip'))) from ev),
    'funnel_villas', (select jsonb_build_array(
        jsonb_build_object('step', 'Saw the casita booking form', 'visits', count(distinct sid) filter (where kind = 'st_view')),
        jsonb_build_object('step', 'Picked dates', 'visits', count(distinct sid) filter (where kind = 'st_dates')),
        jsonb_build_object('step', 'Chose a casita', 'visits', count(distinct sid) filter (where kind = 'st_casita')),
        jsonb_build_object('step', 'Started their details', 'visits', count(distinct sid) filter (where kind = 'st_form')),
        jsonb_build_object('step', 'Pressed Book Now', 'visits', count(distinct sid) filter (where kind = 'st_submit')),
        jsonb_build_object('step', 'Booked', 'visits', count(distinct sid) filter (where kind = 'st_booked')),
        jsonb_build_object('step', 'Went to pay', 'visits', count(distinct sid) filter (where kind = 'pay_click' and data->>'type' = 'villa')),
        jsonb_build_object('step', 'Paid', 'visits', count(distinct sid) filter (where kind = 'pay_return_ok' and data->>'type' = 'villa'))) from ev),
    'blocked', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('reason', coalesce(data->>'reason', kind), 'times', count(*), 'visits', count(distinct sid)) as x
          from ev where kind in ('dt_blocked', 'st_blocked', 'dt_error', 'st_error', 'pay_error')
         group by coalesce(data->>'reason', kind) order by count(*) desc limit 12) z),
    'email_clicks', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('email', coalesce(utm_campaign, '?'), 'visits', count(distinct sid)) as x
          from ev where utm_medium = 'email' group by utm_campaign order by count(distinct sid) desc limit 10) z),
    'bookings', (select jsonb_build_object(
        'count', count(*),
        'guests', coalesce(sum(coalesce(adults, 0) + coalesce(children_6_12, 0) + coalesce(children_0_5, 0)), 0),
        'value', coalesce(sum(total_amount) filter (where status not in ('declined', 'expired')), 0),
        'cancelled', count(*) filter (where status in ('declined', 'expired')),
        'by_origin', (select coalesce(jsonb_object_agg(o, n), '{}') from (
            select coalesce(booking_origin, case when cb_owned then 'cloudbeds' else 'site_guest' end) o, count(*) n
              from booking_requests where created_at >= t0 and created_at < t1 and coalesce(source, '') <> 'sheet_import' group by 1) z),
        'by_type', (select coalesce(jsonb_object_agg(coalesce(stay_type, '?'), n), '{}') from (
            select stay_type, count(*) n from booking_requests
             where created_at >= t0 and created_at < t1 and coalesce(source, '') <> 'sheet_import' group by 1) z),
        'by_source', (select coalesce(jsonb_object_agg(coalesce(source, '?'), n), '{}') from (
            select source, count(*) n from booking_requests
             where created_at >= t0 and created_at < t1 and coalesce(source, '') <> 'sheet_import' group by 1) z),
        'lead_days', (select round(avg(check_in - (created_at at time zone 'Asia/Manila')::date)) from booking_requests
             where created_at >= t0 and created_at < t1 and coalesce(source, '') <> 'sheet_import' and check_in is not null))
      from booking_requests where created_at >= t0 and created_at < t1 and coalesce(source, '') <> 'sheet_import'),
    'payments', (select jsonb_build_object(
        'links_created', count(*),
        'paid', count(*) filter (where status in ('PAID', 'SETTLED')),
        'paid_amount', coalesce(sum(coalesce(paid_amount, amount)) filter (where status in ('PAID', 'SETTLED')), 0),
        'expired', count(*) filter (where status = 'EXPIRED'),
        'failed', count(*) filter (where status = 'failed'),
        'by_channel', (select coalesce(jsonb_object_agg(ch, n), '{}') from (
            select coalesce(payment_channel, '?') ch, count(*) n from xendit_invoices
             where created_at >= t0 and created_at < t1 and status in ('PAID', 'SETTLED') and coalesce(live, true) group by 1) z))
      from xendit_invoices where created_at >= t0 and created_at < t1 and coalesce(live, true)),
    'emails', (select jsonb_build_object(
        'sent', count(*) filter (where status = 'sent'),
        'failed', count(*) filter (where status = 'failed'),
        'by_kind', (select coalesce(jsonb_object_agg(k, n), '{}') from (
            select split_part(kind, ':', 1) k, count(*) n from booking_email_log
             where created_at >= t0 and created_at < t1 and status = 'sent' group by 1) z))
      from booking_email_log where created_at >= t0 and created_at < t1),
    'staff', (select coalesce(jsonb_agg(x order by (x->>'actions')::int desc), '[]') from (
        select jsonb_build_object('who', who,
                 'actions', sum(n), 'changes', sum(n) filter (where src = 'change'),
                 'top', (array_agg(k order by n desc))[1:4]) as x
          from (
            select actor as who, kind as k, count(*) n, 'event' src from site_events
             where at >= t0 and at < t1 and kind like 'staff_%' and actor is not null group by actor, kind
            union all
            select changed_by_email, 'booking ' || action, count(*), 'change' from booking_audit_log
             where logged_at >= t0 and logged_at < t1 and changed_by_email is not null group by changed_by_email, action
          ) a group by who) z)
  ) into r
  from (select 1) one;
  return r;
end;
$$;
revoke all on function site_insights(date, date) from public, anon;
grant execute on function site_insights(date, date) to authenticated;

select 'v44 applied' as status;
