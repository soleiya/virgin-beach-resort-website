-- =============================================================================
-- booking-v69: offers only for dates that still have room (Cloudbeds).
--
-- The AI used to see only nights booked on the website, so it offered dates
-- that were already full in Cloudbeds. Casita availability now comes from
-- cb_rates (Cloudbeds nightly availability per casita type, kept in step by
-- cloudbeds-sync every 5 minutes, 460 nights ahead); day trips from
-- daytrip_availability().
--
-- * campaign_casita_nights(from, to)   free casitas per night (Cloudbeds)
-- * campaign_window_check(offer, expires) → is there room in the offer's
--   stay window?  {verdict ok|tight|full, nights, open_nights, free_nights,
--   full_dates, note, …}  used by the campaigns function on every AI
--   suggestion (full ones are dropped) and by the staff editor.
-- * campaign_ai_context(): 'occupancy' replaced by 'availability' (Cloudbeds
--   per month + free casitas per night for the next 120 nights + day-trip
--   cabanas) and the online-booking limits.
-- Read-only; re-runnable.
-- =============================================================================

create or replace function campaign_casita_nights(p_from date, p_to date)
returns table(night date, free int, on_sale boolean)
language sql stable security definer set search_path = public as $$
  select g::date, coalesce(sum(greatest(r.rooms_available, 0)), 0)::int, count(r.night) > 0
  from generate_series(p_from, greatest(p_to, p_from + 1) - 1, interval '1 day') g
  left join cb_rates r on r.night = g::date
  group by g order by g
$$;
revoke all on function campaign_casita_nights(date, date) from public, anon;
grant execute on function campaign_casita_nights(date, date) to authenticated, service_role;

create or replace function campaign_window_check(p_offer jsonb, p_expires date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  st booking_settings%rowtype;
  o jsonb := coalesce(p_offer, '{}'::jsonb);
  v_kinds text[];
  v_from date; v_to date;
  v_on boolean; v_dt boolean;
  r jsonb := '{}'::jsonb;
  n_total int := 0; n_open int := 0; n_free int := 0; n_full int := 0;
  full_list text[] := '{}'; v_last_online date;
  d_total int := 0; d_open int := 0; d_full_list text[] := '{}';
  v_verdict text := 'ok'; v_note text := '';
  x record;
begin
  perform campaign_guard();
  select * into st from booking_settings where id = 1;
  v_kinds := coalesce((select array_agg(k) from jsonb_array_elements_text(case when jsonb_typeof(o->'booking_kinds') = 'array' then o->'booking_kinds' else '["overnight"]'::jsonb end) k), array['overnight']);
  v_on := 'overnight' = any(v_kinds);
  v_dt := 'day_trip' = any(v_kinds);
  v_from := greatest(coalesce(nullif(o->>'stay_from', '')::date, v_today + 1), v_today + 1);
  v_to := coalesce(nullif(o->>'stay_to', '')::date, least(coalesce(p_expires, v_today + 30) + 60, v_from + 90));
  if v_to < v_from then
    return jsonb_build_object('verdict', 'full', 'note', 'The stay window is already over.', 'from', v_from, 'to', v_to);
  end if;
  v_last_online := st.villa_bookings_open_until;

  if v_on then
    for x in select * from campaign_casita_nights(v_from, v_to + 1) loop
      n_total := n_total + 1;
      if x.on_sale and x.free > 0 then n_open := n_open + 1; n_free := n_free + x.free;
      else n_full := n_full + 1; if array_length(full_list, 1) is null or array_length(full_list, 1) < 40 then full_list := full_list || to_char(x.night, 'Mon DD'); end if;
      end if;
    end loop;
  end if;
  if v_dt then
    for x in select * from daytrip_availability(v_from, least(v_to, v_from + 92)) loop
      d_total := d_total + 1;
      if coalesce(x.dining_left, 0) + coalesce(x.lounge_left, 0) > 0 then d_open := d_open + 1;
      elsif array_length(d_full_list, 1) is null or array_length(d_full_list, 1) < 40 then d_full_list := d_full_list || to_char(x.day, 'Mon DD');
      end if;
    end loop;
  end if;

  if (not v_on or n_open = 0) and (not v_dt or d_open = 0) then v_verdict := 'full';
  elsif (v_on and n_total > 0 and n_open::numeric / n_total < 0.3) or (v_dt and not v_on and d_total > 0 and d_open::numeric / d_total < 0.3) then v_verdict := 'tight';
  end if;

  if v_on then
    v_note := case when n_open = 0 then 'Casitas: no free nights in Cloudbeds (full or not open yet) for ' || to_char(v_from, 'Mon DD') || '–' || to_char(v_to, 'Mon DD') || '.'
      else 'Casitas (Cloudbeds): ' || n_open || ' of ' || n_total || ' nights still have room (' || n_free || ' casita-nights free)' ||
        case when n_full > 0 then '; full or closed: ' || array_to_string(full_list, ', ') || case when n_full > array_length(full_list, 1) then '…' else '' end else '' end || '.' end;
    if v_last_online is not null and v_to > v_last_online then
      v_note := v_note || ' Online booking only runs to ' || to_char(v_last_online, 'Mon DD, YYYY') || '; later nights are by request.';
    end if;
  end if;
  if v_dt then
    v_note := trim(v_note || ' ' || case when d_open = 0 then 'Day trips: no cabanas left on these days.'
      else 'Day trips: cabanas free on ' || d_open || ' of ' || d_total || ' days' ||
        case when array_length(d_full_list, 1) > 0 then ' (full: ' || array_to_string(d_full_list, ', ') || ')' else '' end || '.' end);
  end if;

  return jsonb_build_object('verdict', v_verdict, 'note', v_note, 'from', v_from, 'to', v_to,
    'nights', n_total, 'open_nights', n_open, 'free_casita_nights', n_free, 'full_dates', to_jsonb(full_list),
    'days', d_total, 'open_days', d_open, 'checked_at', now());
end;
$$;
revoke all on function campaign_window_check(jsonb, date) from public, anon;
grant execute on function campaign_window_check(jsonb, date) to authenticated, service_role;

create or replace function campaign_ai_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date; r jsonb; st booking_settings%rowtype;
begin
  perform campaign_guard();
  select * into st from booking_settings where id = 1;
  select jsonb_build_object(
    'today', v_today,
    'segments', campaign_segments(),
    'calendar', (select value from campaign_settings where key = 'calendar'),
    'products', (select value from campaign_settings where key = 'products'),
    'villa_types', (select coalesce(jsonb_agg(distinct jsonb_build_object('room_type', room_type, 'name', room_type_name, 'weekday', weekday_rate, 'weekend', weekend_rate)), '[]') from villas where active),
    'add_ons', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'price', price)), '[]') from add_ons where active and price is not null),
    'online_booking', jsonb_build_object('villa_nights_until', st.villa_bookings_open_until, 'day_trips_until', st.bookings_open_until,
      'requests_until', st.requests_open_until),
    -- live from Cloudbeds: free casitas per month and per night
    'availability', jsonb_build_object(
      'source', 'Cloudbeds, live (18 casitas)',
      'by_month', (select coalesce(jsonb_agg(jsonb_build_object(
          'month', m, 'nights_on_sale', on_sale, 'casita_nights_free', free, 'occupancy_pct', case when on_sale > 0 then round(100 - 100.0 * free / (18 * on_sale)) end,
          'full_nights', full_n, 'sun_thu_nights_with_3plus_free', wk_free) order by m), '[]')
        from (select to_char(night, 'YYYY-MM') m, count(*) filter (where on_sale) on_sale, sum(free) filter (where on_sale) free,
                count(*) filter (where not on_sale or free = 0) full_n,
                count(*) filter (where on_sale and free >= 3 and extract(dow from night) between 0 and 4) wk_free
              from campaign_casita_nights(v_today, (date_trunc('month', v_today) + interval '6 months')::date) group by 1) a),
      'free_casitas_per_night', (select string_agg(to_char(night, 'MM-DD') || ':' || case when on_sale then free::text else 'x' end, ' ' order by night)
        from campaign_casita_nights(v_today + 1, v_today + 121)),
      'per_night_note', 'MM-DD:free casitas that night; x = closed / not on sale; 0 = full',
      'day_trip_full_days', (select coalesce(jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day), '[]')
        from daytrip_availability(v_today + 1, v_today + 92) where coalesce(dining_left, 0) + coalesce(lounge_left, 0) = 0),
      'day_trip_busy_days', (select coalesce(jsonb_agg(to_char(day, 'YYYY-MM-DD') || ' (' || dining_left || ' dining cabanas left)' order by day), '[]')
        from daytrip_availability(v_today + 1, v_today + 92) where dining_left between 1 and 8)),
    'past_campaigns', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'status', c.status, 'audience', c.audience_label, 'offer', c.offer - 'images',
        'decline_reason', c.decline_reason, 'stats', campaign_stats(c.id)) order by c.created_at desc), '[]')
      from (select * from campaigns where status not in ('suggested') order by created_at desc limit 25) c),
    'open_suggestions', (select coalesce(jsonb_agg(c.name), '[]') from campaigns c where c.status = 'suggested')
  ) into r;
  return r;
end;
$$;
revoke all on function campaign_ai_context() from public, anon;
grant execute on function campaign_ai_context() to authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true); -- for the check below only
select 'v69 applied' as status,
  (select campaign_window_check('{"booking_kinds":["overnight"],"stay_from":"2026-12-20","stay_to":"2027-01-03"}'::jsonb, null) ->> 'note') as sample;
