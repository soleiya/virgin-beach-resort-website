-- =============================================================================
-- booking-v57: Cloudbeds sync no longer shrinks a website party that needs an
-- extra mattress.
--
-- Why: a casita sleeps 4 in Cloudbeds. A website party of 5 (4 + 1 extra floor
-- mattress) is pushed to Cloudbeds as 4 guests, with the real party in the
-- reservation note. When Cloudbeds' reservation came back, cb_apply_reservation
-- saw "4 guests ≠ 5" and overwrote the website's adult / child split with
-- Cloudbeds' 4. The booking kept its price, but every re-quote (quotation
-- email, staff alert, dashboard) then priced 4 people and no mattress, e.g.
-- VBR-6200545814764: ₱26,357.36 booked, ₱21,826.95 emailed to the guest.
--
-- Fix: keep the website's split when Cloudbeds' head count is lower than the
-- website party by no more than the booking's extra mattresses — that is just
-- the push trimming to the room limit. Any other difference (staff changed the
-- guest count in Cloudbeds) still follows Cloudbeds, as before.
--
-- The function is patched in place from its live definition so nothing else
-- in it changes; the script stops if the definition isn't the expected one.
-- Then the two bookings this already hit are put back from their guest lists.
-- =============================================================================

do $$
declare
  d text := pg_get_functiondef('cb_apply_reservation'::regproc);
  old_txt text := $x$  v_keep_split := not v_owned and (nullif(p->>'adults', '') is null
    or v_cb_pax = coalesce(b.adults, 0) + coalesce(b.children_6_12, 0) + coalesce(b.children_0_5, 0));$x$;
  new_txt text := $x$  v_keep_split := not v_owned and (nullif(p->>'adults', '') is null
    or v_cb_pax = coalesce(b.adults, 0) + coalesce(b.children_6_12, 0) + coalesce(b.children_0_5, 0)
    -- v57: the push trims a party to Cloudbeds' room limit when extra mattresses are needed
    or (v_cb_pax > 0
        and v_cb_pax < coalesce(b.adults, 0) + coalesce(b.children_6_12, 0) + coalesce(b.children_0_5, 0)
        and v_cb_pax >= coalesce(b.adults, 0) + coalesce(b.children_6_12, 0) + coalesce(b.children_0_5, 0) - coalesce(b.extra_beds, 0)));$x$;
begin
  if position('-- v57:' in d) > 0 then
    raise notice 'cb_apply_reservation already patched';
  elsif position(old_txt in d) = 0 then
    raise exception 'cb_apply_reservation is not the expected version — not patched';
  else
    execute replace(d, old_txt, new_txt);
    raise notice 'cb_apply_reservation patched';
  end if;
end $$;

-- Repair: party rebuilt from the guest list each guest entered on the website.
-- VBR-6200545814764 — 5 adults (3 seniors), 1 extra mattress (Cloudbeds had 4)
update booking_requests set adults = 5
 where order_code = 'VBR-6200545814764' and adults = 4 and senior_count = 3 and extra_beds = 1;
-- VBR-8824522811339 — 4 adults + 1 child 0–5, 1 extra mattress (the child was dropped)
update booking_requests set children_0_5 = 1
 where order_code = 'VBR-8824522811339' and adults = 4 and children_0_5 = 0 and extra_beds = 1;

select jsonb_pretty(jsonb_agg(jsonb_build_object('code', order_code, 'adults', adults, 'seniors', senior_count,
         'k612', children_6_12, 'k05', children_0_5, 'booked', total_amount,
         'requote', (quote_booking_overnight(id)->>'total')::numeric) order by order_code))
  from booking_requests where order_code in ('VBR-6200545814764', 'VBR-8824522811339');
