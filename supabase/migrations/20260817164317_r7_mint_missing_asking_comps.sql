-- R7 gap-close: an asking comp for every property that was ever a listing but
-- has NO asking comp to show for it.
--
-- Two classes, both scrape-side:
--   1. Pre-R7 "rate Upon Request" listings — priced listings created comps,
--      unpriced created NOTHING (the 2026-07-27 gap), so their listing-event
--      facts exist only as properties.* columns today. The 20260816013359
--      backfill filled event fields onto EXISTING comps only.
--   2. Claim-path/edge rows carrying listed_at (the importer stamps it on every
--      scrape insert) with no comp.
-- Without this, repointing v_property_owner_context's was_on_market off
-- p.listed_at (and later dropping the columns) would silently forget these
-- properties were ever on the market.
--
-- Idempotent: source_key 'r7drop:<property id>' inserts once. deal_type 'sale'
-- mirrors the importer's unpriced rule (no rate => sale). as_of_date = the
-- listing date we actually have. Fill-only; no existing comp is touched.
-- kind='asking' rows are excluded from all valuation/market math only by
-- rate/price presence — these carry none, so they weight nothing.
-- APPLY-TIME CHECK: comps.source carries the 20260816014956 provenance CHECK —
-- confirm 'county_appraiser' is in its vocabulary (claim-path rows keep
-- p.source='county_appraiser'); if not, fold those to 'scrape' here.

-- ⚠️ title does NOT qualify a row and is NOT dropped: import_county_parcels
-- mints county rows with the operating BUSINESS name in properties.title
-- (2,768 rows, e.g. "MARLIN JAMES AIR CONDITIONING" on a parcel:hillsborough
-- source_key) — a durable fact about the place, not a listing event. Rows that
-- qualify via real event signals still carry their title into listing_title
-- (on those rows it is a scrape's listing headline).
insert into comps (
  property_id, source, source_key, deal_type, kind, as_of_date,
  listing_url, broker_name, broker_company, broker_phone, broker_email,
  days_on_market, listed_at, listing_title, sale_conditions, sale_status,
  sale_type, is_auction, occupancy, source_last_updated
)
select
  p.id, coalesce(p.source, 'scrape'), 'r7drop:' || p.id, 'sale'::deal_type,
  'asking'::comp_kind,
  coalesce(p.listed_at, p.scraped_at::date, p.created_at::date),
  p.listing_url, p.broker_name, p.broker_company, p.broker_phone, p.broker_email,
  p.days_on_market, p.listed_at,
  case when p.scraped_at is not null or p.listing_url is not null then p.title end,
  p.sale_conditions, p.sale_status::text,
  p.sale_type, p.is_auction, p.occupancy, p.source_last_updated
from properties p
where not exists (
        select 1 from comps c
        where c.property_id = p.id and c.kind = 'asking'
      )
  and not exists (select 1 from comps c2 where c2.source_key = 'r7drop:' || p.id)
  and (p.listing_url is not null or p.broker_name is not null
       or p.broker_company is not null or p.broker_phone is not null
       or p.broker_email is not null or p.days_on_market is not null
       or p.sale_conditions is not null
       or p.sale_status is not null or p.sale_type is not null
       or p.is_auction is not null or p.occupancy is not null
       or p.source_last_updated is not null
       or p.listed_at is not null);
