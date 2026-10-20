-- ============================================================================
-- Booking rules v20 — staff can block Day Trip cabanas.
--
-- A cabana can be taken off sale for one day or a range of days, with a
-- reason staff pick from a short list:
--   under_repair · unavailable · blocked
-- plus an optional note ("roof leak", "owner's guests", …).
--
-- What a block does:
--   * The public booking page greys the cabana out for those dates (it reads
--     public_cabana_holds, which now includes blocks — the reason itself is
--     never shown to guests).
--   * Nobody can attach a blocked cabana to a booking for a blocked date —
--     not the website, not the staff form, not the Cabana Map — and a booking
--     that already has cabanas can't be moved onto a date they're blocked.
--   * Bookings that were already on a cabana before it was blocked are left
--     alone; the dashboard warns staff so they can move those parties.
--   * Every block and unblock is written to the activity log.
--
-- Run in Supabase → SQL Editor (after booking-v19). Safe to re-run.
-- ============================================================================

create extension if not exists btree_gist;

-- 1. The blocks themselves. end_date is the LAST blocked day (inclusive),
--    since a day trip is a single date, not a night.
create table if not exists cabana_blocks (
  id uuid primary key default gen_random_uuid(),
  cabana_id uuid not null references cabanas(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null default 'blocked',
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_email text default (auth.jwt() ->> 'email'),
  constraint cabana_blocks_dates check (end_date >= start_date),
  constraint cabana_blocks_reason check (reason in ('under_repair', 'unavailable', 'blocked')),
  constraint cabana_blocks_no_overlap exclude using gist (
    cabana_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);
create index if not exists cabana_blocks_dates on cabana_blocks(start_date, end_date);

alter table cabana_blocks enable row level security;
drop policy if exists "Staff can view cabana blocks" on cabana_blocks;
create policy "Staff can view cabana blocks" on cabana_blocks for select to authenticated using (true);
drop policy if exists "Staff can add cabana blocks" on cabana_blocks;
create policy "Staff can add cabana blocks" on cabana_blocks for insert to authenticated with check (true);
drop policy if exists "Staff can change cabana blocks" on cabana_blocks;
create policy "Staff can change cabana blocks" on cabana_blocks for update to authenticated using (true) with check (true);
drop policy if exists "Staff can remove cabana blocks" on cabana_blocks;
create policy "Staff can remove cabana blocks" on cabana_blocks for delete to authenticated using (true);
-- No anon policy: guests only ever see the PII-free public_cabana_holds view.

-- 2. Human-readable reason, used in error messages and the activity log.
create or replace function cabana_block_reason_label(p text) returns text
language sql immutable as $$
  select case p when 'under_repair' then 'Under repair'
                when 'unavailable' then 'Unavailable'
                else 'Blocked' end;
$$;

-- 3. Public availability: booked cabanas (as before) PLUS every blocked
--    cabana-day. Same two columns, so the booking page needs no change.
create or replace view public_cabana_holds as
  select bc.cabana_id, br.check_in
  from booking_cabanas bc
  join booking_requests br on br.id = bc.booking_id
  where br.status not in ('declined', 'expired')
  union all
  select b.cabana_id, d::date as check_in
  from cabana_blocks b,
       generate_series(b.start_date, b.end_date, interval '1 day') d;

grant select on public_cabana_holds to anon, authenticated;

-- 4. Guard: a blocked cabana can't be attached to a booking on a blocked
--    date (covers the website, the staff form and the Cabana Map planner).
create or replace function guard_cabana_not_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_date date;
  v_status booking_status;
  v_block cabana_blocks%rowtype;
  v_label text;
begin
  select check_in, status into v_date, v_status from booking_requests where id = new.booking_id;
  if v_date is null or v_status in ('declined', 'expired') then
    return new;
  end if;
  select * into v_block from cabana_blocks
   where cabana_id = new.cabana_id and v_date between start_date and end_date
   limit 1;
  if found then
    select label into v_label from cabanas where id = new.cabana_id;
    raise exception 'Cabana not available: % is % on %', coalesce(v_label, 'this cabana'),
      lower(cabana_block_reason_label(v_block.reason)), to_char(v_date, 'Mon DD, YYYY')
      using errcode = 'P0001', hint = 'cabana_blocked';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_cabana_not_blocked on booking_cabanas;
create trigger trg_guard_cabana_not_blocked
  before insert or update of cabana_id, booking_id on booking_cabanas
  for each row execute function guard_cabana_not_blocked();

-- …and a booking that holds cabanas can't be moved onto a date when one of
-- them is blocked (or re-opened from declined/expired while one is blocked).
create or replace function guard_booking_date_cabana_blocks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_reason text;
begin
  if new.check_in is null or new.status in ('declined', 'expired') then
    return new;
  end if;
  if new.check_in is not distinct from old.check_in
     and not (old.status in ('declined', 'expired')) then
    return new;
  end if;
  select c.label, b.reason into v_label, v_reason
    from booking_cabanas bc
    join cabana_blocks b on b.cabana_id = bc.cabana_id and new.check_in between b.start_date and b.end_date
    join cabanas c on c.id = bc.cabana_id
   where bc.booking_id = new.id
   limit 1;
  if v_label is not null then
    raise exception 'Cabana not available: % is % on %', v_label,
      lower(cabana_block_reason_label(v_reason)), to_char(new.check_in, 'Mon DD, YYYY')
      using errcode = 'P0001', hint = 'cabana_blocked';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_booking_date_cabana_blocks on booking_requests;
create trigger trg_guard_booking_date_cabana_blocks
  before update of check_in, status on booking_requests
  for each row execute function guard_booking_date_cabana_blocks();

-- 5. Activity log (same table as every other booking change).
create or replace function log_cabana_block_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_email text; r cabana_blocks%rowtype; v_label text; v_action text;
begin
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  begin v_email := auth.jwt() ->> 'email'; exception when others then v_email := null; end;
  r := coalesce(new, old);
  select label into v_label from cabanas where id = r.cabana_id;
  v_action := case tg_op when 'INSERT' then 'cabana_blocked'
                         when 'DELETE' then 'cabana_unblocked'
                         else 'cabana_block_changed' end;
  insert into booking_audit_log (booking_id, order_code, guest_name, action, changed_by_id, changed_by_email, changes)
  values (null, null, 'BLOCK: ' || cabana_block_reason_label(r.reason), v_action, v_uid, v_email,
          jsonb_build_object('cabana_id', r.cabana_id, 'cabana', v_label,
                             'start_date', r.start_date, 'end_date', r.end_date,
                             'reason', cabana_block_reason_label(r.reason), 'note', r.note));
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_log_cabana_block_change on cabana_blocks;
create trigger trg_log_cabana_block_change
  after insert or update or delete on cabana_blocks
  for each row execute function log_cabana_block_change();

-- Handy checks:
--   select c.label, b.start_date, b.end_date, b.reason, b.note from cabana_blocks b join cabanas c on c.id = b.cabana_id order by b.start_date;
--   select * from public_cabana_holds where check_in = current_date;
