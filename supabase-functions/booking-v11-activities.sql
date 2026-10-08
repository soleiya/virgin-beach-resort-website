-- ============================================================================
-- Booking rules v11 — Guest Activities & Recreation Rate List (Oct 2026)
-- Replaces the add-on prices with the official rate list. Prices include
-- VAT and service charge, like every other rate. Re-runnable.
-- ============================================================================
insert into add_ons (slug, name, description, unit, price, sort, active) values
  ('massage_60',        'Massage — 60 minutes',  'In-casita or beachside massage by our visiting wellness therapists.', 'per person', 750, 10, true),
  ('massage_90',        'Massage — 90 minutes',  'A longer, deeper session to fully unwind.',                          'per person', 1000, 20, true),
  ('massage_120',       'Massage — 120 minutes', 'Our longest session — a full two hours of pure relaxation.',          'per person', 1250, 25, true),
  ('jetski_30',         'Jet Ski — 30 minutes',  'Zip across the cove on a jet ski.',                                  'per jet ski', 3500, 30, true),
  ('jetski_60',         'Jet Ski — 1 hour',      'A full hour on the water to explore the coastline.',                 'per jet ski', 5500, 35, true),
  ('banana_boat',       'Banana Boat — 15 minutes', 'The classic group ride — hold on tight!',                         'per ride', 3500, 40, true),
  ('disco_ball',        'Disco Ball — 15 minutes',  'Spin and bounce across the waves on an inflatable tube.',         'per ride', 3500, 45, true),
  ('flying_fish',       'Flying Fish — 15 minutes', 'Lift off the water on a towed inflatable for a real thrill.',     'per ride', 3500, 50, true),
  ('boat_snorkel',      'Boat Ride & Snorkeling — 2 hours', 'Head out by boat to snorkel the reefs nearby.',            'per boat', 5500, 60, true),
  ('boat_snorkel_cave', 'Boat Ride, Snorkeling & Napayong Cave — 2 hours', 'Snorkeling plus a visit to Napayong Island''s cave.', 'per boat', 6500, 65, true),
  ('atv_1',             'ATV — Solo, 40 minutes',   'Off-road ride along the scenic trails around the property.',      'per ATV', 1000, 70, true),
  ('atv_2',             'ATV — Double, 40 minutes', 'Share one ATV with a companion on the trails around the property.', 'per ATV', 1200, 75, true)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, unit = excluded.unit,
  price = excluded.price, sort = excluded.sort, active = true;
