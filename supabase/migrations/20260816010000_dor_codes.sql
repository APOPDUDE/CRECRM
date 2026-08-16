-- War Room overhaul Phase 3: the DOR-code picker's data.
--
-- dor_codes: the FDOR standard land-use list (000-099), each with a SHORT
-- description and ONE of five general categories (industrial / office / retail /
-- multifamily / other) - Alex's "not all these crazy options" hover. Category
-- follows the app's working buckets: 040-049 industrial, plus 027 (auto
-- sales/repair/garages - his niche rides with industrial, same as isIndustrialUse);
-- 017-019 office; 010-016, 020-026, 028-039 retail; 003/008 multifamily.
--
-- v_county_dor_codes: every (county, dor_use_code) actually present in the book,
-- with counts - the picker lists values that do NOT normalize to a standard code
-- (county 4-digit variants like Sarasota 4804, Hillsborough 4830) as custom codes
-- with the county in italics, matching verbatim against that county's rows.
create table dor_codes (
  code text primary key,
  description text not null,
  category text not null check (category in ('industrial','office','retail','multifamily','other'))
);

alter table dor_codes enable row level security;
create policy dor_codes_auth_read on dor_codes for select to authenticated using (true);

insert into dor_codes (code, description, category) values
  ('000', 'Vacant residential', 'other'),
  ('001', 'Single family', 'other'),
  ('002', 'Mobile home', 'other'),
  ('003', 'Multifamily, 10+ units', 'multifamily'),
  ('004', 'Condominium', 'other'),
  ('005', 'Cooperative', 'other'),
  ('006', 'Retirement home', 'other'),
  ('007', 'Misc residential (camps, boarding homes)', 'other'),
  ('008', 'Multifamily, under 10 units', 'multifamily'),
  ('009', 'Residential common elements', 'other'),
  ('010', 'Vacant commercial', 'retail'),
  ('011', 'Store, one story', 'retail'),
  ('012', 'Mixed use: store + office/residential', 'retail'),
  ('013', 'Department store', 'retail'),
  ('014', 'Supermarket', 'retail'),
  ('015', 'Regional shopping center', 'retail'),
  ('016', 'Community shopping center', 'retail'),
  ('017', 'Office, one story', 'office'),
  ('018', 'Office, multi-story', 'office'),
  ('019', 'Professional services building', 'office'),
  ('020', 'Airport, terminal, pier, marina', 'retail'),
  ('021', 'Restaurant, cafeteria', 'retail'),
  ('022', 'Drive-in restaurant', 'retail'),
  ('023', 'Financial institution', 'retail'),
  ('024', 'Insurance company office', 'retail'),
  ('025', 'Repair shop (non-auto), laundry', 'retail'),
  ('026', 'Service station', 'retail'),
  ('027', 'Auto sales, repair, storage; garages', 'industrial'),
  ('028', 'Parking lot, mobile home park', 'retail'),
  ('029', 'Wholesale outlet, produce house', 'retail'),
  ('030', 'Florist, greenhouse', 'retail'),
  ('031', 'Drive-in theater, open stadium', 'retail'),
  ('032', 'Enclosed theater, auditorium', 'retail'),
  ('033', 'Nightclub, lounge, bar', 'retail'),
  ('034', 'Bowling alley, rink, pool hall', 'retail'),
  ('035', 'Tourist attraction, exhibit', 'retail'),
  ('036', 'Camp', 'retail'),
  ('037', 'Race track', 'retail'),
  ('038', 'Golf course, driving range', 'retail'),
  ('039', 'Hotel, motel', 'retail'),
  ('040', 'Vacant industrial', 'industrial'),
  ('041', 'Light manufacturing, machine shop, printing', 'industrial'),
  ('042', 'Heavy industrial, foundry, steel fab', 'industrial'),
  ('043', 'Lumber yard, sawmill', 'industrial'),
  ('044', 'Packing plant (fruit, vegetable, meat)', 'industrial'),
  ('045', 'Cannery, bottler, brewery, winery', 'industrial'),
  ('046', 'Food processing, bakery, candy', 'industrial'),
  ('047', 'Mineral processing, cement, refinery', 'industrial'),
  ('048', 'Warehousing, distribution, trucking terminal', 'industrial'),
  ('049', 'Open storage, junk yard, equipment yard', 'industrial'),
  ('050', 'Improved agriculture', 'other'),
  ('051', 'Cropland class I', 'other'),
  ('052', 'Cropland class II', 'other'),
  ('053', 'Cropland class III', 'other'),
  ('054', 'Timberland, site index 90+', 'other'),
  ('055', 'Timberland, site index 80-89', 'other'),
  ('056', 'Timberland, site index 70-79', 'other'),
  ('057', 'Timberland, site index 60-69', 'other'),
  ('058', 'Timberland, site index 50-59', 'other'),
  ('059', 'Timberland, not classified', 'other'),
  ('060', 'Grazing land class I', 'other'),
  ('061', 'Grazing land class II', 'other'),
  ('062', 'Grazing land class III', 'other'),
  ('063', 'Grazing land class IV', 'other'),
  ('064', 'Grazing land class V', 'other'),
  ('065', 'Grazing land class VI', 'other'),
  ('066', 'Orchard, grove, citrus', 'other'),
  ('067', 'Poultry, bees, fish, rabbits', 'other'),
  ('068', 'Dairy, feed lot', 'other'),
  ('069', 'Ornamentals, misc agriculture', 'other'),
  ('070', 'Vacant institutional', 'other'),
  ('071', 'Church', 'other'),
  ('072', 'Private school or college', 'other'),
  ('073', 'Private hospital', 'other'),
  ('074', 'Home for the aged', 'other'),
  ('075', 'Orphanage, charitable service', 'other'),
  ('076', 'Mortuary, cemetery', 'other'),
  ('077', 'Club, lodge, union hall', 'other'),
  ('078', 'Sanitarium, rest home', 'other'),
  ('079', 'Cultural organization', 'other'),
  ('080', 'Vacant governmental', 'other'),
  ('081', 'Military', 'other'),
  ('082', 'Forest, park, recreation area', 'other'),
  ('083', 'Public county school', 'other'),
  ('084', 'Public college', 'other'),
  ('085', 'Public hospital', 'other'),
  ('086', 'County-owned, other', 'other'),
  ('087', 'State-owned, other', 'other'),
  ('088', 'Federal-owned, other', 'other'),
  ('089', 'Municipal-owned, other', 'other'),
  ('090', 'Leasehold interest (gov land, private lessee)', 'other'),
  ('091', 'Utility, gas, electric, railroad', 'other'),
  ('092', 'Mining, petroleum, gas land', 'other'),
  ('093', 'Subsurface rights', 'other'),
  ('094', 'Right-of-way, street, ditch', 'other'),
  ('095', 'River, lake, submerged land', 'other'),
  ('096', 'Sewage, waste land, marsh, swamp', 'other'),
  ('097', 'Outdoor recreation, parkland', 'other'),
  ('098', 'Centrally assessed', 'other'),
  ('099', 'Acreage, not zoned agricultural', 'other');

create view v_county_dor_codes as
select county, dor_use_code as code, count(*)::int as property_count
from properties
where dor_use_code is not null and county is not null
group by 1, 2;
