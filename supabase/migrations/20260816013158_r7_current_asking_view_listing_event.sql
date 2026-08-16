-- R7: v_property_current_asking also exposes the listing-event fields of the
-- latest asking comp per property x deal_type. Existing columns keep their
-- names, types and positions (v_county_market_stats and
-- v_property_market_position select from this view); the event columns are
-- APPENDED, so CREATE OR REPLACE suffices — no drop, grants untouched.

create or replace view public.v_property_current_asking as
select distinct on (property_id, deal_type)
  property_id,
  deal_type,
  asking_lease_rate_psf,
  sale_price,
  cap_rate_pct,
  sf,
  as_of_date,
  id as comp_id,
  listing_url,
  broker_name,
  broker_company,
  broker_phone,
  broker_email,
  days_on_market,
  listed_at,
  listing_title,
  listing_description,
  sale_conditions,
  sale_status,
  sale_type,
  is_auction,
  occupancy,
  source_last_updated
from comps
where kind = 'asking'::comp_kind
order by property_id, deal_type, as_of_date desc nulls last, created_at desc;
