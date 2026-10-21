-- ============================================================================
-- Booking rules v22 — every new booking starts at the first step
--
-- Like creating a reservation in Cloudbeds, a booking made on the website
-- (by a guest or by staff, day trip or villa) is always created as
-- "Confirmation Pending". Payment / confirmation move it on from there — on
-- the website or in Cloudbeds — so the two never start out of step.
-- Not affected: bookings that come from Cloudbeds (they keep Cloudbeds'
-- status) and the Day Trip sheet import. Re-runnable.
-- ============================================================================
create or replace function new_booking_starts_pending() returns trigger
language plpgsql as $$
begin
  if current_setting('vbr.cb_sync', true) = 'on' or new.cb_owned or coalesce(new.source, '') = 'sheet_import' then
    return new;
  end if;
  new.status := 'pending';
  return new;
end;
$$;
drop trigger if exists trg_new_booking_starts_pending on booking_requests;
create trigger trg_new_booking_starts_pending before insert on booking_requests
  for each row execute function new_booking_starts_pending();

select 'v22 applied' as status;
