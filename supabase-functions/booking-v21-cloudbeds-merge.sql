-- ============================================================================
-- Booking rules v21 — merge of the two Cloudbeds-first versions
--
-- v18-cloudbeds-ota + v19 (Cloudbeds view account) and v18-cloudbeds-first
-- (this account) both send website villa bookings to Cloudbeds. This keeps
-- v19's behaviour and functions, and adds from v18-cloudbeds-first:
--   * booking_origin (site_guest / site_staff / cloudbeds / sheet) — already
--     in the database, unchanged here;
--   * a payment posted directly in Cloudbeds counts on the website;
--   * a guest's proof is attached to the Cloudbeds reservation (Documents +
--     note) as soon as it's uploaded, not only after it's verified;
--   * emails: the website sends only the quotation for villa bookings that are
--     in Cloudbeds (send-booking-email), Cloudbeds sends the rest.
-- It puts back v19's cb_claim_push and cb_apply_reservation (replaced by
-- v18-cloudbeds-first) and removes that version's extra payment trigger, so
-- each payment reaches Cloudbeds once, through cb_pending_payment_posts.
-- Re-runnable. Test mode (push_enabled) is not touched.
-- ============================================================================

-- 1. v19's push payload (folio lines, add-ons with names and prices, go-live date)
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
  return to_jsonb(b) || jsonb_build_object(
    'villas', (select coalesce(jsonb_agg(jsonb_build_object('unit_label', v.unit_label, 'cb_room_id', v.cb_room_id,
                                                            'cb_room_type_id', v.cb_room_type_id) order by v.sort), '[]'::jsonb)
                 from booking_villas bv join villas v on v.id = bv.villa_id where bv.booking_id = b.id),
    -- add-ons with their names and prices (booking_requests.add_ons only has slug + qty)
    'addon_lines', (select coalesce(jsonb_agg(jsonb_build_object('slug', a.slug, 'name', a.name, 'price', a.price, 'qty', (x->>'qty')::int)), '[]'::jsonb)
                      from jsonb_array_elements(coalesce(b.add_ons, '[]'::jsonb)) x join add_ons a on a.slug = x->>'slug'),
    'nights', b.check_out - b.check_in);
end;
$$;


-- 2. one way for payments to reach Cloudbeds (v18-ota / v19); drop the duplicate
drop trigger if exists trg_cb_payment on booking_payments;
drop function if exists cb_after_payment_change();
drop function if exists cb_payment_ctx(uuid);
drop function if exists cb_payment_result(uuid, text, text, text);
drop function if exists cb_unsent_payments(uuid);
drop function if exists cb_site_booking_follow(uuid, jsonb);

-- proofs go to Cloudbeds' Documents once uploaded (pending too); payments once verified
create or replace function cb_pending_payment_posts() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'reservation_id', b.cb_reservation_id, 'amount', p.amount,
           'method', p.method, 'kind', p.kind, 'note', p.note, 'order_code', b.order_code, 'status', p.status,
           'proof_path', p.proof_path,
           'need_payment', p.status = 'verified' and p.cb_posted_at is null and p.cb_post_attempts < 5
                           and coalesce(p.verified_by, '') <> 'Cloudbeds',
           'need_doc', p.proof_path is not null and p.cb_doc_posted_at is null and p.cb_doc_attempts < 5)
         order by coalesce(p.verified_at, p.created_at)), '[]'::jsonb)
    from booking_payments p join booking_requests b on b.id = p.booking_id
   where p.amount > 0
     and ((p.status = 'verified' and p.cb_posted_at is null and p.cb_post_attempts < 5 and coalesce(p.verified_by, '') <> 'Cloudbeds')
          or (p.status in ('pending', 'verified') and p.proof_path is not null and p.cb_doc_posted_at is null and p.cb_doc_attempts < 5))
     and b.cb_reservation_id is not null and not b.cb_owned
     and cb_push_enabled();
$$;

create or replace function cb_after_payment_verified() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vbr.cb_sync', true) = 'on' or not cb_push_enabled() then return new; end if;
  if ((new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified') and coalesce(new.verified_by, '') <> 'Cloudbeds')
      or (tg_op = 'INSERT' and new.proof_path is not null))
     and exists (select 1 from booking_requests b where b.id = new.booking_id and b.cb_reservation_id is not null and not b.cb_owned) then
    perform cb_call('payments');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cb_payment_post on booking_payments;
create trigger trg_cb_payment_post after insert or update of status on booking_payments
  for each row execute function cb_after_payment_verified();

-- 3. a payment posted in Cloudbeds counts here: uploads it covers are verified
-- (by "Cloudbeds", so they aren't posted back), and the paid amount follows.
create or replace function cb_site_payments_follow(p_booking_id uuid, p_paid numeric) returns void
language plpgsql security definer set search_path = public as $$
declare b booking_requests%rowtype;
begin
  if p_paid is null then return; end if;
  select * into b from booking_requests where id = p_booking_id;
  if not found or b.cb_owned or p_paid <= coalesce(b.amount_paid, 0) + 0.5 then return; end if;
  update booking_payments p set status = 'verified', verified_at = now(), verified_by = 'Cloudbeds'
   where p.booking_id = b.id and p.status = 'pending'
     and (select coalesce(sum(q.amount), 0) from booking_payments q
           where q.booking_id = b.id and (q.status = 'verified' or (q.status = 'pending' and q.created_at <= p.created_at))) <= p_paid + 0.5;
  update booking_requests set
    amount_paid = greatest(coalesce((select sum(q.amount) from booking_payments q where q.booking_id = b.id and q.status = 'verified'), 0), p_paid),
    amount_pending = coalesce((select sum(q.amount) from booking_payments q where q.booking_id = b.id and q.status = 'pending'), 0),
    paid_in_full_at = case when paid_in_full_at is null and total_amount is not null and p_paid >= total_amount - 0.5 then now() else paid_in_full_at end
  where id = b.id;
end;
$$;

-- 4. v19's Cloudbeds → website sync, plus the payment rule above
create or replace function cb_apply_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
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
  v_old booking_requests%rowtype;
  v_changes jsonb := '[]'::jsonb;
  v_secret text;
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

  v_old := b;
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
    -- dates moved in Cloudbeds: balance reminders start over for the new dates
    balance_reminder_at = case when v_stay_changed then null else balance_reminder_at end,
    balance_overdue_at = case when v_stay_changed then null else balance_overdue_at end,
    cb_synced_at = now()
  where id = b.id
  returning * into b;

  -- A website booking changed in Cloudbeds (dates, casitas or price): tell the
  -- guest, in the same email thread, like any change made on the dashboard.
  if not v_owned and not v_new and v_target not in ('declined', 'expired') then
    if v_old.check_in is distinct from b.check_in or v_old.check_out is distinct from b.check_out then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('label', 'Stay',
        'before', to_char(v_old.check_in, 'Mon DD, YYYY') || ' → ' || to_char(v_old.check_out, 'Mon DD, YYYY'),
        'after', to_char(b.check_in, 'Mon DD, YYYY') || ' → ' || to_char(b.check_out, 'Mon DD, YYYY')));
    end if;
    if v_old.room_name is distinct from b.room_name and v_stay_changed then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('label', 'Casita(s)',
        'before', coalesce(v_old.room_name, '—'), 'after', coalesce(b.room_name, '—')));
    end if;
    if v_old.total_amount is distinct from b.total_amount then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('label', 'Total',
        'before', coalesce('₱' || to_char(v_old.total_amount, 'FM999,999,990.00'), '—'),
        'after', coalesce('₱' || to_char(b.total_amount, 'FM999,999,990.00'), '—')));
    end if;
    if jsonb_array_length(v_changes) > 0 then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
      if v_secret is not null then
        perform net.http_post(
          url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
          body := jsonb_build_object('type', 'CHANGE', 'record', jsonb_build_object('id', b.id), 'changes', v_changes,
            'old_check_in', v_old.check_in, 'source', 'cloudbeds', 'change_id', gen_random_uuid(), 'changed_by', 'Cloudbeds'),
          timeout_milliseconds := 30000);
      end if;
    end if;
  end if;

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

  -- v21: a payment posted in Cloudbeds counts on the website too
  if not v_owned then
    perform cb_site_payments_follow(b.id, nullif(p->>'paid', '')::numeric);
  end if;

  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'villas_reset', v_reset,
                            'clashes', to_jsonb(v_clash));
end;
$$;


-- 5. permissions
do $$ declare f text; begin
  foreach f in array array['cb_claim_push(uuid)', 'cb_pending_payment_posts()', 'cb_apply_reservation(jsonb)',
                           'cb_site_payments_follow(uuid,numeric)', 'cb_folio_preview(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

select 'v21 applied' as status, cb_push_enabled() as push_enabled;
