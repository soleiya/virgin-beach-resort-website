-- ============================================================================
-- v64 — the 5:00 PM trip-day rule only closes online day trips with NOTHING
-- paid. A booking that was paid and then grew (staff added guests / cabanas,
-- so a balance is due) is never closed automatically: it stays under
-- "Action needed" until staff record the balance. (Nov 11 2026, VBR-27409.)
-- Changes one condition in process_booking_deadlines() (v49); everything else
-- is left exactly as it is live. Safe to re-run.
-- ============================================================================
do $v64$
declare
  d   text := pg_get_functiondef('public.process_booking_deadlines()'::regprocedure);
  v_old text := $o$and (now() at time zone 'Asia/Manila')::time >= time '17:00'
       and b.total_amount is not null and coalesce(b.amount_paid, 0) < b.total_amount - 0.5$o$;
  v_new text := $n$and (now() at time zone 'Asia/Manila')::time >= time '17:00'
       -- v64: only when nothing was paid; part-paid bookings wait for staff
       and b.total_amount is not null and coalesce(b.amount_paid, 0) < 0.5$n$;
begin
  if position(v_new in d) > 0 then
    raise notice 'v64 already applied';
    return;
  end if;
  if (length(d) - length(replace(d, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'v64: the 5 PM condition was not found exactly once — nothing changed';
  end if;
  execute replace(d, v_old, v_new);
  raise notice 'v64 applied';
end
$v64$;

select 'v64 applied' as result
 where position('coalesce(b.amount_paid, 0) < 0.5' in pg_get_functiondef('public.process_booking_deadlines()'::regprocedure)) > 0;
