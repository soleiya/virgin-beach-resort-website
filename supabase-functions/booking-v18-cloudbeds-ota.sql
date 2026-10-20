-- ============================================================================
-- Booking rules v18 — the website as our own "OTA", Cloudbeds as the record
--
--   * A villa booked on the website (guest or staff, with our own forms) is
--     created in Cloudbeds right away as "Confirmation Pending" on the same
--     casita. The website runs the payment step (24 h deadline, 50% / full,
--     proof check); verifying a payment confirms it in Cloudbeds and posts the
--     payment to the Cloudbeds folio. Unpaid → cancelled in Cloudbeds.
--   * From then on the stay follows Cloudbeds: dates, casitas, guest details,
--     head count, status, check-in/out, cancellations. (Changes are made in
--     Cloudbeds; the dashboard locks those fields.)
--   * Go-live is explicit and only bookings made after it are sent:
--       select cb_go_live();        -- start sending website bookings
--       select cb_state_set('push_enabled', 'false'::jsonb);   -- back to test mode
--   * Day trips are unchanged (website only).
-- Re-runnable.
-- ============================================================================

-- 1. go-live switch: only bookings made from this moment are sent ---------------
create or replace function cb_push_from() returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::timestamptz from cb_sync_state where key = 'push_from'), 'infinity'::timestamptz);
$$;

create or replace function cb_go_live() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform cb_state_set('push_from', to_jsonb(now()));
  perform cb_state_set('push_enabled', 'true'::jsonb);
  return jsonb_build_object('push_enabled', true, 'push_from', now());
end;
$$;

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
     and created_at >= cb_push_from()
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

create or replace function cb_pending_pushes() returns setof uuid
language sql security definer set search_path = public as $$
  select id from booking_requests b
   where cb_reservation_id is null and not cb_owned and stay_type = 'overnight'
     and status not in ('declined', 'expired', 'completed')
     and check_out >= current_date
     and created_at >= cb_push_from()
     and cb_push_attempts < 6
     and (cb_push_state is null or cb_push_state = 'error'
          or (cb_push_state = 'pushing' and cb_push_at < now() - interval '5 minutes'))
     and created_at < now() - interval '1 minute'
     and exists (select 1 from booking_villas where booking_id = b.id)
     and cb_push_enabled()
   order by created_at limit 20;
$$;

-- 2. verified website payments → Cloudbeds folio -----------------------------------
alter table booking_payments add column if not exists cb_posted_at timestamptz;
alter table booking_payments add column if not exists cb_post_attempts int not null default 0;
alter table booking_payments add column if not exists cb_post_error text;

create or replace function cb_pending_payment_posts() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'reservation_id', b.cb_reservation_id, 'amount', p.amount,
           'method', p.method, 'kind', p.kind, 'note', p.note, 'order_code', b.order_code) order by p.verified_at), '[]'::jsonb)
    from booking_payments p join booking_requests b on b.id = p.booking_id
   where p.status = 'verified' and p.amount > 0 and p.cb_posted_at is null and p.cb_post_attempts < 5
     and b.cb_reservation_id is not null and not b.cb_owned
     and cb_push_enabled();
$$;

create or replace function cb_payment_posted(p_payment_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update booking_payments
     set cb_posted_at = case when p_error is null then now() end,
         cb_post_attempts = cb_post_attempts + case when p_error is null then 0 else 1 end,
         cb_post_error = left(p_error, 500)
   where id = p_payment_id;
$$;

create or replace function cb_after_payment_verified() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified') and cb_push_enabled()
     and exists (select 1 from booking_requests b where b.id = new.booking_id and b.cb_reservation_id is not null and not b.cb_owned) then
    perform cb_call('payments');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cb_payment_post on booking_payments;
create trigger trg_cb_payment_post after insert or update of status on booking_payments
  for each row execute function cb_after_payment_verified();

-- 3. Cloudbeds → website: website bookings now follow Cloudbeds too ------------------
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
  v_stay_changed boolean;
  v_cb_pax int;
  v_keep_split boolean;
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

  -- Status: Cloudbeds is the master. A website booking is sent to Cloudbeds as
  -- "Confirmation Pending" and the website runs its payment step (pending →
  -- proof → confirmed, or expired when unpaid); while Cloudbeds still says
  -- not_confirmed the website's own status stands. Anything Cloudbeds decides
  -- (confirmed, checked in/out, cancelled, no-show) is followed.
  v_target := case
    when v_owned then v_status
    when v_cb in ('canceled', 'no_show', 'deleted') then (case when b.status = 'expired' then 'expired' else 'declined' end)::booking_status
    when v_cb = 'checked_out' then 'completed'
    when v_cb in ('confirmed', 'checked_in') then 'confirmed'
    else b.status end;
  v_active := v_target not in ('declined', 'expired');

  v_reset := v_new
    or b.check_in is distinct from v_in or b.check_out is distinct from v_out
    or (b.status not in ('declined', 'expired')) is distinct from v_active
    or not (v_assigned <@ v_old_fixed and v_old_fixed <@ v_assigned)
    or (select coalesce(array_agg(z order by z), '{}') from unnest(v_types) z)
       is distinct from (select coalesce(array_agg(z order by z), '{}') from unnest(v_old_types) z);

  v_stay_changed := not v_new and (b.check_in is distinct from v_in or b.check_out is distinct from v_out
    or not (v_assigned <@ v_old_fixed and v_old_fixed <@ v_assigned));
  -- website bookings keep their adult / 6-12 / 0-5 split while Cloudbeds' head count agrees
  v_cb_pax := coalesce(nullif(p->>'adults', '')::numeric::int, 0) + coalesce(nullif(p->>'children', '')::numeric::int, 0);
  v_keep_split := not v_owned and (nullif(p->>'adults', '') is null
    or v_cb_pax = coalesce(b.adults, 0) + coalesce(b.children_6_12, 0) + coalesce(b.children_0_5, 0));

  if v_reset and not v_new then
    delete from booking_villas where booking_id = b.id;
  end if;

  update booking_requests set
    status = v_target,
    check_in = v_in,
    check_out = v_out,
    -- guest details follow Cloudbeds for every stay (website bookings too)
    guest_name = coalesce(nullif(trim(p->>'guest_name'), ''), guest_name),
    guest_email = case when lower(trim(coalesce(p->>'guest_email', ''))) in ('', 'reservations@virginbeachresort.com') and not v_owned
                       then guest_email else coalesce(nullif(trim(p->>'guest_email'), ''), guest_email) end,
    guest_phone = coalesce(nullif(trim(p->>'guest_phone'), ''), guest_phone),
    country = coalesce(nullif(trim(p->>'country'), ''), country),
    adults = case when v_keep_split then adults else greatest(coalesce(nullif(p->>'adults', '')::numeric::int, adults), 0) end,
    children_6_12 = case when v_keep_split then children_6_12 else greatest(coalesce(nullif(p->>'children', '')::numeric::int, children_6_12), 0) end,
    children_0_5 = case when v_keep_split then children_0_5 else 0 end,
    senior_count = case when v_keep_split then senior_count else least(senior_count, greatest(coalesce(nullif(p->>'adults', '')::numeric::int, adults), 0)) end,
    -- price: Cloudbeds' for its own stays; a website stay keeps the website quote
    -- (what the guest was asked to pay) until its dates or casitas change in Cloudbeds
    total_amount = case when v_owned or v_stay_changed then coalesce(nullif(p->>'total', '')::numeric, total_amount) else total_amount end,
    source = case when v_owned then cb_source_map(p->>'source') else source end,
    room_name = coalesce(v_rooms_text, room_name),
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

-- 4. permissions ----------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array['cb_push_from()', 'cb_go_live()', 'cb_claim_push(uuid)', 'cb_pending_pushes()',
    'cb_pending_payment_posts()', 'cb_payment_posted(uuid,text)', 'cb_apply_reservation(jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Status
select cb_push_enabled() as push_enabled, cb_push_from() as push_from;
