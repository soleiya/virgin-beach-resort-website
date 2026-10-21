-- ============================================================================
-- Booking rules v23 — everything the guest gives us reaches Cloudbeds
--
--   * Senior / PWD ID photos and pet vaccination cards (uploaded at booking or
--     later on the Upload Payment page) are attached to the Cloudbeds
--     reservation's Documents, like payment proofs, with a note.
--   * A second screenshot for a payment that's already waiting to be checked
--     (₱0 left to claim) still goes to Cloudbeds' Documents.
--   * The Upload Payment page knows when a booking is handled in Cloudbeds,
--     so it doesn't promise a website email.
-- The booking's details (guest list, requests, pets, how they heard, …) are
-- written to a Cloudbeds note by the cloudbeds-sync function at push time.
-- Re-runnable. Test mode / go-live is not touched.
-- ============================================================================

alter table booking_requests add column if not exists cb_docs_sent text[] not null default '{}';
alter table booking_requests add column if not exists cb_docs_error text;
alter table booking_requests add column if not exists cb_docs_attempts int not null default 0;
alter table booking_requests add column if not exists cb_details_at timestamptz;   -- details note posted

-- IDs / pet cards not in Cloudbeds yet (for website bookings that are)
create or replace function cb_pending_docs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', b.id, 'reservation_id', b.cb_reservation_id, 'order_code', b.order_code,
           'docs', d.docs) order by b.created_at), '[]'::jsonb)
    from booking_requests b
    cross join lateral (
      select jsonb_agg(jsonb_build_object('bucket', x.bucket, 'path', x.path, 'label', x.label)) docs
        from (select 'senior-ids' bucket, p path, 'Senior-PWD-ID' label from unnest(coalesce(b.senior_id_paths, '{}')) p
              union all
              select 'pet-vaccinations', p, 'Pet-vaccination-card' from unnest(coalesce(b.pet_vaccination_paths, '{}')) p) x
       where not (x.path = any(b.cb_docs_sent))
    ) d
   where d.docs is not null
     and b.cb_reservation_id is not null and not b.cb_owned
     and b.cb_docs_attempts < 5
     and cb_push_enabled();
$$;

create or replace function cb_doc_result(p_booking_id uuid, p_path text, p_error text) returns void
language sql security definer set search_path = public as $$
  update booking_requests
     set cb_docs_sent = case when p_error is null and not (p_path = any(cb_docs_sent)) then cb_docs_sent || p_path else cb_docs_sent end,
         cb_docs_error = case when p_error is null then null else left(p_error, 500) end,
         cb_docs_attempts = case when p_error is null then 0 else cb_docs_attempts + 1 end
   where id = p_booking_id;
$$;

create or replace function cb_details_posted(p_booking_id uuid) returns void
language sql security definer set search_path = public as $$
  update booking_requests set cb_details_at = now() where id = p_booking_id;
$$;

-- new IDs / pet cards on a booking that's in Cloudbeds → send them now
create or replace function cb_after_docs_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vbr.cb_sync', true) = 'on' or not cb_push_enabled() then return new; end if;
  if new.cb_reservation_id is not null and not new.cb_owned
     and (new.senior_id_paths is distinct from old.senior_id_paths or new.pet_vaccination_paths is distinct from old.pet_vaccination_paths) then
    perform cb_call('docs');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cb_docs on booking_requests;
create trigger trg_cb_docs after update of senior_id_paths, pet_vaccination_paths on booking_requests
  for each row execute function cb_after_docs_change();

-- payment proofs: also an extra ₱0 screenshot (amount >= 0) goes to Documents
create or replace function cb_pending_payment_posts() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'reservation_id', b.cb_reservation_id, 'amount', p.amount,
           'method', p.method, 'kind', p.kind, 'note', p.note, 'order_code', b.order_code, 'status', p.status,
           'proof_path', p.proof_path,
           'need_payment', p.status = 'verified' and p.amount > 0 and p.cb_posted_at is null and p.cb_post_attempts < 5
                           and coalesce(p.verified_by, '') <> 'Cloudbeds',
           'need_doc', p.proof_path is not null and p.cb_doc_posted_at is null and p.cb_doc_attempts < 5)
         order by coalesce(p.verified_at, p.created_at)), '[]'::jsonb)
    from booking_payments p join booking_requests b on b.id = p.booking_id
   where ((p.status = 'verified' and p.amount > 0 and p.cb_posted_at is null and p.cb_post_attempts < 5 and coalesce(p.verified_by, '') <> 'Cloudbeds')
          or (p.status in ('pending', 'verified') and p.proof_path is not null and p.cb_doc_posted_at is null and p.cb_doc_attempts < 5))
     and b.cb_reservation_id is not null and not b.cb_owned
     and cb_push_enabled();
$$;

-- Upload Payment page: tell it when the booking is handled in Cloudbeds
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
  where b.order_code = upper(trim(p_order_code))
    and lower(b.guest_email) = lower(trim(p_guest_email))
    and not b.cb_owned
  limit 1;
$$;
revoke all on function get_booking_uploads(text, text) from public;
grant execute on function get_booking_uploads(text, text) to anon, authenticated;

do $$ declare f text; begin
  foreach f in array array['cb_pending_docs()', 'cb_doc_result(uuid,text,text)', 'cb_details_posted(uuid)', 'cb_pending_payment_posts()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

select 'v23 applied' as status;
