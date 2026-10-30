-- ============================================================================
-- Booking rules v32 — day trips pay through Xendit too; add-ons: ATV only
--
--   * Every booking made on the website (villa stays AND day trips / half-day /
--     corporate with a quote) is paid online through Xendit. Bank-transfer
--     proof uploads by guests are switched off for all of them (staff can
--     still record a manual payment taken by phone/email in the dashboard).
--   * Day trips aren't sent to Cloudbeds, so the "wait for Cloudbeds" check
--     before taking a payment applies to villa stays only.
--   * Guest add-ons: only the ATV rides stay on offer. The previous on/off
--     state is saved in add_ons_backup_v32 (to undo: see the bottom).
-- Re-runnable.
-- ============================================================================

create or replace function pays_with_xendit(b booking_requests) returns boolean
language sql stable as $$
  select not coalesce(b.cb_owned, false)
$$;

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
    'check_in', b.check_in, 'check_out', b.check_out, 'stay_type', b.stay_type,
    'stay_label', case when b.stay_type = 'overnight' then 'Overnight stay' else coalesce(nullif(b.stay_type_label, ''), 'Day trip') end, 'total', b.total_amount, 'paid', v_paid);
end;
$$;

revoke all on function xendit_invoice_start(text, text, text) from public, anon, authenticated;
grant execute on function xendit_invoice_start(text, text, text) to service_role;

create or replace function guard_villa_proof_upload() returns trigger
language plpgsql as $$
begin
  if new.method = 'transfer' and new.created_by is null and new.proof_path like 'guest/%'
     and exists (select 1 from booking_requests b where b.id = new.booking_id and pays_with_xendit(b)) then
    raise exception 'Bookings are paid online — please use the "Pay now" button.';
  end if;
  return new;
end;
$$;

-- add-ons: ATV rides only
create table if not exists add_ons_backup_v32 as select slug, active from add_ons;
alter table add_ons_backup_v32 enable row level security;
update add_ons set active = false where active and slug !~ '^atv';

-- To undo the add-on change:
--   update add_ons a set active = k.active from add_ons_backup_v32 k where k.slug = a.slug;

select 'v32 applied' as status, (select string_agg(name, ', ' order by sort) from add_ons where active) as add_ons_on_offer;
