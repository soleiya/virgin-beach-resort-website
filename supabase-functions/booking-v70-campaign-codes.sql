-- =============================================================================
-- booking-v70: offer codes inventory + code attempts; Campaigns for all staff
--
-- 1. Campaigns is open to every staff account (it was miguel@ only).
--    View-only accounts (booking_settings.readonly_staff_emails) can look but
--    not change anything: the v56 zz_guard_readonly_staff trigger now also
--    sits on the campaign tables, and campaign_access() tells the page and
--    the campaigns function which one the account is.
-- 2. discount_code_attempts: every time a guest applies a code on the
--    website (booking pages), the page logs it through log_code_attempt():
--    the code as typed, whether it worked and why not, the email on the form
--    (if typed), the visit's anonymous browser id, page and device. A booking
--    sent with a code is logged too (stage 'booked' / 'refused'). Anonymous
--    callers can only add rows (rate-limited); nobody can read them except
--    staff through the functions below.
-- 3. campaign_codes(filters)        the inventory of codes sent by campaigns:
--                                   who, when, tried, booked, active
--    campaign_code_detail(code)     one code: recipient, attempts, bookings
--    campaign_code_attempts(...)    recent attempts on the site, including
--                                   codes that don't exist (typos, guessing)
--    campaign_code_set_active(codes, on)  disable / re-enable codes
-- Re-runnable.
-- =============================================================================

-- 1. every staff account ----------------------------------------------------------
create or replace function campaign_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') in ('service_role', 'authenticated');
$$;

create or replace function campaign_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email', lower(coalesce(auth.jwt() ->> 'email', '')),
    'staff', coalesce(auth.role(), '') in ('service_role', 'authenticated'),
    'can_edit', coalesce(auth.role(), '') = 'service_role'
      or (coalesce(auth.role(), '') = 'authenticated'
          and not exists (select 1 from booking_settings s where lower(coalesce(auth.jwt() ->> 'email', '')) = any(s.readonly_staff_emails))));
$$;
revoke all on function campaign_access() from public, anon;
grant execute on function campaign_access() to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['campaigns', 'campaign_recipients', 'campaign_settings', 'campaign_admins', 'guest_profiles'] loop
    execute format('drop trigger if exists zz_guard_readonly_staff on %I', t);
    execute format('create trigger zz_guard_readonly_staff before insert or update or delete on %I for each row execute function guard_readonly_staff()', t);
  end loop;
end $$;

-- 2. code attempts ----------------------------------------------------------------
create table if not exists discount_code_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  code text not null,                 -- as typed (upper-cased)
  known boolean not null default false,
  campaign_id uuid,
  kind text,                          -- overnight / day_trip
  stage text not null default 'apply',-- apply / booked / refused
  ok boolean not null,
  error text,
  email text,                         -- email on the booking form, if typed
  matches_owner boolean,              -- email = the address the code was sent to
  check_in date,
  order_code text,
  vid text, page text, device text,
  repeats int not null default 1      -- same browser + code + result again within 10 minutes
);
create index if not exists discount_code_attempts_code on discount_code_attempts (code, at desc);
create index if not exists discount_code_attempts_at on discount_code_attempts (at desc);
create index if not exists discount_code_attempts_vid on discount_code_attempts (vid, at desc);
alter table discount_code_attempts enable row level security;
revoke all on discount_code_attempts from anon, authenticated;

create or replace function log_code_attempt(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(left(regexp_replace(trim(coalesce(p->>'code', '')), '\s+', '', 'g'), 40));
  v_vid text := nullif(left(coalesce(p->>'vid', ''), 40), '');
  v_ok boolean := coalesce((p->>'ok')::boolean, false);
  v_stage text := case when p->>'stage' in ('apply', 'booked', 'refused') then p->>'stage' else 'apply' end;
  v_email text := lower(trim(left(coalesce(p->>'email', ''), 160)));
  v_err text := nullif(left(coalesce(p->>'error', ''), 200), '');
  dc discount_codes%rowtype;
  v_id bigint;
begin
  if length(v_code) < 2 then return; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then v_email := null; end if;
  -- rate limits: 40 a browser an hour, 3000 a day overall
  if v_vid is not null and (select count(*) from discount_code_attempts where vid = v_vid and at > now() - interval '1 hour') >= 40 then return; end if;
  if (select count(*) from discount_code_attempts where at > now() - interval '1 day') >= 3000 then return; end if;
  select * into dc from discount_codes where code = v_code;
  -- the same browser, code and result again shortly after → count it on the last row
  if v_stage = 'apply' then
    select id into v_id from discount_code_attempts
     where vid is not distinct from v_vid and code = v_code and ok = v_ok and stage = 'apply'
       and error is not distinct from v_err and at > now() - interval '10 minutes'
     order by at desc limit 1;
    if v_id is not null then
      update discount_code_attempts set repeats = repeats + 1, at = now(),
        email = coalesce(v_email, email),
        matches_owner = case when coalesce(v_email, email) is null or dc.assigned_email is null then matches_owner else lower(coalesce(v_email, email)) = dc.assigned_email end
      where id = v_id;
      return;
    end if;
  end if;
  insert into discount_code_attempts (code, known, campaign_id, kind, stage, ok, error, email, matches_owner, check_in, order_code, vid, page, device)
  values (v_code, dc.code is not null, dc.campaign_id,
    case when p->>'kind' in ('overnight', 'day_trip') then p->>'kind' end, v_stage, v_ok, v_err, v_email,
    case when v_email is null or dc.assigned_email is null then null else v_email = dc.assigned_email end,
    case when coalesce(p->>'check_in', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'check_in')::date end,
    nullif(left(coalesce(p->>'order_code', ''), 40), ''), v_vid, nullif(left(coalesce(p->>'page', ''), 80), ''),
    case when p->>'device' in ('mobile', 'tablet', 'desktop') then p->>'device' end);
end;
$$;
revoke all on function log_code_attempt(jsonb) from public;
grant execute on function log_code_attempt(jsonb) to anon, authenticated, service_role;

-- 3. the inventory ------------------------------------------------------------------
-- one row per campaign code with its use
create or replace view campaign_code_rows as
  select dc.code, dc.campaign_id, c.name as campaign, c.status as campaign_status, dc.assigned_email as email,
    cr.name as guest_name, cr.status as send_status, cr.sent_at, cr.error as send_error,
    dc.active, dc.expires_on, dc.discount_kind, dc.percent, dc.amount_off, dc.perk, dc.booking_kinds, dc.max_uses,
    dc.updated_at, dc.note,
    coalesce(a.tries, 0) as tries, coalesce(a.failed, 0) as failed_tries, a.last_try, a.last_ok, a.last_error, a.other_email,
    coalesce(b.bookings, 0) as bookings, b.orders, coalesce(b.discount, 0) as discount, coalesce(b.revenue, 0) as revenue, b.last_booked,
    case
      when coalesce(b.bookings, 0) > 0 then 'booked'
      when not dc.active then 'disabled'
      when dc.expires_on is not null and dc.expires_on < (now() at time zone 'Asia/Manila')::date then 'expired'
      when coalesce(a.tries, 0) > 0 then 'tried'
      when cr.status = 'sent' then 'sent'
      when cr.status in ('failed', 'skipped') then 'not_sent'
      else 'queued' end as state
  from discount_codes dc
  join campaigns c on c.id = dc.campaign_id
  left join campaign_recipients cr on cr.campaign_id = dc.campaign_id and cr.code = dc.code
  left join lateral (
    select sum(x.repeats)::int as tries, sum(x.repeats) filter (where not x.ok)::int as failed, max(x.at) as last_try,
      (array_agg(x.ok order by x.at desc))[1] as last_ok, (array_agg(x.error order by x.at desc))[1] as last_error,
      bool_or(x.matches_owner = false) as other_email
    from discount_code_attempts x where x.code = dc.code) a on true
  left join lateral (
    select count(*)::int as bookings, string_agg(bk.order_code || ' (' || bk.status::text || ')', ', ' order by bk.created_at) as orders,
      sum(case when coalesce(bk.code_discount, 0) > 0 then bk.code_discount else coalesce(bk.discount_amount, 0) end) as discount,
      sum(coalesce(bk.total_amount, 0)) as revenue, max(bk.created_at) as last_booked
    from booking_requests bk where bk.discount_code = dc.code and bk.status::text not in ('declined', 'expired')) b on true
  where dc.campaign_id is not null;
revoke all on campaign_code_rows from anon, authenticated;

create or replace function campaign_codes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(lower(trim(coalesce(p->>'search', ''))), '');
  v_state text := nullif(p->>'state', '');
  v_camp uuid := nullif(p->>'campaign_id', '')::uuid;
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 100), 1), 500);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  r jsonb;
begin
  perform campaign_guard();
  with base as (
    select * from campaign_code_rows x
    where (v_camp is null or x.campaign_id = v_camp)
      and (v_q is null or lower(x.code) like '%' || v_q || '%' or lower(coalesce(x.email, '')) like '%' || v_q || '%'
           or lower(coalesce(x.guest_name, '')) like '%' || v_q || '%' or lower(coalesce(x.orders, '')) like '%' || v_q || '%')
  ), f as (
    select * from base where v_state is null or state = v_state or (v_state = 'active' and active and state not in ('expired', 'booked'))
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'counts', (select jsonb_object_agg(state, n) from (select state, count(*) n from base group by state) s),
    'all', (select count(*) from base),
    'tried_any', (select count(*) from base where tries > 0),
    'discount', (select coalesce(sum(discount), 0) from base),
    'revenue', (select coalesce(sum(revenue), 0) from base),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.created_at desc), '[]')
                  from campaigns c where exists (select 1 from discount_codes d where d.campaign_id = c.id)),
    'rows', (select coalesce(jsonb_agg(to_jsonb(f2) order by coalesce(f2.last_booked, f2.last_try, f2.sent_at) desc nulls last, f2.code), '[]')
             from (select * from f order by coalesce(last_booked, last_try, sent_at) desc nulls last, code limit v_limit offset v_offset) f2)
  ) into r;
  return r;
end;
$$;
revoke all on function campaign_codes(jsonb) from public, anon;
grant execute on function campaign_codes(jsonb) to authenticated, service_role;

create or replace function campaign_code_detail(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_code text := upper(trim(coalesce(p_code, ''))); r jsonb;
begin
  perform campaign_guard();
  select jsonb_build_object(
    'code', (select to_jsonb(x) from campaign_code_rows x where x.code = v_code),
    'plain', (select jsonb_build_object('code', d.code, 'label', d.label, 'active', d.active, 'expires_on', d.expires_on, 'note', d.note) from discount_codes d where d.code = v_code),
    'attempts', (select coalesce(jsonb_agg(to_jsonb(a) - 'vid' || jsonb_build_object('browser', left(a.vid, 6)) order by a.at desc), '[]')
                 from (select * from discount_code_attempts where code = v_code order by at desc limit 200) a),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'order_code', b.order_code, 'status', b.status, 'stay_type', b.stay_type,
                   'check_in', b.check_in, 'guest_email', b.guest_email, 'total', b.total_amount,
                   'discount', case when coalesce(b.code_discount, 0) > 0 then b.code_discount else coalesce(b.discount_amount, 0) end,
                   'created_at', b.created_at) order by b.created_at desc), '[]')
                 from booking_requests b where b.discount_code = v_code)
  ) into r;
  return r;
end;
$$;
revoke all on function campaign_code_detail(text) from public, anon;
grant execute on function campaign_code_detail(text) to authenticated, service_role;

-- recent attempts on the website (all codes, also unknown ones)
create or replace function campaign_code_attempts(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 100), 1), 500);
  v_days int := least(greatest(coalesce((p->>'days')::int, 30), 1), 365);
  v_only text := nullif(p->>'only', ''); -- failed / unknown / campaign
  r jsonb;
begin
  perform campaign_guard();
  select jsonb_build_object(
    'summary', (select jsonb_build_object('attempts', coalesce(sum(repeats), 0), 'browsers', count(distinct vid),
        'failed', coalesce(sum(repeats) filter (where not ok), 0), 'unknown', coalesce(sum(repeats) filter (where not known), 0),
        'booked', count(*) filter (where stage = 'booked'))
      from discount_code_attempts where at > now() - make_interval(days => v_days)),
    'rows', (select coalesce(jsonb_agg(to_jsonb(a) - 'vid' || jsonb_build_object('browser', left(a.vid, 6), 'campaign', c.name, 'owner', dc.assigned_email)
        order by a.at desc), '[]')
      from (select * from discount_code_attempts x where x.at > now() - make_interval(days => v_days)
              and (v_only is null or (v_only = 'failed' and not x.ok) or (v_only = 'unknown' and not x.known) or (v_only = 'campaign' and x.campaign_id is not null))
            order by x.at desc limit v_limit) a
      left join campaigns c on c.id = a.campaign_id
      left join discount_codes dc on dc.code = a.code)
  ) into r;
  return r;
end;
$$;
revoke all on function campaign_code_attempts(jsonb) from public, anon;
grant execute on function campaign_code_attempts(jsonb) to authenticated, service_role;

create or replace function campaign_code_set_active(p_codes text[], p_active boolean) returns int
language plpgsql security definer set search_path = public as $$
declare v_by text := coalesce(nullif(lower(auth.jwt() ->> 'email'), ''), 'staff'); n int;
begin
  perform campaign_guard();
  if coalesce(cardinality(p_codes), 0) = 0 then return 0; end if;
  if cardinality(p_codes) > 5000 then raise exception 'Too many codes at once'; end if;
  update discount_codes d set active = p_active,
    note = concat_ws(E'\n', nullif(d.note, ''), '[' || case when p_active then 'Re-enabled' else 'Disabled' end || ' ' ||
      to_char(now() at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || ' by ' || v_by || ']')
  where d.code = any(select upper(trim(x)) from unnest(p_codes) x) and d.campaign_id is not null and d.active is distinct from p_active;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function campaign_code_set_active(text[], boolean) from public, anon;
grant execute on function campaign_code_set_active(text[], boolean) to authenticated, service_role;

select 'v70 applied' as status;
