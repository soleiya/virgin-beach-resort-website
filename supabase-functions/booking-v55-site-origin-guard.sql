-- ============================================================================
-- booking-v55 — website bookings only from virginbeachresort.com
--
-- A copy of the website on another domain could otherwise still save
-- bookings and booking requests into this database (the public "anon" key is
-- in every page). Browsers always send the page's Origin with these calls, so
-- a guest booking (anon) coming from any other site is refused.
--   * Staff (signed in), Cloudbeds sync and other server jobs are not affected.
--   * Calls with no Origin header (not from a browser) are let through — the
--     usual checks (prices, dates, availability) still apply to them.
--   * booking_settings.allowed_origins (new) lists the allowed sites.
-- Run in Supabase → SQL Editor. Safe to run more than once.
-- Undo: drop trigger if exists trg_guard_site_origin on booking_requests;
-- ============================================================================
alter table booking_settings add column if not exists allowed_origins text[]
  not null default array['https://virginbeachresort.com', 'https://www.virginbeachresort.com'];

create or replace function guard_site_origin() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_origin text; v_ok text[];
begin
  if coalesce(auth.role(), '') <> 'anon' then return new; end if;
  begin
    v_origin := lower(rtrim(nullif(current_setting('request.headers', true), '')::json->>'origin', '/'));
  exception when others then v_origin := null;
  end;
  if v_origin is null or v_origin = '' then return new; end if;
  select allowed_origins into v_ok from booking_settings where id = 1;
  if v_origin = any(select lower(rtrim(o, '/')) from unnest(coalesce(v_ok, array['https://virginbeachresort.com'])) o) then
    return new;
  end if;
  raise exception 'Online bookings can only be made on virginbeachresort.com. Please book on our official website.'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_guard_site_origin on booking_requests;
create trigger trg_guard_site_origin before insert on booking_requests
  for each row execute function guard_site_origin();

select 'v55 applied' as status, (select allowed_origins from booking_settings where id = 1) as allowed_origins;
