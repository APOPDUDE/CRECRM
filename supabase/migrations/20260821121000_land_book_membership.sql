-- Applied 2026-08-21 via MCP, with Alex's same-day threshold calls: half-acre
-- floor, residential IN via just-land / 5%-ratio arms only.
--
-- The land book (Alex, 2026-08-21): a second War Room for sourcing developer
-- land, separate from the industrial book "so it doesn't slow the normal book."
-- Membership is a DB rule, not a UI filter (foundation rule #1): both pages,
-- every RPC, and n8n must agree on which book a parcel belongs to.
--
-- The rule, in Alex's words and thresholds:
-- * "properties that are a lot of land and very little building, like anything
--   5% building to land ratio — those can be on the land book AND the normal
--   property book"  -> a real building with building-to-land ratio <= 0.05
--   puts a row on BOTH books.
-- * "properties that are just land will only be on the land book"
--   -> COUNTY-KNOWN vacant (< 1,000 SF on county-synced building facts) means
--      land_only: the normal book's fetch will exclude these rows (frontend
--      change lands with the land book page, not here). County-synced is
--      load-bearing twice over: gross_sf NULL means UNKNOWN, not vacant, and
--      a scraped/manual 0 is the exact garbage 20260814100000 documented
--      (scraped SF wrong 59% of the time, 1,059 rows carrying gross_sf = 0)
--      — neither may evict a possibly-real warehouse from the normal book.
--      Building size is greatest(gross_sf, heated_sf): a stray 0 in one
--      column must not shadow a real figure in the other.
-- * DOR land classes ride in regardless of the building test: 00 vacant
--   residential, 10 vacant commercial, 40 vacant industrial, 50-69
--   agricultural, 70 vacant institutional, 99 acreage.
-- * Residential is IN (Alex 2026-08-21: "that's where we can find some
--   opportunities... but only land or the 5% ratio") — vacant residential
--   (00) via its DOR class, improved residential (01-09) only via the <=5%
--   ratio arm (a real recorded building on acreage: the teardown play).
--   The later move is filtering land-book residential by FLU-industrial /
--   zoned-industrial once enrichment lands FLU.
-- * Condo units stay out: a warehouse-condo unit carries the parent complex's
--   land_acres (8180 Uzita Dr: 2,655 SF unit "on" 30 ac -> 0.2% BLR), so
--   without the guard 636 units flood in — the exact pin-flood
--   refresh_condo_units() exists to stop.
-- * Half-acre floor on everything (Alex 2026-08-21): below that it isn't
--   developer land. One constant below if the answer ever changes.
--
-- Stamped by refresh_land_book(), same contract as refresh_condo_units():
-- self-healing in both directions, call it after county-parcel imports land
-- new rows. land_acres is county truth (trigger-protected), so the flags only
-- move when the county data does.

begin;

alter table properties
  add column if not exists in_land_book boolean not null default false,
  add column if not exists land_only boolean not null default false;

comment on column properties.in_land_book is
  'Member of the land book (developer-land War Room). DOR land class (00/10/40/50-69/70/99), '
  'county-known-vacant, or building-to-land ratio <= 5% — half-acre floor, condo units '
  'always excluded. Set by refresh_land_book().';
comment on column properties.land_only is
  'In the land book as just-land (county-known-vacant, or DOR land class with no recorded '
  'building): shown ONLY there — the normal book''s fetch excludes these rows. <= 5% '
  'ratio rows with a real building stay on both books.';

-- The land book page does its own lazy uuid-bucket fetch filtered in_land_book,
-- so the partial index mirrors the book-fetch access path (keyset on id).
create index if not exists properties_land_book_idx
  on properties (id) where in_land_book;

-- ---------------------------------------------------------------------------
-- dor_class(): the normalized 2-3 digit FDOR class as an int, for rules that
-- need the class itself rather than property_kind_from_dor()'s bucket.
-- EXACTLY the same width rule as property_kind_from_dor / dorInt() in
-- src/lib/zoning.ts (verified against the FDOR NAL roll, 20260815211841):
-- digits only; <=3 digits verbatim; exactly 4 = first TWO; 5+ = first THREE.
-- Keep all three in lockstep.
-- ---------------------------------------------------------------------------

create or replace function dor_class(p_code text)
returns integer
language sql
immutable
set search_path = public
as $$
  with c as (
    select regexp_replace(coalesce(p_code, ''), '\D', '', 'g') as d
  )
  select case
    when d = '' then null
    when length(d) <= 3 then d::int
    when length(d) = 4 then left(d, 2)::int
    else left(d, 3)::int
  end
  from c;
$$;

comment on function dor_class(text) is
  'County CAMA/FDOR use code -> normalized DOR class int (48, 10, 99...). Same width rule '
  'as property_kind_from_dor and dorInt() in src/lib/zoning.ts — keep in lockstep.';

grant execute on function dor_class(text) to authenticated, service_role;
revoke execute on function dor_class(text) from anon, public;

-- ---------------------------------------------------------------------------
-- refresh_land_book(): recompute both flags for the whole book, both
-- directions. Returns a jsonb tally so import runbooks can log it.
-- ---------------------------------------------------------------------------

create or replace function refresh_land_book() returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_changed int;
  v_in int;
  v_only int;
begin
  with calc as (
    select id,
      is_condo_unit,
      dor_class(dor_use_code) as dc,
      land_acres,
      -- greatest(), not coalesce-first: a stray 0 in gross_sf must not
      -- shadow a real heated_sf.
      greatest(coalesce(gross_sf, 0), coalesce(heated_sf, 0)) as bldg_sf,
      -- Vacancy is a COUNTY claim only (county_synced_at gates it): NULL SF
      -- is unknown, and scraped/manual SF — 0 included — is the documented
      -- garbage 20260814100000 refuses. Neither is evidence of vacancy.
      county_synced_at is not null
        and greatest(coalesce(gross_sf, 0), coalesce(heated_sf, 0)) < 1000
        as known_vacant
    from properties
  ),
  target as (
    select id, known_vacant,
      -- 00 vacant residential rides with the land classes (improved
      -- residential 01-09 has no land class — it can only enter via the
      -- ratio arm, i.e. with a real recorded building)
      dc in (0, 10, 40, 70, 99) or dc between 50 and 69 as dor_land,
      bldg_sf,
      coalesce(
        land_acres >= 0.5
        and not is_condo_unit
        and (
          dc in (0, 10, 40, 70, 99)
          or dc between 50 and 69
          or known_vacant
          -- the ratio arm needs a REAL building: with none, blr is 0 and
          -- would smuggle in every parcel the vacant arm rightly rejected
          or (bldg_sf >= 1000
              and land_acres > 0
              and bldg_sf / (land_acres * 43560.0) <= 0.05)
        ), false) as want_in
    from calc
  ),
  final as (
    select id, want_in,
      -- "just land": county-known-vacant, or a DOR land class with no
      -- recorded building contradicting it (DOR is county evidence itself).
      want_in and (known_vacant or (coalesce(dor_land, false) and bldg_sf < 1000))
        as want_only
    from target
  )
  update properties p
  set in_land_book = f.want_in,
      land_only    = f.want_only
  from final f
  where p.id = f.id
    and (p.in_land_book is distinct from f.want_in
         or p.land_only is distinct from f.want_only);

  get diagnostics v_changed = row_count;
  select count(*) filter (where in_land_book),
         count(*) filter (where land_only)
    into v_in, v_only
  from properties;

  return jsonb_build_object(
    'changed', v_changed, 'in_land_book', v_in, 'land_only', v_only);
end $$;

comment on function refresh_land_book() is
  'Recompute in_land_book/land_only for the whole book, both directions (self-healing). '
  'Call after county-parcel imports, like refresh_condo_units(). Thresholds: half-acre '
  'floor, 1,000 SF building line (county-synced facts only), 5% building-to-land ratio, '
  'DOR land classes 00/10/40/50-69/70/99; condo units always excluded; improved '
  'residential (01-09) enters only via the ratio arm.';

grant execute on function refresh_land_book() to authenticated, service_role;
revoke execute on function refresh_land_book() from anon, public;

-- ---------------------------------------------------------------------------
-- Land-book DOR picker options. category stays untouched (040 must keep riding
-- with industrial on the normal book's picker) — land is a second axis, not a
-- recategorization.
-- ---------------------------------------------------------------------------

alter table dor_codes
  add column if not exists land_class boolean not null default false;

comment on column dor_codes.land_class is
  'Appears in the LAND book''s DOR picker. Orthogonal to category: 040 stays industrial '
  'for the normal book AND land_class for the land book.';

update dor_codes set land_class = true
where code in ('000','010','040','070','099')
   or code between '050' and '069';

-- Stamp the whole book now — without this, every row keeps the column
-- defaults and the land book opens empty despite qualifying rows.
select refresh_land_book();

commit;
