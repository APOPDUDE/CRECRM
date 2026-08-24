-- Applied 2026-08-22 via MCP execute_sql (NOT apply_migration — see below).
--
-- `useGeocodeMissing` (src/hooks/use-properties.ts) runs on every War Room mount, in
-- both views, and asks one question: "give me 25 properties with no coordinates".
-- There was no index that could answer it. `properties_lat_lng_idx` is partial ON
-- `lat is not null`, i.e. precisely the complement, so the planner had nothing to use
-- and fell back to a sequential scan of the whole 123 MB table.
--
-- Measured as `authenticated` on 2026-08-22, with the book at 127,007 rows:
--   select id from properties where lat is null and address is not null
--     and address not ilike '%unavailable%' and address not ilike 'Portfolio of %'
--     limit 25;                                          -->  7,439 ms
-- That is a background chore for at most 25 rows, fired on every page load, landing
-- within 600 ms of the 8s statement timeout. It got slower every time the book grew;
-- the land import (17k -> 127k rows) is what brought it to the edge.
--
-- The predicate is `lat is null` alone rather than the full client predicate: the
-- address rules are two ILIKEs over a handful of survivors once the index has cut the
-- set, and keeping the index narrow means it stays valid if the placeholder wording
-- ever changes. Fewer than 5,000 rows qualify, so this index is tiny.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and
-- `apply_migration` wraps its payload in one. This file is the record; the statement
-- was executed on its own via execute_sql. After applying, verify no invalid index was
-- left behind by a cancelled build:
--   select indexrelid::regclass from pg_index where not indisvalid;

create index concurrently if not exists properties_needs_geocode_idx
  on public.properties (id)
  where lat is null;

comment on index public.properties_needs_geocode_idx is
  'Answers useGeocodeMissing''s "properties with no coordinates" batch query. Without '
  'it that query is a full scan of properties (7,439 ms at 127k rows, 2026-08-22) on '
  'every War Room mount. Drop it and the War Room gets slow again.';
