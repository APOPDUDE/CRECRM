-- Applied 2026-08-24 via MCP.
--
-- The plain land-book table is now served a page at a time (usePagedLandBook),
-- ordered by address. Without this, ORDER BY address LIMIT 100 under
-- in_land_book would sort 100k rows for every page view; with it, each page is
-- a partial-index range scan.

begin;

create index if not exists properties_land_book_address_idx
  on properties (address)
  where in_land_book;

comment on index properties_land_book_address_idx is
  'Serves the paged land-book table (usePagedLandBook): ORDER BY address LIMIT n as an index scan.';

commit;
