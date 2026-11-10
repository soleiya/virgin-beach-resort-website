-- =============================================================================
-- booking-v59: room swaps in Cloudbeds no longer open casitas on the website,
-- and Cloudbeds availability is checked for every stay (2026 too).
--
-- What happened (VBR-27400, Bamboo King Casita, Nov 13–16 2026):
--   10:08  Staff swapped two Cloudbeds guests between B.Casita 2 and B.Casita 4
--          (Cala 2→4, Fehse 4→2). cloudbeds-sync applies one reservation at a
--          time: Cala's move hit Fehse's not-yet-moved hold on B.Casita 4 (and
--          vice versa), the insert raised exclusion_violation, and the casita
--          was silently dropped as a "clash". Nothing in Cloudbeds changed
--          afterwards, so the reservation was never synced again — the website
--          showed both casitas free. Adrien Luntao's Casita 10 was lost the
--          same way.
--   11:10  A guest booked Bamboo King Nov 13–16 on the website. For stays that
--          end before cloudbeds_rates_from (2027-01-01) quote_overnight never
--          looks at Cloudbeds' rooms_available, so the website's own holds were
--          the only check. The push to Cloudbeds then failed ("could not
--          accommodate your request") six times.
--
-- Fix:
--   1. cb_apply_reservation: Cloudbeds is the master for the casita it assigns.
--      If another *Cloudbeds* reservation still holds that casita on the
--      website (the other half of a swap), its hold is released, it is queued
--      for a re-sync, and this reservation takes the casita. Staff blocks and
--      website bookings Cloudbeds never took are not touched (still a clash).
--   2. Any reservation left with a clash is queued and retried by every pull
--      (cb_resync_queue / cb_resync_take) until it applies cleanly.
--   3. quote_overnight: Cloudbeds' rooms_available is checked for every night
--      of every online stay, also before cloudbeds_rates_from (prices there
--      stay the website's own). Booking requests (inquiry mode) and staff
--      bookings are unchanged.
--
-- Functions are patched in place from their live definitions (as in v57); the
-- script stops if a definition isn't the expected one. Re-runnable.
-- Needs the matching cloudbeds-sync edge function (pull retries the queue,
-- syncOne re-syncs a displaced reservation at once).
-- =============================================================================

-- 1. retry queue ---------------------------------------------------------------
create table if not exists cb_resync_queue (
  reservation_id text primary key,
  reason text,
  attempts int not null default 0,
  queued_at timestamptz not null default now(),
  last_try_at timestamptz
);
alter table cb_resync_queue enable row level security;  -- written by the service role only
drop policy if exists "Staff can view Cloudbeds resync queue" on cb_resync_queue;
create policy "Staff can view Cloudbeds resync queue" on cb_resync_queue for select to authenticated using (true);

-- Reservations to fetch again from Cloudbeds (oldest first). Each one is tried
-- every pull (5 min) for about a day, then left for staff (and the nightly full sync).
create or replace function cb_resync_take(p_limit int default 25) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_ids text[];
begin
  with picked as (
    select reservation_id from cb_resync_queue
     where attempts < 300
     order by queued_at
     limit greatest(coalesce(p_limit, 25), 1)
     for update skip locked
  ), taken as (
    update cb_resync_queue q set attempts = q.attempts + 1, last_try_at = now()
      from picked where q.reservation_id = picked.reservation_id
    returning q.reservation_id
  )
  select coalesce(array_agg(reservation_id), '{}') into v_ids from taken;
  return v_ids;
end;
$$;
revoke all on function cb_resync_take(int) from public, anon, authenticated;
grant execute on function cb_resync_take(int) to service_role;

-- 2. cb_apply_reservation ------------------------------------------------------
do $$
declare
  d text := pg_get_functiondef('cb_apply_reservation(jsonb)'::regprocedure);
  decl_old text := $x$  v_secret text;
begin$x$;
  decl_new text := $x$  v_secret text;
  o record;                       -- v59
  v_displaced text[] := '{}';     -- v59: Cloudbeds reservations whose stale hold was released
begin$x$;
  ins_old text := $x$      exception when exclusion_violation or unique_violation then
        v_clash := v_clash || ((select unit_label from villas where id = v) || ' already taken ' || v_in || '→' || v_out);
      end;$x$;
  ins_new text := $x$      exception when exclusion_violation or unique_violation then
        -- v59: Cloudbeds is the master for the casita it assigned. Another Cloudbeds
        -- reservation still holding it here is stale (e.g. the other half of a room
        -- swap that hasn't synced yet): release that hold, queue it for a re-sync,
        -- and take the casita. Staff blocks and website-only bookings stay a clash.
        for o in
          select h.id, ob.cb_reservation_id
            from booking_villas h join booking_requests ob on ob.id = h.booking_id
           where h.active and h.villa_id = v and h.booking_id <> b.id
             and ob.cb_reservation_id is not null and ob.cb_reservation_id <> v_id
             and daterange(h.check_in, h.check_out, '[)') && daterange(v_in, v_out, '[)')
        loop
          delete from booking_villas where id = o.id;
          if not o.cb_reservation_id = any(v_displaced) then
            v_displaced := v_displaced || o.cb_reservation_id;
          end if;
          insert into cb_resync_queue (reservation_id, reason)
          values (o.cb_reservation_id, 'casita taken by Cloudbeds #' || v_id)
          on conflict (reservation_id) do update set reason = excluded.reason, attempts = 0, queued_at = now();
        end loop;
        begin
          insert into booking_villas (booking_id, villa_id, check_in, check_out, created_by, provisional)
          values (b.id, v, v_in, v_out, 'Cloudbeds', false);
        exception when exclusion_violation or unique_violation then
          v_clash := v_clash || ((select unit_label from villas where id = v) || ' already taken ' || v_in || '→' || v_out);
        end;
      end;$x$;
  ret_old text := $x$  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'villas_reset', v_reset,
                            'clashes', to_jsonb(v_clash));$x$;
  ret_new text := $x$  -- v59: a reservation the website couldn't place is fetched again every pull
  if array_length(v_clash, 1) > 0 and v_active then
    insert into cb_resync_queue (reservation_id, reason) values (v_id, array_to_string(v_clash, '; '))
    on conflict (reservation_id) do update set reason = excluded.reason;
  else
    delete from cb_resync_queue where reservation_id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'villas_reset', v_reset,
                            'clashes', to_jsonb(v_clash), 'displaced', to_jsonb(v_displaced));$x$;
begin
  if position('-- v59:' in d) > 0 then
    raise notice 'cb_apply_reservation already patched';
  elsif position(decl_old in d) = 0 or position(ins_old in d) = 0 or position(ret_old in d) = 0 then
    raise exception 'cb_apply_reservation is not the expected version — not patched';
  else
    d := replace(d, decl_old, decl_new);
    d := replace(d, ins_old, ins_new);
    d := replace(d, ret_old, ret_new);
    execute d;
    raise notice 'cb_apply_reservation patched';
  end if;
end $$;

-- 3. quote_overnight -----------------------------------------------------------
do $$
declare
  f regprocedure := 'quote_overnight(date,date,uuid[],integer,integer,integer,integer,integer,jsonb,boolean,text,date)'::regprocedure;
  d text := pg_get_functiondef(f);
  decl_old text := $x$  v_chk jsonb;$x$;
  decl_new text := $x$  v_chk jsonb;
  v_full date;                    -- v59$x$;
  loop_old text := $x$for v in select * from villas where id = any(coalesce(p_villa_ids, '{}')) order by sort loop$x$;
  loop_new text := $x$for v in select * from villas where id = any(coalesce(p_villa_ids, '{}')) order by sort loop
    -- v59: Cloudbeds decides whether this casita type still has enough free units,
    -- for every online stay — also before cloudbeds_rates_from, where the price is
    -- still the website's own. (Requests and staff bookings are not checked.)
    if v_avail_err is null and not v_staff
       and coalesce(current_setting('vbr.quote_mode', true), '') <> 'inquiry'
       and coalesce((select bs.cloudbeds_rates from booking_settings bs where bs.id = 1), false) then
      select r.night into v_full
        from cb_rates r
       where r.cb_room_type_id = v.cb_room_type_id
         and r.night >= p_check_in and r.night < p_check_out
         and r.rooms_available is not null
         and r.rooms_available < (select count(*) from villas vv
                                   where vv.id = any(coalesce(p_villa_ids, '{}')) and vv.cb_room_type_id = v.cb_room_type_id)
       order by r.night
       limit 1;
      if v_full is not null then
        v_avail_err := 'Sorry — the ' || v.room_type_name || ' is no longer available on ' ||
                       to_char(v_full, 'FMDay, FMMonth FMDD, YYYY') ||
                       '. Please choose other dates or another casita, or contact our reservations team.';
      end if;
    end if;$x$;
begin
  if position('-- v59:' in d) > 0 then
    raise notice 'quote_overnight already patched';
  elsif position(decl_old in d) = 0 or position(loop_old in d) = 0
        or position('v_staff' in d) = 0 or position('v_avail_err' in d) = 0 then
    raise exception 'quote_overnight is not the expected version — not patched';
  else
    d := replace(d, decl_old, decl_new);
    d := replace(d, loop_old, loop_new);
    execute d;
    raise notice 'quote_overnight patched';
  end if;
end $$;

-- 4. check ---------------------------------------------------------------------
select p.proname, position('-- v59:' in pg_get_functiondef(p.oid)) > 0 as patched
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('cb_apply_reservation', 'quote_overnight', 'cb_resync_take')
 order by 1;
