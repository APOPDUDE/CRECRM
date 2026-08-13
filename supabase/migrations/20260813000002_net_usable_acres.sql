-- net_usable_acres: the dirt you could actually put something on.
--
-- Alex's definition, verbatim: "if there's only 50k sqft of highlands and a 25k
-- sqft building there's only 25k sqft of usable land". So it is the UPLANDS minus
-- the building's FOOTPRINT - not minus its gross floor area, which on a two-storey
-- building would subtract the same dirt twice. Only 402 of 17,364 rows carry
-- `stories` and just 48 of those are >1, so the divisor is almost always 1; it is
-- there so a rare multi-storey does not under-report its yard.
--
-- GENERATED, not backfilled: it must be right for every property forever, including
-- ones imported tomorrow, and it moves on its own whenever usable_acres, gross_sf
-- or stories change. 15,683 rows carry it - every property with acreage on file.
--
-- NOT the same thing as the valuation's `excess_acres`, and confusing the two
-- double-counts the parking:
--   net_usable_acres = uplands - building footprint          <- the physical yard
--   excess_acres     = uplands - the building's TYPICAL SITE <- what earns money
-- The gap between them is the parking, apron and truck court that the building's
-- own $/SF comp is already paying for. On a low-coverage IOS site the two nearly
-- agree (4.39 vs 4.19 ac at 4325 Hwy 92); on a dense one the difference is the
-- whole parking lot - 100 Railroad Ave has 6.54 acres of yard but only 2.26 that
-- earn anything on top of the building.
alter table properties drop column if exists net_usable_acres;

alter table properties
  add column net_usable_acres numeric
  generated always as (
    case
      when coalesce(usable_acres, land_acres) is null then null
      else round(greatest(0,
             coalesce(usable_acres, land_acres)
             - coalesce(gross_sf, heated_sf, 0)::numeric
               / greatest(coalesce(stories, 1), 1)::numeric
               / 43560), 2)
    end
  ) stored;

comment on column properties.net_usable_acres is
  'Uplands minus the building footprint - the dirt actually available to use, in acres. Generated. NOT the valuation''s excess_acres, which additionally removes the parking/apron already covered by the building''s own $/SF comp.';
