-- ============================================================================
-- Booking rules v13 — editable guest emails + faster dashboard
--
--   * booking_requests.email_custom — the opening message / subject staff
--     wrote in the dashboard's "Email to the guest" panel:
--       { "quote": { "subject": "...", "message": "..." },
--         "confirmed": { ... } }
--     The send-booking-email function puts the message at the top of the
--     guest email; amounts, bank details, links and policies below it are
--     always generated from the booking.
--   * notify_booking_change(...) gains p_message: the staff's own opening
--     for the "changes to your reservation" email.
--   * Indexes for the dashboard's date-window loading (years of Cloudbeds
--     history are now on file).
-- Re-runnable.
-- ============================================================================

alter table booking_requests add column if not exists email_custom jsonb;

create index if not exists booking_requests_check_in_idx on booking_requests (check_in);
create index if not exists booking_requests_check_out_idx on booking_requests (check_out);
create index if not exists booking_requests_created_at_idx on booking_requests (created_at desc);
create index if not exists booking_requests_legacy_row_idx on booking_requests (legacy_source_row);

drop function if exists notify_booking_change(uuid, jsonb, date);
create or replace function notify_booking_change(
  p_booking_id uuid,
  p_changes jsonb,                    -- [{ "label": "Date", "before": "...", "after": "..." }, ...]
  p_old_check_in date default null,   -- original date, keeps the email in the guest's thread
  p_message text default null         -- staff's own opening message (optional)
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
      'message', nullif(left(coalesce(p_message, ''), 5000), ''),
      'change_id', gen_random_uuid(),
      'changed_by', auth.jwt() ->> 'email'
    ),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function notify_booking_change(uuid, jsonb, date, text) from public, anon;
grant execute on function notify_booking_change(uuid, jsonb, date, text) to authenticated;
