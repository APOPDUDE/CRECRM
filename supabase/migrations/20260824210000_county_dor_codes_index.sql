-- Applied 2026-08-24 via MCP.
--
-- The DOR picker hung at "Loading codes…" (Alex). Its second query,
-- v_county_dor_codes, is a plain GROUP BY over properties — fine at the 27k-row
-- industrial book it was written against, but at 127k rows the planner's only
-- path was a seq scan of a 324 MB heap (multi-KB rows: appraiser_data et al).
-- On the small compute tier that blew past PostgREST's 8s statement timeout,
-- the client retried, and the picker never left its loading state.
--
-- A covering partial index matching the view's WHERE clause exactly gives the
-- planner an index-only GroupAggregate: ~4 MB read instead of 324 MB, immune to
-- heap bloat and to however large the book grows next.

begin;

create index if not exists properties_county_dor_idx
  on properties (county, dor_use_code)
  where dor_use_code is not null and county is not null;

comment on index properties_county_dor_idx is
  'Covering index for v_county_dor_codes (the DOR picker''s county-custom-code list): '
  'index-only group-by instead of a 324 MB seq scan.';

commit;
