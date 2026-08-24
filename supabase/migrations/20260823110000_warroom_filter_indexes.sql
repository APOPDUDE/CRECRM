-- Applied 2026-08-23 via MCP execute_sql, one statement at a time (CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction, and apply_migration wraps in one).
-- This file is the record. Verify afterwards with:
--   select indexrelid::regclass from pg_index where not indisvalid;   -- expected: none
--
-- The index foundation for filter-first War Room reads. Each one is here because a
-- measurement said so; the before/after numbers are the point of this file.
--
-- ---------------------------------------------------------------------------
-- 1. properties_industrial_book_idx -- the missing half of the book pair
-- ---------------------------------------------------------------------------
-- The land book has had `properties_land_book_idx (id) where in_land_book` since
-- 20260821121000. The industrial book had no counterpart, so `not land_only` was a
-- sequential scan while `in_land_book` was an index scan -- the normal, default book was
-- the slow one.
--
--   select count(*) from properties where not land_only;   3,739 ms  ->  8 ms
--   (34,643 rows; the land equivalent was already 817 ms)
--
-- ---------------------------------------------------------------------------
-- 2/3. properties_{ind,land}_addr_idx -- the table's sort order
-- ---------------------------------------------------------------------------
-- The table sorts by the DISPLAYED address, which is coalesce(site_address, address)
-- (county situs wins -- see reference-county-parcel-identity). Nothing indexed that
-- expression, so page 1 of the table was a full sort of the book:
--
--   order by coalesce(site_address, address), id limit 100    3,324 ms  ->  13 ms
--
-- `id` is the tiebreak so the ordering is total: without it two properties sharing an
-- address can swap between page requests and a row appears twice or not at all.
--
-- WORTH KNOWING: this also rehabilitates OFFSET paging. Project memory records that deep
-- OFFSET over properties times out, and it did -- but that was OFFSET over an UNINDEXED
-- sort, where every page re-sorted the book. With the expression indexed:
--
--   offset  5,000 limit 100      6 ms
--   offset 20,000 limit 100     46 ms
--
-- So the War Room pager does not need keyset pagination, and can keep "Page 7 of 346".
-- (Both numbers are warm. Cold, straight after the build, the same query was 8,107 ms --
-- when timing anything on this instance, run it twice.)

create index concurrently if not exists properties_industrial_book_idx
  on public.properties (id) where not land_only;

create index concurrently if not exists properties_ind_addr_idx
  on public.properties (coalesce(site_address, address), id) where not land_only;

create index concurrently if not exists properties_land_addr_idx
  on public.properties (coalesce(site_address, address), id) where in_land_book;

comment on index public.properties_industrial_book_idx is
  'The industrial book (not land_only). Counterpart to properties_land_book_idx -- without '
  'it a bare industrial book count is a 3.7s sequential scan.';
comment on index public.properties_ind_addr_idx is
  'The table view''s sort order for the industrial book: coalesce(site_address, address) '
  'with id as total-order tiebreak. Also what makes OFFSET paging affordable again.';
comment on index public.properties_land_addr_idx is
  'As properties_ind_addr_idx, for the land book.';
