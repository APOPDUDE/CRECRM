-- The last remnant of the owners table: properties.owner_id (dead orphan, FK already dropped).
-- Held one deploy because the prior live bundle selected it; bundle index-vUr6olo0 no longer does.
-- v_map_property was its only remaining dependent - re-created with owner_company_id in its place
-- (same slot purpose: the map row's owner key, now the company id). security_invoker preserved.
-- Verified after apply: map_properties RPC returns rows carrying owner_company_id; war room 658.
drop view v_map_property;
alter table properties drop column owner_id;
create view v_map_property with (security_invoker = true) as
 SELECT id,
    COALESCE(site_address, address) AS address,
    address AS source_address,
    city,
    state,
    zip,
    county,
    parcel_number,
    site_address,
    folio,
    property_type,
    gross_sf,
    land_acres,
    specs,
    listing_status,
    days_on_market,
    year_built,
    zoning_description,
    zoning_district,
    occupancy,
    lat,
    lng,
    owner_company_id,
    owner_name,
    owner_mailing_address,
    last_sale_date,
    last_sale_price,
    listing_url,
    created_at,
    updated_at,
    ( SELECT count(*) AS count
           FROM listings l
          WHERE l.property_id = p.id) AS listing_count,
    ( SELECT count(*) AS count
           FROM pursuits pu
          WHERE pu.property_id = p.id) AS pursuit_count,
    zoning_type,
    zoning_code,
    zoning_jurisdiction,
    dor_use_code
   FROM properties p;
grant select on v_map_property to authenticated;
grant select on v_map_property to anon;
grant select on v_map_property to service_role;
