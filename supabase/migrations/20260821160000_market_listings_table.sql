-- market_listings: a listing is its own record, not a column on the building.
--
-- Why (Alex, 2026-08-21). Today one scraped property row IS one market listing:
-- properties.source_key = 'loopnet:{listingId}' (verified -- 2,797 of 2,827 scraped
-- properties carry a source_key whose number equals the id in their asking comp's
-- listing_url). So a re-list overwrites the previous one, two concurrent listings on the
-- same building become two "properties", and listing_status / last_seen_in_sweep answer
-- per BUILDING when the sweep actually observes per LISTING.
--
-- Measured on azzouzana/loopnet-scraper output the same day (Pinellas, 852 rows):
--   700 for-lease rows -> 676 distinct LoopNet propertyId. 23 buildings carry 2-3 live
--   listings (direct + sublease). So the fan-out is real but small (~1.04x), NOT the ~2.8x
--   that a "600 rows vs 216 properties" reading suggests -- the rest of that gap is breadth:
--   the industrial-properties SRP also returns Office (223), Retail (141), Multifamily (15)
--   etc., which the mapper filters out. This table exists for the 23, and for history.
--
-- What stays put: properties.listing_status. 88,171 non-scraped properties (the county
-- book) carry it, twelve app call sites read it, and property-detail lets a human set it by
-- hand. It stays on properties as the building-level ROLLUP, maintained from
-- market_listings by the sweep. market_listings.status is the per-listing truth.
--
-- Keyed to property_id, never to a parcel: 947 of 3,541 scraped properties (26.7%) have no
-- parcel at all -- parcel arrives later from appraiser matching, so a parcel FK would reject
-- a quarter of listings.

-- ---------------------------------------------------------------- properties: building id
-- LoopNet's propertyId is the BUILDING; listingId is the listing. The old actor only ever
-- gave us the listing id, so we have no building id on file. Learn it from the sweep and
-- the same building stops minting a new property row every time it re-lists.
alter table public.properties
  add column if not exists loopnet_property_id bigint;

create unique index if not exists properties_loopnet_property_id_uq
  on public.properties (loopnet_property_id)
  where loopnet_property_id is not null;

comment on column public.properties.loopnet_property_id is
  'LoopNet building id (their propertyId), learned from the sweep. Distinct from the listing '
  'id in source_key. Resolution order in import_scraped_listings: this, then '
  'source_key = loopnet:{listingId}, then create.';

-- --------------------------------------------------------------------- market_listings
create table if not exists public.market_listings (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references public.properties(id) on delete cascade,
  source            text not null default 'loopnet',
  source_listing_id text not null,
  listing_type      deal_type not null,
  status            listing_market_status not null default 'on_market',
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  off_market_at     timestamptz,
  asking_rate_psf   numeric(12,2),
  asking_price      numeric(14,2),
  cap_rate_pct      numeric(6,3),
  sqft              integer,
  broker_name       text,
  broker_company    text,
  url               text,
  raw               jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint market_listings_source_listing_uq unique (source, source_listing_id),
  -- deal_type carries 'both' for our own brokerage deals; a market listing is one or the other.
  constraint market_listings_type_is_lease_or_sale
    check (listing_type in ('lease','sale')),
  constraint market_listings_off_market_has_date
    check (status <> 'off_market' or off_market_at is not null)
);

create index if not exists market_listings_property_idx  on public.market_listings (property_id);
create index if not exists market_listings_last_seen_idx on public.market_listings (last_seen_at);
create index if not exists market_listings_status_idx    on public.market_listings (status)
  where status = 'on_market';

comment on table public.market_listings is
  'One row per market listing observed by the sweep (LoopNet/Crexi), hanging off property_id. '
  'The per-listing lifecycle -- first_seen_at, last_seen_at, status -- lives here; '
  'properties.listing_status is the building-level rollup maintained from these rows.';
comment on column public.market_listings.source_listing_id is
  'The source''s own listing id, bare (no "loopnet:" prefix). For LoopNet this is listingId, '
  'the same id space as the legacy properties.source_key suffix.';
comment on column public.market_listings.raw is
  'The source row as returned, for reprocessing without a re-scrape.';

drop trigger if exists market_listings_updated_at on public.market_listings;
create trigger market_listings_updated_at
  before update on public.market_listings
  for each row execute function public.set_updated_at();

alter table public.market_listings enable row level security;

drop policy if exists market_listings_auth_all on public.market_listings;
create policy market_listings_auth_all on public.market_listings
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.market_listings to authenticated, service_role;

-- ------------------------------------------------------------------------------ backfill
-- Every scraped property becomes exactly one listing, carrying its current lifecycle state.
-- Scope deliberately matches what the sweep touches, including the 578 parcel-keyed scraped
-- rows -- drop them and they fall out of the off-market diff.
insert into public.market_listings (
  property_id, source, source_listing_id, listing_type, status,
  first_seen_at, last_seen_at, off_market_at,
  asking_rate_psf, asking_price, cap_rate_pct, sqft,
  broker_name, broker_company, url)
select
  p.id,
  case when p.source_key like 'loopnet:%' then 'loopnet'
       when p.source_key like 'crexi:%'   then 'crexi'
       else 'scrape' end,
  case when p.source_key like 'loopnet:%' then substring(p.source_key from 9)
       when p.source_key like 'crexi:%'   then substring(p.source_key from 7)
       else p.source_key end,
  -- The latest asking comp knows which side this listing was; fall back on which price it carries.
  coalesce(
    nullif(ask.deal_type, 'both'),
    (case when ask.asking_lease_rate_psf is not null then 'lease' else 'sale' end)::deal_type
  ),
  p.listing_status,
  coalesce(p.scraped_at, p.created_at),
  coalesce(p.last_seen_in_sweep, p.scraped_at, p.created_at),
  case when p.listing_status = 'off_market'
       then coalesce(p.last_seen_in_sweep, p.updated_at) end,
  ask.asking_lease_rate_psf, ask.sale_price, ask.cap_rate_pct, ask.sf,
  ask.broker_name, ask.broker_company, ask.listing_url
from public.properties p
left join lateral (
  select c.deal_type, c.asking_lease_rate_psf, c.sale_price, c.cap_rate_pct, c.sf,
         c.broker_name, c.broker_company, c.listing_url
  from public.comps c
  where c.property_id = p.id and c.kind = 'asking'
  order by c.as_of_date desc nulls last, c.created_at desc
  limit 1
) ask on true
where p.source = 'scrape'
  and p.source_key is not null
on conflict (source, source_listing_id) do nothing;
