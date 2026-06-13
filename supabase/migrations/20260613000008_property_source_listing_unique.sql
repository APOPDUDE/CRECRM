-- Idempotent upserts of scraped listings (n8n/Apify import). Dedupe key is a
-- namespaced source_listing_id like 'crexi:834014' / 'loopnet:40865556' so the
-- two platforms can never collide. Partial, so manually-entered properties
-- (source_listing_id null) are unaffected and can repeat freely.
create unique index if not exists properties_source_listing_uq
  on properties (source_listing_id)
  where source_listing_id is not null;
