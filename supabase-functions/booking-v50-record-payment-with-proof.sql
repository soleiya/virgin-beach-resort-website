-- ============================================================================
-- v50 — staff record a payment WITH its screenshot in one step (Nov 7 2026).
-- Day trips: "Confirmed · Paid" needs evidence — a screenshot uploaded by staff
-- or the guest, or an automatic Xendit payment. Safe to re-run.
-- ============================================================================

create or replace function public.staff_record_payment_proof(p_booking_id uuid, p_amount numeric, p_kind text,
  p_method text, p_note text, p_path text)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare v_id uuid;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'not allowed'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount received'; end if;
  if p_path is null or p_path not like 'staff/' || p_booking_id::text || '-%' then
    raise exception 'Attach the payment screenshot (or photo of the receipt)';
  end if;
  insert into booking_payments (booking_id, kind, amount, method, proof_path, note, created_by)
  values (p_booking_id, case when p_kind in ('deposit', 'full', 'balance', 'other') then p_kind else 'other' end,
          p_amount, coalesce(nullif(p_method, ''), 'other'), p_path, nullif(trim(coalesce(p_note, '')), ''), auth.jwt() ->> 'email')
  returning id into v_id;
  -- no payment_uploaded_at: that would email the guest "proof received, under review"
  update booking_requests set payment_screenshot_path = p_path where id = p_booking_id;
  return staff_verify_payment(v_id, p_amount, false, p_note);
end;
$function$;
revoke all on function public.staff_record_payment_proof(uuid, numeric, text, text, text, text) from public, anon;
grant execute on function public.staff_record_payment_proof(uuid, numeric, text, text, text, text) to authenticated;

select 'v50 applied' as status;
