-- ============================================================================
-- booking-v26: renumber the 49 day-trip cabanas to match the new map
-- (assets/images/cabana-map-bg-v3.jpg). Each section now counts 1, 2, 3…
-- across lounge and dining cabanas together — front row first, left to right.
-- Same physical cabanas (same ids), so every existing booking and block keeps
-- its cabana; only the number and label change.
-- Safe to run once. If the current numbers don't match what this expects,
-- it stops without changing anything.
-- ============================================================================
do $$
declare n_match int; n_total int;
begin
  create temp table _renum (section text, cabana_type text, old_no int, new_no int) on commit drop;
  insert into _renum values
    ('A','lounge_cabana',1,1),
    ('A','dining_cabana',1,2),
    ('A','lounge_cabana',2,3),
    ('A','dining_cabana',2,4),
    ('A','lounge_cabana',3,5),
    ('A','dining_cabana',3,6),
    ('A','lounge_cabana',4,7),
    ('A','dining_cabana',4,8),
    ('A','dining_cabana',5,9),
    ('A','dining_cabana',6,10),
    ('A','dining_cabana',7,11),
    ('A','dining_cabana',8,12),
    ('A','lounge_cabana',5,13),
    ('A','dining_cabana',9,14),
    ('A','dining_cabana',22,15),
    ('A','dining_cabana',10,16),
    ('A','dining_cabana',11,17),
    ('A','dining_cabana',12,18),
    ('A','dining_cabana',14,19),
    ('A','dining_cabana',15,20),
    ('A','dining_cabana',16,21),
    ('A','dining_cabana',17,22),
    ('A','dining_cabana',18,23),
    ('A','dining_cabana',19,24),
    ('A','dining_cabana',20,25),
    ('A','dining_cabana',21,26),
    ('B','lounge_cabana',1,1),
    ('B','dining_cabana',2,2),
    ('B','dining_cabana',3,3),
    ('B','dining_cabana',4,4),
    ('B','dining_cabana',6,5),
    ('B','dining_cabana',7,6),
    ('B','dining_cabana',8,7),
    ('B','dining_cabana',9,8),
    ('B','dining_cabana',10,9),
    ('B','dining_cabana',11,10),
    ('B','dining_cabana',12,11),
    ('B','dining_cabana',14,12),
    ('B','dining_cabana',15,13),
    ('B','dining_cabana',16,14),
    ('B','dining_cabana',17,15),
    ('B','dining_cabana',18,16),
    ('B','dining_cabana',19,17),
    ('B','dining_cabana',20,18),
    ('B','dining_cabana',21,19),
    ('B','dining_cabana',22,20),
    ('B','dining_cabana',23,21),
    ('B','dining_cabana',24,22),
    ('B','dining_cabana',25,23);

  select count(*) into n_total from cabanas;
  select count(*) into n_match
    from cabanas c join _renum r
      on r.section = c.section and r.cabana_type = c.cabana_type and r.old_no = c.number;
  if n_total <> 49 or n_match <> 49 then
    raise exception 'Expected 49 cabanas with the old numbers, found % of % — nothing changed (already renumbered?)', n_match, n_total;
  end if;

  -- two steps so no number is ever used twice mid-update
  update cabanas c set number = r.new_no + 1000
    from _renum r
   where r.section = c.section and r.cabana_type = c.cabana_type and r.old_no = c.number;
  update cabanas set number = number - 1000,
         label = 'Section ' || section || ' — ' ||
                 case cabana_type when 'lounge_cabana' then 'Lounge' else 'Dining' end ||
                 ' Cabana ' || (number - 1000)
   where number > 1000;
  raise notice 'Renumbered 49 cabanas';
end $$;

-- Check: 26 in Section A (lounges 1, 3, 5, 7, 13) and 23 in Section B (lounge 1).
select section, count(*) as cabanas,
       string_agg(number::text, ', ' order by number) filter (where cabana_type = 'lounge_cabana') as lounge_numbers,
       min(number) as first_no, max(number) as last_no
  from cabanas group by section order by section;
