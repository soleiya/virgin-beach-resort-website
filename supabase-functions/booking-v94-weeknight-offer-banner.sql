-- booking-v94: public weeknight-offer banner on the website (homepage + Overnight page).
-- weeknight_offer_public() returns the live weekday-only campaign offer (percent, booking deadline,
-- stay window) and, per active casita type, the Sun–Thu non-peak nights that Cloudbeds still shows
-- as available (cb_rates.rooms_available > 0), from tomorrow (Manila) to the end of the stay window,
-- capped at villa_bookings_open_until. Returns null when no weekday offer is running, so the banner hides.
-- Read-only, exposes no guest data, codes or campaign copy. Callable by anon.

create or replace function public.weeknight_offer_public()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c record;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_from date; v_to date; v_rooms jsonb;
begin
  select cp.offer, cp.expires_on into c
    from campaigns cp
   where cp.status in ('sending', 'paused', 'sent')
     and cp.launched_at is not null
     and coalesce((cp.offer ->> 'weekdays_only')::boolean, false)
     and coalesce(cp.offer ->> 'applies_to', 'rooms') = 'rooms'
     and (cp.expires_on is null or cp.expires_on >= v_today)
   order by cp.launched_at desc
   limit 1;
  if not found then return null; end if;

  v_from := greatest(v_today + 1, coalesce((c.offer ->> 'stay_from')::date, v_today + 1));
  v_to := least(coalesce((c.offer ->> 'stay_to')::date, v_today + 60),
                coalesce((select s.villa_bookings_open_until from booking_settings s where s.id = 1), v_today + 365),
                v_today + 120);
  if v_from > v_to then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('slug', t.room_type, 'name', t.name, 'rate', t.rate, 'nights', t.nights) order by t.sort), '[]'::jsonb)
    into v_rooms
    from (
      select v.room_type, min(v.room_type_name) as name, min(v.weekday_rate) as rate, min(v.sort) as sort,
             to_jsonb(array_agg(distinct r.night order by r.night)) as nights
        from villas v
        join cb_rates r on r.cb_room_type_id = v.cb_room_type_id
       where v.active
         and r.night between v_from and v_to
         and r.rooms_available > 0
         and extract(isodow from r.night) not in (5, 6)
         and not exists (select 1 from peak_dates p where p.night = r.night)
       group by v.room_type
    ) t;

  if jsonb_array_length(v_rooms) = 0 then return null; end if;
  return jsonb_build_object(
    'percent', (c.offer ->> 'percent')::numeric,
    'book_by', c.expires_on,
    'stay_from', v_from,
    'stay_to', v_to,
    'synced_at', (select max(synced_at) from cb_rates),
    'rooms', v_rooms);
end;
$function$;

revoke all on function public.weeknight_offer_public() from public;
grant execute on function public.weeknight_offer_public() to anon, authenticated;
