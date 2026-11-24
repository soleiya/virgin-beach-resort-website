-- =============================================================================
-- booking-v90 — StoreHub history import from the browser (no API key yet).
--
-- The ntq StoreHub account has no API/Settings access, so sales are read from
-- the Backoffice pages in the owner's signed-in browser and pushed straight to
-- Supabase with sh_ingest(code, batch). The code is a random one-time value
-- (only its sha-256 is stored) that expires after 3 hours; rows go through the
-- same sh_upsert as the API sync (v89). Batches are capped at 2,000 rows.
-- Expired codes are harmless; delete them any time.
-- =============================================================================

create table if not exists public.sh_ingest_codes (
  code_hash text primary key,
  expires_at timestamptz not null,
  used_rows int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.sh_ingest_codes enable row level security;
revoke all on public.sh_ingest_codes from anon, authenticated;

create or replace function public.sh_ingest(p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare h text; r jsonb; n int;
begin
  h := encode(digest(coalesce(p_code, ''), 'sha256'), 'hex');
  if not exists (select 1 from sh_ingest_codes where code_hash = h and expires_at > now()) then raise exception 'invalid or expired code'; end if;
  n := coalesce(jsonb_array_length(p->'transactions'), 0) + coalesce(jsonb_array_length(p->'products'), 0) + coalesce(jsonb_array_length(p->'stores'), 0);
  if n > 2000 then raise exception 'batch too large'; end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.sh_upsert(jsonb_build_object('stores', coalesce(p->'stores', '[]'), 'products', coalesce(p->'products', '[]'),
                                           'transactions', coalesce(p->'transactions', '[]')));
  update sh_ingest_codes set used_rows = used_rows + n where code_hash = h;
  return r;
end $$;
revoke all on function public.sh_ingest(text, jsonb) from public;
grant execute on function public.sh_ingest(text, jsonb) to anon, authenticated;

-- A code is made by hand when an import is run, e.g.:
--   insert into sh_ingest_codes (code_hash, expires_at)
--   values (encode(digest('<random>', 'sha256'), 'hex'), now() + interval '3 hours');
