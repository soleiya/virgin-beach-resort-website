-- ============================================================================
-- Booking rules v34 — safer online payments
--
--   * No double payments: before a new Xendit checkout page is made, the
--     xendit-pay function checks the booking's earlier open pages with Xendit
--     (xendit_open_invoices) — a page that was already paid is recorded first,
--     the others are closed in Xendit so they can't be paid any more.
--   * If a booking is still paid more than its total, staff are emailed
--     ("refund needed") and a note is added to the booking.
--   * Every online payment sends the guest a "payment received" receipt
--     (villa stays — their confirmation comes from Cloudbeds).
--   * 50% down payments are rounded up to whole pesos (₱7,763 instead of
--     ₱7,762.50); the balance is the rest.
-- Re-runnable.
-- ============================================================================

create or replace function deposit_amount(p_total numeric) returns numeric
language sql immutable as $$ select ceil(coalesce(p_total, 0) / 2) $$;

create or replace function booking_payment_summary(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', b.total_amount,
    'paid', b.amount_paid,
    'claimed', coalesce((select sum(amount) from booking_payments p where p.booking_id = b.id and p.status <> 'rejected'), 0),
    'pending', coalesce((select sum(amount) from booking_payments p where p.booking_id = b.id and p.status = 'pending'), 0),
    'balance', greatest(coalesce(b.total_amount, 0) - b.amount_paid, 0),
    'deposit', deposit_amount(b.total_amount),
    'half_allowed', half_allowed(b.check_in),
    'balance_due', case when b.check_in is not null then balance_due_date(b.check_in) end,
    'plan', b.payment_plan,
    'last', (select jsonb_build_object('kind', p.kind, 'amount', p.amount, 'method', p.method, 'status', p.status, 'at', p.created_at)
               from booking_payments p where p.booking_id = b.id order by p.created_at desc limit 1),
    'fully_paid', b.total_amount is not null and b.amount_paid >= b.total_amount - 0.5
  )
  from booking_requests b where b.id = p_booking_id;
$$;

revoke all on function booking_payment_summary(uuid) from public, anon;
grant execute on function booking_payment_summary(uuid) to authenticated, service_role;

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
  if not pays_with_xendit(b) then return jsonb_build_object('error', 'Online payment isn''t available for this booking — please contact us.'); end if;
  if b.status in ('declined', 'expired', 'completed') then
    return jsonb_build_object('error', 'This booking is no longer open for payment — please contact us.');
  end if;
  if b.total_amount is null or b.total_amount <= 0 then
    return jsonb_build_object('error', 'This booking has no amount to pay yet — please contact us.');
  end if;
  -- Only take money once Cloudbeds has accepted the reservation (it can refuse
  -- a stay the website thought was free, e.g. dates without rates).
  if b.stay_type = 'overnight' and cb_push_enabled() and b.cb_reservation_id is null then
    if b.cb_push_state = 'error' then
      return jsonb_build_object('error', 'We couldn''t confirm your casita for these dates in our reservations system, so we haven''t taken a payment. Please call +63 917 792 0712 or email reservations@virginbeachresort.com and our team will sort it out.');
    end if;
    return jsonb_build_object('error', 'We''re still securing your casita in our reservations system — please try again in a minute.', 'retry', true);
  end if;

  v_paid := coalesce((select sum(amount) from booking_payments where booking_id = b.id and status in ('verified', 'pending')), 0);
  if v_paid >= b.total_amount - 0.5 then return jsonb_build_object('error', 'This booking is already paid in full. Thank you!'); end if;
  if v_kind not in ('deposit', 'full', 'balance') then v_kind := 'full'; end if;
  if v_kind = 'deposit' and (v_paid > 0 or not half_allowed(b.check_in)) then v_kind := 'full'; end if;
  if v_kind = 'balance' and v_paid = 0 then v_kind := 'full'; end if;
  v_amount := case v_kind when 'deposit' then deposit_amount(b.total_amount)
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
    'check_in', b.check_in, 'check_out', b.check_out, 'stay_type', b.stay_type,
    'stay_label', case when b.stay_type = 'overnight' then 'Overnight stay' else coalesce(nullif(b.stay_type_label, ''), 'Day trip') end, 'total', b.total_amount, 'paid', v_paid);
end;
$$;

revoke all on function xendit_invoice_start(text, text, text) from public, anon, authenticated;
grant execute on function xendit_invoice_start(text, text, text) to service_role;

-- the booking's checkout pages that are still open (checked with Xendit before a new one is made)
create or replace function xendit_open_invoices(p_order_code text, p_guest_email text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('xid', x.id, 'invoice_id', x.invoice_id, 'amount', x.amount, 'kind', x.kind) order by x.created_at), '[]'::jsonb)
    from xendit_invoices x
    join booking_requests b on b.id = x.booking_id
   where b.order_code = resolve_order_code(p_order_code)
     and lower(b.guest_email) = lower(trim(coalesce(p_guest_email, '')))
     and x.status = 'PENDING' and x.invoice_id is not null;
$$;
revoke all on function xendit_open_invoices(text, text) from public, anon, authenticated;
grant execute on function xendit_open_invoices(text, text) to service_role;

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
  v_before numeric;
  v_excess numeric;
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
  v_before := coalesce(b.amount_paid, 0);
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
  v_excess := case when b.total_amount is not null then round(v_paid - b.total_amount, 2) else 0 end;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;

  -- v34: paid more than the booking total (e.g. two checkout pages paid) —
  -- flag it for staff to refund in Xendit.
  if v_excess > 0.5 then
    perform set_config('vbr.actor', 'Xendit', true);
    update booking_requests
       set staff_notes = concat_ws(' · ', staff_notes,
             'OVERPAID ' || '₱' || to_char(v_excess, 'FM999,999,990.00') || ' via Xendit (invoice ' || coalesce(p_invoice_id, x.invoice_id) || ') — refund it in Xendit')
     where id = b.id;
    if v_secret is not null then
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'OVERPAID', 'record', jsonb_build_object('id', b.id), 'payment_id', v_pid, 'excess', v_excess),
        timeout_milliseconds := 30000);
    end if;
  end if;
  -- v34: a "payment received" receipt for every online payment (the email
  -- function sends it for villa stays, whose confirmations come from Cloudbeds)
  if v_secret is not null and v_before < coalesce(b.total_amount, 0) - 0.5 then
    perform net.http_post(
      url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('type', 'PAYMENT_RECEIVED', 'record', jsonb_build_object('id', b.id), 'payment_id', v_pid),
      timeout_milliseconds := 30000);
  end if;
  update booking_requests
     set payment_plan = coalesce(payment_plan, case when x.kind = 'deposit' then 'half' else 'full' end),
         payment_uploaded_at = coalesce(payment_uploaded_at, now())
   where id = b.id;

  if b.status in ('pending', 'pending_payment') then
    -- first payment: confirmed (→ Cloudbeds status + its confirmation email)
    update booking_requests set status = 'confirmed', paid_in_full_at = case when v_full then now() end where id = b.id;
  elsif v_full and b.paid_in_full_at is null then
    update booking_requests set paid_in_full_at = now() where id = b.id;
    if v_secret is not null and b.status not in ('completed', 'declined', 'expired') then
      perform net.http_post(
        url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
        body := jsonb_build_object('type', 'PAID_IN_FULL', 'record', jsonb_build_object('id', b.id), 'payment_id', v_pid),
        timeout_milliseconds := 30000);
    end if;
  end if;
  return jsonb_build_object('paid', v_pid, 'booking', b.order_code, 'status_was', b.status, 'fully_paid', v_full, 'overpaid', greatest(v_excess, 0));
end;
$$;

revoke all on function xendit_invoice_event(text, text, text, numeric, text, text, timestamptz) from public, anon, authenticated;
grant execute on function xendit_invoice_event(text, text, text, numeric, text, text, timestamptz) to service_role;

select 'v34 applied' as status;
