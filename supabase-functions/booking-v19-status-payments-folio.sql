-- ============================================================================
-- Booking rules v19 — statuses, payments and Cloudbeds folio
--
--   * Payment safety
--       - A booking expires when its payment deadline passes with no payment
--         waiting to be checked or verified (a junk / rejected upload no longer
--         holds the cabana or casita forever).
--       - Rejecting a proof gives the guest a fresh payment deadline (24 h, or
--         8:00 AM on the trip date if sooner), puts the booking back to
--         "Confirmation Pending" and emails the guest (PROOF_REJECTED).
--       - Confirming a booking in Cloudbeds no longer auto-approves payments
--         nobody has checked — staff verify them in Payments.
--       - submit_payment_proof only accepts the guest's own upload path.
--   * Staff-uploaded proofs: staff_attach_proof() records a verified payment
--     (so it shows in Payments, reaches the Cloudbeds folio and confirms).
--   * Cloudbeds: changes made there to a website booking email the guest;
--     the push carries meals / extra beds / pets / add-ons / discounts so the
--     Cloudbeds folio matches the website total; proofs are attached to the
--     Cloudbeds reservation (Documents) after the payment is posted.
-- Re-runnable.
-- ============================================================================

-- 1. columns -------------------------------------------------------------------------
alter table booking_requests add column if not exists pay_deadline_from timestamptz;  -- restarts the payment deadline
alter table booking_requests add column if not exists cb_folio_state text;           -- null | done | partial
alter table booking_requests add column if not exists cb_folio_note text;
alter table booking_payments add column if not exists cb_doc_posted_at timestamptz;
alter table booking_payments add column if not exists cb_doc_attempts int not null default 0;
alter table booking_payments add column if not exists cb_doc_error text;

-- 2. confirming (e.g. in Cloudbeds) no longer approves unchecked payments ------------
create or replace function public.booking_confirm_payments() returns trigger
language plpgsql security definer set search_path = public as $function$
begin
  -- Only a status change made on the website counts as staff having seen the money.
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
$function$;

-- 3. guest upload: own path only ------------------------------------------------------
create or replace function public.submit_payment_proof(p_order_code text, p_guest_email text, p_storage_path text, p_kind text default 'full')
returns boolean
language plpgsql security definer set search_path = public as $function$
declare
  b booking_requests%rowtype;
  v_kind text := coalesce(nullif(p_kind, ''), 'full');
  v_amount numeric;
  v_claimed numeric;
begin
  select * into b from booking_requests
   where order_code = upper(trim(p_order_code)) and lower(guest_email) = lower(trim(p_guest_email))
     and not cb_owned
   limit 1;
  if not found then return false; end if;
  if p_storage_path is null or lower(p_storage_path) not like lower('guest/' || b.order_code || '-%') or p_storage_path like '%..%' then
    raise exception 'Upload not recognised — please try again';
  end if;
  if b.status in ('declined', 'expired', 'completed') then
    raise exception 'This booking is no longer open for payment — please contact us';
  end if;
  select coalesce(sum(amount), 0) into v_claimed from booking_payments where booking_id = b.id and status <> 'rejected';
  if v_kind = 'deposit' and not half_allowed(b.check_in) then
    v_kind := 'full';  -- within 14 days of arrival: 100% is required
  end if;
  if v_kind not in ('deposit', 'full', 'balance') then v_kind := 'full'; end if;
  if v_kind = 'balance' and v_claimed = 0 then v_kind := 'full'; end if;
  v_amount := case v_kind
    when 'deposit' then round(coalesce(b.total_amount, 0) / 2, 2)
    when 'full' then greatest(coalesce(b.total_amount, 0) - v_claimed, 0)
    else greatest(coalesce(b.total_amount, 0) - greatest(v_claimed, b.amount_paid), 0) end;

  insert into booking_payments (booking_id, kind, amount, method, proof_path)
  values (b.id, v_kind, v_amount, 'transfer', p_storage_path);

  update booking_requests
     set payment_screenshot_path = p_storage_path,
         payment_uploaded_at = now(),
         amount_pending = coalesce((select sum(amount) from booking_payments p where p.booking_id = b.id and p.status = 'pending'), 0),
         payment_plan = coalesce(payment_plan, case when v_kind = 'deposit' then 'half' else 'full' end),
         status = case when status = 'pending' then 'pending_payment' else status end
   where id = b.id;
  return true;
end;
$function$;

-- 4. staff verify / reject ------------------------------------------------------------
create or replace function public.staff_verify_payment(p_payment_id uuid, p_amount numeric default null, p_reject boolean default false, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  p booking_payments%rowtype;
  b booking_requests%rowtype;
  v_paid numeric;
  v_full boolean;
  v_secret text;
  v_deadline timestamptz;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'not allowed'; end if;
  select * into p from booking_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  update booking_payments
     set status = case when p_reject then 'rejected' else 'verified' end,
         amount = coalesce(p_amount, amount),
         note = coalesce(nullif(trim(p_note), ''), note),
         verified_at = now(), verified_by = auth.jwt() ->> 'email'
   where id = p_payment_id;
  v_paid := recalc_amount_paid(p.booking_id);
  select * into b from booking_requests where id = p.booking_id;
  v_full := b.total_amount is not null and v_paid >= b.total_amount - 0.5;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;

  if p_reject then
    -- nothing else waiting or verified: back to Confirmation Pending with a fresh deadline
    if b.status in ('pending', 'pending_payment')
       and not exists (select 1 from booking_payments x where x.booking_id = b.id and x.status in ('pending', 'verified')) then
      update booking_requests set status = 'pending', pay_deadline_from = now() where id = b.id;
      select final_at into v_deadline from booking_deadlines(now(), b.check_in);
    end if;
    if v_secret is not null and p.proof_path is not null and p.proof_path not like 'staff/%' then
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'PROOF_REJECTED', 'record', jsonb_build_object('id', b.id), 'payment_id', p_payment_id,
          'reason', nullif(trim(coalesce(p_note, '')), ''), 'deadline', v_deadline),
        timeout_milliseconds := 30000);
    end if;
  elsif v_paid > 0 and b.status in ('pending', 'pending_payment') then
    update booking_requests set status = 'confirmed', paid_in_full_at = case when v_full then now() end where id = b.id;
  elsif v_full and b.paid_in_full_at is null then
    update booking_requests set paid_in_full_at = now() where id = b.id;
    if v_secret is not null and b.status <> 'completed' then
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'PAID_IN_FULL', 'record', jsonb_build_object('id', b.id), 'payment_id', p_payment_id),
        timeout_milliseconds := 30000);
    end if;
  end if;
  return booking_payment_summary(b.id);
end;
$function$;

-- 5. a proof uploaded by staff = a verified payment ------------------------------------
create or replace function public.staff_attach_proof(p_booking_id uuid, p_path text, p_portion text default 'full')
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  b booking_requests%rowtype;
  v_kind text := case p_portion when 'deposit' then 'deposit' when 'balance' then 'balance' else 'full' end;
  v_amount numeric;
  v_id uuid;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'not allowed'; end if;
  if p_path is null or p_path not like 'staff/' || p_booking_id::text || '-%' then raise exception 'Unexpected file path'; end if;
  select * into b from booking_requests where id = p_booking_id;
  if not found then raise exception 'Booking not found'; end if;
  if v_kind = 'balance' and coalesce(b.amount_paid, 0) = 0 then v_kind := 'full'; end if;
  v_amount := case v_kind when 'deposit' then round(coalesce(b.total_amount, 0) / 2, 2)
                          else greatest(coalesce(b.total_amount, 0) - coalesce(b.amount_paid, 0), 0) end;
  insert into booking_payments (booking_id, kind, amount, method, proof_path, note, created_by)
  values (b.id, v_kind, v_amount, 'transfer', p_path, 'Proof uploaded by staff', auth.jwt() ->> 'email')
  returning id into v_id;
  update booking_requests set payment_screenshot_path = p_path, payment_uploaded_at = now(),
         payment_plan = coalesce(payment_plan, case when v_kind = 'deposit' then 'half' else 'full' end)
   where id = b.id;
  return staff_verify_payment(v_id, v_amount, false, null);
end;
$function$;
revoke all on function public.staff_attach_proof(uuid, text, text) from public, anon;
grant execute on function public.staff_attach_proof(uuid, text, text) to authenticated;

-- 6. expiry: deadline passed and no payment waiting or verified --------------------------
create or replace function public.process_booking_deadlines() returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_expired int := 0;
  v_due int := 0;
  v_overdue int := 0;
  v_secret text;
  x record;
begin
  with due as (
    select b.id
      from booking_requests b, lateral booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in) d
     where b.status in ('pending', 'pending_payment')
       and not b.cb_owned
       and not exists (select 1 from booking_payments p where p.booking_id = b.id and p.status in ('pending', 'verified'))
       and d.final_at is not null
       and now() >= d.final_at
  )
  update booking_requests b
     set status = 'expired', expired_at = now()
    from due
   where b.id = due.id;
  get diagnostics v_expired = row_count;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is not null then
    -- 3 days before the balance date
    for x in
      select b.id from booking_requests b
       where b.status = 'confirmed' and not b.cb_owned and b.amount_paid > 0
         and b.total_amount is not null and b.amount_paid < b.total_amount - 0.5
         and b.check_in > manila_today()
         and manila_today() >= balance_due_date(b.check_in) - 3
         and manila_today() <= balance_due_date(b.check_in)
         and b.balance_reminder_at is null
       limit 50
    loop
      update booking_requests set balance_reminder_at = now() where id = x.id;
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'BALANCE_DUE', 'record', jsonb_build_object('id', x.id)),
        timeout_milliseconds := 30000);
      v_due := v_due + 1;
    end loop;
    -- the day after the balance date: guest reminder + staff alert
    for x in
      select b.id from booking_requests b
       where b.status = 'confirmed' and not b.cb_owned and b.amount_paid > 0
         and b.total_amount is not null and b.amount_paid < b.total_amount - 0.5
         and b.check_in >= manila_today()
         and manila_today() > balance_due_date(b.check_in)
         and b.balance_overdue_at is null
       limit 50
    loop
      update booking_requests set balance_overdue_at = now() where id = x.id;
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'BALANCE_OVERDUE', 'record', jsonb_build_object('id', x.id)),
        timeout_milliseconds := 30000);
      v_overdue := v_overdue + 1;
    end loop;
  end if;
  return jsonb_build_object('expired', v_expired, 'balance_reminders', v_due, 'balance_overdue', v_overdue);
end;
$function$;

-- 7. push carries the folio lines; proofs go to Cloudbeds after the payment ---------------
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

create or replace function cb_folio_result(p_booking_id uuid, p_state text, p_note text) returns void
language sql security definer set search_path = public as $$
  update booking_requests set cb_folio_state = p_state, cb_folio_note = left(p_note, 1000) where id = p_booking_id;
$$;

create or replace function cb_pending_payment_posts() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'reservation_id', b.cb_reservation_id, 'amount', p.amount,
           'method', p.method, 'kind', p.kind, 'note', p.note, 'order_code', b.order_code,
           'proof_path', p.proof_path, 'need_payment', p.cb_posted_at is null,
           'need_doc', p.proof_path is not null and p.cb_doc_posted_at is null and p.cb_doc_attempts < 5) order by p.verified_at), '[]'::jsonb)
    from booking_payments p join booking_requests b on b.id = p.booking_id
   where p.status = 'verified' and p.amount > 0
     and ((p.cb_posted_at is null and p.cb_post_attempts < 5)
          or (p.cb_posted_at is not null and p.proof_path is not null and p.cb_doc_posted_at is null and p.cb_doc_attempts < 5))
     and b.cb_reservation_id is not null and not b.cb_owned
     and cb_push_enabled();
$$;

create or replace function cb_payment_doc_posted(p_payment_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update booking_payments
     set cb_doc_posted_at = case when p_error is null then now() end,
         cb_doc_attempts = cb_doc_attempts + case when p_error is null then 0 else 1 end,
         cb_doc_error = left(p_error, 500)
   where id = p_payment_id;
$$;

-- 8. Cloudbeds → website: changes to website bookings email the guest -------------------------
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

  return jsonb_build_object('id', v_id, 'booking_id', b.id, 'new', v_new, 'villas_reset', v_reset,
                            'clashes', to_jsonb(v_clash));
end;
$$;

-- 9. permissions --------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array['cb_claim_push(uuid)', 'cb_folio_result(uuid,text,text)', 'cb_pending_payment_posts()',
    'cb_payment_doc_posted(uuid,text)', 'cb_apply_reservation(jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.submit_payment_proof(text, text, text, text) from public;
grant execute on function public.submit_payment_proof(text, text, text, text) to anon, authenticated;
revoke all on function public.staff_verify_payment(uuid, numeric, boolean, text) from public, anon;
grant execute on function public.staff_verify_payment(uuid, numeric, boolean, text) to authenticated;

select 'v19 applied' as status, cb_push_enabled() as push_enabled;
