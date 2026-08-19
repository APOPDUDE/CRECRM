-- CG (Hillsborough Commercial - General) leaves the industrial crossover set
-- (Alex, 2026-08-19: "auto deselect CG in industrial zoning keep it in retail").
-- It rode with "zoned industrial" since the 2026-08-15 "can be both" call, but CG is
-- general commercial — retail strips — and was flooding industrial canvasses. CI
-- (Commercial - Intensive) stays a crossover.
--
-- Every consumer reads this row live — isZonedIndustrial (the Zoned filter), the
-- overlay layer buckets (shapes + code picker, via useIndustrialCrossovers), the
-- include/only unions, and the zoning library — so this one flip reclassifies the
-- app end to end. zoning_type is already 'retail', which is where CG now files.
update zoning_code_map
set allows_industrial = false
where jurisdiction = 'Hillsborough County' and code = 'CG';
