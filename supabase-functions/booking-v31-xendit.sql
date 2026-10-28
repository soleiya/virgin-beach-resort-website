-- ============================================================================
-- Booking rules v31 — villa payments through Xendit
--
--   Villa bookings made on the website are paid online through Xendit
--   (card, GCash, Maya, QR Ph … whatever is switched on in Xendit). Day trips
--   keep bank transfer + proof upload.
--   * The guest picks 50% (while allowed) or 100% — or the balance later —
--     on the booking page / Upload page; the amount is always worked out here.
--   * The xendit-pay Edge Function creates the Xendit invoice and records it
--     in xendit_invoices; Xendit's webhook tells us when it is paid.
--   * Paid → a verified payment (method 'xendit', verified by "Xendit"):
--     the booking is confirmed (Cloudbeds sends its confirmation), the payment
--     is posted to the Cloudbeds folio (method Xendit), and the guest gets
--     "paid in full" when it completes the total.
--   * An unpaid invoice expires with the booking's 24-hour hold.
-- Re-runnable.
-- ============================================================================

create table if not exists xendit_invoices (
  id uuid primary key default gen_random_uuid(),           -- also our external_id (vbr-<id>)
  booking_id uuid not null references booking_requests(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'full', 'balance')),
  amount numeric not null check (amount > 0),
  status text not null default 'creating'                   -- creating | PENDING | PAID | EXPIRED | failed
    check (status in ('creating', 'PENDING', 'PAID', 'SETTLED', 'EXPIRED', 'failed')),
  invoice_id text unique,                                   -- Xendit's id
  invoice_url text,
  expires_at timestamptz,
  paid_amount numeric,
  paid_at timestamptz,
  payment_method text,                                      -- e.g. EWALLET / CREDIT_CARD / QR_CODE
  payment_channel text,                                     -- e.g. GCASH / PAYMAYA / VISA
  payment_id uuid references booking_payments(id),          -- the verified payment it became
  error text,
  live boolean,                                             -- created with a live key (false = Xendit test mode)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists xendit_invoices_booking_idx on xendit_invoices (booking_id, created_at desc);
alter table xendit_invoices enable row level security;
drop policy if exists xendit_invoices_staff_read on xendit_invoices;
create policy xendit_invoices_staff_read on xendit_invoices for select to authenticated using (true);

-- payments made with Xendit TEST keys: recorded here, never posted to Cloudbeds
alter table booking_payments add column if not exists test boolean not null default false;

-- Which bookings pay through Xendit: villas made on the website.
create or replace function pays_with_xendit(b booking_requests) returns boolean
language sql stable as $$
  select b.stay_type = 'overnight' and not coalesce(b.cb_owned, false)
$$;

-- 1. the guest asks to pay ---------------------------------------------------------------
-- Works out what to charge and either returns an open invoice for the same
-- amount (reuse) or a new 'creating' row for the Edge Function to fill in.
-- p_kind: 'deposit' (50%), 'full' (everything left) or 'balance' (the rest
-- after a deposit). Called by the xendit-pay Edge Function (service role).
create or replace function xendit_invoice_start(p_order_code text, p_guest_email text, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b booking_requests%rowtype;
  v_kind text := coalesce(nullif(p_kind, ''), 'full');
  v_paid numeric;
  v_amount numeric;
  v_expires timestamptz;
  v_open xendit_invoices%rowtype;
  v_id uuid;
begin
  select * into b from booking_requests
   where order_code = resolve_order_code(p_order_code)
     and lower(guest_email) = lower(trim(coalesce(p_guest_email, '')))
     and not cb_owned
   limit 1;
  if not found then return jsonb_build_object('error', 'We couldn''t find a booking with that Booking ID and email.'); end if;
  if not pays_with_xendit(b) then return jsonb_build_object('error', 'Online payment is for villa stays — please use the upload page for this booking.'); end if;
  if b.status in ('declined', 'expired', 'completed') then
    return jsonb_build_object('error', 'This booking is no longer open for payment — please contact us.');
  end if;
  if b.total_amount is null or b.total_amount <= 0 then
    return jsonb_build_object('error', 'This booking has no amount to pay yet — please contact us.');
  end if;

  v_paid := coalesce((select sum(amount) from booking_payments where booking_id = b.id and status in ('verified', 'pending')), 0);
  if v_paid >= b.total_amount - 0.5 then return jsonb_build_object('error', 'This booking is already paid in full. Thank you!'); end if;
  if v_kind not in ('deposit', 'full', 'balance') then v_kind := 'full'; end if;
  if v_kind = 'deposit' and (v_paid > 0 or not half_allowed(b.check_in)) then v_kind := 'full'; end if;
  if v_kind = 'balance' and v_paid = 0 then v_kind := 'full'; end if;
  v_amount := case v_kind when 'deposit' then round(b.total_amount / 2, 2)
                          else round(b.total_amount - v_paid, 2) end;
  if v_paid > 0 and v_kind = 'full' then v_kind := 'balance'; end if;

  -- how long the invoice stays open: the booking's payment hold while it's
  -- unpaid; otherwise 3 days (balance)
  if b.status in ('pending', 'pending_payment') and v_paid = 0 then
    select final_at into v_expires from booking_deadlines(coalesce(b.pay_deadline_from, b.created_at), b.check_in);
  end if;
  v_expires := coalesce(v_expires, now() + interval '3 days');
  if v_expires < now() + interval '10 minutes' then
    return jsonb_build_object('error', 'The payment window for this booking has passed — please contact us.');
  end if;

  -- an open invoice for the same amount can be reused
  select * into v_open from xendit_invoices
   where booking_id = b.id and status = 'PENDING' and amount = v_amount and expires_at > now() + interval '5 minutes'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('reuse', true, 'invoice_url', v_open.invoice_url, 'amount', v_amount, 'kind', v_open.kind,
                              'order_code', b.order_code);
  end if;

  insert into xendit_invoices (booking_id, kind, amount, expires_at)
  values (b.id, v_kind, v_amount, v_expires) returning id into v_id;
  return jsonb_build_object(
    'xid', v_id, 'kind', v_kind, 'amount', v_amount, 'expires_at', v_expires,
    'order_code', b.order_code, 'guest_name', b.guest_name, 'guest_email', b.guest_email, 'guest_phone', b.guest_phone,
    'check_in', b.check_in, 'check_out', b.check_out, 'total', b.total_amount, 'paid', v_paid);
end;
$$;

-- the Edge Function stores what Xendit returned (or the error)
create or replace function xendit_invoice_created(p_xid uuid, p_invoice_id text, p_url text, p_expires timestamptz, p_live boolean, p_error text)
returns void
language sql security definer set search_path = public as $$
  update xendit_invoices
     set invoice_id = p_invoice_id, invoice_url = p_url,
         expires_at = coalesce(p_expires, expires_at), live = p_live,
         status = case when p_error is null then 'PENDING' else 'failed' end,
         error = left(p_error, 500), updated_at = now()
   where id = p_xid;
$$;

-- 2. Xendit's webhook ---------------------------------------------------------------------
-- PAID / SETTLED → a verified payment + the same follow-ups as a staff-verified
-- payment. EXPIRED → closed. Repeats are ignored. Returns what happened.
create or replace function xendit_invoice_event(p_external_id text, p_invoice_id text, p_status text, p_paid_amount numeric,
                                                p_method text, p_channel text, p_paid_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  x xendit_invoices%rowtype;
  b booking_requests%rowtype;
  v_pid uuid;
  v_paid numeric;
  v_full boolean;
  v_secret text;
  v_xid uuid;
begin
  begin v_xid := nullif(regexp_replace(coalesce(p_external_id, ''), '^vbr-', ''), '')::uuid; exception when others then v_xid := null; end;
  select * into x from xendit_invoices
   where (v_xid is not null and id = v_xid) or (p_invoice_id is not null and invoice_id = p_invoice_id)
   order by (id = v_xid) desc limit 1
   for update;
  if not found then return jsonb_build_object('ignored', 'unknown invoice'); end if;

  if upper(p_status) = 'EXPIRED' then
    update xendit_invoices set status = 'EXPIRED', updated_at = now() where id = x.id and status in ('creating', 'PENDING');
    return jsonb_build_object('expired', x.id);
  end if;
  if upper(p_status) not in ('PAID', 'SETTLED') then return jsonb_build_object('ignored', p_status); end if;
  if x.payment_id is not null then
    update xendit_invoices set status = upper(p_status), updated_at = now() where id = x.id;
    return jsonb_build_object('already', x.payment_id);
  end if;

  select * into b from booking_requests where id = x.booking_id for update;
  insert into booking_payments (booking_id, kind, amount, method, note, status, created_by, verified_at, verified_by, test)
  values (b.id, x.kind, coalesce(p_paid_amount, x.amount), 'xendit',
          trim(both ' ·' from concat_ws(' · ', 'Xendit', nullif(p_channel, ''), nullif(p_method, ''), 'invoice ' || coalesce(p_invoice_id, x.invoice_id),
                case when x.live is false then 'TEST MODE' end)),
          'verified', null, coalesce(p_paid_at, now()), 'Xendit', coalesce(x.live is false, false))
  returning id into v_pid;
  update xendit_invoices
     set status = upper(p_status), paid_amount = coalesce(p_paid_amount, x.amount), paid_at = coalesce(p_paid_at, now()),
         payment_method = p_method, payment_channel = p_channel, payment_id = v_pid, updated_at = now()
   where id = x.id;
  -- any other open invoice for this booking is now stale
  update xendit_invoices set status = 'EXPIRED', updated_at = now()
   where booking_id = b.id and id <> x.id and status in ('creating', 'PENDING');

  v_paid := recalc_amount_paid(b.id);
  v_full := b.total_amount is not null and v_paid >= b.total_amount - 0.5;
  update booking_requests
     set payment_plan = coalesce(payment_plan, case when x.kind = 'deposit' then 'half' else 'full' end),
         payment_uploaded_at = coalesce(payment_uploaded_at, now())
   where id = b.id;

  if b.status in ('pending', 'pending_payment') then
    -- first payment: confirmed (→ Cloudbeds status + its confirmation email)
    update booking_requests set status = 'confirmed', paid_in_full_at = case when v_full then now() end where id = b.id;
  elsif v_full and b.paid_in_full_at is null then
    update booking_requests set paid_in_full_at = now() where id = b.id;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
    if v_secret is not null and b.status not in ('completed', 'declined', 'expired') then
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'PAID_IN_FULL', 'record', jsonb_build_object('id', b.id), 'payment_id', v_pid),
        timeout_milliseconds := 30000);
    end if;
  end if;
  return jsonb_build_object('paid', v_pid, 'booking', b.order_code, 'status_was', b.status, 'fully_paid', v_full);
end;
$$;

-- Cloudbeds folio: v23's list, minus Xendit test-mode payments
create or replace function cb_pending_payment_posts() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'reservation_id', b.cb_reservation_id, 'amount', p.amount,
           'method', p.method, 'kind', p.kind, 'note', p.note, 'order_code', b.order_code, 'status', p.status,
           'proof_path', p.proof_path,
           'need_payment', p.status = 'verified' and p.amount > 0 and p.cb_posted_at is null and p.cb_post_attempts < 5
                           and coalesce(p.verified_by, '') <> 'Cloudbeds' and not p.test,
           'need_doc', p.proof_path is not null and p.cb_doc_posted_at is null and p.cb_doc_attempts < 5)
         order by coalesce(p.verified_at, p.created_at)), '[]'::jsonb)
    from booking_payments p join booking_requests b on b.id = p.booking_id
   where ((p.status = 'verified' and p.amount > 0 and p.cb_posted_at is null and p.cb_post_attempts < 5
           and coalesce(p.verified_by, '') <> 'Cloudbeds' and not p.test)
          or (p.status in ('pending', 'verified') and p.proof_path is not null and p.cb_doc_posted_at is null and p.cb_doc_attempts < 5))
     and b.cb_reservation_id is not null and not b.cb_owned
     and cb_push_enabled();
$$;
revoke all on function cb_pending_payment_posts() from public, anon, authenticated;
grant execute on function cb_pending_payment_posts() to service_role;

-- 3. pages ---------------------------------------------------------------------------
-- Upload/pay page lookup: v25 + whether the booking pays online, and the
-- state of its latest Xendit invoice (so the page can say "payment received").
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
    'pay_online', pays_with_xendit(b),
    'xendit_paid', (select jsonb_build_object('kind', x.kind, 'amount', coalesce(x.paid_amount, x.amount), 'paid_at', x.paid_at, 'channel', x.payment_channel)
                      from xendit_invoices x where x.booking_id = b.id and x.status in ('PAID', 'SETTLED') order by x.paid_at desc limit 1),
    'xendit_open', (select jsonb_build_object('kind', x.kind, 'amount', x.amount, 'url', x.invoice_url, 'expires_at', x.expires_at)
                      from xendit_invoices x where x.booking_id = b.id and x.status = 'PENDING' and x.expires_at > now()
                     order by x.created_at desc limit 1),
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

-- villas pay online: no bank-transfer proof uploads for them (docs still OK)
create or replace function guard_villa_proof_upload() returns trigger
language plpgsql as $$
begin
  if new.method = 'transfer' and new.created_by is null and new.proof_path like 'guest/%'
     and exists (select 1 from booking_requests b where b.id = new.booking_id and pays_with_xendit(b)) then
    raise exception 'Villa stays are paid online — please use the "Pay now" button on the Upload page.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_villa_proof_upload on booking_payments;
create trigger trg_guard_villa_proof_upload before insert on booking_payments
  for each row execute function guard_villa_proof_upload();

do $$ declare f text; begin
  foreach f in array array['xendit_invoice_start(text,text,text)', 'xendit_invoice_created(uuid,text,text,timestamptz,boolean,text)',
                           'xendit_invoice_event(text,text,text,numeric,text,text,timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

select 'v31 applied' as status;
