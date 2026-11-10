-- =============================================================================
-- booking-v60: email alerts when the website and Cloudbeds fall out of step.
--
-- Every 5 minutes (pg_cron → edge function sync-alerts) cb_sync_alerts_collect()
-- looks for:
--   push   a website booking that isn't in Cloudbeds — Cloudbeds rejected it,
--          or it still has no Cloudbeds number 10 minutes after booking
--          (VBR-27400).
--   hold   a Cloudbeds reservation the website couldn't put on its casita for
--          15+ minutes (the room-swap problem fixed in v59).
--   avail  a night (up to the end of online booking) where the website shows
--          more free casitas of a type than Cloudbeds, for 15+ minutes —
--          an overbooking is possible.
--   sync   the 5-minute Cloudbeds sync hasn't run for 20 minutes, or keeps
--          failing for 20 minutes.
-- Each problem is emailed once when it appears, again every 2 hours while it
-- is still open, and once more when it clears. Recipients: the ALERT_EMAILS
-- secret of the sync-alerts function (default migquesada@gmail.com).
-- Re-runnable.
-- =============================================================================

create table if not exists cb_sync_alerts (
  key text primary key,
  kind text not null,
  title text not null,
  detail text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  notified_at timestamptz,
  notify_count int not null default 0,
  resolved_at timestamptz
);
alter table cb_sync_alerts enable row level security;   -- written by the service role only
drop policy if exists "Staff can view sync alerts" on cb_sync_alerts;
create policy "Staff can view sync alerts" on cb_sync_alerts for select to authenticated using (true);

-- What is wrong right now: one row per problem.
create or replace function cb_sync_issues() returns table(key text, kind text, title text, detail text, min_age interval)
language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce(villa_bookings_open_until, current_date + 120) as open_until
      from booking_settings where id = 1
  ), today as (select (now() at time zone 'Asia/Manila')::date as d)

  -- push: website booking not in Cloudbeds
  select 'push:' || b.id, 'push',
         b.order_code || ' is not in Cloudbeds — ' || coalesce(b.guest_name, '?') || ', ' ||
           coalesce(b.room_name, '?') || ', ' || to_char(b.check_in, 'Mon DD') || '–' || to_char(b.check_out, 'Mon DD'),
         case when b.cb_push_state = 'error'
              then 'Cloudbeds rejected it: ' || left(regexp_replace(coalesce(b.cb_push_error, ''), '&#96;', '''', 'g'), 300) ||
                   ' (' || b.cb_push_attempts || ' attempt' || case when b.cb_push_attempts = 1 then '' else 's' end || ')'
              else 'Booked ' || to_char(b.created_at at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || ' and still has no Cloudbeds number.' end ||
         ' Status on the website: ' || b.status || '. Check the room in Cloudbeds; if it is not free, cancel it on the dashboard and contact the guest.',
         interval '0'
    from booking_requests b
   where b.stay_type = 'overnight' and not b.cb_owned and b.cb_reservation_id is null
     and b.status not in ('declined', 'expired', 'completed')
     and b.check_out >= (select d from today)
     and exists (select 1 from booking_villas bv where bv.booking_id = b.id and bv.active)
     and cb_push_enabled()
     and (b.cb_push_state = 'error' or b.created_at < now() - interval '10 minutes')

  union all
  -- hold: Cloudbeds reservation not placed on its casita on the website
  select 'hold:' || q.reservation_id, 'hold',
         'Cloudbeds #' || q.reservation_id || ' is not held on the website' ||
           coalesce(' — ' || b.guest_name || ', ' || to_char(b.check_in, 'Mon DD') || '–' || to_char(b.check_out, 'Mon DD'), ''),
         'Its casita is shown as free online. Reason: ' || coalesce(q.reason, '?') || '. Retried ' || q.attempts ||
           ' time(s). Fix: in Cloudbeds, take the room off the reservation and put it back on.',
         interval '0'
    from cb_resync_queue q
    left join booking_requests b on b.cb_reservation_id = q.reservation_id
   where q.queued_at < now() - interval '15 minutes'
     and (b.id is null or (b.status not in ('declined', 'expired', 'completed') and b.check_out >= (select d from today)))

  union all
  -- …or holds fewer casitas on the website than Cloudbeds has rooms for it
  select 'hold:' || b.cb_reservation_id, 'hold',
         'Cloudbeds #' || b.cb_reservation_id || ' is not fully held on the website — ' || coalesce(b.guest_name, '?') || ', ' ||
           to_char(b.check_in, 'Mon DD') || '–' || to_char(b.check_out, 'Mon DD'),
         'Cloudbeds has ' || (b.cb_info->>'rooms') || '; the website holds ' || h.n || ' of ' || cardinality(string_to_array(b.cb_info->>'rooms', ', ')) ||
           '. Fix: in Cloudbeds, take the room off the reservation and put it back on.',
         interval '15 minutes'
    from booking_requests b
    cross join lateral (select count(*) as n from booking_villas bv where bv.booking_id = b.id and bv.active) h
   where b.cb_reservation_id is not null and nullif(b.cb_info->>'rooms', '') is not null
     and b.status not in ('declined', 'expired', 'completed') and b.check_out >= (select d from today)
     and h.n < cardinality(string_to_array(b.cb_info->>'rooms', ', '))
     and not exists (select 1 from cb_resync_queue q where q.reservation_id = b.cb_reservation_id)

  union all
  -- avail: website shows more free casitas than Cloudbeds
  select 'avail:' || t.cb_room_type_id || ':' || n.night, 'avail',
         t.room_type_name || ' on ' || to_char(n.night, 'Dy Mon DD') || ': website ' || site.free || ' free, Cloudbeds ' || r.rooms_available,
         'The website could sell a casita Cloudbeds doesn''t have. Compare the Cloudbeds calendar with the website for this night.',
         interval '15 minutes'
    from (select cb_room_type_id, min(room_type) as room_type, min(room_type_name) as room_type_name, count(*) as units
            from villas where active and cb_room_type_id is not null group by 1) t
    cross join lateral (select d::date as night from generate_series((select d from today),
                          least((select open_until from s), (select d from today) + 400), interval '1 day') d) n
    join cb_rates r on r.cb_room_type_id = t.cb_room_type_id and r.night = n.night
    cross join lateral (
      select t.units - count(distinct bv.villa_id) as free
        from booking_villas bv join villas v on v.id = bv.villa_id
       where bv.active and v.active and v.cb_room_type_id = t.cb_room_type_id
         and n.night >= bv.check_in and n.night < bv.check_out) site
   where coalesce(r.rate, 0) > 0                      -- closed nights aren't sold online anyway
     and r.rooms_available is not null and r.rooms_available < site.free
     and not exists (select 1 from public_closed_nights c where c.night = n.night and c.room_type = t.room_type)

  union all
  -- sync: not running / failing
  select 'sync:stale', 'sync',
         'The Cloudbeds sync has not run since ' ||
           coalesce(to_char(((st.value->>'ran_at')::timestamptz) at time zone 'Asia/Manila', 'Mon DD HH12:MI AM'), 'never'),
         'Website availability is no longer being updated from Cloudbeds. Check Supabase → Edge Functions → cloudbeds-sync (logs) and the cloudbeds-pull cron job.',
         interval '0'
    from cb_sync_state st
   where st.key = 'last_pull' and coalesce((st.value->>'ran_at')::timestamptz, 'epoch') < now() - interval '20 minutes'

  union all
  select 'sync:failing', 'sync',
         'The Cloudbeds sync is failing',
         'Last run ' || to_char(((st.value->>'ran_at')::timestamptz) at time zone 'Asia/Manila', 'HH12:MI AM') || ': ' ||
           coalesce(st.value->>'failed', '0') || ' reservation(s) failed. Last error: ' ||
           coalesce((select left(e.value::text, 300) from cb_sync_state e where e.key = 'last_error'), '—'),
         interval '20 minutes'
    from cb_sync_state st
   where st.key = 'last_pull'
     and (coalesce((st.value->>'failed')::int, 0) > 0 or (st.value->>'complete') = 'false')
$$;

-- Record what's wrong now; return what to email (new / still open after 2 h /
-- just cleared). Nothing is marked as sent here — cb_sync_alerts_sent() does that.
create or replace function cb_sync_alerts_collect() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_open jsonb; v_cleared jsonb;
begin
  create temp table if not exists _issues on commit drop as select * from cb_sync_issues() limit 0;
  truncate _issues;
  insert into _issues select * from cb_sync_issues();

  -- new problems, or ones that came back after clearing
  insert into cb_sync_alerts as a (key, kind, title, detail)
  select i.key, i.kind, i.title, i.detail from _issues i
  on conflict (key) do update
     set title = excluded.title, detail = excluded.detail, last_seen = now(),
         first_seen = case when a.resolved_at is not null then now() else a.first_seen end,
         notified_at = case when a.resolved_at is not null then null else a.notified_at end,
         resolved_at = null;

  -- cleared since the last check
  update cb_sync_alerts a set resolved_at = clock_timestamp()
   where a.resolved_at is null and not exists (select 1 from _issues i where i.key = a.key);

  select coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'kind', a.kind, 'title', a.title, 'detail', a.detail,
           'since', a.first_seen, 'reminder', a.notified_at is not null) order by a.kind, a.first_seen), '[]')
    into v_open
    from cb_sync_alerts a join _issues i on i.key = a.key
   where a.resolved_at is null and a.first_seen <= now() - i.min_age
     and (a.notified_at is null or a.notified_at < now() - interval '2 hours');

  -- cleared problems we had emailed about (and haven't said were cleared yet)
  select coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'kind', a.kind, 'title', a.title, 'since', a.first_seen) order by a.kind), '[]')
    into v_cleared
    from cb_sync_alerts a
   where a.resolved_at is not null and a.notified_at is not null and a.notified_at < a.resolved_at;

  delete from cb_sync_alerts where resolved_at < now() - interval '30 days';
  return jsonb_build_object('open', v_open, 'cleared', v_cleared);
end;
$$;

-- The email went out: remember it so the same problem isn't sent again for 2 hours.
create or replace function cb_sync_alerts_sent(p_keys text[]) returns void
language sql security definer set search_path = public as $$
  update cb_sync_alerts
     set notified_at = clock_timestamp(),
         notify_count = notify_count + case when resolved_at is null then 1 else 0 end
   where key = any(p_keys);
$$;

do $$ declare f text; begin
  foreach f in array array['cb_sync_issues()', 'cb_sync_alerts_collect()', 'cb_sync_alerts_sent(text[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- every 5 minutes, 2 minutes after the Cloudbeds pull
create or replace function cb_alerts_call() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text := cb_webhook_secret();
begin
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/sync-alerts',
    -- the public anon key (same as the website's booking-config.js) satisfies the
    -- function's "Verify JWT"; the vault secret is what actually authorises the call
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret,
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRva3NjcWp2cXR5aGVjbWJzaHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTQzNDksImV4cCI6MjEwMzA5MDM0OX0.DbnnSokdaT_4E48LvgxG5An-xqVKGnxKjAVGrR-YLvk'),
    body := '{"action":"check"}'::jsonb,
    timeout_milliseconds := 30000);
exception when others then
  raise warning 'sync-alerts call failed: %', sqlerrm;
end;
$$;
revoke all on function cb_alerts_call() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'cloudbeds-sync-alerts';
select cron.schedule('cloudbeds-sync-alerts', '2-59/5 * * * *', $$select public.cb_alerts_call()$$);

-- what would be reported right now
select kind, key, title, min_age from cb_sync_issues() order by kind, key;
