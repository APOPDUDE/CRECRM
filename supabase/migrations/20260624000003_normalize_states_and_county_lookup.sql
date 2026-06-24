-- Audit cleanup (data quality): state normalization + county_lookup completeness.

-- 1. Normalize obvious state mislabels to 'FL'. Update state ONLY (do not retouch city — that
--    would re-fire set_property_county and could NULL a county whose city isn't in the lookup).
--    'Florida' -> 'FL' (2 rows, one on an active listing); the Lakeland row mislabeled 'VA' whose
--    zip 33815 is unambiguously Lakeland/Polk County FL. The 4 New York rows (Madison/Park/Fifth Ave
--    HQ-address leakage) and 1 genuine Lamar, MO row are intentionally LEFT for manual review.
update properties set state = 'FL' where state = 'Florida';
update properties set state = 'FL'
  where state = 'VA' and lower(btrim(city)) = 'lakeland' and zip = '33815';

-- 2. Add missing FL cities to the city->county reference (bare county name, lowercase key — matches
--    the existing 112-row convention which already spans Orange/Osceola/Charlotte/DeSoto/etc.).
insert into county_lookup (city_key, county) values
  ('leesburg','Lake'),('lecanto','Citrus'),('miami','Miami-Dade'),('jacksonville','Duval'),
  ('longwood','Seminole'),('homestead','Miami-Dade'),('sumterville','Sumter'),('winter park','Orange'),
  ('avon park','Highlands'),('casselberry','Seminole'),('florida city','Miami-Dade'),('fruitland park','Lake'),
  ('hernando','Citrus'),('inverness','Citrus'),('ocala','Marion'),('sebring','Highlands'),
  ('sorrento','Lake'),('tavares','Lake'),('wildwood','Sumter')
on conflict (city_key) do nothing;

-- 3. Backfill county for properties whose city now resolves (only fills NULL/blank counties).
update properties p set county = cl.county
from county_lookup cl
where (p.county is null or btrim(p.county) = '')
  and lower(btrim(p.city)) = cl.city_key;
