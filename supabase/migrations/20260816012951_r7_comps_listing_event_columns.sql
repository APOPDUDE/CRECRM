-- R7: listing-event data belongs on the comp, not the property.
-- The asking comp IS the listing event; these columns carry what a scrape
-- learns about the EVENT (url, broker, dates, sale terms). The matching
-- properties.* columns stay as a dual-write until the UI repoint deploys,
-- then drop in a later block. title/description are named listing_title/
-- listing_description here to avoid colliding with readers of comps.*.
-- properties.sale_status is integer (LoopNet numeric status code); on the
-- comp it is text carrying the raw payload value.

alter table public.comps
  add column listing_url text,
  add column broker_name text,
  add column broker_company text,
  add column broker_phone text,
  add column broker_email text,
  add column days_on_market integer,
  add column listed_at date,
  add column listing_title text,
  add column listing_description text,
  add column sale_conditions text,
  add column sale_status text,
  add column sale_type text,
  add column is_auction boolean,
  add column occupancy text,
  add column source_last_updated date;
