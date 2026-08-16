-- Alex (2026-08-16): "why is IG zoning not included in the industrial zoning type" -
-- because the auto-classifier filed City of Tampa's IG (466 properties) as
-- planned_development. In Tampa's code IG is Industrial General (IH's lighter
-- sibling). Reclassify + re-type the book. Also Oldsmar's M-1 description was seeded
-- as the literal code (the city layer is code-only), which made the property page
-- read "M-1 - M-1"; it is Light Industrial.
update zoning_code_map
set zoning_type = 'industrial', allows_industrial = true,
    description = 'Industrial General', verified = true
where jurisdiction = 'City of Tampa' and code = 'IG';

update zoning_code_map
set description = 'Light Industrial', verified = true
where jurisdiction = 'City of Oldsmar' and code = 'M-1';

select apply_zoning_map();
