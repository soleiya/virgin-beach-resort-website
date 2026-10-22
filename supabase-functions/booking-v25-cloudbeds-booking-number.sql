-- ============================================================================
-- Booking rules v25 — one booking number for website villa bookings
--
--   New villa bookings made on the website (by a guest or by staff) take
--   Cloudbeds' confirmation number as their Booking ID, written VBR-<number>
--   (e.g. VBR-1234567890), as soon as they reach Cloudbeds. Cloudbeds' own
--   emails print the same VBR-<number>, so there is only one number.
--
--   * The temporary VBR-xxxxx the booking starts with is kept in
--     order_code_temp and still works on the Upload Payment page (so does
--     typing just the Cloudbeds number).
--   * Day trips, and every booking made before this update, keep their code
--     (history is not changed).
--   * booking_ref(id) lets the booking page show the final number right away.
-- Re-runnable.
-- ============================================================================

alter table booking_requests add column if not exists order_code_temp text;
alter table booking_requests add column if not exists cb_ref_code boolean not null default false;
create index if not exists booking_requests_order_code_temp_idx on booking_requests (order_code_temp) where order_code_temp is not null;

-- new website villa bookings → will take the Cloudbeds number
-- (runs after trg_set_booking_origin: triggers fire in name order)
create or replace function set_cb_ref_code() returns trigger
language plpgsql as $$
begin
  if new.stay_type = 'overnight' and not coalesce(new.cb_owned, false)
     and new.booking_origin in ('site_guest', 'site_staff') then
    new.cb_ref_code := true;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_set_cb_ref_code on booking_requests;
create trigger trg_set_cb_ref_code before insert on booking_requests
  for each row execute function set_cb_ref_code();

-- push finished: store the Cloudbeds reservation, and switch the Booking ID
create or replace function cb_push_result(p_booking_id uuid, p_reservation_id text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('vbr.cb_sync', 'on', true);
  perform set_config('vbr.actor', 'Cloudbeds', true);
  if p_reservation_id is not null then
    update booking_requests
       set cb_reservation_id = p_reservation_id, cb_push_state = 'done', cb_push_error = p_error,
           order_code_temp = case when cb_ref_code and order_code_temp is null and order_code is distinct from 'VBR-' || p_reservation_id
                                  then order_code else order_code_temp end,
           order_code = case when cb_ref_code then 'VBR-' || p_reservation_id else order_code end
     where id = p_booking_id;
  else
    update booking_requests set cb_push_state = 'error', cb_push_error = left(p_error, 1000) where id = p_booking_id;
  end if;
end;
$$;
revoke all on function cb_push_result(uuid, text, text) from public, anon, authenticated;
grant execute on function cb_push_result(uuid, text, text) to service_role;

-- also when Cloudbeds' webhook links the reservation first (matched by the
-- temporary code we sent as its third-party ID)
create or replace function cb_ref_code_on_link() returns trigger
language plpgsql as $$
begin
  if new.cb_ref_code and new.cb_reservation_id is not null and old.cb_reservation_id is null
     and new.order_code is distinct from 'VBR-' || new.cb_reservation_id then
    new.order_code_temp := coalesce(new.order_code_temp, old.order_code);
    new.order_code := 'VBR-' || new.cb_reservation_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cb_ref_code_on_link on booking_requests;
create trigger trg_cb_ref_code_on_link before update of cb_reservation_id on booking_requests
  for each row execute function cb_ref_code_on_link();

-- what the guest typed → the booking's current code
--   "vbr-123" / " VBR-123 " → VBR-123 ; "1234567890" → VBR-1234567890 ;
--   an old temporary code → the booking it belongs to now
create or replace function resolve_order_code(p text) returns text
language sql stable security definer set search_path = public as $$
  with x as (select case when trim(coalesce(p, '')) ~ '^[0-9]+$' then 'VBR-' || trim(p) else upper(trim(coalesce(p, ''))) end as c)
  select coalesce(
    (select b.order_code from booking_requests b, x where b.order_code = x.c limit 1),
    (select b.order_code from booking_requests b, x where b.order_code_temp = x.c limit 1),
    (select c from x));
$$;
revoke all on function resolve_order_code(text) from public, anon, authenticated;

-- Upload Payment page lookup (v23 + the code resolution above)
create or replace function get_booking_uploads(p_order_code text, p_guest_email text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order_code', b.order_code,
    'first_name', split_part(trim(coalesce(b.guest_name, '')), ' ', 1),
    'status', b.status,
    'stay_type', b.stay_type,
    'stay_label', coalesce(b.stay_type_label, b.stay_type),
    'check_in', b.check_in,
    'check_out', b.check_out,
    'senior_count', coalesce(b.senior_count, 0),
    'senior_ids', coalesce(array_length(b.senior_id_paths, 1), 0),
    'pet_count', coalesce(b.pet_count, 0),
    'pet_cards', coalesce(array_length(b.pet_vaccination_paths, 1), 0),
    'pet_policy_agreed', b.pet_policy_agreed_at is not null,
    'payment_uploaded', b.payment_uploaded_at is not null,
    'online_discount', coalesce(b.online_discount, 0),
    'in_cloudbeds', b.cb_reservation_id is not null,
    'secure_by', case when b.status in ('pending', 'pending_payment') and b.payment_uploaded_at is null then d.final_at end,
    'pay', booking_payment_summary(b.id)
  )
  from booking_requests b
  left join lateral booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in) d on true
  where b.order_code = resolve_order_code(p_order_code)
    and lower(b.guest_email) = lower(trim(p_guest_email))
    and not b.cb_owned
  limit 1;
$$;
revoke all on function get_booking_uploads(text, text) from public;
grant execute on function get_booking_uploads(text, text) to anon, authenticated;

-- booking page: the booking's number once Cloudbeds has assigned it
create or replace function booking_ref(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order_code', b.order_code,
    'final', not b.cb_ref_code or b.cb_reservation_id is not null,
    'failed', b.cb_push_state = 'error')
    from booking_requests b
   where b.id = p_booking_id and b.created_at > now() - interval '1 hour';
$$;
revoke all on function booking_ref(uuid) from public;
grant execute on function booking_ref(uuid) to anon, authenticated;

select 'v25 applied' as status;
