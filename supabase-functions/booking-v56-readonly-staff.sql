-- =============================================================================
-- booking-v56: view-only staff accounts (Accounting).
-- Accounts listed in booking_settings.readonly_staff_emails can sign in and
-- read everything the dashboard shows, but the database refuses any change
-- they try to make — direct edits and the staff RPCs alike (the trigger sees
-- the signed-in user's email even inside SECURITY DEFINER functions).
-- System jobs (cron, webhooks, edge functions using the service key) carry no
-- user email and are not affected. Staff heartbeat / activity tracking is not
-- guarded, so the view-only account still shows up as "online".
-- =============================================================================

alter table booking_settings add column if not exists readonly_staff_emails text[] not null default '{}';

create or replace function guard_readonly_staff() returns trigger
language plpgsql stable security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_email <> '' and exists (select 1 from booking_settings s where v_email = any(s.readonly_staff_emails)) then
    raise exception 'This account is view-only (Accounting). Ask the reservations team to make this change.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['booking_requests', 'booking_payments', 'booking_villas', 'booking_cabanas',
                           'peak_dates', 'cabana_blocks', 'discount_codes', 'booking_settings'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_guard_readonly_staff on public.%I', t);
      execute format('create trigger zz_guard_readonly_staff before insert or update or delete on public.%I
                        for each row execute function guard_readonly_staff()', t);
    end if;
  end loop;
end $$;

update booking_settings set readonly_staff_emails = array['mae@staff.local']
 where not ('mae@staff.local' = any(readonly_staff_emails));

select readonly_staff_emails from booking_settings;
