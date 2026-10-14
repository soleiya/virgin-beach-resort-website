-- ============================================================================
-- Booking rules v14 — run the website alongside Cloudbeds
--
-- Villas: Cloudbeds stays the master.
--   * Every reservation made or changed in Cloudbeds (front office, Booking.com,
--     the Cloudbeds booking engine …) is copied into booking_requests by the
--     `cloudbeds-sync` edge function — instantly via Cloudbeds webhooks, and
--     every 5 minutes as a safety net (plus a nightly re-check of all upcoming
--     stays).
--   * A villa booked on the website (by a guest or in the staff dashboard) is
--     created in Cloudbeds automatically and put on the same casita, so the
--     OTAs stop selling it. Its status (confirmed / cancelled) follows the
--     website; dates, casitas and guests are then changed in Cloudbeds.
--   * A Cloudbeds stay with no casita assigned yet holds a "provisional"
--     casita of the right type here, so the website never sells a room type
--     that's already full.
-- Day trips: the website is the master; daytrip_sheet_rows() feeds the
--   Google Sheet mirror (Apps Script, see google-sheet-mirror.gs).
--
-- Re-runnable.
-- ============================================================================

-- 1. columns ------------------------------------------------------------------
alter table villas add column if not exists cb_room_id text;
alter table villas add column if not exists cb_room_type_id text;
alter table villas add column if not exists cb_room_type_name text;
create unique index if not exists villas_cb_room_id_key on villas (cb_room_id) where cb_room_id is not null;

alter table booking_requests add column if not exists cb_reservation_id text;
alter table booking_requests add column if not exists cb_owned boolean not null default false;  -- made in Cloudbeds
alter table booking_requests add column if not exists cb_info jsonb;                          -- status, source, total, balance … as Cloudbeds has them
alter table booking_requests add column if not exists cb_synced_at timestamptz;
alter table booking_requests add column if not exists cb_push_state text;                     -- null | pushing | done | error
alter table booking_requests add column if not exists cb_push_at timestamptz;
alter table booking_requests add column if not exists cb_push_attempts int not null default 0;
alter table booking_requests add column if not exists cb_push_error text;
create unique index if not exists booking_requests_cb_reservation_key on booking_requests (cb_reservation_id) where cb_reservation_id is not null;

alter table booking_villas add column if not exists provisional boolean not null default false;
alter table booking_villas add column if not exists cb_block_id text;   -- a room block made in Cloudbeds

-- Everything imported from Cloudbeds belongs to Cloudbeds.
update booking_requests
   set cb_reservation_id = substr(legacy_source_row, 4), cb_owned = true
 where legacy_source_row like 'CB:%' and cb_reservation_id is null;

-- 2. sync state ----------------------------------------------------------------
create table if not exists cb_sync_state (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
alter table cb_sync_state enable row level security;
drop policy if exists cb_sync_state_staff_read on cb_sync_state;
create policy cb_sync_state_staff_read on cb_sync_state for select to authenticated using (key <> 'secret');

create or replace function cb_state_set(p_key text, p_value jsonb) returns void
language sql security definer set search_path = public as $$
  insert into cb_sync_state (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

-- TEST MODE: until launch, website bookings are NOT sent to Cloudbeds
-- (Cloudbeds → website still syncs). Launch with:
--   select cb_state_set('push_enabled', 'true'::jsonb);
insert into cb_sync_state (key, value) values ('push_enabled', 'false'::jsonb) on conflict (key) do nothing;

create or replace function cb_push_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from cb_sync_state where key = 'push_enabled'), false);
$$;

-- 3. helpers -------------------------------------------------------------------
create or replace function cb_source_map(p text) returns text
language sql immutable as $$
  select case
    when p is null then 'cloudbeds'
    when p ilike 'website%' or p ilike '%booking engine%' or p ilike '%ota extension%' then 'cloudbeds'
    when p ilike 'booking.com%' then 'booking_com'
    when p ilike 'walk-in%' or p ilike 'walk in%' then 'walk_in'
    when p ilike 'email%' then 'email'
    when p ilike 'phone%' then 'phone'
    when p ilike 'facebook%' or p ilike 'messenger%' then 'messenger'
    when p ilike 'wedding%' or p ilike '%events%' then 'events'
    when p ilike 'expo%' then 'expo'
    when p ilike 'corporate%' then 'corporate'
    when p ilike 'employee%' or p ilike 'friend - employee%' then 'staff_stay'
    when p ilike 'returnee%' then 'returnee'
    when p ilike 'partner%' or p ilike 'z partners%' or p ilike 'ntq%' or p ilike 'referral%' or p ilike 'friend%' then 'partner'
    else 'other'
  end;
$$;

create or replace function cb_status_map(p text) returns booking_status
language sql immutable as $$
  select (case p
    when 'not_confirmed' then 'pending'
    when 'confirmed' then 'confirmed'
    when 'checked_in' then 'confirmed'
    when 'checked_out' then 'completed'
    when 'canceled' then 'declined'
    when 'no_show' then 'declined'
    when 'deleted' then 'declined'
    else 'confirmed' end)::booking_status;
$$;

create or replace function cb_norm(p text) returns text
language sql immutable as $$
  select lower(regexp_replace(regexp_replace(trim(coalesce(p, '')), '\s*-\s*\d+$', ''), '\s+', ' ', 'g'));
$$;

-- 4. apply one Cloudbeds reservation ----------------------------------------------
-- p = { id, status, source, guest_name, guest_email, guest_phone, country,
--       start, end, adults, children, total, balance, paid, created, modified,
--       ota_ref, rooms: [{room_id, room_name, room_type_id}],
--       unassigned: [{room_type_id, room_type_name}] }
create or replace function cb_apply_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id text := p->>'id';
  v_cb text := coalesce(p->>'status', 'confirmed');
  v_status booking_status := cb_status_map(v_cb);
  v_in date := nullif(p->>'start', '')::date;
  v_out date := nullif(p->>'end', '')::date;
  b booking_requests%rowtype;
  v_found boolean;
  v_new boolean := false;
  v_owned boolean;
  v_target booking_status;
  v_assigned uuid[] := '{}';
  v_old_fixed uuid[];
  v_old_prov uuid[];
  v_types text[] := '{}';
  v_old_types text[];
  v_clash text[] := '{}';
  v_reset boolean;
  v_active boolean;
  x jsonb;
  v uuid;
  t text;
  v_rooms_text text;
  v_info jsonb;
begin
  if v_id is null then raise exception 'missing reservation id'; end if;
  perform set_config('vbr.cb_sync', 'on', true);
  perform set_config('vbr.actor', 'Cloudbeds', true);

  select * into b from booking_requests where cb_reservation_id = v_id;
  v_found := found;
  -- A website booking we pushed whose id didn't get stored: match by order code.
  if not v_found and coalesce(p->>'ota_ref', '') <> '' then
    select * into b from booking_requests
     where order_code = p->>'ota_ref' and cb_reservation_id is null and not cb_owned;
    v_found := found;
    if v_found then
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;
    end if;
  end if;
  if v_found then
    v_in := coalesce(v_in, b.check_in);   -- e.g. a "deleted" event carries no dates
    v_out := coalesce(v_out, b.check_out);
  end if;
  if not v_found and v_cb = 'deleted' then
    return jsonb_build_object('id', v_id, 'skipped', 'deleted, never synced');
  end if;
  if v_in is null or v_out is null or v_out <= v_in then
    return jsonb_build_object('id', v_id, 'skipped', 'no valid dates');
  end if;

  -- casitas Cloudbeds has assigned
  for x in select * from jsonb_array_elements(coalesce(p->'rooms', '[]'::jsonb)) loop
    select id into v from villas where cb_room_id = x->>'room_id';
    if v is null then
      select id into v from villas where cb_norm(unit_label) = cb_norm(x->>'room_name') limit 1;
    end if;
    if v is null then
      v_clash := v_clash || ('unknown casita ' || coalesce(x->>'room_name', x->>'room_id'));
    elsif not v = any(v_assigned) then
      v_assigned := v_assigned || v;
    end if;
  end loop;
  -- rooms sold but not assigned yet: hold one casita of that type
  for x in select * from jsonb_array_elements(coalesce(p->'unassigned', '[]'::jsonb)) loop
    v_types := v_types || coalesce(x->>'room_type_id', '?');
  end loop;

  v_rooms_text := (select string_agg(coalesce(e.r->>'room_name', '?'), ', ') from jsonb_array_elements(coalesce(p->'rooms', '[]'::jsonb)) as e(r));
  if array_length(v_types, 1) > 0 then
    v_rooms_text := concat_ws(', ', v_rooms_text,
      (select string_agg(coalesce(e.r->>'room_type_name', 'room') || ' (not assigned)', ', ') from jsonb_array_elements(p->'unassigned') as e(r)));
  end if;

  if not v_found then
    insert into booking_requests (
      status, source, stay_type, stay_type_label, room_name, guest_name, guest_email, guest_phone, country,
      check_in, check_out, adults, children_6_12, total_amount, booked_by, created_at, staff_notes,
      legacy_source_row, cb_reservation_id, cb_owned, cb_synced_at,
      email_guest, marketing_opt_in, discount_amount, extra_beds, primary_is_senior
    ) values (
      v_status, cb_source_map(p->>'source'), 'overnight', 'Overnight Stay', v_rooms_text,
      coalesce(nullif(trim(p->>'guest_name'), ''), '(no name in Cloudbeds)'),
      nullif(trim(p->>'guest_email'), ''), nullif(trim(p->>'guest_phone'), ''), nullif(trim(p->>'country'), ''),
      v_in, v_out, greatest(coalesce(nullif(p->>'adults', '')::numeric::int, 1), 0),
      greatest(coalesce(nullif(p->>'children', '')::numeric::int, 0), 0),
      nullif(p->>'total', '')::numeric, 'Cloudbeds',
      coalesce(nullif(p->>'created', '')::timestamptz, now()),
      '[From Cloudbeds #' || v_id || ']',
      'CB:' || v_id, v_id, true, now(),
      false, false, 0, 0, false
    ) returning * into b;
    v_new := true;
    v_old_fixed := '{}'; v_old_prov := '{}'; v_old_types := '{}';
  else
    select coalesce(array_agg(villa_id) filter (where not provisional), '{}'),
           coalesce(array_agg(villa_id) filter (where provisional), '{}'),
           coalesce(array_agg(vl.cb_room_type_id) filter (where bv.provisional), '{}')
      into v_old_fixed, v_old_prov, v_old_types
      from booking_villas bv join villas vl on vl.id = bv.villa_id
     where bv.booking_id = b.id;
  end if;
  v_owned := b.cb_owned;

  -- Status: Cloudbeds decides for its own bookings. For website bookings the
  -- website decides (payment flow), except a cancellation / check-out in Cloudbeds.
  v_target := case
    when v_owned then v_status
    when v_cb in ('canceled', 'no_show', 'deleted') then 'declined'
    when v_cb = 'checked_out' and b.status in ('confirmed', 'completed') then 'completed'
    else b.status end;
  v_active := v_target not in ('declined', 'expired');

  v_reset := v_new
    or b.check_in is distinct from v_in or b.check_out is distinct from v_out
    or (b.status not in ('declined', 'expired')) is distinct from v_active
    or not (v_assigned <@ v_old_fixed and v_old_fixed <@ v_assigned)
    or (select coalesce(array_agg(z order by z), '{}') from unnest(v_types) z)
       is distinct from (select coalesce(array_agg(z order by z), '{}') from unnest(v_old_types) z);

  if v_reset and not v_new then
    delete from booking_villas where booking_id = b.id;
  end if;

  update booking_requests set
    status = v_target,
    check_in = v_in,
    check_out = v_out,
    guest_name = case when v_owned then coalesce(nullif(trim(p->>'guest_name'), ''), guest_name) else guest_name end,
    guest_email = case when v_owned then coalesce(nullif(trim(p->>'guest_email'), ''), guest_email) else guest_email end,
    guest_phone = case when v_owned then coalesce(nullif(trim(p->>'guest_phone'), ''), guest_phone) else guest_phone end,
    country = case when v_owned then coalesce(nullif(trim(p->>'country'), ''), country) else country end,
    adults = case when v_owned then greatest(coalesce(nullif(p->>'adults', '')::numeric::int, adults), 0) else adults end,
    children_6_12 = case when v_owned then greatest(coalesce(nullif(p->>'children', '')::numeric::int, children_6_12), 0) else children_6_12 end,
    senior_count = case when v_owned then least(senior_count, greatest(coalesce(nullif(p->>'adults', '')::numeric::int, adults), 0)) else senior_count end,
    total_amount = case when v_owned then coalesce(nullif(p->>'total', '')::numeric, total_amount) else total_amount end,
    source = case when v_owned then cb_source_map(p->>'source') else source end,
    room_name = case when v_owned then coalesce(v_rooms_text, room_name) else room_name end,
    cb_synced_at = now()
  where id = b.id
  returning * into b;

  if v_reset and v_active then
    foreach v in array v_assigned loop
      begin
        insert into booking_villas (booking_id, villa_id, check_in, check_out, created_by, provisional)
        values (b.id, v, v_in, v_out, 'Cloudbeds', false);
      exception when exclusion_violation or unique_violation then
        v_clash := v_clash || ((select unit_label from villas where id = v) || ' already taken ' || v_in || '→' || v_out);
      end;
    end loop;
    foreach t in array v_types loop
      -- keep the casita it held before if it's still free, else the first free one
      select vl.id into v
        from villas vl
       where vl.active and vl.cb_room_type_id = t
         and not exists (select 1 from booking_villas h where h.booking_id = b.id and h.villa_id = vl.id)
         and not exists (select 1 from booking_villas h
                          where h.active and h.villa_id = vl.id
                            and daterange(h.check_in, h.check_out, '[)') && daterange(v_in, v_out, '[)'))
       order by (vl.id = any(v_old_prov)) desc, vl.sort
       limit 1;
      if v is null then
        v_clash := v_clash || ('no free casita of type ' || t || ' to hold ' || v_in || '→' || v_out || ' (Cloudbeds may be overbooked)');
      else
        begin
          insert into booking_villas (booking_id, villa_id, check_in, check_out, created_by, provisional)
          values (b.id, v, v_in, v_out, 'Cloudbeds', true);
        exception when exclusion_violation or unique_violation then
          v_clash := v_clash || ('could not hold a casita of type ' || t);
        end;
      end if;
    end loop;
  end if;

  v_info := jsonb_strip_nulls(jsonb_build_object(
    'status', v_cb,
    'source', p->>'source',
    'total', nullif(p->>'total', '')::numeric,
    'balance', nullif(p->>'balance', '')::numeric,
    'paid', nullif(p->>'paid', '')::numeric,
    'ota_ref', nullif(p->>'ota_ref', ''),
    'rooms', v_rooms_text,
    'unassigned', case when array_length(v_types, 1) > 0 then array_length(v_types, 1) end,
    'adults', nullif(p->>'adults', ''),
    'children', nullif(p->>'children', ''),
    'modified', nullif(p->>'modified', ''),
    'clashes', case when array_length(v_clash, 1) > 0 then to_jsonb(v_clash) end
  ));
  -- clashes from earlier syncs stay until the villa set changes again
  if not v_reset and b.cb_info ? 'clashes' and not (v_info ? 'clashes') then
    v_info := v_info || jsonb_build_object('clashes', b.cb_info->'clashes');
  end if;
  update booking_requests set cb_info = v_info where id = b.id and cb_info is distinct from v_info;

  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'villas_reset', v_reset,
                            'clashes', to_jsonb(v_clash));
end;
$$;

-- 5. website → Cloudbeds ------------------------------------------------------------
create or replace function cb_claim_push(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b booking_requests%rowtype;
begin
  if not cb_push_enabled() then return null; end if;  -- test mode
  update booking_requests
     set cb_push_state = 'pushing', cb_push_at = now(), cb_push_attempts = cb_push_attempts + 1
   where id = p_booking_id
     and cb_reservation_id is null and not cb_owned and stay_type = 'overnight'
     and status not in ('declined', 'expired', 'completed')
     and check_in is not null and check_out > check_in
     and cb_push_attempts < 6
     and (cb_push_state is null or cb_push_state = 'error'
          or (cb_push_state = 'pushing' and cb_push_at < now() - interval '5 minutes'))
     and exists (select 1 from booking_villas where booking_id = p_booking_id)
  returning * into b;
  if not found then return null; end if;
  return to_jsonb(b) || jsonb_build_object('villas', (
    select coalesce(jsonb_agg(jsonb_build_object('unit_label', v.unit_label, 'cb_room_id', v.cb_room_id,
                                                 'cb_room_type_id', v.cb_room_type_id) order by v.sort), '[]'::jsonb)
      from booking_villas bv join villas v on v.id = bv.villa_id where bv.booking_id = b.id));
end;
$$;

create or replace function cb_push_result(p_booking_id uuid, p_reservation_id text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('vbr.cb_sync', 'on', true);
  perform set_config('vbr.actor', 'Cloudbeds', true);
  if p_reservation_id is not null then
    update booking_requests set cb_reservation_id = p_reservation_id, cb_push_state = 'done', cb_push_error = p_error
     where id = p_booking_id;
  else
    update booking_requests set cb_push_state = 'error', cb_push_error = left(p_error, 1000) where id = p_booking_id;
  end if;
end;
$$;

-- bookings still waiting to go to Cloudbeds (retried by every pull)
create or replace function cb_pending_pushes() returns setof uuid
language sql security definer set search_path = public as $$
  select id from booking_requests b
   where cb_reservation_id is null and not cb_owned and stay_type = 'overnight'
     and status not in ('declined', 'expired', 'completed')
     and check_out >= current_date
     and cb_push_attempts < 6
     and (cb_push_state is null or cb_push_state = 'error'
          or (cb_push_state = 'pushing' and cb_push_at < now() - interval '5 minutes'))
     and created_at < now() - interval '1 minute'
     and exists (select 1 from booking_villas where booking_id = b.id)
     and cb_push_enabled()
   order by created_at limit 20;
$$;

-- room list from Cloudbeds → villas
create or replace function cb_set_rooms(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; v uuid; v_matched text[] := '{}'; v_unmatched text[] := '{}';
begin
  for x in select * from jsonb_array_elements(p) loop
    select id into v from villas where cb_room_id = x->>'room_id';
    if v is null then
      select id into v from villas where cb_norm(unit_label) = cb_norm(x->>'room_name') limit 1;
    end if;
    if v is null then
      v_unmatched := v_unmatched || (coalesce(x->>'room_name', '?') || ' [' || coalesce(x->>'room_type_name', '') || ']');
    else
      update villas set cb_room_id = null where cb_room_id = x->>'room_id' and id <> v;
      update villas set cb_room_id = x->>'room_id', cb_room_type_id = x->>'room_type_id', cb_room_type_name = x->>'room_type_name'
       where id = v;
      v_matched := v_matched || (x->>'room_name');
    end if;
  end loop;
  return jsonb_build_object('matched', array_length(v_matched, 1), 'unmatched', to_jsonb(v_unmatched),
    'villas_without_cloudbeds_room', (select coalesce(jsonb_agg(unit_label order by sort), '[]'::jsonb) from villas where active and cb_room_id is null));
end;
$$;

-- Cloudbeds room blocks (out of service, blocked dates, courtesy holds) for
-- [p_from, p_to) → website blocks, so the website never sells those nights.
-- p = [{block_id, type, reason, start, end, rooms: [room_id, …]}]; Cloudbeds'
-- endDate is the last blocked night.
create or replace function cb_apply_blocks(p_from date, p_to date, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x jsonb; r text; v uuid; v_in date; v_out date; v_reason text;
  v_keep text[] := '{}'; v_added int := 0; v_removed int := 0; v_clash text[] := '{}';
begin
  perform set_config('vbr.cb_sync', 'on', true);
  perform set_config('vbr.actor', 'Cloudbeds', true);
  for x in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    v_in := (x->>'start')::date;
    v_out := (x->>'end')::date + 1;
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
  return jsonb_build_object('added', v_added, 'removed', v_removed, 'clashes', to_jsonb(v_clash));
end;
$$;

-- which of these Cloudbeds reservations are already up to date here
create or replace function cb_known(p_ids text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(cb_reservation_id, coalesce(cb_info->>'modified', '')), '{}'::jsonb)
    from booking_requests where cb_reservation_id = any(p_ids);
$$;

create or replace function cb_webhook_secret() returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
$$;

-- call the edge function (queued by pg_net, sent after commit)
create or replace function cb_call(p_action text, p_body jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text := cb_webhook_secret();
begin
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/cloudbeds-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := coalesce(p_body, '{}'::jsonb) || jsonb_build_object('action', p_action),
    timeout_milliseconds := 60000
  );
exception when others then
  raise warning 'cb_call % failed: %', p_action, sqlerrm;  -- never block a booking
end;
$$;

do $$ declare f text; begin
  foreach f in array array['cb_state_set(text,jsonb)', 'cb_apply_reservation(jsonb)', 'cb_claim_push(uuid)',
    'cb_push_result(uuid,text,text)', 'cb_pending_pushes()', 'cb_known(text[])', 'cb_push_enabled()', 'cb_apply_blocks(date,date,jsonb)', 'cb_set_rooms(jsonb)', 'cb_webhook_secret()', 'cb_call(text,jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- 6. triggers ------------------------------------------------------------------------
-- a casita was put on a website booking → create the booking in Cloudbeds
create or replace function cb_after_villa_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vbr.cb_sync', true) = 'on' or not cb_push_enabled() then return new; end if;
  if new.booking_id is not null and exists (
       select 1 from booking_requests b where b.id = new.booking_id
          and b.cb_reservation_id is null and not b.cb_owned and b.stay_type = 'overnight'
          and b.status not in ('declined', 'expired')) then
    perform cb_call('push', jsonb_build_object('booking_id', new.booking_id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cb_villa_push on booking_villas;
create trigger trg_cb_villa_push after insert on booking_villas
  for each row execute function cb_after_villa_insert();

-- confirmed / cancelled on the website → same in Cloudbeds
create or replace function cb_after_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vbr.cb_sync', true) = 'on' or not cb_push_enabled() then return new; end if;
  if new.cb_reservation_id is not null and not new.cb_owned and new.status is distinct from old.status then
    perform cb_call('status', jsonb_build_object('booking_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cb_status_push on booking_requests;
create trigger trg_cb_status_push after update of status on booking_requests
  for each row execute function cb_after_status_change();

-- 7. existing functions: be quiet during a sync ---------------------------------------
create or replace function public.notify_booking_email() returns trigger
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_secret text;
begin
  -- Cloudbeds sync: only website bookings (or ones staff chose to email) can
  -- ever produce a guest email, so don't wake the email function for the rest.
  if current_setting('vbr.cb_sync', true) = 'on'
     and coalesce(new.source, 'website') <> 'website' and not coalesce(new.email_guest, false) then
    return new;
  end if;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is null then
    return new; -- emails not set up yet; never block a booking
  end if;
  -- pg_net queues this and sends it only after the booking (and its
  -- cabanas) have been committed, so the function always sees the full row.
  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    ),
    timeout_milliseconds := 30000
  );
  return new;
exception when others then
  -- An email problem must never stop a guest's booking from saving.
  raise warning 'notify_booking_email failed: %', sqlerrm;
  return new;
end;
$function$;

-- Cloudbeds bookings are never auto-expired here (Cloudbeds manages them).
create or replace function public.process_booking_deadlines() returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_expired int := 0;
begin
  with due as (
    select b.id
      from booking_requests b, lateral booking_deadlines(b.created_at, b.check_in) d
     where b.status in ('pending', 'pending_payment')
       and not b.cb_owned
       and b.payment_uploaded_at is null
       and d.final_at is not null
       and now() >= d.final_at
  )
  update booking_requests b
     set status = 'expired', expired_at = now()
    from due
   where b.id = due.id;
  get diagnostics v_expired = row_count;
  return jsonb_build_object('expired', v_expired);
end;
$function$;

-- Activity log: name the sync as the author, and don't log pure sync bookkeeping.
create or replace function public.log_booking_change() returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid;
  v_email text;
  v_changes jsonb;
begin
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  begin v_email := auth.jwt() ->> 'email'; exception when others then v_email := null; end;
  v_email := coalesce(v_email, nullif(current_setting('vbr.actor', true), ''));
  if tg_op = 'INSERT' then
    insert into booking_audit_log (booking_id, order_code, guest_name, action, changed_by_id, changed_by_email, changes)
    values (new.id, new.order_code, new.guest_name, 'insert', v_uid, v_email, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    select jsonb_object_agg(t.key, jsonb_build_object('old', t.old_val, 'new', t.new_val))
      into v_changes
      from (
        select e.key as key, (to_jsonb(old) -> e.key) as old_val, (to_jsonb(new) -> e.key) as new_val
          from jsonb_each(to_jsonb(new)) as e(key, value)
         where (to_jsonb(old) -> e.key) is distinct from (to_jsonb(new) -> e.key)
           and e.key not like 'cb\_%'
      ) t;
    if v_changes is null then
      return new;
    end if;
    insert into booking_audit_log (booking_id, order_code, guest_name, action, changed_by_id, changed_by_email, changes)
    values (new.id, new.order_code, new.guest_name, 'update', v_uid, v_email, v_changes);
    return new;
  elsif tg_op = 'DELETE' then
    insert into booking_audit_log (booking_id, order_code, guest_name, action, changed_by_id, changed_by_email, changes)
    values (old.id, old.order_code, old.guest_name, 'delete', v_uid, v_email, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$function$;

-- 8. schedules ----------------------------------------------------------------------
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('cloudbeds-pull', 'cloudbeds-nightly');
end $$;
select cron.schedule('cloudbeds-pull', '*/5 * * * *', $$select public.cb_call('pull')$$);
-- 03:10 Manila: re-check every stay from yesterday on (catches anything a webhook missed)
select cron.schedule('cloudbeds-nightly', '10 19 * * *', $$select public.cb_call('full')$$);

-- 9. dashboard status ----------------------------------------------------------------
create or replace function cb_sync_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'last_pull', (select value from cb_sync_state where key = 'last_pull'),
    'last_error', (select value from cb_sync_state where key = 'last_error'),
    'setup', (select value from cb_sync_state where key = 'setup'),
    'push_enabled', cb_push_enabled(),
    'push_errors', (select count(*) from booking_requests where cb_push_state = 'error' and status not in ('declined', 'expired')),
    'push_waiting', (select count(*) from booking_requests where stay_type = 'overnight' and not cb_owned
                       and cb_reservation_id is null and status not in ('declined', 'expired', 'completed') and check_out >= current_date),
    'clashes_upcoming', (select count(*) from booking_requests where cb_info ? 'clashes' and check_out >= current_date
                           and status not in ('declined', 'expired'))
  );
$$;
-- "Sync now" button in the dashboard
create or replace function cb_request_sync() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'not allowed'; end if;
  perform cb_call('pull');
end;
$$;
revoke all on function cb_request_sync() from public, anon;
grant execute on function cb_request_sync() to authenticated;

revoke all on function cb_sync_status() from public, anon;
grant execute on function cb_sync_status() to authenticated;

-- 10. day trips → Google Sheet mirror ---------------------------------------------------
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'sheet_export_token') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'sheet_export_token',
      'Token the Google Sheet mirror (Apps Script) uses to read day trips');
  end if;
end $$;

-- One row per day trip, in the columns of the 2026 Day Trip Calendar.
create or replace function daytrip_sheet_rows(p_token text, p_year int) returns jsonb
language plpgsql stable security definer set search_path = public, vault as $$
declare v_ok boolean;
begin
  select exists (select 1 from vault.decrypted_secrets where name = 'sheet_export_token' and decrypted_secret = p_token)
    into v_ok;
  if not coalesce(v_ok, false) then raise exception 'not allowed'; end if;
  return (
    select coalesce(jsonb_agg(r order by r->>'date', r->>'created'), '[]'::jsonb) from (
      select jsonb_build_object(
        'date', b.check_in,
        'created', b.created_at,
        'month', extract(month from b.check_in)::int,
        'day', extract(day from b.check_in)::int,
        'booker', coalesce(b.booked_by, case when b.source = 'website' then 'Website' else b.source end),
        'name', b.guest_name,
        'kind', b.stay_type,
        'adults', greatest(b.adults - coalesce(b.senior_count, 0), 0),
        'kids', coalesce(b.children_6_12, 0),
        'kids05', coalesce(b.children_0_5, 0),
        'seniors', coalesce(b.senior_count, 0),
        'pets', coalesce(b.pet_count, 0),
        'dining', coalesce(c.dining, b.legacy_dining_cabanas, 0),
        'lounge', coalesce(c.lounge, b.legacy_lounge_cabanas, 0),
        'family', case when b.stay_type = 'all_inclusive_family' then 1 else 0 end,
        'barkada', case when b.stay_type = 'all_inclusive_barkada' then 1 else 0 end,
        'others', b.add_on_total,
        'total', b.total_amount,
        'status', b.status,
        'order', b.order_code,
        'remarks', concat_ws(' · ',
           case when b.status in ('pending', 'pending_payment') then 'UNPAID' end,
           nullif(regexp_replace(coalesce(b.staff_notes, ''), '^\[Imported from 2026 Day Trip Calendar\]\s*', ''), ''),
           nullif(b.notes, ''),
           case when b.children_0_5 > 0 then b.children_0_5 || ' kid(s) 0-5' end,
           b.order_code)
      ) as r
        from booking_requests b
        left join lateral (
          select count(*) filter (where cb.cabana_type = 'dining_cabana') as dining,
                 count(*) filter (where cb.cabana_type = 'lounge_cabana') as lounge
            from booking_cabanas bc join cabanas cb on cb.id = bc.cabana_id
           where bc.booking_id = b.id
          having count(*) > 0
        ) c on true
       where b.stay_type <> 'overnight'
         and b.check_in >= make_date(p_year, 1, 1) and b.check_in < make_date(p_year + 1, 1, 1)
         and b.status not in ('declined', 'expired')
    ) x
  );
end;
$$;
revoke all on function daytrip_sheet_rows(text, int) from public;
grant execute on function daytrip_sheet_rows(text, int) to anon, authenticated;

-- Show the token once so it can be pasted into the Apps Script:
--   select decrypted_secret from vault.decrypted_secrets where name = 'sheet_export_token';
