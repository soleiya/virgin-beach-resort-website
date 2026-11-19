-- booking-v81: villa revenue monitor + staff AI assistant (read-only SQL)
--
-- 1) villa_revenue_days(from, to): for each night, the most the casitas could earn
--    and what confirmed stays are earning, for the Villa Calendar.
--      * max      = every active casita sold that night at its room rate + full-board
--                   meals for its base occupancy (adult meal rate).
--                   Room rate = Cloudbeds' rate for the night when it has one (> 0),
--                   otherwise the website's weekday / weekend-peak rate.
--      * achieved = confirmed + completed overnight stays, spread evenly over their
--                   nights. Website bookings: total − pets − add-ons (discounts
--                   already taken off). Cloudbeds bookings: Cloudbeds' total, plus
--                   estimated meals (adults × adult meal + kids 6–12 × child meal,
--                   per night) when the Cloudbeds total looks like room only
--                   (less than room value + half the meal value).
--      * pending  = the same for pending stays (shown separately, not in achieved)
--      * lost     = value of casitas blocked that night (staff / Cloudbeds blocks and
--                   Cloudbeds availability holds) — still part of max.
-- 2) staff_ai_query(sql): lets the dashboard assistant read anything a signed-in staff
--    member can read. Runs as the caller (RLS and grants apply), one SELECT/WITH
--    statement, in a read-only transaction — it can never change data.
--    staff_ai_schema(): the tables and columns, for the assistant.

create or replace function public.villa_revenue_days(p_from date, p_to date)
returns table (night date, max_total numeric, achieved numeric, pending numeric, lost_blocked numeric,
               casitas int, sold int, blocked int)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  rt overnight_rates%rowtype;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 400 then
    raise exception 'Pick a range of up to 400 nights';
  end if;
  select * into rt from overnight_rates where id = 1;

  return query
  with nights as (
    select d::date as n, (extract(isodow from d) in (5, 6) or exists (select 1 from peak_dates pd where pd.night = d::date)) as wk
      from generate_series(p_from, p_to - 1, interval '1 day') d
  ), unit as (   -- value of each casita each night
    select nt.n, v.id as villa_id,
           coalesce(nullif(r.rate, 0), case when nt.wk then v.weekend_rate else v.weekday_rate end)::numeric
             + coalesce(v.base_occupancy, 0) * rt.meal_adult as val,
           coalesce(nullif(r.rate, 0), case when nt.wk then v.weekend_rate else v.weekday_rate end)::numeric as room
      from nights nt
      cross join villas v
      left join cb_rates r on r.cb_room_type_id = v.cb_room_type_id and r.night = nt.n
     where v.active
  ), blk as (
    select distinct u.n, u.villa_id, u.val
      from unit u join booking_villas bv on bv.villa_id = u.villa_id and bv.active and bv.booking_id is null
                                      and u.n >= bv.check_in and u.n < bv.check_out
  ), stays as (  -- each confirmed / pending stay's value per night
    select b.id, b.status, b.check_in, b.check_out, (b.check_out - b.check_in) as nn,
           case when not b.cb_owned then
                  greatest(coalesce(b.total_amount, 0) - coalesce(b.pet_total, 0) - coalesce(b.add_on_total, 0), 0)
                else
                  coalesce(b.total_amount, 0) +
                  case when coalesce(b.total_amount, 0) < rv.room_val + 0.5 * me.meal_val then me.meal_val else 0 end
           end as stay_val
      from booking_requests b
      cross join lateral (
        select ((coalesce(b.adults, 0) * rt.meal_adult + coalesce(b.children_6_12, 0) * rt.meal_child)
                * (b.check_out - b.check_in))::numeric as meal_val) me
      cross join lateral (
        select coalesce(sum(u.room), 0) as room_val
          from booking_villas bv join unit u on u.villa_id = bv.villa_id and u.n >= bv.check_in and u.n < bv.check_out
         where bv.booking_id = b.id) rv
     where b.stay_type = 'overnight' and b.status in ('confirmed', 'completed', 'pending')
       and b.check_in is not null and b.check_out > b.check_in
       and b.check_in < p_to and b.check_out > p_from
  ), per_night as (
    select nt.n,
           coalesce(sum(s.stay_val / s.nn) filter (where s.status in ('confirmed', 'completed')), 0) as ach,
           coalesce(sum(s.stay_val / s.nn) filter (where s.status = 'pending'), 0) as pen
      from nights nt left join stays s on nt.n >= s.check_in and nt.n < s.check_out
     group by nt.n
  ), sold_units as (
    select u.n, count(distinct u.villa_id) as c
      from unit u join booking_villas bv on bv.villa_id = u.villa_id and bv.active and bv.booking_id is not null
                                      and u.n >= bv.check_in and u.n < bv.check_out
      join booking_requests b on b.id = bv.booking_id and b.status in ('confirmed', 'completed')
     group by u.n
  )
  select nt.n,
         round(coalesce((select sum(u.val) from unit u where u.n = nt.n), 0), 2),
         round(pn.ach, 2),
         round(pn.pen, 2),
         round(coalesce((select sum(b.val) from blk b where b.n = nt.n), 0), 2),
         (select count(*) from unit u where u.n = nt.n)::int,
         coalesce((select su.c from sold_units su where su.n = nt.n), 0)::int,
         (select count(*) from blk b where b.n = nt.n)::int
    from nights nt join per_night pn on pn.n = nt.n
   order by nt.n;
end;
$function$;

revoke all on function public.villa_revenue_days(date, date) from public, anon;
grant execute on function public.villa_revenue_days(date, date) to authenticated, service_role;

-- ------------------------------------------------------------------ assistant
create or replace function public.staff_ai_query(p_sql text, p_limit int default 200)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v text := regexp_replace(trim(coalesce(p_sql, '')), ';\s*$', '');
  v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_out jsonb;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then raise exception 'not allowed'; end if;
  if v = '' then raise exception 'Empty query'; end if;
  if position(';' in v) > 0 then raise exception 'One statement at a time, please (no semicolons).'; end if;
  if v !~* '^\s*(select|with)\s' then raise exception 'Only SELECT / WITH queries are allowed.'; end if;
  -- nothing in this transaction can write, whatever the query calls
  perform set_config('transaction_read_only', 'on', true);
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit %s) t', v, v_lim) into v_out;
  return v_out;
end;
$function$;

revoke all on function public.staff_ai_query(text, int) from public, anon;
grant execute on function public.staff_ai_query(text, int) to authenticated;

create or replace function public.staff_ai_schema()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(t.relname, t.cols), '{}'::jsonb)
    from (select c.relname, string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) as cols
            from pg_class c
            join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
             and c.relname !~ '^(backup_|add_ons_backup|pg_stat)'
             and has_table_privilege(c.oid, 'select')
           group by c.relname) t
$function$;

revoke all on function public.staff_ai_schema() from public, anon;
grant execute on function public.staff_ai_schema() to authenticated;
