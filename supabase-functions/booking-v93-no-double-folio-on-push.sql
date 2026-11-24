-- booking-v93-no-double-folio-on-push.sql
-- Fix: website-pushed villa bookings got their folio lines (meals, extras,
-- discounts) posted to Cloudbeds TWICE.
--
-- Why: since v85, cb_apply_reservation() treats a booking it "links" as one
-- staff made by hand and calls refolio. But when the website pushes a booking,
-- Cloudbeds' reservation/created webhook arrives while push() is still running
-- (before cb_push_result stores the reservation id). The webhook matched the
-- booking (by order code / email), linked it — which renamed VBR-277xx to
-- VBR-<Cloudbeds id> — and refolio posted every line again. push() had already
-- posted them under the old code, so Cloudbeds' referenceID check didn't catch
-- the repeat, and discounts have no repeat check at all.
-- Seen on VBR-9437643179263 (Marissa Yala, temp VBR-27726), Nov 23 2026, and
-- every website push since v85.
--
-- Now: a booking the website is pushing (cb_push_state = 'pushing') is linked
-- as before but NOT treated as a hand-made link: no refolio, no details note
-- (push() posts both itself), and the usual change detection still runs.
--
-- Applied as a patch of the live v85 function (each anchor must be found).

do $mig$
declare n text := pg_get_functiondef('public.cb_apply_reservation(jsonb)'::regprocedure);
begin
  if position('v93:' in n) > 0 then raise notice 'v93 already applied'; return; end if;

  -- 1. match by order code (ota_ref)
  if position($a1$    if v_found then
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;
      v_linked := true;
    end if;$a1$ in n) = 0 then raise exception 'v93: anchor 1 not found — cb_apply_reservation changed since v85'; end if;
  n := replace(n, $a1$    if v_found then
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;
      v_linked := true;
    end if;$a1$, $b1$    if v_found then
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;
      -- v93: mid-push (webhook beat cb_push_result) → push() posts the folio itself
      v_linked := b.cb_push_state is distinct from 'pushing';
    end if;$b1$);

  -- 2. match by guest email + dates
  if position($a2$      v_found := true;
      v_linked := true;
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;$a2$ in n) = 0 then raise exception 'v93: anchor 2 not found — cb_apply_reservation changed since v85'; end if;
  n := replace(n, $a2$      v_found := true;
      v_linked := true;
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;$a2$, $b2$      v_found := true;
      -- v93: mid-push (webhook beat cb_push_result) → push() posts the folio itself
      v_linked := b.cb_push_state is distinct from 'pushing';
      update booking_requests set cb_reservation_id = v_id, cb_push_state = 'done', cb_push_error = null where id = b.id;$b2$);

  if (length(n) - length(replace(n, 'v93:', ''))) / 4 <> 2 then raise exception 'v93: expected 2 patches'; end if;
  execute n;
end $mig$;
