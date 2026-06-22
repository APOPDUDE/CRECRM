-- County property-appraiser enrichment fields (filled by the enrich-appraiser edge
-- function from the 6 Tampa-area counties' public ArcGIS REST services, keyed by parcel ID).
-- Existing scraped columns (lat/lng, building_sf, year_built, land_acres, zoning_description)
-- are backfilled only when null; these new columns hold appraiser-authoritative extras.
alter table public.properties
  add column if not exists owner_name text,
  add column if not exists owner_mailing_address text,
  add column if not exists just_value numeric(14,2),
  add column if not exists assessed_value numeric(14,2),
  add column if not exists dor_use_code text,
  add column if not exists appraiser_data jsonb,
  add column if not exists appraiser_updated_at timestamptz;

-- Lets the enrich job cheaply find what still needs a pass.
create index if not exists properties_appraiser_pending_idx
  on public.properties (appraiser_updated_at)
  where appraiser_updated_at is null;
