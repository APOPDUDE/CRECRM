-- The map row learns zoning (and the raw county use code).
--
-- The UI's two-axis filter — USE (what the county records it as) × ZONING (what it is
-- allowed to become) — needs both on every row the map and search return. dor_use_code
-- rides along because property_type is too coarse for the refinements Alex runs
-- ("single family home but zoned industrial"): the bucket for that lives client-side
-- off the raw code. Columns are appended, which CREATE OR REPLACE VIEW permits.

create or replace view v_map_property
with (security_invoker = true) as
select
  p.id,
  coalesce(p.site_address, p.address) as address,
  p.address as source_address,
  p.city, p.state, p.zip, p.county, p.parcel_number, p.site_address, p.folio,
  p.property_type, p.gross_sf, p.land_acres, p.specs, p.listing_status,
  p.days_on_market, p.year_built, p.zoning_description, p.zoning_district,
  p.occupancy, p.lat, p.lng, p.owner_id, p.owner_name, p.owner_mailing_address,
  p.last_sale_date, p.last_sale_price, p.listing_url, p.created_at, p.updated_at,
  (select count(*) from listings l where l.property_id = p.id) as listing_count,
  (select count(*) from pursuits pu where pu.property_id = p.id) as pursuit_count,
  p.zoning_type, p.zoning_code, p.zoning_jurisdiction, p.dor_use_code
from properties p;
