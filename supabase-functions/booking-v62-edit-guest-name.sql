-- =============================================================================
-- booking-v62: staff can correct the Guest Name of an existing booking.
--
-- Since booking-v5, lock_booking_identity() refused any change to Guest Name or
-- Booked By once a booking existed. Staff asked to be able to fix names (e.g.
-- "Insta Answer c/o Rae Shella Ang" from the 2026 Sheet import).
--   * Guest Name: staff may change it; the activity log records old → new and
--     who. Still refused: an empty name, a reservation that is in Cloudbeds (its
--     name comes from Cloudbeds — change it there), and the public website.
--   * Booked By: stays locked, as before.
--   * staff_save_overnight() (villa bookings) now saves the name on an edit.
-- Patches both functions in place from their live definitions. Re-runnable.
-- =============================================================================

do $$
declare
  d text := pg_get_functiondef('lock_booking_identity()'::regprocedure);
  old_txt text := $x$    if new.guest_name is distinct from old.guest_name then
      raise exception 'Guest Name can''t be changed on an existing booking';
    end if;$x$;
  new_txt text := $x$    -- v62: staff may correct the guest name (the activity log keeps old → new);
    -- a Cloudbeds reservation's name comes from Cloudbeds; the public site can't change it
    if new.guest_name is distinct from old.guest_name then
      if auth.role() = 'anon' then
        raise exception 'Guest Name can''t be changed on an existing booking';
      end if;
      if old.cb_reservation_id is not null then
        raise exception 'This reservation is in Cloudbeds — change the guest name in Cloudbeds (it updates here within a few minutes)';
      end if;
      if nullif(trim(coalesce(new.guest_name, '')), '') is null then
        raise exception 'Guest Name can''t be empty';
      end if;
      new.guest_name := trim(new.guest_name);
    end if;$x$;
begin
  if position('-- v62:' in d) > 0 then raise notice 'lock_booking_identity already patched';
  elsif position(old_txt in d) = 0 then raise exception 'lock_booking_identity is not the expected version — not patched';
  else execute replace(d, old_txt, new_txt); raise notice 'lock_booking_identity patched';
  end if;
end $$;

do $$
declare
  d text := pg_get_functiondef('staff_save_overnight(uuid,jsonb,uuid[])'::regprocedure);
  old_txt text := $x$    guest_phone = nullif(trim(payload->>'guest_phone'), ''),
$x$;
  new_txt text := $x$    guest_name = coalesce(nullif(trim(payload->>'guest_name'), ''), b.guest_name),  -- v62: staff can correct it
    guest_phone = nullif(trim(payload->>'guest_phone'), ''),
$x$;
begin
  if position('-- v62:' in d) > 0 then raise notice 'staff_save_overnight already patched';
  elsif (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception 'staff_save_overnight is not the expected version — not patched';
  else execute replace(d, old_txt, new_txt); raise notice 'staff_save_overnight patched';
  end if;
end $$;

select p.proname, position('-- v62:' in pg_get_functiondef(p.oid)) > 0 as patched
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('lock_booking_identity', 'staff_save_overnight')
 order by 1;
