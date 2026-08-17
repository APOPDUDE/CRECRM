-- R7 repoint: v_map_property's three listing-event outputs (days_on_market,
-- occupancy, listing_url) now come from the property's asking comps — newest
-- first, first non-null wins per field, exactly the merge the app's
-- useCurrentListingEvent performs. Column NAMES, types and ORDER are unchanged
-- (map_properties / search_map_properties to_jsonb these rows and the deployed
-- bundle reads the keys), so CREATE OR REPLACE suffices.
--
-- Behavior-identical while the dual-write lives: the importer writes both
-- sides, and the 20260816013359 + 20260816090000 backfills seeded the comps
-- from the property columns. This is the step that lets the columns drop.

create or replace view public.v_map_property
with (security_invoker = true) as
 SELECT p.id,
    COALESCE(p.site_address, p.address) AS address,
    p.address AS source_address,
    p.city,
    p.state,
    p.zip,
    p.county,
    p.parcel_number,
    p.site_address,
    p.folio,
    p.property_type,
    p.gross_sf,
    p.land_acres,
    p.specs,
    p.listing_status,
    ask.days_on_market,
    p.year_built,
    p.zoning_description,
    p.zoning_district,
    ask.occupancy,
    p.lat,
    p.lng,
    p.owner_company_id,
    p.owner_name,
    p.owner_mailing_address,
    p.last_sale_date,
    p.last_sale_price,
    ask.listing_url,
    p.created_at,
    p.updated_at,
    ( SELECT count(*) AS count
           FROM listings l
          WHERE l.property_id = p.id) AS listing_count,
    ( SELECT count(*) AS count
           FROM pursuits pu
          WHERE pu.property_id = p.id) AS pursuit_count,
    p.zoning_type,
    p.zoning_code,
    p.zoning_jurisdiction,
    p.dor_use_code
   FROM properties p
   LEFT JOIN LATERAL (
     SELECT (array_remove(array_agg(c.days_on_market ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), null))[1] AS days_on_market,
            (array_remove(array_agg(c.occupancy      ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), null))[1] AS occupancy,
            (array_remove(array_agg(c.listing_url    ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), null))[1] AS listing_url
     FROM comps c
     WHERE c.property_id = p.id AND c.kind = 'asking'::comp_kind
   ) ask ON true;
