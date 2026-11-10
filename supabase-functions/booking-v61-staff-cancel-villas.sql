-- =============================================================================
-- booking-v61: staff can cancel a villa reservation from the website dashboard,
-- and the cancellation goes to Cloudbeds.
--
-- Until now a villa booking that was in Cloudbeds was locked on the dashboard
-- ("cancel in Cloudbeds"); only website-made bookings ever sent a status to
-- Cloudbeds. Now:
--   * staff_cancel_villa(booking, reason, note, notify) — staff only (view-only
--     accounts are refused by the v56 guard). Reason: guest_cancelled /
--     correction / test / other. The booking becomes Canceled, its casita is
--     released, and the reason, note, who and when are kept on the booking
--     (cancel_reason / cancel_note / cancelled_by / cancelled_at) and in the
--     staff notes.
--   * The status trigger now also sends a staff cancellation of a booking MADE
--     IN CLOUDBEDS (other status changes of those still come only from
--     Cloudbeds). cloudbeds-sync cancels the reservation in Cloudbeds; Cloudbeds
--     emails the guest only when cancel_notify is on.
--   * Retries: every pull first re-sends staff cancellations Cloudbeds hasn't
--     taken yet (cb_pending_cancel_pushes); for 30 minutes a sync can't undo a
--     fresh staff cancellation; after 15 minutes the sync alerts email says so.
-- Needs the matching cloudbeds-sync (pushStatus / pull) and dashboard.
-- Re-runnable. Patches functions in place from their live definitions (as v57).
-- =============================================================================

-- 1. who cancelled, why ------------------------------------------------------------
alter table booking_requests
  add column if not exists cancel_reason text,
  add column if not exists cancel_note text,
  add column if not exists cancel_notify boolean,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text;

-- 2. the dashboard's "Cancel reservation" ----------------------------------------
create or replace function staff_cancel_villa(p_booking_id uuid, p_reason text, p_note text default null, p_notify boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b booking_requests%rowtype;
  v_by text := coalesce(nullif(lower(auth.jwt() ->> 'email'), ''), 'staff');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_label text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then raise exception 'Staff only'; end if;
  if coalesce(p_reason, '') not in ('guest_cancelled', 'correction', 'test', 'other') then
    raise exception 'Choose why the reservation is cancelled';
  end if;
  if p_reason = 'other' and v_note is null then raise exception 'Add a short note for "Other"'; end if;
  select * into b from booking_requests where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.stay_type <> 'overnight' then raise exception 'Only villa bookings are cancelled here'; end if;
  if b.cb_reservation_id is null then
    raise exception 'This booking isn''t in Cloudbeds — change its status in the booking instead';
  end if;
  if b.status in ('declined', 'expired', 'completed') then raise exception 'This reservation is already closed (%)', b.status; end if;
  if coalesce(b.cb_info->>'status', '') in ('checked_in', 'checked_out') then
    raise exception 'The guest is already checked in at Cloudbeds — change it in Cloudbeds';
  end if;
  v_label := case p_reason when 'guest_cancelled' then 'Guest cancelled' when 'correction' then 'Correction'
                           when 'test' then 'Test booking' else 'Other' end;
  update booking_requests set
    status = 'declined',
    cancel_reason = p_reason, cancel_note = v_note, cancel_notify = coalesce(p_notify, false),
    cancelled_at = now(), cancelled_by = v_by,
    staff_notes = concat_ws(E'\n', nullif(staff_notes, ''),
      '[Cancelled ' || to_char(now() at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || ' by ' || v_by || ' — ' || v_label ||
      coalesce(': ' || v_note, '') || case when coalesce(p_notify, false) then ' · guest emailed by Cloudbeds' else ' · guest not emailed' end || ']')
  where id = b.id;
  return jsonb_build_object('id', b.id, 'order_code', b.order_code, 'cb_reservation_id', b.cb_reservation_id);
end;
$$;
revoke all on function staff_cancel_villa(uuid, text, text, boolean) from public, anon;
grant execute on function staff_cancel_villa(uuid, text, text, boolean) to authenticated;

-- 3. the status trigger: also send a staff cancellation of a Cloudbeds-made booking
do $$
declare
  d text := pg_get_functiondef('cb_after_status_change()'::regprocedure);
  old_txt text := $x$  if new.cb_reservation_id is not null and not new.cb_owned and new.status is distinct from old.status then$x$;
  new_txt text := $x$  if new.cb_reservation_id is not null and new.status is distinct from old.status
     and (not new.cb_owned
          -- v61: a staff cancellation from the dashboard goes to Cloudbeds too
          or (new.status = 'declined' and new.cancelled_at is not null and new.cancelled_at > now() - interval '5 minutes')) then$x$;
begin
  if position('-- v61:' in d) > 0 then raise notice 'cb_after_status_change already patched';
  elsif position(old_txt in d) = 0 then raise exception 'cb_after_status_change is not the expected version — not patched';
  else execute replace(d, old_txt, new_txt); raise notice 'cb_after_status_change patched';
  end if;
end $$;

-- 4. a sync can't undo a fresh staff cancellation (30 min for it to reach Cloudbeds)
do $$
declare
  d text := pg_get_functiondef('cb_apply_reservation(jsonb)'::regprocedure);
  old_txt text := $x$  v_target := case
    when v_owned then v_status$x$;
  new_txt text := $x$  v_target := case
    -- v61: cancelled by staff on the website a moment ago, Cloudbeds not updated yet
    when b.status = 'declined' and b.cancelled_at > now() - interval '30 minutes'
         and v_cb not in ('canceled', 'no_show', 'deleted') then 'declined'::booking_status
    when v_owned then v_status$x$;
begin
  if position('-- v61:' in d) > 0 then raise notice 'cb_apply_reservation already patched (v61)';
  elsif position(old_txt in d) = 0 then raise exception 'cb_apply_reservation is not the expected version — not patched';
  else execute replace(d, old_txt, new_txt); raise notice 'cb_apply_reservation patched (v61)';
  end if;
end $$;

-- 5. staff cancellations Cloudbeds hasn't taken yet (re-sent by every pull, for a day)
create or replace function cb_pending_cancel_pushes() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id order by cancelled_at), '{}')
    from booking_requests
   where status = 'declined' and cancelled_at is not null
     and cancelled_at between now() - interval '24 hours' and now() - interval '1 minute'
     and cb_reservation_id is not null
     and coalesce(cb_info->>'status', '') not in ('canceled', 'no_show', 'deleted');
$$;
revoke all on function cb_pending_cancel_pushes() from public, anon, authenticated;
grant execute on function cb_pending_cancel_pushes() to service_role;

-- 6. sync alerts (v60): + "cancelled on the website, still active in Cloudbeds"
do $$
declare
  d text := pg_get_functiondef('cb_sync_issues()'::regprocedure);
  anchor text := $x$  union all
  -- …or holds fewer casitas on the website than Cloudbeds has rooms for it$x$;
  branch text := $x$  union all
  -- v61: a staff cancellation on the website that Cloudbeds still hasn't taken
  select 'cancel:' || b.id, 'push',
         b.order_code || ' was cancelled on the website but is still active in Cloudbeds — ' || coalesce(b.guest_name, '?') || ', ' ||
           to_char(b.check_in, 'Mon DD') || '–' || to_char(b.check_out, 'Mon DD'),
         'Cancelled ' || to_char(b.cancelled_at at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || ' by ' || coalesce(b.cancelled_by, 'staff') ||
           '; Cloudbeds still shows it as ' || coalesce(b.cb_info->>'status', '?') || '. Cancel #' || b.cb_reservation_id ||
           ' in Cloudbeds by hand (if it was reinstated there on purpose, ignore this).',
         interval '15 minutes'
    from booking_requests b
   where b.cancelled_at > now() - interval '24 hours' and b.cb_reservation_id is not null
     and coalesce(b.cb_info->>'status', '') not in ('canceled', 'no_show', 'deleted')

$x$;
begin
  if position('-- v61:' in d) > 0 then raise notice 'cb_sync_issues already patched';
  elsif position(anchor in d) = 0 then raise exception 'cb_sync_issues is not the expected version (v60) — not patched';
  else execute replace(d, anchor, branch || anchor); raise notice 'cb_sync_issues patched';
  end if;
end $$;

-- check
select p.proname, coalesce(nullif(position('-- v61:' in pg_get_functiondef(p.oid)), 0)::text, '-') as v61_at
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('staff_cancel_villa', 'cb_after_status_change', 'cb_apply_reservation', 'cb_pending_cancel_pushes', 'cb_sync_issues')
 order by 1;
