-- ============================================================================
-- "Changes to your reservation" guest email
-- Run once in Supabase → SQL Editor (after booking-email-trigger.sql).
--
-- The staff dashboard calls this after a staff member edits a booking with
-- "Email the guest" ticked. It hands the list of changes to the
-- send-booking-email Edge Function, which re-reads the booking and emails the
-- guest at the address ON THE BOOKING (never an address sent by the browser).
-- Only signed-in staff can call it.
-- ============================================================================

create or replace function notify_booking_change(
  p_booking_id uuid,
  p_changes jsonb,            -- [{ "label": "Date", "before": "...", "after": "..." }, ...]
  p_old_check_in date default null  -- original date, keeps the email in the guest's thread
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'not allowed';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 30 then
    raise exception 'changes must be a non-empty array (max 30)';
  end if;
  if not exists (select 1 from booking_requests where id = p_booking_id) then
    raise exception 'booking not found';
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'booking_email_webhook_secret' limit 1;
  if v_secret is null then
    return; -- emails not set up
  end if;

  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/send-booking-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'type', 'CHANGE',
      'record', jsonb_build_object('id', p_booking_id),
      'changes', p_changes,
      'old_check_in', p_old_check_in,
      'change_id', gen_random_uuid(),
      'changed_by', auth.jwt() ->> 'email'
    ),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function notify_booking_change(uuid, jsonb, date) from public, anon;
grant execute on function notify_booking_change(uuid, jsonb, date) to authenticated;
