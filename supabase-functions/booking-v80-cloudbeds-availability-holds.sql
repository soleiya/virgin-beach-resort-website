-- booking-v80: Cloudbeds availability holds (applied 2026-11-20)
-- Cloudbeds availability holds
-- The website follows Cloudbeds literally: when Cloudbeds says fewer casitas of a
-- type are free on a night than the website has free (an allotment, a "do not
-- release" hold, an unassigned reservation, stale Cloudbeds inventory — anything
-- that takes a room without showing it on a casita), the website now holds the
-- difference on specific free casitas. Those holds:
--   * hide the casitas from the online casita picker and quotes (public_villa_holds)
--   * block staff saves on that casita (exclusion constraint) — the Villa Calendar
--     shows the hold and why
--   * can't be removed or edited from the dashboard: free the room in Cloudbeds and
--     the website releases it at the next sync (≤ 5 min for the next 14 nights,
--     ≤ ~75 min further out)
--   * step aside automatically when a Cloudbeds reservation or room block lands
--     on that casita
-- Only nights Cloudbeds actually prices (rate > 0) are used: nights that aren't on
-- sale are already closed online, and Cloudbeds reports no room count for them.

alter table public.booking_villas add column if not exists cb_avail_hold boolean not null default false;

-- ------------------------------------------------------------------ recompute
create or replace function public.cb_sync_avail_holds()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_on boolean := coalesce((select s.cloudbeds_rates from booking_settings s where s.id = 1), false);
  v_added int := 0; v_removed int := 0; v_failed int := 0;
  h_rec record;
begin
  perform set_config('vbr.cb_sync', 'on', true);
  perform set_config('vbr.actor', 'Cloudbeds', true);

  drop table if exists _cb_hold_nights;
  create temp table _cb_hold_nights on commit drop as
  with n as (
    select r.cb_room_type_id, r.night, greatest(r.rooms_available, 0) as cb_free
      from cb_rates r
     where v_on and r.night >= v_today
       and coalesce(r.rate, 0) > 0 and r.rooms_available is not null
       and exists (select 1 from villas v where v.active and v.cb_room_type_id = r.cb_room_type_id)
  ), free as (
    select n.cb_room_type_id, n.night, n.cb_free, v.id as villa_id, v.sort
      from n join villas v on v.active and v.cb_room_type_id = n.cb_room_type_id
     where not exists (select 1 from booking_villas bv
                        where bv.villa_id = v.id and bv.active and not bv.cb_avail_hold
                          and n.night >= bv.check_in and n.night < bv.check_out)
  ), ranked as (
    select f.*, count(*) over (partition by f.cb_room_type_id, f.night) as site_free,
           row_number() over (partition by f.cb_room_type_id, f.night order by f.sort desc) as rn
      from free f
  )
  select villa_id, night from ranked where rn <= site_free - cb_free;

  -- consecutive nights on the same casita → one hold
  drop table if exists _cb_hold_want;
  create temp table _cb_hold_want on commit drop as
  select villa_id, min(night) as ci, max(night) + 1 as co
    from (select villa_id, night, night - (row_number() over (partition by villa_id order by night))::int as g
            from _cb_hold_nights) x
   group by villa_id, g;

  delete from booking_villas bv
   where bv.cb_avail_hold and bv.check_out > v_today
     and not exists (select 1 from _cb_hold_want hw
                      where hw.villa_id = bv.villa_id and hw.ci = bv.check_in and hw.co = bv.check_out);
  get diagnostics v_removed = row_count;

  for h_rec in select * from _cb_hold_want x
            where not exists (select 1 from booking_villas bv
                               where bv.cb_avail_hold and bv.villa_id = x.villa_id
                                 and bv.check_in = x.ci and bv.check_out = x.co)
  loop
    begin
      insert into booking_villas (villa_id, check_in, check_out, block_reason, created_by, cb_avail_hold)
      values (h_rec.villa_id, h_rec.ci, h_rec.co,
              'Cloudbeds: not available in Cloudbeds (no casita shown there) — free it in Cloudbeds to release',
              'Cloudbeds', true);
      v_added := v_added + 1;
    exception when exclusion_violation or unique_violation then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('added', v_added, 'removed', v_removed, 'failed', v_failed);
end;
$function$;

revoke all on function public.cb_sync_avail_holds() from public, anon, authenticated;

-- ------------------------------------------- Cloudbeds bookings/blocks win
-- A Cloudbeds reservation or room block landing on a held casita takes it; the
-- hold moves to another free casita (or goes away) at the next recompute.
create or replace function public.booking_villas_cb_displace()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.cb_avail_hold or not new.active then return new; end if;
  if coalesce(current_setting('vbr.cb_sync', true), '') = 'on' then
    delete from booking_villas h
     where h.cb_avail_hold and h.villa_id = new.villa_id and h.id <> new.id
       and daterange(h.check_in, h.check_out, '[)') && daterange(new.check_in, new.check_out, '[)');
  end if;
  return new;
end;
$function$;

-- runs after trg_booking_villas_follow (which sets the dates), before zz_guard
drop trigger if exists trg_booking_villas_zcb_displace on public.booking_villas;
create trigger trg_booking_villas_zcb_displace
  before insert or update on public.booking_villas
  for each row execute function public.booking_villas_cb_displace();

-- ------------------------------------------- only the sync touches the holds
create or replace function public.guard_cb_avail_hold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('vbr.cb_sync', true), '') <> 'on'
     and ((tg_op <> 'INSERT' and old.cb_avail_hold) or (tg_op <> 'DELETE' and new.cb_avail_hold)) then
    raise exception 'This casita is held because Cloudbeds shows it as unavailable. Free it in Cloudbeds — the website follows within a few minutes.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists trg_booking_villas_zcb_guard on public.booking_villas;
create trigger trg_booking_villas_zcb_guard
  before insert or update or delete on public.booking_villas
  for each row execute function public.guard_cb_avail_hold();

-- ------------------------------------------- recompute after each sync step
CREATE OR REPLACE FUNCTION public.cb_apply_rates(p_from date, p_to date, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rows int; v_open int; v_holds jsonb;
begin
  if p_to <= p_from then return jsonb_build_object('rows', 0); end if;
  with types as (
    select distinct cb_room_type_id as t from villas where active and cb_room_type_id is not null
  ), nights as (
    select d::date as night from generate_series(p_from, p_to - 1, interval '1 day') d
  ), given as (
    select x->>'room_type_id' as t, (x->>'date')::date as night,
           nullif(x->>'rate', '')::numeric as rate, nullif(x->>'rooms_available', '')::int as avail,
           coalesce((x->>'cta')::boolean, false) as cta, coalesce((x->>'ctd')::boolean, false) as ctd,
           nullif(x->>'min_los', '')::int as min_los
      from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
  )
  insert into cb_rates as r (cb_room_type_id, night, rate, rooms_available, closed_arrival, closed_departure, min_los, synced_at)
  select types.t, nights.night, coalesce(g.rate, 0), case when g.t is null then 0 else g.avail end, coalesce(g.cta, false), coalesce(g.ctd, false), g.min_los, now()
    from types cross join nights
    left join lateral (select * from given g where g.t = types.t and g.night = nights.night limit 1) g on true
  on conflict (cb_room_type_id, night) do update
    set rate = excluded.rate, rooms_available = excluded.rooms_available, closed_arrival = excluded.closed_arrival,
        closed_departure = excluded.closed_departure, min_los = excluded.min_los, synced_at = excluded.synced_at;
  get diagnostics v_rows = row_count;
  select count(*) into v_open from cb_rates where night >= p_from and night < p_to and rate > 0 and coalesce(rooms_available, 1) > 0;
  delete from cb_rates where night < current_date - 2;
  v_holds := cb_sync_avail_holds();
  return jsonb_build_object('rows', v_rows, 'open_nights', v_open, 'from', p_from, 'to', p_to, 'holds', v_holds);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_apply_blocks(p_from date, p_to date, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x jsonb; r text; v uuid; v_in date; v_out date; v_reason text;
  v_keep text[] := '{}'; v_added int := 0; v_removed int := 0; v_clash text[] := '{}';
  v_holds jsonb;
begin
  perform set_config('vbr.cb_sync', 'on', true);
  perform set_config('vbr.actor', 'Cloudbeds', true);
  for x in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    v_in := (x->>'start')::date;
    v_out := greatest((x->>'end')::date, (x->>'start')::date + 1);
    v_reason := 'Cloudbeds: ' || coalesce(nullif(trim(x->>'reason'), ''), replace(coalesce(x->>'type', 'block'), '_', ' '));
    for r in select jsonb_array_elements_text(coalesce(x->'rooms', '[]'::jsonb)) loop
      select id into v from villas where cb_room_id = r;
      continue when v is null;
      v_keep := v_keep || (x->>'block_id' || ':' || v);
      if exists (select 1 from booking_villas where cb_block_id = x->>'block_id' and villa_id = v
                  and check_in = v_in and check_out = v_out and block_reason = v_reason) then
        continue;
      end if;
      delete from booking_villas where cb_block_id = x->>'block_id' and villa_id = v;
      begin
        insert into booking_villas (villa_id, check_in, check_out, block_reason, created_by, cb_block_id)
        values (v, v_in, v_out, v_reason, 'Cloudbeds', x->>'block_id');
        v_added := v_added + 1;
      exception when exclusion_violation or unique_violation then
        v_clash := v_clash || ((select unit_label from villas where id = v) || ' ' || v_in || '→' || v_out || ' overlaps a booking here');
      end;
    end loop;
  end loop;
  delete from booking_villas
   where cb_block_id is not null and check_out > p_from and check_in < p_to
     and not ((cb_block_id || ':' || villa_id) = any(v_keep));
  get diagnostics v_removed = row_count;
  v_holds := cb_sync_avail_holds();
  return jsonb_build_object('added', v_added, 'removed', v_removed, 'clashes', to_jsonb(v_clash), 'holds', v_holds);
end;
$function$;

-- first fill
select public.cb_sync_avail_holds();
