-- ============================================================================
-- Booking rules v18 — Cloudbeds is the main source for villas
--
--   * booking_origin on every booking: site_guest (booked by a guest on the
--     website), site_staff (made in the staff dashboard), cloudbeds (made in
--     Cloudbeds / OTAs) or sheet (2026 Day Trip sheet import).
--   * A villa booked on the site is written to Cloudbeds as a full
--     reservation (source "New Website – Guest" / "– Staff", meals and extras
--     on the folio, discounts as adjustments — see cloudbeds-sync). After
--     that Cloudbeds is in charge: its status wins, and staff can work the
--     reservation in Cloudbeds as usual.
--   * Payments: a proof uploaded on the website is attached to the Cloudbeds
--     reservation (Documents + a note). When staff verify it on the website
--     it's posted to the Cloudbeds folio. A payment posted directly in
--     Cloudbeds counts on the website too.
-- Re-runnable.
-- ============================================================================

-- 1. where each booking was made ------------------------------------------------
alter table booking_requests add column if not exists booking_origin text;

update booking_requests set booking_origin = case
    when cb_owned then 'cloudbeds'
    when source = 'sheet_import' then 'sheet'
    when booked_by is not null or coalesce(source, 'website') <> 'website' then 'site_staff'
    else 'site_guest' end
 where booking_origin is null;

create or replace function set_booking_origin() returns trigger
language plpgsql as $$
declare v_role text;
begin
  if new.booking_origin is null then
    begin v_role := auth.role(); exception when others then v_role := null; end;
    new.booking_origin := case
      when new.cb_owned or current_setting('vbr.cb_sync', true) = 'on' then 'cloudbeds'
      when new.source = 'sheet_import' then 'sheet'
      when v_role = 'authenticated' then 'site_staff'
      else 'site_guest' end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_set_booking_origin on booking_requests;
create trigger trg_set_booking_origin before insert on booking_requests
  for each row execute function set_booking_origin();
create index if not exists booking_requests_origin_idx on booking_requests (booking_origin);

-- 2. payments ↔ Cloudbeds ---------------------------------------------------------
alter table booking_payments add column if not exists cb_document_id text;
alter table booking_payments add column if not exists cb_payment_id text;
alter table booking_payments add column if not exists cb_error text;

-- What the push needs: the booking, its casitas and the website quotation.
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
  return to_jsonb(b) || jsonb_build_object(
    'villas', (select coalesce(jsonb_agg(jsonb_build_object('unit_label', v.unit_label, 'cb_room_id', v.cb_room_id,
                                                 'cb_room_type_id', v.cb_room_type_id) order by v.sort), '[]'::jsonb)
                 from booking_villas bv join villas v on v.id = bv.villa_id where bv.booking_id = b.id),
    'quote', quote_booking_overnight(b.id));
end;
$$;

-- One payment, with what the sync needs to send it to Cloudbeds.
create or replace function cb_payment_ctx(p_payment_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object(
    'reservation_id', b.cb_reservation_id, 'order_code', b.order_code, 'guest_name', b.guest_name,
    'total', b.total_amount, 'cb_owned', b.cb_owned)
    from booking_payments p join booking_requests b on b.id = p.booking_id
   where p.id = p_payment_id;
$$;

create or replace function cb_payment_result(p_payment_id uuid, p_document_id text, p_cb_payment_id text, p_error text)
returns void language sql security definer set search_path = public as $$
  update booking_payments
     set cb_document_id = coalesce(p_document_id, cb_document_id),
         cb_payment_id = coalesce(p_cb_payment_id, cb_payment_id),
         cb_error = p_error
   where id = p_payment_id;
$$;

-- Payments not in Cloudbeds yet for a booking that now is (e.g. uploaded
-- before the booking reached Cloudbeds) — the sync sends them after a push.
create or replace function cb_unsent_payments(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'needs_document', p.proof_path is not null and p.cb_document_id is null,
                                               'needs_payment', p.status = 'verified' and p.cb_payment_id is null
                                                                and coalesce(p.verified_by, '') <> 'Cloudbeds')
                            order by p.created_at), '[]'::jsonb)
    from booking_payments p
   where p.booking_id = p_booking_id
     and ((p.proof_path is not null and p.cb_document_id is null)
          or (p.status = 'verified' and p.cb_payment_id is null and coalesce(p.verified_by, '') <> 'Cloudbeds'));
$$;

do $$ declare f text; begin
  foreach f in array array['cb_claim_push(uuid)', 'cb_payment_ctx(uuid)', 'cb_payment_result(uuid,text,text,text)', 'cb_unsent_payments(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

create or replace function cb_after_payment_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_res text; v_owned boolean;
begin
  if current_setting('vbr.cb_sync', true) = 'on' or not cb_push_enabled() then return new; end if;
  select cb_reservation_id, cb_owned into v_res, v_owned from booking_requests where id = new.booking_id;
  if v_res is null or v_owned then return new; end if;
  if tg_op = 'INSERT' and new.proof_path is not null then
    perform cb_call('proof', jsonb_build_object('payment_id', new.id));
  end if;
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified')
     and new.cb_payment_id is null and coalesce(new.verified_by, '') <> 'Cloudbeds' then
    perform cb_call('payment', jsonb_build_object('payment_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cb_payment on booking_payments;
create trigger trg_cb_payment after insert or update of status on booking_payments
  for each row execute function cb_after_payment_change();

-- 3. Cloudbeds wins for site villas that are in Cloudbeds ---------------------------
-- (cb_apply_reservation from v14, with the status / payment rules changed for
-- website bookings: Cloudbeds' status is now the truth, and a payment posted
-- in Cloudbeds counts here.)
create or replace function cb_site_booking_follow(p_booking_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  b booking_requests%rowtype;
  v_cb text := p->>'status';
  v_paid numeric := nullif(p->>'paid', '')::numeric;
  v_target booking_status;
begin
  select * into b from booking_requests where id = p_booking_id;
  if not found or b.cb_owned then return; end if;
  perform set_config('vbr.cb_sync', 'on', true);
  perform set_config('vbr.actor', 'Cloudbeds', true);
  v_target := case
    when v_cb = 'not_confirmed' then case when b.status in ('pending', 'pending_payment', 'confirmed') then b.status::text else 'pending' end
    when v_cb in ('confirmed', 'checked_in') then 'confirmed'
    when v_cb = 'checked_out' then 'completed'
    when v_cb in ('canceled', 'no_show', 'deleted') then case when b.status = 'expired' then 'expired' else 'declined' end
    else b.status::text end::booking_status;
  -- payments posted in Cloudbeds count here; cover uploads up to that amount
  if v_paid is not null and v_paid > b.amount_paid + 0.5 then
    update booking_payments p set status = 'verified', verified_at = now(), verified_by = 'Cloudbeds'
     where p.booking_id = b.id and p.status = 'pending'
       and (select coalesce(sum(amount), 0) from booking_payments q
             where q.booking_id = b.id and (q.status = 'verified' or (q.status = 'pending' and q.created_at <= p.created_at))) <= v_paid + 0.5;
  end if;
  update booking_requests set
    status = v_target,
    amount_paid = greatest(coalesce((select sum(amount) from booking_payments q where q.booking_id = b.id and q.status = 'verified'), 0), coalesce(v_paid, 0)),
    amount_pending = coalesce((select sum(amount) from booking_payments q where q.booking_id = b.id and q.status = 'pending'), 0),
    paid_in_full_at = case when paid_in_full_at is null and total_amount is not null
                            and greatest(amount_paid, coalesce(v_paid, 0)) >= total_amount - 0.5 then now() else paid_in_full_at end
  where id = b.id;
end;
$$;
revoke all on function cb_site_booking_follow(uuid, jsonb) from public, anon, authenticated;
grant execute on function cb_site_booking_follow(uuid, jsonb) to service_role;

-- the v14 sync function, with the v18 status / payment rules
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
  -- v18: Cloudbeds decides for website bookings too, once they're in Cloudbeds.
  -- ("Confirmation Pending" there doesn't undo a confirmation made on the site
  -- a moment ago — the site pushes that to Cloudbeds.)
  v_target := case
    when v_owned then v_status
    when v_cb = 'not_confirmed' then case when b.status in ('pending', 'pending_payment', 'confirmed') then b.status else 'pending'::booking_status end
    when v_cb in ('confirmed', 'checked_in') then 'confirmed'::booking_status
    when v_cb = 'checked_out' then 'completed'::booking_status
    when v_cb in ('canceled', 'no_show', 'deleted') then case when b.status = 'expired' then b.status else 'declined'::booking_status end
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

  -- v18: payments posted in Cloudbeds count on the website
  if not v_owned then
    perform cb_site_booking_follow(b.id, p);
  end if;

  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'villas_reset', v_reset,
                            'clashes', to_jsonb(v_clash));
end;
$$;


-- 5. Confirmed in Cloudbeds ≠ payment checked on the website ----------------------------
-- (v16 counted uploads as verified when a booking was set to Confirmed by hand.
-- Keep that for staff on the site, but not when the confirmation comes from
-- Cloudbeds — there, Cloudbeds' paid amount decides, see cb_site_booking_follow.)
create or replace function booking_confirm_payments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vbr.cb_sync', true) = 'on' then return new; end if;
  if new.status = 'confirmed' and old.status in ('pending', 'pending_payment') and not new.cb_owned then
    update booking_payments set status = 'verified', verified_at = now(), verified_by = coalesce(auth.jwt() ->> 'email', 'status change')
     where booking_id = new.id and status = 'pending';
    new.amount_paid := coalesce((select sum(amount) from booking_payments p where p.booking_id = new.id and p.status = 'verified'), 0);
    new.amount_pending := 0;
    if new.total_amount is not null and new.amount_paid >= new.total_amount - 0.5 and new.paid_in_full_at is null then
      new.paid_in_full_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- 6. dashboard: which Cloudbeds sources the site uses ---------------------------------
-- (filled by the sync's setup from getSources: {"site_guest": "s-…", "site_staff": "s-…"})
insert into cb_sync_state (key, value) values ('sources', '{}'::jsonb) on conflict (key) do nothing;

-- 7. dry run for the sync's folio_plan action: booking + quotation, nothing claimed
create or replace function cb_folio_preview(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(b) || jsonb_build_object('quote', quote_booking_overnight(b.id))
    from booking_requests b where b.id = p_booking_id;
$$;
revoke all on function cb_folio_preview(uuid) from public, anon, authenticated;
grant execute on function cb_folio_preview(uuid) to service_role;
