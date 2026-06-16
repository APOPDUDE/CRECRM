-- The landlord board reads pursuits directly by property_id (usePropertyMatches),
-- so the convenience view is redundant. Drop it.
drop view if exists public.v_listing_pursuits;
