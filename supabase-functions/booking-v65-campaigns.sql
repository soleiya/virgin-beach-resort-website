-- =============================================================================
-- booking-v65: Offers & Campaigns (staff dashboard → "Campaigns" view,
-- assets/js/staff-campaigns.js; edge function supabase-functions/campaigns).
--
-- * guest_profiles   one row per guest email, rebuilt from booking_requests +
--                    the Cloudbeds guest directory (cb_guest_contacts): visits,
--                    nights, spend, party, family / friends / couple / corporate
--                    segment, months visited, last / next visit.
-- * campaigns        an offer to a group of guests: who (audience rule), what
--                    (percent / peso off, or a freebie), the email copy, and its
--                    status: suggested (by AI) → draft → sending → sent, or
--                    declined / paused / cancelled.
-- * campaign_recipients  one per guest: their personal code and send status.
-- * Personal codes are ordinary discount_codes rows (v24/v28), single use, tied
--   to the campaign and the guest's email — so the website's booking pages
--   (villas and day trips) already apply them. New: discount_kind 'perk' (a
--   freebie, ₱0 off, shown on the booking and in Cloudbeds' notes).
-- * Only campaign_admins (miguel@staff.local to start) can use any of it; the
--   database refuses everyone else, not just the page.
-- * Opt-outs: every email has an unsubscribe link (campaign_unsubscribe);
--   campaign_optouts survives profile rebuilds.
-- Re-runnable.
-- =============================================================================

-- 0. who may use Campaigns --------------------------------------------------------
create table if not exists campaign_admins (
  email text primary key check (email = lower(trim(email))),
  added_at timestamptz not null default now()
);
insert into campaign_admins (email) values ('miguel@staff.local') on conflict do nothing;
alter table campaign_admins enable row level security;
revoke all on campaign_admins from anon, authenticated;

create or replace function campaign_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from campaign_admins a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function campaign_is_admin() to authenticated, service_role;

create or replace function campaign_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not campaign_is_admin() then raise exception 'Campaigns are not available for this account' using errcode = '42501'; end if;
end;
$$;

-- 1. Cloudbeds guest directory (filled by the campaigns edge function) ------------
create table if not exists cb_guest_contacts (
  reservation_id text not null,
  guest_id text not null,
  name text, email text, phone text, country text,
  is_main boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (reservation_id, guest_id)
);
create index if not exists cb_guest_contacts_email_idx on cb_guest_contacts (lower(email));
alter table cb_guest_contacts enable row level security;
revoke all on cb_guest_contacts from anon, authenticated;

create or replace function campaign_upsert_contacts(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform campaign_guard();
  insert into cb_guest_contacts (reservation_id, guest_id, name, email, phone, country, is_main, updated_at)
  select distinct on (x->>'reservation_id', coalesce(nullif(x->>'guest_id', ''), 'main'))
         x->>'reservation_id', coalesce(nullif(x->>'guest_id', ''), 'main'),
         nullif(trim(x->>'name'), ''), nullif(lower(trim(x->>'email')), ''), nullif(trim(x->>'phone'), ''),
         nullif(trim(x->>'country'), ''), coalesce((x->>'is_main')::boolean, false), now()
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
  where nullif(x->>'reservation_id', '') is not null
  on conflict (reservation_id, guest_id) do update set
    name = coalesce(excluded.name, cb_guest_contacts.name), email = coalesce(excluded.email, cb_guest_contacts.email),
    phone = coalesce(excluded.phone, cb_guest_contacts.phone), country = coalesce(excluded.country, cb_guest_contacts.country),
    is_main = excluded.is_main or cb_guest_contacts.is_main, updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function campaign_upsert_contacts(jsonb) from public, anon;
grant execute on function campaign_upsert_contacts(jsonb) to authenticated, service_role;

-- 2. guest profiles ---------------------------------------------------------------
create table if not exists campaign_optouts (
  email text primary key,
  at timestamptz not null default now(),
  source text
);
alter table campaign_optouts enable row level security;
revoke all on campaign_optouts from anon, authenticated;

create table if not exists guest_profiles (
  email text primary key,
  name text, phone text, country text,
  first_visit date, last_visit date, next_visit date,
  visits int not null default 0, villa_stays int not null default 0, day_trips int not null default 0,
  nights int not null default 0, spend numeric not null default 0, avg_spend numeric not null default 0,
  max_party int not null default 0, kids boolean not null default false, seniors boolean not null default false,
  segment text, tier text, months int[], sources text[], occasions text[],
  opt_in boolean not null default false,
  last_order_code text,
  updated_at timestamptz not null default now()
);
create index if not exists guest_profiles_segment_idx on guest_profiles (segment, tier);
alter table guest_profiles enable row level security;
revoke all on guest_profiles from anon, authenticated;

-- an email we may write to (not an OTA relay, not our own, looks valid)
create or replace function campaign_email_ok(p text) returns boolean
language sql immutable as $$
  select p ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
     and p !~* '@(guest\.booking\.com|m\.expediapartnercentral\.com|agoda-messaging\.com|messaging\.agoda\.com|guest\.trip\.com|airbnb\.com|guest\.airbnb\.com|virginbeachresort\.com|staff\.local)$'
     and p !~* '^(no-?reply|noemail|none|na|test)@';
$$;

-- the kind of party a booking was
create or replace function campaign_booking_segment(b booking_requests) returns text
language sql immutable as $$
  select case
    when b.stay_type = 'corporate' or b.source in ('corporate', 'events') or b.occasion = 'team_building'
      or coalesce(b.guest_name, '') ~* '\m(inc|corp|corporation|company|co|ltd|llc|bank|school|university|college|foundation|association|dept|department|agency|services|holdings|enterprises?)\M'
      then 'corporate'
    when coalesce(b.children_6_12, 0) + coalesce(b.children_0_5, 0) > 0 or b.stay_type = 'all_inclusive_family' then 'family'
    when coalesce(b.adults, 0) >= 3 or b.stay_type = 'all_inclusive_barkada' then 'friends'
    when coalesce(b.adults, 0) = 2 then 'couple'
    else 'solo' end;
$$;

create or replace function campaign_rebuild_profiles() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date; n int; v_noemail int;
begin
  perform campaign_guard();
  drop table if exists _pb;
  create temp table _pb on commit drop as
  select b.*, campaign_booking_segment(b) as seg,
         coalesce(case when campaign_email_ok(lower(trim(b.guest_email))) then lower(trim(b.guest_email)) end,
                  (select c.email from cb_guest_contacts c where c.reservation_id = b.cb_reservation_id and campaign_email_ok(c.email)
                   order by c.is_main desc, c.updated_at desc limit 1)) as em,
         coalesce(nullif(trim(b.guest_phone), ''),
                  (select c.phone from cb_guest_contacts c where c.reservation_id = b.cb_reservation_id and c.phone is not null
                   order by c.is_main desc limit 1)) as ph
  from booking_requests b
  where b.status::text not in ('declined', 'expired', 'inquiry')
    and coalesce(b.source, '') <> 'staff_stay';
  select count(*) into v_noemail from _pb where em is null;

  delete from guest_profiles where true;
  insert into guest_profiles (email, name, phone, country, first_visit, last_visit, next_visit, visits, villa_stays, day_trips,
    nights, spend, avg_spend, max_party, kids, seniors, segment, tier, months, sources, occasions, opt_in, last_order_code, updated_at)
  select em,
    (array_agg(guest_name order by check_in desc nulls last))[1],
    (array_agg(ph order by check_in desc nulls last) filter (where ph is not null))[1],
    (array_agg(country order by check_in desc nulls last) filter (where country is not null))[1],
    min(check_in) filter (where check_in <= v_today),
    max(check_in) filter (where check_in <= v_today),
    min(check_in) filter (where check_in > v_today),
    count(*),
    count(*) filter (where stay_type = 'overnight'),
    count(*) filter (where stay_type <> 'overnight'),
    coalesce(sum(greatest(check_out - check_in, 0)) filter (where stay_type = 'overnight'), 0),
    coalesce(sum(total_amount), 0),
    round(coalesce(avg(total_amount), 0)),
    coalesce(max(coalesce(adults, 0) + coalesce(children_6_12, 0) + coalesce(children_0_5, 0)), 0),
    bool_or(coalesce(children_6_12, 0) + coalesce(children_0_5, 0) > 0),
    bool_or(coalesce(senior_count, 0) > 0),
    case when bool_or(seg = 'corporate') then 'corporate'
         else (array_agg(seg order by case seg when 'family' then 1 when 'friends' then 2 when 'couple' then 3 else 4 end))[1] end,
    null,
    (select array_agg(distinct m order by m) from unnest(array_agg(extract(month from check_in)::int)) m where m is not null),
    array_remove(array_agg(distinct source), null),
    array_remove(array_agg(distinct occasion), null),
    bool_or(coalesce(marketing_opt_in, false)),
    (array_agg(order_code order by check_in desc nulls last))[1],
    now()
  from _pb where em is not null
  group by em;
  get diagnostics n = row_count;

  -- segment ties: the most frequent kind of party wins (family > friends > couple > solo on a tie)
  update guest_profiles g set segment = s.seg from (
    select em, (array_agg(seg order by cnt desc, case seg when 'family' then 1 when 'friends' then 2 when 'couple' then 3 else 4 end))[1] as seg
    from (select em, seg, count(*) cnt from _pb where em is not null group by 1, 2) x group by em
  ) s where s.em = g.email and g.segment <> 'corporate';

  update guest_profiles set tier = case
    when spend >= 150000 or visits >= 4 then 'vip'
    when visits >= 2 then 'repeat'
    when last_visit is null then 'upcoming'
    else 'one_time' end
  where true;

  return jsonb_build_object('profiles', n, 'bookings_without_email', v_noemail, 'contacts', (select count(*) from cb_guest_contacts), 'at', now());
end;
$$;
revoke all on function campaign_rebuild_profiles() from public, anon;
grant execute on function campaign_rebuild_profiles() to authenticated, service_role;

-- 3. campaigns ----------------------------------------------------------------------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft'
    check (status in ('suggested', 'draft', 'sending', 'sent', 'paused', 'declined', 'cancelled')),
  source text not null default 'staff' check (source in ('staff', 'ai')),
  rationale text,
  audience jsonb not null default '{}'::jsonb,
  audience_label text,
  offer jsonb not null default '{}'::jsonb,
  code_prefix text,
  expires_on date,
  subject text, headline text, body text, cta_label text,
  est_recipients int, est_bookings numeric, est_revenue numeric,
  ai_model text, ai_batch uuid,
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  launched_at timestamptz, launched_by text, finished_at timestamptz,
  decline_reason text
);
create index if not exists campaigns_status_idx on campaigns (status, created_at desc);
alter table campaigns enable row level security;
revoke all on campaigns from anon, authenticated;

create table if not exists campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  email text not null,
  name text,
  code text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  unsub_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists campaign_recipients_queue_idx on campaign_recipients (status, created_at);
create index if not exists campaign_recipients_email_idx on campaign_recipients (email, sent_at);
create index if not exists campaign_recipients_code_idx on campaign_recipients (code);
alter table campaign_recipients enable row level security;
revoke all on campaign_recipients from anon, authenticated;

create table if not exists campaign_settings (
  key text primary key,
  value jsonb not null
);
alter table campaign_settings enable row level security;
revoke all on campaign_settings from anon, authenticated;
insert into campaign_settings (key, value) values
  ('daily_cap', '300'::jsonb),
  ('batch_size', '25'::jsonb),
  ('test_email', '"migquesada@gmail.com"'::jsonb),
  -- the sales team's 2027 plan (slides "2027 Execution Schedule" + menu launch list), for the AI
  ('calendar', $j$[
    {"month":"2026-12","theme":"Celebrate the Season","notes":"Noche Buena, Christmas Day, NYE Gala; corporate banquets; New Wedding Packages and Grazing Table Packages launch Dec 2026"},
    {"month":"2027-01","theme":"Start the Year with a Feast","notes":"New Year bookings, Balikbayan groups, Summer Early Bird rollout, corporate HR Q1/Q2 retreats, weekend family platters; Valentine's menu, Corporate menu, Team Building menu launch. KPI: 50% advance Q2 bookings. Weekday nights Jan 4 - Mar 21 open online at 2026 rates."},
    {"month":"2027-02","theme":"Love Served on a Plate","notes":"Valentine's dining (Feb 14 cabana + dinner packages), Chinese New Year buffets, Summer Outing kits to HR; Summer Menu & BBQ packages launch. KPI: 100% cabana & dinner occupancy Feb 14."},
    {"month":"2027-03","theme":"Taste of Summer & Holy Week","notes":"Holy Week Mar 22-31 (closed online, by request), early birds, corporate outings, school alumni reunions, Boodle Fight & seafood. KPI: 100% Holy Week; 80% April weekend blocks."},
    {"month":"2027-04","theme":"Grill, Feast & Repeat","notes":"Peak summer occupancy, F&B upselling, Araw ng Kagitingan long weekend, beachside BBQ & unlimited grilling; Mother's Day menu launch. KPI: +15% avg F&B check."},
    {"month":"2027-05","theme":"Mom Deserves the Best","notes":"Mother's Day special buffet, team building, Pavilion 2 banquets; Father's Day menu launch. KPI: sell out Mother's Day; 10 company proposals."},
    {"month":"2027-06","theme":"Dad's Grill & Feast","notes":"Father's Day BBQ & steak, Independence Day weekend, rainy-season midweek, weekend family sharing platters. KPI: 60% weekday room occupancy via staycations."},
    {"month":"2027-07","theme":"Warm Bowls, Happy Souls","notes":"Comfort food, staycations, remote workers; soup & coffee promo; Stay 2 Nights + F&B credit; Filipino Heritage Buffet launch; reactivate past guests. KPI: reactivate 200 past guests; +25% restaurant visits."},
    {"month":"2027-08","theme":"Sarap ng Pilipinas","notes":"Buwan ng Wika buffets, long weekends (Aug 21 Ninoy Aquino Day, Aug 30 National Heroes Day), schools, Sept/Oct MICE. KPI: sell out Aug long weekend rooms."},
    {"month":"2027-09","theme":"Sip, Savor & Stay","notes":"Afternoon merienda, coffee & pastries off-peak sets, MICE & Q4 contracts, Early Bird Christmas packages; Halloween menu and Christmas Party packages launch. KPI: lock 70% of Dec Pavilion 2 dates."},
    {"month":"2027-10","theme":"A Frightfully Delicious Feast","notes":"Halloween packages, Christmas pre-sales, corporate party deposits; Noche Buena & Media Noche menus launch. KPI: full Q4 corporate calendar."},
    {"month":"2027-11","theme":"The Taste of Christmas Begins","notes":"All Saints' weekend dining, early Christmas buffets, holiday food trays; final push for Dec 24-25 & Dec 31. KPI: 90% peak occupancy."}
  ]$j$::jsonb),
  ('products', $j$["Corporate Day Trip","Overnight Company Outing","Team Building Experience","Executive Retreat","Corporate Meetings & Seminars","Christmas Party by the Beach","Employee Incentive Getaway","Family Day Celebration","Villa (casita) overnight stays with full-board meals","Day trip with Dining or Lounge Cabana","Add-ons: massage, ATV rides, bonfire"]$j$::jsonb)
on conflict (key) do nothing;

-- personal codes: discount_codes rows tied to a campaign and a guest
alter table discount_codes add column if not exists campaign_id uuid references campaigns(id) on delete set null;
alter table discount_codes add column if not exists assigned_email text;
alter table discount_codes add column if not exists perk text;
alter table discount_codes alter column percent drop not null;
create index if not exists discount_codes_campaign_idx on discount_codes (campaign_id) where campaign_id is not null;
alter table discount_codes drop constraint if exists discount_codes_amount_check;
alter table discount_codes add constraint discount_codes_amount_check check (
  (discount_kind = 'percent' and percent > 0 and percent <= 100)
  or (discount_kind = 'fixed' and amount_off > 0)
  or (discount_kind = 'perk' and nullif(trim(coalesce(perk, '')), '') is not null));

-- a freebie takes nothing off the bill; it's described instead
create or replace function public.discount_code_amount(dc discount_codes, p_base numeric) returns numeric
language sql immutable as $function$
  select case when dc.discount_kind = 'perk' or coalesce(p_base, 0) <= 0 then 0
              when dc.discount_kind = 'fixed' then round(least(dc.amount_off, p_base), 2)
              else round(p_base * dc.percent / 100, 2) end;
$function$;
create or replace function public.discount_code_amount_text(dc discount_codes) returns text
language sql immutable as $function$
  select case when dc.discount_kind = 'perk' then coalesce(nullif(trim(dc.perk), ''), 'a free perk')
              when dc.discount_kind = 'fixed' then '₱' || to_char(dc.amount_off, 'FM999,999,990.##')
              else trim(to_char(dc.percent, 'FM990.##')) || '%' end;
$function$;
-- the bill line for a code
create or replace function public.discount_code_line(dc discount_codes, p_label text) returns text
language sql immutable as $function$
  select case when dc.discount_kind = 'perk'
              then 'Offer code ' || dc.code || ' — ' || coalesce(nullif(trim(dc.perk), ''), 'a free perk') || ' (we''ll have it ready for you)'
              else 'Discount code ' || dc.code || ' — ' || discount_code_amount_text(dc) || ' ' || coalesce(p_label, '') end;
$function$;

-- the quotations use discount_code_line() for the code's bill line (patched in place)
do $do$
declare d text; n text; f regprocedure; hits int := 0;
begin
  foreach f in array array['public.quote_overnight(date,date,uuid[],int,int,int,int,int,jsonb,boolean,text,date)'::regprocedure,
                           'public.quote_daytrip_code(text,date,numeric,numeric)'::regprocedure] loop
    d := pg_get_functiondef(f);
    n := regexp_replace(d, $re$'(Discount code|Code) '\s*\|\|\s*dc\.code\s*\|\|\s*' — '\s*\|\|\s*discount_code_amount_text\(dc\)\s*\|\|\s*' '\s*\|\|\s*(v_code_label|v_label)$re$,
                        'discount_code_line(dc, \2)', 'g');
    if n <> d then execute n; hits := hits + 1;
    elsif position('discount_code_line(' in d) = 0 then raise exception 'v65: the code line in % was not found', f;
    end if;
  end loop;
  raise notice 'v65: % quotation function(s) patched', hits;
end;
$do$;

-- a personal (campaign) code works only for the guest it was sent to, on the website
create or replace function guard_campaign_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if new.discount_code is null then return new; end if;
  if tg_op = 'UPDATE' and new.discount_code is not distinct from old.discount_code
     and new.guest_email is not distinct from old.guest_email then return new; end if;
  select assigned_email into v_email from discount_codes where code = new.discount_code;
  if v_email is not null and coalesce(new.booking_origin, '') = 'site_guest'
     and lower(trim(coalesce(new.guest_email, ''))) <> v_email then
    raise exception 'Offer code % is personal — please book with the email address it was sent to.', new.discount_code using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists zx_campaign_code_guard on booking_requests;
create trigger zx_campaign_code_guard before insert or update of discount_code, guest_email on booking_requests
  for each row execute function guard_campaign_code();

-- 4. audiences ------------------------------------------------------------------------
-- rule (all optional): segments[], tiers[], kinds[] ('villa','daytrip'), min_visits, max_visits,
-- min_spend, max_spend, last_from, last_to (dates), min_days_since, max_days_since, months[] (visited in),
-- kids (bool), opt_in_only (bool), include_upcoming (bool, default false), countries[],
-- skip_contacted_days (int, default 14), emails[] (just these)
create or replace function campaign_rule_match(g guest_profiles, r jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select campaign_email_ok(g.email)
    and not exists (select 1 from campaign_optouts o where o.email = g.email)
    and (jsonb_typeof(r->'emails') is distinct from 'array' or jsonb_array_length(r->'emails') = 0 or r->'emails' ? g.email)
    and (jsonb_typeof(r->'segments') is distinct from 'array' or jsonb_array_length(r->'segments') = 0 or r->'segments' ? g.segment)
    and (jsonb_typeof(r->'tiers') is distinct from 'array' or jsonb_array_length(r->'tiers') = 0 or r->'tiers' ? g.tier)
    and (jsonb_typeof(r->'kinds') is distinct from 'array' or jsonb_array_length(r->'kinds') = 0
         or (r->'kinds' ? 'villa' and g.villa_stays > 0) or (r->'kinds' ? 'daytrip' and g.day_trips > 0))
    and (nullif(r->>'min_visits', '') is null or g.visits >= (r->>'min_visits')::int)
    and (nullif(r->>'max_visits', '') is null or g.visits <= (r->>'max_visits')::int)
    and (nullif(r->>'min_spend', '') is null or g.spend >= (r->>'min_spend')::numeric)
    and (nullif(r->>'max_spend', '') is null or g.spend <= (r->>'max_spend')::numeric)
    and (nullif(r->>'last_from', '') is null or g.last_visit >= (r->>'last_from')::date)
    and (nullif(r->>'last_to', '') is null or g.last_visit <= (r->>'last_to')::date)
    and (nullif(r->>'min_days_since', '') is null or g.last_visit <= (now() at time zone 'Asia/Manila')::date - (r->>'min_days_since')::int)
    and (nullif(r->>'max_days_since', '') is null or g.last_visit >= (now() at time zone 'Asia/Manila')::date - (r->>'max_days_since')::int)
    and (jsonb_typeof(r->'months') is distinct from 'array' or jsonb_array_length(r->'months') = 0
         or g.months && (select coalesce(array_agg(x::int), '{}') from jsonb_array_elements_text(r->'months') x))
    and (nullif(r->>'kids', '') is null or g.kids = (r->>'kids')::boolean)
    and (not coalesce((r->>'opt_in_only')::boolean, false) or g.opt_in)
    and (coalesce((r->>'include_upcoming')::boolean, false) or g.next_visit is null)
    and (jsonb_typeof(r->'countries') is distinct from 'array' or jsonb_array_length(r->'countries') = 0 or r->'countries' ? coalesce(g.country, ''))
    and (coalesce((r->>'skip_contacted_days')::int, 14) <= 0 or not exists (
         select 1 from campaign_recipients cr where cr.email = g.email and cr.status = 'sent'
           and cr.sent_at > now() - make_interval(days => coalesce((r->>'skip_contacted_days')::int, 14))));
$$;

create or replace function campaign_audience(p_rule jsonb, p_sample int default 12) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform campaign_guard();
  with m as (select g.* from guest_profiles g where campaign_rule_match(g, coalesce(p_rule, '{}'::jsonb)))
  select jsonb_build_object(
    'count', (select count(*) from m),
    'spend', (select coalesce(sum(spend), 0) from m),
    'by_segment', (select coalesce(jsonb_object_agg(coalesce(segment, '?'), n), '{}') from (select segment, count(*) n from m group by 1) x),
    'by_tier', (select coalesce(jsonb_object_agg(coalesce(tier, '?'), n), '{}') from (select tier, count(*) n from m group by 1) x),
    'sample', (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'name', name, 'segment', segment, 'tier', tier,
                 'visits', visits, 'last_visit', last_visit, 'spend', spend)), '[]')
               from (select * from m order by spend desc limit greatest(coalesce(p_sample, 12), 0)) s)
  ) into r;
  return r;
end;
$$;
revoke all on function campaign_audience(jsonb, int) from public, anon;
grant execute on function campaign_audience(jsonb, int) to authenticated, service_role;

-- the segment × tier picture (for the page and the AI)
create or replace function campaign_segments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  perform campaign_guard();
  select jsonb_build_object(
    'profiles', (select count(*) from guest_profiles),
    'emailable', (select count(*) from guest_profiles g where campaign_email_ok(g.email) and not exists (select 1 from campaign_optouts o where o.email = g.email)),
    'opted_out', (select count(*) from campaign_optouts),
    'opt_in', (select count(*) from guest_profiles where opt_in),
    'updated_at', (select max(updated_at) from guest_profiles),
    'segments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.guests desc), '[]') from (
      select segment, tier, count(*) as guests, round(avg(visits), 1) as avg_visits, round(avg(spend)) as avg_spend,
             round(sum(spend)) as total_spend, round(avg(v_today - last_visit)) as avg_days_since,
             count(*) filter (where kids) as with_kids, count(*) filter (where villa_stays > 0) as villa_guests,
             count(*) filter (where day_trips > 0) as daytrip_guests, count(*) filter (where next_visit is not null) as upcoming,
             count(*) filter (where last_visit < v_today - 365) as lapsed_1y
      from guest_profiles group by 1, 2) x),
    'months', (select coalesce(jsonb_object_agg(m, n), '{}') from (
      select m, count(*) n from guest_profiles, unnest(months) m group by 1) x)
  ) into r;
  return r;
end;
$$;
revoke all on function campaign_segments() from public, anon;
grant execute on function campaign_segments() to authenticated, service_role;

create or replace function campaign_guests(p_search text default null, p_segment text default null, p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; q text := lower(nullif(trim(coalesce(p_search, '')), ''));
begin
  perform campaign_guard();
  with m as (
    select g.*, exists (select 1 from campaign_optouts o where o.email = g.email) as opted_out,
           (select max(cr.sent_at) from campaign_recipients cr where cr.email = g.email and cr.status = 'sent') as contacted_at
    from guest_profiles g
    where (q is null or g.email like '%' || q || '%' or lower(coalesce(g.name, '')) like '%' || q || '%' or coalesce(g.phone, '') like '%' || q || '%')
      and (p_segment is null or p_segment = '' or g.segment = p_segment or g.tier = p_segment))
  select jsonb_build_object('total', (select count(*) from m),
    'rows', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from m order by spend desc, email
             limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) x)) into r;
  return r;
end;
$$;
revoke all on function campaign_guests(text, text, int, int) from public, anon;
grant execute on function campaign_guests(text, text, int, int) to authenticated, service_role;

-- 5. campaign lifecycle -----------------------------------------------------------------
create or replace function campaign_stats(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'recipients', count(*),
    'queued', count(*) filter (where cr.status in ('queued', 'sending')),
    'sent', count(*) filter (where cr.status = 'sent'),
    'failed', count(*) filter (where cr.status = 'failed'),
    'skipped', count(*) filter (where cr.status = 'skipped'),
    'redeemed', (select count(*) from booking_requests b join campaign_recipients r2 on r2.code = b.discount_code
                 where r2.campaign_id = p_id and b.status::text not in ('declined', 'expired')),
    'revenue', (select coalesce(sum(b.total_amount), 0) from booking_requests b join campaign_recipients r2 on r2.code = b.discount_code
                where r2.campaign_id = p_id and b.status::text not in ('declined', 'expired')),
    'discount_given', (select coalesce(sum(coalesce(nullif(b.code_discount, 0), b.discount_amount, 0)), 0) from booking_requests b
                join campaign_recipients r2 on r2.code = b.discount_code
                where r2.campaign_id = p_id and b.status::text not in ('declined', 'expired')),
    'unsubscribed', (select count(*) from campaign_optouts o where o.source = 'campaign:' || p_id::text))
  from campaign_recipients cr where cr.campaign_id = p_id;
$$;

create or replace function campaign_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform campaign_guard();
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('stats', campaign_stats(c.id)) order by
           case c.status when 'suggested' then 0 when 'draft' then 1 when 'sending' then 2 when 'paused' then 3 else 4 end, c.created_at desc), '[]')
    into r from campaigns c where c.created_at > now() - interval '400 days' or c.status in ('suggested', 'draft', 'sending', 'paused');
  return r;
end;
$$;
revoke all on function campaign_list() from public, anon;
grant execute on function campaign_list() to authenticated, service_role;

create or replace function campaign_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform campaign_guard();
  select to_jsonb(c) || jsonb_build_object('stats', campaign_stats(c.id),
    'recipients', (select coalesce(jsonb_agg(jsonb_build_object('email', cr.email, 'name', cr.name, 'code', cr.code, 'status', cr.status,
                     'sent_at', cr.sent_at, 'error', cr.error,
                     'booking', (select jsonb_build_object('order_code', b.order_code, 'status', b.status, 'total', b.total_amount,
                                   'check_in', b.check_in, 'stay_type', b.stay_type, 'created_at', b.created_at)
                                 from booking_requests b where b.discount_code = cr.code and b.status::text not in ('declined', 'expired')
                                 order by b.created_at desc limit 1))
                     order by (select 1 from booking_requests b where b.discount_code = cr.code limit 1) nulls last, cr.sent_at desc nulls last, cr.email), '[]')
                   from (select * from campaign_recipients where campaign_id = c.id limit 2000) cr))
    into r from campaigns c where c.id = p_id;
  return r;
end;
$$;
revoke all on function campaign_get(uuid) from public, anon;
grant execute on function campaign_get(uuid) to authenticated, service_role;

-- create / edit (suggested, draft or paused only)
create or replace function campaign_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_status text; v_who text := coalesce(auth.jwt() ->> 'email', 'system');
  o jsonb := coalesce(p->'offer', '{}'::jsonb); v_kind text;
begin
  perform campaign_guard();
  v_kind := coalesce(o->>'kind', 'percent');
  if v_kind not in ('percent', 'fixed', 'perk') then raise exception 'Offer type must be percent, fixed or perk'; end if;
  if v_kind = 'percent' and not (coalesce((o->>'percent')::numeric, 0) > 0 and (o->>'percent')::numeric <= 100) then raise exception 'Enter a percent between 1 and 100'; end if;
  if v_kind = 'fixed' and not (coalesce((o->>'amount')::numeric, 0) > 0) then raise exception 'Enter the peso amount off'; end if;
  if v_kind = 'perk' and nullif(trim(coalesce(o->>'perk', '')), '') is null then raise exception 'Describe the freebie'; end if;
  if nullif(trim(coalesce(p->>'name', '')), '') is null then raise exception 'Give the campaign a name'; end if;
  if v_id is not null then
    select status into v_status from campaigns where id = v_id for update;
    if not found then raise exception 'Campaign not found'; end if;
    if v_status not in ('suggested', 'draft', 'paused') then raise exception 'A % campaign can''t be edited', v_status; end if;
    update campaigns set
      name = trim(p->>'name'),
      status = case when v_status = 'suggested' then 'draft' else v_status end,
      rationale = coalesce(p->>'rationale', rationale),
      audience = coalesce(p->'audience', audience), audience_label = coalesce(p->>'audience_label', audience_label),
      offer = o, code_prefix = upper(nullif(regexp_replace(coalesce(p->>'code_prefix', ''), '[^A-Za-z0-9]', '', 'g'), '')),
      expires_on = nullif(p->>'expires_on', '')::date,
      subject = p->>'subject', headline = p->>'headline', body = p->>'body', cta_label = p->>'cta_label',
      updated_at = now(), updated_by = v_who
    where id = v_id;
  else
    insert into campaigns (name, status, source, rationale, audience, audience_label, offer, code_prefix, expires_on, subject, headline, body, cta_label, created_by, updated_by)
    values (trim(p->>'name'), 'draft', 'staff', p->>'rationale', coalesce(p->'audience', '{}'::jsonb), p->>'audience_label', o,
      upper(nullif(regexp_replace(coalesce(p->>'code_prefix', ''), '[^A-Za-z0-9]', '', 'g'), '')),
      nullif(p->>'expires_on', '')::date, p->>'subject', p->>'headline', p->>'body', p->>'cta_label', v_who, v_who)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function campaign_save(jsonb) from public, anon;
grant execute on function campaign_save(jsonb) to authenticated, service_role;

create or replace function campaign_set_status(p_id uuid, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c campaigns%rowtype; v_who text := coalesce(auth.jwt() ->> 'email', 'system');
begin
  perform campaign_guard();
  select * into c from campaigns where id = p_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if p_status = 'declined' and c.status in ('suggested', 'draft') then
    update campaigns set status = 'declined', decline_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now(), updated_by = v_who where id = p_id;
  elsif p_status = 'paused' and c.status = 'sending' then
    update campaigns set status = 'paused', updated_at = now(), updated_by = v_who where id = p_id;
  elsif p_status = 'sending' and c.status = 'paused' and c.launched_at is not null then
    update campaigns set status = 'sending', updated_at = now(), updated_by = v_who where id = p_id;
  elsif p_status = 'cancelled' and c.status in ('sending', 'paused') then
    -- emails not yet sent are dropped and their codes switched off
    update campaign_recipients set status = 'skipped', error = 'campaign cancelled' where campaign_id = p_id and status in ('queued', 'sending');
    update discount_codes d set active = false from campaign_recipients cr
      where cr.campaign_id = p_id and cr.status = 'skipped' and d.code = cr.code;
    update campaigns set status = 'cancelled', finished_at = now(), updated_at = now(), updated_by = v_who where id = p_id;
  elsif p_status = 'draft' and c.status = 'declined' then
    update campaigns set status = 'draft', decline_reason = null, updated_at = now(), updated_by = v_who where id = p_id;
  else
    raise exception 'Can''t change a % campaign to %', c.status, p_status;
  end if;
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;
revoke all on function campaign_set_status(uuid, text, text) from public, anon;
grant execute on function campaign_set_status(uuid, text, text) to authenticated, service_role;

-- an unambiguous random code: PREFIX-AB2CD
create or replace function campaign_new_code(p_prefix text) returns text
language plpgsql volatile set search_path = public as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; s text; i int; pre text := left(upper(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9]', '', 'g')), 12);
begin
  if pre = '' then pre := 'VBR'; end if;
  loop
    s := '';
    for i in 1..5 loop s := s || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    s := pre || '-' || s;
    exit when not exists (select 1 from discount_codes where code = s);
  end loop;
  return s;
end;
$$;

-- approve & send: one personal code per guest in the audience, queued for the sender
create or replace function campaign_launch(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c campaigns%rowtype; o jsonb; v_who text := coalesce(auth.jwt() ->> 'email', 'system'); n int := 0; g record; v_code text;
  v_today date := (now() at time zone 'Asia/Manila')::date; v_kinds text[];
begin
  perform campaign_guard();
  select * into c from campaigns where id = p_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if c.status not in ('suggested', 'draft') then raise exception 'This campaign is already %', c.status; end if;
  if nullif(trim(coalesce(c.subject, '')), '') is null or nullif(trim(coalesce(c.body, '')), '') is null then raise exception 'Add the email subject and message first'; end if;
  if c.expires_on is null or c.expires_on < v_today then raise exception 'Set an offer expiry date in the future'; end if;
  o := c.offer;
  v_kinds := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(o->'booking_kinds') = 'array' then o->'booking_kinds' else '["overnight"]'::jsonb end) x
                       where x in ('overnight', 'day_trip')), array['overnight']);
  for g in select gp.email, gp.name from guest_profiles gp where campaign_rule_match(gp, c.audience) order by gp.spend desc loop
    v_code := campaign_new_code(coalesce(c.code_prefix, 'VBR'));
    insert into discount_codes (code, label, applies_to, discount_kind, percent, amount_off, perk, min_room_total, starts_on, expires_on, active, note,
      booking_kinds, stay_from, stay_to, min_nights, max_uses, once_per_guest, campaign_id, assigned_email, created_by)
    values (v_code, left(c.name, 120),
      case when coalesce(o->>'kind', 'percent') = 'perk' then 'all'
           when (o->>'applies_to') in ('rooms', 'add_ons', 'all') then
             case when o->>'applies_to' = 'add_ons' and v_kinds <> array['overnight'] then 'all' else o->>'applies_to' end
           else 'all' end,
      coalesce(o->>'kind', 'percent'),
      case when coalesce(o->>'kind', 'percent') = 'percent' then (o->>'percent')::numeric end,
      case when o->>'kind' = 'fixed' then (o->>'amount')::numeric end,
      case when o->>'kind' = 'perk' then trim(o->>'perk') end,
      coalesce(nullif(o->>'min_total', '')::numeric, 0), v_today, c.expires_on, true,
      'Campaign "' || left(c.name, 80) || '" — personal code for ' || g.email,
      v_kinds, nullif(o->>'stay_from', '')::date, nullif(o->>'stay_to', '')::date, coalesce(nullif(o->>'min_nights', '')::int, 0),
      1, false, c.id, g.email, v_who);
    insert into campaign_recipients (campaign_id, email, name, code) values (c.id, g.email, g.name, v_code);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'No guests match this audience'; end if;
  update campaigns set status = 'sending', launched_at = now(), launched_by = v_who, est_recipients = n, updated_at = now(), updated_by = v_who where id = p_id;
  return jsonb_build_object('id', p_id, 'recipients', n);
end;
$$;
revoke all on function campaign_launch(uuid) from public, anon;
grant execute on function campaign_launch(uuid) to authenticated, service_role;

-- 6. sender (edge function, service role) -------------------------------------------------
create or replace function campaign_claim_batch(p_limit int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cap int; v_batch int; v_sent int; v_take int; r jsonb;
  t0 timestamptz := (((now() at time zone 'Asia/Manila')::date)::timestamp at time zone 'Asia/Manila');
begin
  perform campaign_guard();
  select coalesce((value #>> '{}')::int, 300) into v_cap from campaign_settings where key = 'daily_cap';
  select coalesce((value #>> '{}')::int, 25) into v_batch from campaign_settings where key = 'batch_size';
  v_cap := coalesce(v_cap, 300); v_batch := coalesce(p_limit, v_batch, 25);
  -- emails stuck "sending" for 15+ minutes go back in the queue
  update campaign_recipients set status = 'queued' where status = 'sending' and claimed_at < now() - interval '15 minutes';
  select count(*) into v_sent from campaign_recipients where status = 'sent' and sent_at >= t0;
  v_take := least(v_batch, greatest(v_cap - v_sent, 0));
  if v_take <= 0 then return jsonb_build_object('items', '[]'::jsonb, 'sent_today', v_sent, 'cap', v_cap, 'capped', true); end if;
  with picked as (
    select cr.id from campaign_recipients cr join campaigns c on c.id = cr.campaign_id
    where cr.status = 'queued' and c.status = 'sending'
      and not exists (select 1 from campaign_optouts o where o.email = cr.email)
    order by c.launched_at, cr.created_at
    limit v_take for update of cr skip locked
  ), upd as (
    update campaign_recipients cr set status = 'sending', claimed_at = now(), attempts = cr.attempts + 1
    from picked where cr.id = picked.id returning cr.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'name', u.name, 'code', u.code, 'unsub_token', u.unsub_token,
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject, 'headline', c.headline, 'body', c.body,
      'cta_label', c.cta_label, 'offer', c.offer, 'expires_on', c.expires_on))), '[]')
    into r from upd u join campaigns c on c.id = u.campaign_id;
  -- opted out after launch
  update campaign_recipients cr set status = 'skipped', error = 'unsubscribed'
    where cr.status = 'queued' and exists (select 1 from campaign_optouts o where o.email = cr.email);
  return jsonb_build_object('items', r, 'sent_today', v_sent, 'cap', v_cap, 'capped', false);
end;
$$;
revoke all on function campaign_claim_batch(int) from public, anon, authenticated;
grant execute on function campaign_claim_batch(int) to service_role;

create or replace function campaign_mark(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_cid uuid;
begin
  perform campaign_guard();
  update campaign_recipients set
    status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'queued' end,
    sent_at = case when p_ok then now() else sent_at end,
    error = case when p_ok then null else left(p_error, 500) end
  where id = p_id returning campaign_id into v_cid;
  -- finished: nothing left to send
  update campaigns c set status = 'sent', finished_at = now()
  where c.id = v_cid and c.status = 'sending'
    and not exists (select 1 from campaign_recipients cr where cr.campaign_id = c.id and cr.status in ('queued', 'sending'));
end;
$$;
revoke all on function campaign_mark(uuid, boolean, text) from public, anon, authenticated;
grant execute on function campaign_mark(uuid, boolean, text) to service_role;

-- the email's unsubscribe link (no sign-in)
create or replace function campaign_unsubscribe(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cr campaign_recipients%rowtype;
begin
  select * into cr from campaign_recipients where unsub_token = p_token;
  if not found then return jsonb_build_object('ok', false); end if;
  insert into campaign_optouts (email, source) values (cr.email, 'campaign:' || cr.campaign_id::text) on conflict (email) do nothing;
  update campaign_recipients set status = 'skipped', error = 'unsubscribed' where email = cr.email and status = 'queued';
  return jsonb_build_object('ok', true, 'email', regexp_replace(cr.email, '^(.).*(@.*)$', '\1•••\2'));
end;
$$;
revoke all on function campaign_unsubscribe(uuid) from public;
grant execute on function campaign_unsubscribe(uuid) to anon, authenticated, service_role;

-- 7. AI suggestions ---------------------------------------------------------------------
create or replace function campaign_ai_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date; r jsonb;
begin
  perform campaign_guard();
  select jsonb_build_object(
    'today', v_today,
    'segments', campaign_segments(),
    'calendar', (select value from campaign_settings where key = 'calendar'),
    'products', (select value from campaign_settings where key = 'products'),
    'villa_types', (select coalesce(jsonb_agg(distinct jsonb_build_object('room_type', room_type, 'name', room_type_name, 'weekday', weekday_rate, 'weekend', weekend_rate)), '[]') from villas where active),
    'add_ons', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'price', price)), '[]') from add_ons where active and price is not null),
    -- casita nights already booked per month, next 6 months (18 casitas)
    'occupancy', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'booked_nights', (select count(*) from booking_villas bv join booking_requests b on b.id = bv.booking_id, generate_series(bv.check_in, bv.check_out - 1, interval '1 day') d
                          where b.status::text not in ('declined', 'expired') and bv.check_out >= v_today and d >= m and d < m + interval '1 month'),
        'capacity', 18 * extract(day from (m + interval '1 month' - interval '1 day'))::int) order by m), '[]')
      from generate_series(date_trunc('month', v_today::timestamp), date_trunc('month', v_today::timestamp) + interval '5 months', interval '1 month') m),
    'past_campaigns', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'status', c.status, 'audience', c.audience_label, 'offer', c.offer,
        'decline_reason', c.decline_reason, 'stats', campaign_stats(c.id)) order by c.created_at desc), '[]')
      from (select * from campaigns where status not in ('suggested') order by created_at desc limit 25) c),
    'open_suggestions', (select coalesce(jsonb_agg(c.name), '[]') from campaigns c where c.status = 'suggested')
  ) into r;
  return r;
end;
$$;
revoke all on function campaign_ai_context() from public, anon;
grant execute on function campaign_ai_context() to authenticated, service_role;

-- suggestions from the edge function → status 'suggested'; staff tweak, decline or send
create or replace function campaign_add_suggestions(p jsonb, p_model text default null, p_by text default null) returns int
language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0; v_batch uuid := gen_random_uuid(); v_aud jsonb; v_cnt int;
begin
  perform campaign_guard();
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) loop
    continue when nullif(trim(coalesce(x->>'name', '')), '') is null;
    v_aud := coalesce(x->'audience', '{}'::jsonb);
    select count(*) into v_cnt from guest_profiles g where campaign_rule_match(g, v_aud);
    insert into campaigns (name, status, source, rationale, audience, audience_label, offer, code_prefix, expires_on,
      subject, headline, body, cta_label, est_recipients, est_bookings, est_revenue, ai_model, ai_batch, created_by, updated_by)
    values (left(trim(x->>'name'), 120), 'suggested', 'ai', x->>'rationale', v_aud, x->>'audience_label', coalesce(x->'offer', '{}'::jsonb),
      upper(left(nullif(regexp_replace(coalesce(x->>'code_prefix', ''), '[^A-Za-z0-9]', '', 'g'), ''), 12)),
      nullif(x->>'expires_on', '')::date, x->>'subject', x->>'headline', x->>'body', x->>'cta_label',
      v_cnt, nullif(x->>'est_bookings', '')::numeric, nullif(x->>'est_revenue', '')::numeric, p_model, v_batch, coalesce(p_by, 'ai'), coalesce(p_by, 'ai'));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function campaign_add_suggestions(jsonb, text, text) from public, anon;
grant execute on function campaign_add_suggestions(jsonb, text, text) to authenticated, service_role;

-- 8. the page's header + settings -----------------------------------------------------------
create or replace function campaign_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; t30 timestamptz := now() - interval '30 days';
  t0 timestamptz := (((now() at time zone 'Asia/Manila')::date)::timestamp at time zone 'Asia/Manila');
begin
  perform campaign_guard();
  select jsonb_build_object(
    'me', auth.jwt() ->> 'email',
    'profiles', (select count(*) from guest_profiles),
    'emailable', (select count(*) from guest_profiles g where campaign_email_ok(g.email) and not exists (select 1 from campaign_optouts o where o.email = g.email)),
    'opted_out', (select count(*) from campaign_optouts),
    'profiles_at', (select max(updated_at) from guest_profiles),
    'contacts', (select count(*) from cb_guest_contacts),
    'contacts_at', (select max(updated_at) from cb_guest_contacts),
    'suggested', (select count(*) from campaigns where status = 'suggested'),
    'drafts', (select count(*) from campaigns where status = 'draft'),
    'sending', (select count(*) from campaigns where status = 'sending'),
    'queued', (select count(*) from campaign_recipients cr join campaigns c on c.id = cr.campaign_id where cr.status in ('queued', 'sending') and c.status = 'sending'),
    'sent_today', (select count(*) from campaign_recipients where status = 'sent' and sent_at >= t0),
    'sent_30', (select count(*) from campaign_recipients where status = 'sent' and sent_at >= t30),
    'redeemed_30', (select count(*) from booking_requests b where b.created_at >= t30 and b.status::text not in ('declined', 'expired')
                    and exists (select 1 from campaign_recipients cr where cr.code = b.discount_code)),
    'revenue_30', (select coalesce(sum(b.total_amount), 0) from booking_requests b where b.created_at >= t30 and b.status::text not in ('declined', 'expired')
                    and exists (select 1 from campaign_recipients cr where cr.code = b.discount_code)),
    'settings', (select jsonb_object_agg(key, value) from campaign_settings where key in ('daily_cap', 'batch_size', 'test_email'))
  ) into r;
  return r;
end;
$$;
revoke all on function campaign_overview() from public, anon;
grant execute on function campaign_overview() to authenticated, service_role;

create or replace function campaign_setting_set(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform campaign_guard();
  if p_key not in ('daily_cap', 'batch_size', 'test_email') then raise exception 'Unknown setting %', p_key; end if;
  if p_key = 'daily_cap' and not ((p_value #>> '{}')::int between 1 and 1500) then raise exception 'Daily limit must be 1–1,500'; end if;
  if p_key = 'batch_size' and not ((p_value #>> '{}')::int between 1 and 60) then raise exception 'Batch size must be 1–60'; end if;
  insert into campaign_settings (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function campaign_setting_set(text, jsonb) from public, anon;
grant execute on function campaign_setting_set(text, jsonb) to authenticated, service_role;

-- 9. every 5 minutes: send the next batch (only when something is queued) --------------------
-- the function keeps "Verify JWT" on: the call carries the public anon key (the
-- same one cb_alerts_call() and the website use); the vault secret authorises it
insert into campaign_settings (key, value)
select 'cron_auth', to_jsonb(substring(pg_get_functiondef('public.cb_alerts_call'::regproc) from '''Authorization'', ''(Bearer [^'']+)'''))
on conflict (key) do update set value = excluded.value;

create or replace function campaign_cron_call() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from campaign_recipients cr join campaigns c on c.id = cr.campaign_id where cr.status = 'queued' and c.status = 'sending') then return; end if;
  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/campaigns',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', cb_webhook_secret(),
                                  'Authorization', (select value #>> '{}' from campaign_settings where key = 'cron_auth')),
    body := '{"action":"process"}'::jsonb,
    timeout_milliseconds := 120000);
end;
$$;
revoke all on function campaign_cron_call() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'campaign-sender') then perform cron.unschedule('campaign-sender'); end if;
  perform cron.schedule('campaign-sender', '1-59/5 * * * *', 'select public.campaign_cron_call()');
end;
$do$;

select 'v65 applied' as status,
  (select count(*) from campaign_admins) as admins,
  (select count(*) from campaign_settings) as settings,
  position('discount_code_line(' in pg_get_functiondef('public.quote_overnight(date,date,uuid[],int,int,int,int,int,jsonb,boolean,text,date)'::regprocedure)) > 0 as overnight_patched,
  position('discount_code_line(' in pg_get_functiondef('public.quote_daytrip_code(text,date,numeric,numeric)'::regprocedure)) > 0 as daytrip_patched;
