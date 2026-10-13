-- ============================================================================
-- Booking rules v12 — Staff activity ("last active", not just "last sign-in")
--
-- Supabase's "Last sign in at" only changes when someone types their password
-- again. Staff stay signed in for days, so it says nothing about when they
-- last used the dashboard. This adds:
--
--   * staff_visits        — the dashboard pings staff_heartbeat() every couple
--                           of minutes while a staff member is actually using
--                           it (mouse / keyboard / touch, tab in front). Pings
--                           less than 30 minutes apart extend the same visit,
--                           so each row is one working session: started → last
--                           seen, plus the device it came from.
--   * staff_activity_overview()  — one row per staff account: last active,
--                           dashboard last open, last sign-in, last booking
--                           change, activity counts.
--   * staff_activity_history()   — a timeline per person, including history
--                           from BEFORE this update, rebuilt from what Supabase
--                           already stores:
--                             - auth.sessions       → each fresh sign-in + device
--                             - auth.refresh_tokens → the sign-in token renews
--                               about hourly while the dashboard is open, so
--                               these are grouped into "dashboard open" periods
--                             - booking_audit_log   → every booking change
--
-- Only signed-in staff can call these (same as the Activity Log). Re-runnable.
-- ============================================================================

create table if not exists staff_visits (
  id bigserial primary key,
  user_id uuid not null,
  email text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  pings int not null default 1,
  user_agent text
);
create index if not exists staff_visits_user_seen on staff_visits (user_id, last_seen_at desc);
alter table staff_visits enable row level security;
drop policy if exists "Staff can view visits" on staff_visits;
create policy "Staff can view visits" on staff_visits for select to authenticated using (true);
-- No insert/update/delete policies: rows are only written by staff_heartbeat().

create or replace function staff_heartbeat(p_user_agent text default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_id bigint;
begin
  if v_uid is null then return; end if;
  select id into v_id from staff_visits
   where user_id = v_uid and last_seen_at > now() - interval '30 minutes'
   order by last_seen_at desc limit 1;
  if v_id is null then
    select email into v_email from auth.users where id = v_uid;
    insert into staff_visits (user_id, email, user_agent) values (v_uid, v_email, left(p_user_agent, 300));
  else
    update staff_visits set last_seen_at = now(), pings = pings + 1 where id = v_id;
  end if;
end;
$$;
revoke all on function staff_heartbeat(text) from public, anon;
grant execute on function staff_heartbeat(text) to authenticated;

drop function if exists staff_activity_overview();
create or replace function staff_activity_overview()
returns table (
  user_id uuid, email text, created_at timestamptz,
  last_active_at timestamptz,      -- best estimate of the last time they used the dashboard
  last_interaction_at timestamptz, -- last heartbeat (actually clicking/typing)
  last_open_at timestamptz,        -- last token renewal (dashboard open in a tab)
  last_sign_in_at timestamptz,     -- last time they typed their password
  last_change_at timestamptz,      -- last booking created/edited
  changes_30d bigint, visits_30d bigint, open_days_30d bigint
)
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Staff only'; end if;
  return query
  with v as (
    select sv.user_id, max(sv.last_seen_at) as last_seen,
           count(*) filter (where sv.started_at > now() - interval '30 days') as n30
      from staff_visits sv group by sv.user_id
  ), t as (
    select rt.user_id::uuid as user_id,
           max(greatest(rt.created_at, least(coalesce(rt.updated_at, rt.created_at), rt.created_at + interval '70 minutes'))) as last_tok,
           count(distinct date(rt.created_at at time zone 'Asia/Manila')) filter (where rt.created_at > now() - interval '30 days') as days30
      from auth.refresh_tokens rt
     where rt.user_id ~ '^[0-9a-f-]{36}$'
     group by rt.user_id
  ), s as (
    select se.user_id, max(greatest(se.created_at, coalesce(se.refreshed_at::timestamptz, se.created_at))) as last_sess
      from auth.sessions se group by se.user_id
  ), c as (
    select l.changed_by_id as user_id, max(l.logged_at) as last_change,
           count(*) filter (where l.logged_at > now() - interval '30 days') as n30
      from booking_audit_log l where l.changed_by_id is not null group by l.changed_by_id
  )
  select u.id, u.email::text, u.created_at,
         nullif(greatest(coalesce(v.last_seen, '-infinity'), coalesce(t.last_tok, '-infinity'), coalesce(s.last_sess, '-infinity'),
                         coalesce(c.last_change, '-infinity'), coalesce(u.last_sign_in_at, '-infinity')), '-infinity'::timestamptz),
         v.last_seen,
         nullif(greatest(coalesce(t.last_tok, '-infinity'), coalesce(s.last_sess, '-infinity')), '-infinity'::timestamptz),
         u.last_sign_in_at, c.last_change,
         coalesce(c.n30, 0), coalesce(v.n30, 0), coalesce(t.days30, 0)
    from auth.users u
    left join v on v.user_id = u.id
    left join t on t.user_id = u.id
    left join s on s.user_id = u.id
    left join c on c.user_id = u.id
   order by 4 desc nulls last;
end;
$$;
revoke all on function staff_activity_overview() from public, anon;
grant execute on function staff_activity_overview() to authenticated;

drop function if exists staff_activity_history(uuid, int);
create or replace function staff_activity_history(p_user_id uuid default null, p_days int default 30)
returns table (at timestamptz, ended_at timestamptz, user_id uuid, email text, kind text, detail text)
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if auth.uid() is null then raise exception 'Staff only'; end if;
  return query
  with emails as (select u.id, u.email::text as email from auth.users u),
  -- tokens renewed less than 90 minutes apart = one "dashboard open" period
  tok as (
    select rt.user_id::uuid as uid, rt.created_at as t0,
           greatest(rt.created_at, least(coalesce(rt.updated_at, rt.created_at), rt.created_at + interval '70 minutes')) as t1
      from auth.refresh_tokens rt
     where rt.user_id ~ '^[0-9a-f-]{36}$' and rt.created_at >= v_since
       and (p_user_id is null or rt.user_id = p_user_id::text)
  ), tok_l as (
    select tok.*, lag(tok.t1) over (partition by tok.uid order by tok.t0) as prev_t1 from tok
  ), tok_g as (
    select tok_l.*, sum(case when tok_l.prev_t1 is null or tok_l.t0 - tok_l.prev_t1 > interval '90 minutes' then 1 else 0 end)
                    over (partition by tok_l.uid order by tok_l.t0) as grp
      from tok_l
  ), periods as (
    select tok_g.uid, min(tok_g.t0) as p0, max(tok_g.t1) as p1, count(*) as n from tok_g group by tok_g.uid, tok_g.grp
  )
  select x.at, x.ended_at, x.user_id, e.email, x.kind, x.detail
  from (
    select sv.started_at as at, sv.last_seen_at as ended_at, sv.user_id, 'active'::text as kind,
           coalesce(sv.user_agent, '') as detail
      from staff_visits sv
     where sv.last_seen_at >= v_since and (p_user_id is null or sv.user_id = p_user_id)
    union all
    select p.p0, p.p1, p.uid, 'open', p.n::text from periods p
    union all
    select se.created_at, null::timestamptz, se.user_id, 'sign_in', coalesce(se.user_agent, '')
      from auth.sessions se
     where se.created_at >= v_since and (p_user_id is null or se.user_id = p_user_id)
    union all
    select u.last_sign_in_at, null::timestamptz, u.id, 'sign_in', ''
      from auth.users u
     where u.last_sign_in_at >= v_since and (p_user_id is null or u.id = p_user_id)
       and not exists (select 1 from auth.sessions se2 where se2.user_id = u.id
                        and abs(extract(epoch from se2.created_at - u.last_sign_in_at)) < 120)
    union all
    select l.logged_at, null::timestamptz, l.changed_by_id, 'change',
           concat_ws(' · ', l.action, nullif(l.guest_name, ''), nullif(l.order_code, ''))
      from booking_audit_log l
     where l.logged_at >= v_since and l.changed_by_id is not null
       and (p_user_id is null or l.changed_by_id = p_user_id)
  ) x
  left join emails e on e.id = x.user_id
  order by x.at desc
  limit 1000;
end;
$$;
revoke all on function staff_activity_history(uuid, int) from public, anon;
grant execute on function staff_activity_history(uuid, int) to authenticated;
