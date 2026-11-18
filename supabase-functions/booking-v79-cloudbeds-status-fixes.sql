-- =============================================================================
-- booking-v79: Cloudbeds sync bar — false warnings.
--
-- 1. "N website bookings not in Cloudbeds yet" counted website INQUIRIES
--    (date requests with no casita), which are never sent to Cloudbeds.
--    cb_sync_status() now counts only bookings that hold a casita and aren't
--    inquiries — the same rule as the dashboard badge and the alert email.
-- 2. "N casita clashes": cb_apply_reservation() carried old clash notes
--    forward ("clashes from earlier syncs stay until the villa set changes"),
--    even after the reservation got its casita — so Sync now never cleared
--    them. A carried-over "<casita> already taken" note is now dropped once
--    the reservation holds that casita; existing stale notes are cleaned up.
-- Re-runnable.
-- =============================================================================

create or replace function cb_sync_status() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'last_pull', (select value from cb_sync_state where key = 'last_pull'),
    'last_error', (select value from cb_sync_state where key = 'last_error'),
    'setup', (select value from cb_sync_state where key = 'setup'),
    'push_enabled', cb_push_enabled(),
    'push_errors', (select count(*) from booking_requests where cb_push_state = 'error' and status not in ('declined', 'expired')),
    'push_waiting', (select count(*) from booking_requests b
       where b.stay_type = 'overnight' and not b.cb_owned and b.cb_reservation_id is null
         and b.status::text not in ('declined', 'expired', 'completed', 'inquiry')
         and b.check_out >= current_date
         and exists (select 1 from booking_villas bv where bv.booking_id = b.id and bv.active)),
    'clashes_upcoming', (select count(*) from booking_requests where cb_info ? 'clashes' and check_out >= current_date and status not in ('declined', 'expired'))
  );
$$;

-- cb_apply_reservation: patch the carry-over of old clash notes in place
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('cb_apply_reservation'::regproc);
  if position('v79:' in d) > 0 then raise notice 'cb_apply_reservation already patched'; return; end if;
  n := regexp_replace(d,
    'if\s+not\s+v_reset\s+and\s+b\.cb_info\s+\?\s+''clashes''\s+and\s+not\s+\(v_info\s+\?\s+''clashes''\)\s+then\s+v_info\s*:=\s*v_info\s*\|\|\s*jsonb_build_object\(''clashes'',\s*b\.cb_info->''clashes''\);\s*end\s+if;',
    'if not v_reset and b.cb_info ? ''clashes'' and not (v_info ? ''clashes'') then
    -- v79: a carried-over "<casita> already taken" note is dropped once this reservation holds that casita
    select jsonb_agg(to_jsonb(e)) into x from jsonb_array_elements_text(b.cb_info->''clashes'') e
    where not (e like ''% already taken %'' and exists (
      select 1 from booking_villas h join villas vl on vl.id = h.villa_id
      where h.booking_id = b.id and h.active and vl.unit_label = split_part(e, '' already taken '', 1)));
    if x is not null then v_info := v_info || jsonb_build_object(''clashes'', x); end if;
  end if;');
  if n = d then raise exception 'v79: clash carry-over code not found in cb_apply_reservation — not changed'; end if;
  execute n;
end $do$;

-- clean up the stale notes already stored
update booking_requests b
set cb_info = case when f.keep is null then b.cb_info - 'clashes' else jsonb_set(b.cb_info, '{clashes}', f.keep) end
from (
  select b2.id, (select jsonb_agg(to_jsonb(e)) from jsonb_array_elements_text(b2.cb_info->'clashes') e
                 where not (e like '% already taken %' and exists (
                   select 1 from booking_villas h join villas vl on vl.id = h.villa_id
                   where h.booking_id = b2.id and h.active and vl.unit_label = split_part(e, ' already taken ', 1)))) as keep
  from booking_requests b2 where b2.cb_info ? 'clashes') f
where f.id = b.id and f.keep is distinct from b.cb_info->'clashes';

select 'v79 applied' as status, cb_sync_status() ->> 'push_waiting' as push_waiting, cb_sync_status() ->> 'clashes_upcoming' as clashes_upcoming;
