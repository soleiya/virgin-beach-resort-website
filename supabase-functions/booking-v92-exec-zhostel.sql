-- booking-v92-exec-zhostel.sql
-- Z Hostel figures on the executive briefing (virginbeachresort.com/exec/), so Rommel
-- sees both properties behind the same link and PIN.
--
-- Z Hostel is a separate company with its own Cloudbeds property and StoreHub
-- account. There is no StoreHub API for it yet, so its figures are a snapshot
-- pulled from the Cloudbeds and StoreHub reports and stored here per year.
-- exec-briefing returns exec_zhostel(year) as data.zhostel; the page shows it
-- under the "Z Hostel" switch. To refresh: upsert a new row (same shape).

create table if not exists public.exec_snapshots (
  property   text not null,
  year       int  not null,
  data       jsonb not null,
  as_of      timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property, year)
);
alter table public.exec_snapshots enable row level security;
revoke all on public.exec_snapshots from anon, authenticated;

create or replace function public.exec_zhostel(p_year int)
returns jsonb language sql stable security definer set search_path = public as $$
  select s.data || jsonb_build_object('as_of', s.as_of)
    from exec_snapshots s
   where s.property = 'zhostel' and s.year = p_year
$$;
revoke all on function public.exec_zhostel(int) from public, anon, authenticated;
grant execute on function public.exec_zhostel(int) to service_role;

-- Snapshot: Jan 1 – Nov 24, 2026 (pulled Nov 24, 2026 ~1:30 PM Manila)
insert into public.exec_snapshots (property, year, data, as_of, updated_at)
values ('zhostel', 2026, $j${"property":"Z Hostel","today":"2026-11-24","through":"2026-11-24","sources_note":"Rooms: Cloudbeds Insights (Z Hostel, stay date, taxes/fees excluded). F&B: StoreHub BackOffice reports, net of VAT, business day from 6:00 AM.","months":[{"month":1,"room_rev":1580904.31,"room_rev_books":0.0,"rooms_sold":2070,"capacity":3224,"occ":64.21,"adr":763.72,"revpar":490.35,"fnb_net":900660,"fnb_gross":1008550,"fnb_items":7604,"outlets":{"Cafe":139567,"Tiki Bar":506960,"Z Roof Deck":254133}},{"month":2,"room_rev":1816192.13,"room_rev_books":0.0,"rooms_sold":2371,"capacity":2912,"occ":81.42,"adr":766.0,"revpar":623.69,"fnb_net":1075967,"fnb_gross":1205023,"fnb_items":8281,"outlets":{"Cafe":107220,"Tiki Bar":714517,"Z Roof Deck":254230}},{"month":3,"room_rev":1808629.94,"room_rev_books":0.0,"rooms_sold":2382,"capacity":3224,"occ":73.88,"adr":759.29,"revpar":560.99,"fnb_net":1185235,"fnb_gross":1327331,"fnb_items":8460,"outlets":{"Cafe":133466,"Tiki Bar":861995,"Z Roof Deck":189774}},{"month":4,"room_rev":1281351.03,"room_rev_books":0.0,"rooms_sold":1629,"capacity":3120,"occ":52.21,"adr":786.59,"revpar":410.69,"fnb_net":983286,"fnb_gross":1101091,"fnb_items":7154,"outlets":{"Cafe":115229,"Tiki Bar":628831,"Z Roof Deck":239226}},{"month":5,"room_rev":1025949.07,"room_rev_books":0.0,"rooms_sold":1395,"capacity":3224,"occ":43.27,"adr":735.45,"revpar":318.22,"fnb_net":992609,"fnb_gross":1111664,"fnb_items":6731,"outlets":{"Cafe":129738,"Tiki Bar":695008,"Z Roof Deck":167863}},{"month":6,"room_rev":829062.59,"room_rev_books":0.0,"rooms_sold":1284,"capacity":3120,"occ":41.15,"adr":645.69,"revpar":265.73,"fnb_net":715775,"fnb_gross":801525,"fnb_items":4854,"outlets":{"Cafe":77237,"Tiki Bar":507591,"Z Roof Deck":130947}},{"month":7,"room_rev":800562.1,"room_rev_books":0.0,"rooms_sold":1227,"capacity":3224,"occ":38.06,"adr":652.45,"revpar":248.31,"fnb_net":804685,"fnb_gross":901107,"fnb_items":5590,"outlets":{"Cafe":84594,"Tiki Bar":599429,"Z Roof Deck":120662}},{"month":8,"room_rev":828713.35,"room_rev_books":0.0,"rooms_sold":1325,"capacity":3224,"occ":41.1,"adr":625.44,"revpar":257.05,"fnb_net":503301,"fnb_gross":563441,"fnb_items":3436,"outlets":{"Cafe":66313,"Tiki Bar":310638,"Z Roof Deck":126350}},{"month":9,"room_rev":711522.13,"room_rev_books":0.0,"rooms_sold":1233,"capacity":3132,"occ":39.37,"adr":577.07,"revpar":227.18,"fnb_net":787309,"fnb_gross":881731,"fnb_items":5004,"outlets":{"Cafe":109607,"Tiki Bar":424935,"Z Roof Deck":252767}},{"month":10,"room_rev":1156016.85,"room_rev_books":0.0,"rooms_sold":1765,"capacity":3286,"occ":53.71,"adr":654.97,"revpar":351.8,"fnb_net":1334957,"fnb_gross":1494762,"fnb_items":8616,"outlets":{"Cafe":145917,"Tiki Bar":1054591,"Z Roof Deck":134450}},{"month":11,"room_rev":995927.22,"room_rev_books":178205.89,"rooms_sold":1737,"capacity":3180,"occ":54.62,"adr":675.95,"revpar":369.22,"fnb_net":941926,"fnb_gross":1054561,"fnb_items":6060,"outlets":{"Cafe":113262,"Tiki Bar":676473,"Z Roof Deck":152191}},{"month":12,"room_rev":0,"room_rev_books":501982.38,"rooms_sold":491,"capacity":3286,"occ":14.94,"adr":1022.37,"revpar":152.76,"fnb_net":0,"fnb_gross":0,"fnb_items":0,"outlets":{}}],"room_ytd":{"revenue":12809817.39,"rooms_sold":18130},"fnb_ytd":{"net":10225710,"gross":11450787,"discount":183420,"items":71790},"room_sources":[["Booking.com",3580,3893910.7],["Hostelworld",2570,2416754.97],["CTrip / Trip.com",1963,1259645.97],["Agoda / Priceline",1026,1025715.18],["Walk-In",1107,954241.47],["Returnee",1062,759817.76],["Direct Extension",953,729011.83],["Website",562,553835.05],["One Life Adventures",536,468795.07],["Time 2 Travel",201,212857.64],["Email",132,184728.09],["Expedia",114,174754.53],["KILROY",74,94267.86],["Phone",78,69691.96],["Z Escapes",14,6250.02],["FOC",4157,4200.0],["Partners & Investor",1,1339.29]],"fnb_categories":[["Cocktails",3037668],["Beers",2983059],["Bar Chow",756097],["Uncategorized",585651],["Non Alcoholic",440896],["Premium Shots",372924],["Premium Bottles",329236],["Coffee / Tea",289680],["Liquor",263567],["All Day Bowls",207087]],"top_products":[{"name":"San Miguel Pale Pilsen 320ml","category":"Beers","qty":7455,"gross":954858},{"name":"Red Horse Beer 330ml","category":"Beers","qty":6253,"gross":801721},{"name":"San Mig Light Beer 330ml","category":"Beers","qty":6040,"gross":773055},{"name":"Whatever Cocktail","category":"Cocktails","qty":2249,"gross":563968},{"name":"San Mig Apple Beer 330ml","category":"Beers","qty":3436,"gross":440464},{"name":"Amaretto Sour","category":"Cocktails","qty":1671,"gross":418632},{"name":"Puneta Cocktail","category":"Cocktails","qty":1332,"gross":330258},{"name":"Mojito Classic or Cucumber","category":"Cocktails","qty":1181,"gross":238446},{"name":"Chicken Tenders with Fries","category":"Bar Chow","qty":1154,"gross":195231},{"name":"Rum Coke","category":"Cocktails","qty":975,"gross":190660}]}$j$::jsonb, '2026-11-24T13:30:00+08:00', now())
on conflict (property, year) do update set data = excluded.data, as_of = excluded.as_of, updated_at = now();
