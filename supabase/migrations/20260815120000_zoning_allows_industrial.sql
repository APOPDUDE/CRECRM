-- A zoning code can be two things at once: Hillsborough's CG/CI are commercial districts
-- that also permit industrial uses, Polk's BPC is a business park that swings both ways
-- (Alex 2026-08-15). Rather than turn zoning_type into an array, the map carries the one
-- second question the business actually asks: can industrial go here?
--
-- The app-facing rule: "zoned industrial" = allows_industrial, which is true for every
-- code whose primary type IS industrial plus the named crossover codes.

alter table zoning_code_map add column allows_industrial boolean not null default false;

update zoning_code_map set allows_industrial = true where zoning_type = 'industrial';

update zoning_code_map set allows_industrial = true, verified = true
where (jurisdiction = 'Hillsborough County' and code in ('CG', 'CI'))
   or (jurisdiction = 'Polk County' and code like 'BPC%');

-- BPC verified as industrial-primary too, per the same call
update zoning_code_map set verified = true
where jurisdiction = 'Polk County' and code like 'BPC%';
