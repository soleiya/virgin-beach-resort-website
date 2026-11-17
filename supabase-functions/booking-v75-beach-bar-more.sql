-- =============================================================================
-- booking-v75: the Beach Bar area has 2 lounge cabanas (₱2,000) and 3 dining
-- cabanas (₱1,500), per the front office — all staff only (v74), same prices
-- and capacities as the regular ones. The v74 lounge becomes Lounge 1.
-- Re-runnable.
-- =============================================================================
update cabanas set label = 'Beach Bar — Lounge Cabana 1 (staff only)'
where section = 'Beach Bar' and cabana_type = 'lounge_cabana' and number = 1;

insert into cabanas (section, row_index, col_index, cabana_type, number, label, capacity, price, staff_only)
select x.section, x.r, x.c, x.t, x.n, x.label, x.cap, x.price, true
from (values
  ('Beach Bar', 9, 1, 'lounge_cabana', 2, 'Beach Bar — Lounge Cabana 2 (staff only)', 4, 2000),
  ('Beach Bar', 10, 0, 'dining_cabana', 1, 'Beach Bar — Dining Cabana 1 (staff only)', 10, 1500),
  ('Beach Bar', 10, 1, 'dining_cabana', 2, 'Beach Bar — Dining Cabana 2 (staff only)', 10, 1500),
  ('Beach Bar', 10, 2, 'dining_cabana', 3, 'Beach Bar — Dining Cabana 3 (staff only)', 10, 1500)
) as x(section, r, c, t, n, label, cap, price)
where not exists (select 1 from cabanas k where k.section = x.section and k.cabana_type = x.t and k.number = x.n);

select 'v75 applied' as status, cabana_type, count(*) as beach_bar_cabanas
from cabanas where staff_only group by cabana_type;
