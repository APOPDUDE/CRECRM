-- Enrich properties with the (non-redundant) Apify summary fields + the parcel
-- number that becomes the canonical dedupe key. Redundant summary fields
-- (buildingSize/price/lotSize/propertyType) are intentionally NOT added — we
-- already keep the parsed numerics (building_sf, asking_price, land_acres, property_type).
alter table public.properties
  add column if not exists parcel_number       text,
  add column if not exists title               text,
  add column if not exists property_sub_types  text[],
  add column if not exists building_class      text,
  add column if not exists parking_ratio       text,
  add column if not exists year_built          integer,
  add column if not exists year_renovated      integer,
  add column if not exists stories             integer,
  add column if not exists num_units           integer,
  add column if not exists gross_leasable_area text,
  add column if not exists construction_status text,
  add column if not exists sale_conditions     text,
  add column if not exists occupancy           text,
  add column if not exists on_ground_lease     boolean,
  add column if not exists zoning_district     text,
  add column if not exists zoning_description  text,
  add column if not exists sale_status         integer,
  add column if not exists sale_type           text,
  add column if not exists building_far        text,
  add column if not exists opportunity_zone    boolean,
  add column if not exists is_auction          boolean,
  add column if not exists source_last_updated date;

create index if not exists properties_parcel_number_idx on public.properties(parcel_number) where parcel_number is not null;
