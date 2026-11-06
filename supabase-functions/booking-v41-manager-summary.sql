-- ============================================================================
-- booking-v41 — manager summary page (virginbeachresort.com/manager/)
--
-- A read-only, passcode-protected view for the manager: who's coming and
-- what they booked, by day / week / month.
--   * The passcode is checked HERE, in the database — never in the page — and
--     only a salted hash is stored. Set or change it with the one-line
--     statement Claude gives you (it is NOT in this file, which is public on
--     GitHub):   select manager_set_passcode('....');
--   * Too many wrong passcodes (10 within 15 minutes) lock it for 15 minutes.
--   * Returns names, party, inclusions, status and amounts only — no phone
--     numbers, emails, IDs or payment proofs. Cancelled / expired bookings
--     are left out. At most 62 days per request.
-- Run in Supabase → SQL Editor. Safe to run more than once.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists manager_access (
  id int primary key default 1 check (id = 1),
  salt text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  code_hash text,
  failed int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
alter table manager_access enable row level security;   -- no policies: nobody reads it directly
revoke all on manager_access from anon, authenticated;
insert into manager_access (id) values (1) on conflict (id) do nothing;

-- set / change the passcode (Supabase SQL editor only — not callable from the website)
create or replace function manager_set_passcode(p_code text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(trim(p_code)), 0) < 4 then raise exception 'Passcode must be at least 4 characters'; end if;
  update manager_access set salt = encode(extensions.gen_random_bytes(16), 'hex'), failed = 0, locked_until = null where id = 1;
  update manager_access set code_hash = encode(extensions.digest(salt || trim(p_code), 'sha256'), 'hex') where id = 1;
  return 'manager passcode set';
end;
$$;
revoke all on function manager_set_passcode(text) from public, anon, authenticated;

create or replace function manager_check_passcode(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare m manager_access%rowtype;
begin
  select * into m from manager_access where id = 1 for update;
  if m.code_hash is null then raise exception 'The manager passcode has not been set yet.' using errcode = 'P0001'; end if;
  if m.locked_until is not null and m.locked_until > now() then
    raise exception 'Too many wrong passcodes — try again after %.',
      to_char(m.locked_until at time zone 'Asia/Manila', 'HH12:MI AM') using errcode = 'P0001';
  end if;
  if encode(extensions.digest(m.salt || trim(coalesce(p_code, '')), 'sha256'), 'hex') = m.code_hash then
    update manager_access set failed = 0, locked_until = null where id = 1;
    return true;
  end if;
  -- wrong: count it (10 within 15 minutes → 15-minute lock)
  if m.window_start < now() - interval '15 minutes' then
    update manager_access set failed = 1, window_start = now() where id = 1;
  elsif m.failed + 1 >= 10 then
    update manager_access set failed = 0, window_start = now(), locked_until = now() + interval '15 minutes' where id = 1;
  else
    update manager_access set failed = m.failed + 1 where id = 1;
  end if;
  return false;
end;
$$;
revoke all on function manager_check_passcode(text) from public, anon, authenticated;

-- the summary itself ------------------------------------------------------------
create or replace function manager_summary(p_code text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
  v_rows jsonb;
begin
  v_ok := manager_check_passcode(p_code);
  if not v_ok then
    return jsonb_build_object('ok', false, 'error', 'Wrong passcode');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    return jsonb_build_object('ok', false, 'error', 'Pick a range of up to 62 days');
  end if;

  select coalesce(jsonb_agg(x order by x->>'check_in', x->>'type', x->>'guest'), '[]'::jsonb) into v_rows
  from (
    select jsonb_strip_nulls(jsonb_build_object(
      'code', b.order_code,
      'type', b.stay_type,
      'type_label', coalesce(b.stay_type_label, b.stay_type),
      'status', b.status,
      'cb_status', b.cb_info->>'status',
      'check_in', b.check_in,
      'check_out', b.check_out,
      'guest', b.guest_name,
      'party_names', coalesce(
         nullif((select string_agg(nullif(trim(c->>'name'), ''), ', ')
                   from jsonb_array_elements(case when jsonb_typeof(b.companions) = 'array' then b.companions else '[]'::jsonb end) c), ''),
         nullif(trim(b.guest_names), '')),
      'adults', coalesce(b.adults, 0),
      'kids612', coalesce(b.children_6_12, 0),
      'kids05', coalesce(b.children_0_5, 0),
      'seniors', nullif(coalesce(b.senior_count, 0), 0),
      'pwd_kids', nullif(coalesce(b.pwd_kid_count, 0), 0),
      'pets', nullif(coalesce(b.pet_count, 0), 0),
      'extra_beds', nullif(coalesce(b.extra_beds, 0), 0),
      'dining', nullif(coalesce(b.dining_cabanas, 0), 0),
      'lounge', nullif(coalesce(b.lounge_cabanas, 0), 0),
      'cabana_nos', (select string_agg(cb.label, ', ' order by cb.label) from booking_cabanas bc join cabanas cb on cb.id = bc.cabana_id where bc.booking_id = b.id),
      'villas', (select string_agg(v.unit_label || ' · ' || v.room_type_name, ', ' order by v.sort, v.unit_label)
                   from booking_villas bv join villas v on v.id = bv.villa_id where bv.booking_id = b.id and bv.active),
      'add_ons', (select string_agg(coalesce(a.name, x2->>'slug') || case when coalesce((x2->>'qty')::int, 1) > 1 then ' ×' || (x2->>'qty') else '' end, ', ')
                    from jsonb_array_elements(case when jsonb_typeof(b.add_ons) = 'array' then b.add_ons else '[]'::jsonb end) x2
                    left join add_ons a on a.slug = x2->>'slug'),
      'occasion', nullif(trim(b.occasion), ''),
      'total', coalesce(case when b.cb_owned then (b.cb_info->>'total')::numeric end, b.total_amount),
      'paid', coalesce(case when b.cb_owned then coalesce((b.cb_info->>'paid')::numeric, (b.cb_info->>'total')::numeric - (b.cb_info->>'balance')::numeric) end, b.amount_paid),
      'source', b.source,
      'sheet', b.source = 'sheet_import'
    )) as x
    from booking_requests b
    where b.status not in ('declined', 'expired')
      and (
        (b.stay_type = 'overnight' and b.check_in <= p_to and coalesce(b.check_out, b.check_in + 1) > p_from)
        or (coalesce(b.stay_type, '') <> 'overnight' and b.check_in between p_from and p_to)
      )
  ) s;

  return jsonb_build_object('ok', true, 'from', p_from, 'to', p_to, 'bookings', v_rows,
    'casitas_total', (select count(*) from villas where active));
end;
$$;
revoke all on function manager_summary(text, date, date) from public;
grant execute on function manager_summary(text, date, date) to anon, authenticated;

select 'v41 applied' as status,
       (select code_hash is not null from manager_access where id = 1) as passcode_is_set;
