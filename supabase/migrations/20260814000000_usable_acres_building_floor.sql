-- A building stands on dry ground.
--
-- Extending the county land lines to Sarasota/Polk/Pinellas/Pasco surfaced a
-- contradiction that Hillsborough alone had mostly hidden: **178 properties came
-- out with ZERO usable acres while carrying a building over 1,000 SF**. Polk calls
-- the whole of 428 Recker Hwy lowlands (16.61 submerged + 303.32 "Low acres" =
-- all 319.93 acres), and NWI does the same on others. Whatever the appraiser
-- writes on the roll, the footprint under a standing building is not swamp.
--
-- So `usable_acres` is floored at the building footprint. This is not a fudge:
-- either source over-claiming past the footprint is a mapping artefact, and
-- letting it through drives the valuation's land component to zero and collapses
-- the estimate to bare building value.
--
-- `net_usable_acres` (uplands MINUS footprint) is unaffected in spirit - it still
-- reaches 0 on a fully-covered site, which is correct: no yard left over.
alter table properties drop column if exists net_usable_acres;
alter table properties drop column if exists usable_acres;

alter table properties
  add column usable_acres numeric
  generated always as (
    case
      when land_acres is null then null
      else least(
             land_acres,
             greatest(
               -- the ground the building occupies is dry, by definition
               coalesce(gross_sf, heated_sf, 0)::numeric / 43560::numeric,
               round(land_acres - greatest(coalesce(wet_acres_nwi, 0::numeric),
                                           coalesce(lowlands_acres_county, 0::numeric)), 2)
             ))
    end
  ) stored;

alter table properties
  add column net_usable_acres numeric
  generated always as (
    case
      when land_acres is null then null
      else round(greatest(0::numeric,
             least(
               land_acres,
               greatest(
                 coalesce(gross_sf, heated_sf, 0)::numeric / 43560::numeric,
                 round(land_acres - greatest(coalesce(wet_acres_nwi, 0::numeric),
                                             coalesce(lowlands_acres_county, 0::numeric)), 2)
               ))
             - coalesce(gross_sf, heated_sf, 0)::numeric / 43560::numeric), 2)
    end
  ) stored;

comment on column properties.usable_acres is
  'Upland (dry) acreage = land_acres minus the HARSHER of NWI wetland and the county''s own lowlands land lines, floored at the building footprint because a standing building is not on swamp. Generated.';
comment on column properties.net_usable_acres is
  'Uplands minus the building footprint - the dirt actually available to use, in acres. Generated. 0 on a fully-covered site is correct: no yard left.';
