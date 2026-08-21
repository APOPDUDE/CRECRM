# Land book + parcel enrichment — plan, adjustments, and what's missing

Alex's ask (2026-08-21): a separate **land book** War Room for sourcing developer land
(zoning overlay, land-specific DOR options, verified contact, last-sold, acres search,
on-market search, ≤5% building-to-land crossover rows on both books), Apify sweep
extended to land, and — the big one — an **enrichment pipeline** that adds utility and
site-constraint intelligence to every parcel, with a 0–100 developer suitability score.

This doc is the thinking. The concrete deliverables in this branch:

- `supabase/migrations/20260821120000_parcel_enrichment.sql` — **PROPOSAL, not applied**
- `supabase/migrations/20260821121000_land_book_membership.sql` — **PROPOSAL, not applied**
- `pipeline/` — the idempotent Python harvester (schema bootstrap, generic ArcGIS REST
  walker, endpoint discovery, parcel-polygon fetcher). Joins and scoring are deliberately
  **not** written yet, per "schema + harvester before joins."

---

## 1. Where this lands in the current system

Facts that shaped every decision below:

- `properties` **is** the parcel book (~32k rows — 31,978 as of 2026-08-17 — across the
  6 counties: Hillsborough, Pinellas, Pasco, Polk, Manatee, Sarasota). There is no
  separate parcels table.
- Parcel ids are resolvers, not keys: 104 duplicate (county, parcel) groups, 343
  comma-separated assemblage rows, ~20% of stored parcel numbers don't line up with
  county GIS keys. **Anything keyed "to parcel ID" must actually key to
  `properties.id` (uuid)** and treat the county parcel id as a lookup aid.
- **No geometry exists anywhere server-side.** No PostGIS (only pgcrypto, pg_trgm,
  pg_net), lat/lng numerics only; parcel polygons are fetched live by the browser at
  zoom ≥16 and thrown away; the edge function keeps only a centroid. Wetlands math was
  done offline in DuckDB against the FDOR cadastral layer, then imported as scalars.
- The house pattern for heavy data work is: **compute outside, push scalars in through a
  security-definer jsonb RPC** (`import_county_parcels`, `import_zoning`,
  `import_usable_acres`, `import_land_values`), fill-null-only, set-based, chunked,
  loud per-source status blobs (`appraiser_data` style), freeze-don't-decay on upstream
  failure (`sweep_finalize_off_market`'s fresh-stamps guard).
- The War Room's book fetch is lazy, narrow-column, uuid-bucket-paged; all filtering is
  client-side over the fetched book. A second book of land parcels **must be its own
  fetch**, or it slows the first — which is exactly what Alex asked for.
- Heavy pipelines so far live untracked on Alex's machine (`data/zoning/build_overlays.py`,
  `data/fl_parcels.duckdb`, the deployed-but-uncommitted `bulk-load` edge function).
  **This pipeline is committed to the repo** — that's a deliberate break from precedent,
  so the next machine (or agent) can run it.

## 2. The land book

**Membership is a Postgres rule, not a UI filter** (foundation rule #1). Proposal in
`20260821121000_land_book_membership.sql`:

- `properties.in_land_book boolean` + `properties.land_only boolean`, stamped by
  `refresh_land_book()` (same pattern as `refresh_condo_units()`), so both pages, all
  RPCs, and n8n agree on membership without re-deriving the rule anywhere else.
- Rule (Alex's calls, 2026-08-21): a parcel is in the land book when it has **≥ 0.5
  acres** and either its DOR class is a land class (00 vacant residential included), or
  it is **county-known vacant** (< 1,000 SF on county-synced building facts — a NULL or
  scraped SF is *unknown*, never evidence of vacancy), or it has a real building at
  **building-to-land ratio ≤ 5%** (`gross_sf / (land_acres × 43,560)`). `land_only` = in
  the land book as just-land — those rows leave the normal book; ≤5% crossover rows
  (real building, lots of land) stay on **both** books. **Residential is in** — vacant
  residential (00) via its DOR class, improved residential (01–09) only via the 5% ratio
  arm (the house-on-acreage teardown play). The follow-on Alex wants: filter land-book
  residential by FLU-industrial / zoned-industrial once enrichment lands FLU. Condo
  units are excluded from every arm — a warehouse-condo unit "on" the complex's 30
  acres is the pin-flood `refresh_condo_units()` exists to stop.
- **Applied 2026-08-21, live numbers:** 4,861 in the land book, 2,346 land-only, of
  31,990 total — Polk 1,424 · Hillsborough 1,270 · Sarasota 805 · Manatee 494 ·
  Pinellas 450 · Pasco 403. Zero condo units, zero sub-floor rows.
- The normal book's fetch adds one server-side predicate (`not land_only`) — the
  industrial book gets slightly *smaller*, never slower. The land book page does its own
  lazy uuid-bucket fetch filtered `in_land_book`.

**Populating it:** the county imports to date were scoped to the industrial DOR classes
(40xx–49xx, plus 027); `import_county_parcels` itself takes whatever it's fed. Loading
land is the same RPC fed a wider DOR slice from the same county rolls (and the FDOR
NAL DuckDB for value backfills). Proposed scope to keep the book useful and the row
count sane: vacant industrial (40), vacant commercial (10), agricultural (50–69),
vacant institutional (70), acreage-not-ag (99), **≥ 1 acre**, 6 counties. That floor is
a real decision — see §8. Residential classes (00–09) stay out.

**Filter rail:** the land book reuses the existing rail nearly wholesale — acres range,
last-sold (already built, partial-coverage toggle included), verified contact (via
`v_property_owner_context`, already built), on/off-market lens (already built), zoning
overlay include/only (already built, row-field membership). The DOR picker needs
land-specific options: `dor_codes.category` today has no `land` value, and changing it
would break the normal book's picker (040 must keep riding with industrial) — so the
membership migration adds an orthogonal `land_class` boolean instead and flags
10/40/50–69/70/99. New axis worth adding for developers: **FLU (future land
use)** — there is no FLU column, table, or enum anywhere today; Polk's FLU layer is used
as its *zoning* proxy, which is a different thing. FLU arrives via the enrichment
pipeline (§5), stored on `parcel_enrichment`, filterable on the land book only.

**Verified contact caveat:** land parcels imported fresh will have `owner_name` but no
`owner_company_id` until the owner-import pass runs for them — the verified-contact
filter reads through companies. Budget one owner-import + skip-trace round for the land
book or the filter will look broken.

## 3. On-market land (Apify)

No repo change needed. The DB side already handles land end-to-end (enum value,
off-market aging applies to `('industrial','land')`, $/acre county baselines,
`good_land_deal` flags). The change is **in n8n only**: add `land` to `assetClasses`
on each county's daily sweep run (task `y1AIrIDEUY635m9RH` config), and consider raising
`maxResultsPerSource` for the first week while the monitor primes. Listed in §8 as an
Alex action since n8n holds the config.

## 4. Enrichment pipeline — the architecture call

**Revised 2026-08-21 after Alex's runtime call ("cloud, not my machine"):**

**The PostGIS cache lives in the hosted Supabase DB itself** — a dedicated `gis`
schema (migration `20260821122000`), deliberately NOT in PostgREST's exposed schemas,
so the API surface and generated types stay clean. That makes the compute **stateless**,
so it runs as a scheduled **GitHub Actions workflow**
(`.github/workflows/enrichment.yml`, Mondays + on-demand) — no VPS, no machine of
Alex's, no new platform account. The runner connects over the Supabase session pooler
(`GIS_PG_DSN` Actions secret) and sets its own `statement_timeout` (the 8s API-role
timeout doesn't apply on a direct connection).

Guard rails that keep this sane in the production DB:
- All layers are clipped to the 6-county envelope, so the cache is county-sized (low
  single-digit GB at worst), and `enrichment status` reports per-layer row counts so
  growth is visible.
- Spatial joins read `gis.*` and write only scalar rows through
  `import_parcel_enrichment(jsonb)` — the app, n8n, and "the schema is the API" never
  see geometry.
- The local Docker option (`pipeline/docker-compose.yml`) remains for development; the
  code is identical either way, it's just a different `GIS_PG_DSN`.

**Idempotency & freshness rules carried over from the sweep/appraiser lessons:**
- Every layer harvest records service `lastEditDate` + feature count as a watermark;
  unchanged layers are skipped (`--force` overrides).
- A layer refresh stages into a temp table and **atomically swaps** only on complete
  success — a mid-harvest failure leaves the previous good copy in place
  (freeze, don't decay).
- Every run writes a `harvest_runs` row with a loud status; zero-feature responses are
  recorded as `empty`, never treated as "layer has no features" without a count check.
- The Supabase push only includes domains whose sources succeeded this run — a broken
  county endpoint can never null out yesterday's good utility distances.

## 5. Schema proposal (Supabase side)

`20260821120000_parcel_enrichment.sql` — one row per property, **keyed
`property_id uuid` PK/FK → `properties(id)`** (see §1 on why not parcel number).
Domains and columns:

| Domain | Columns |
| --- | --- |
| utilities | `water_main_dist_ft`, `water_main_diameter_in`, `water_provider`, `sewer_gravity_dist_ft`, `sewer_force_dist_ft`, `sewer_provider`, `in_water_service_area`, `in_sewer_service_area`, `substation_dist_ft`, `transmission_line_dist_ft`, `transmission_kv`, `electric_provider`, `nearest_powered_parcel_ft`, `gas_transmission_dist_ft`, `gas_operator`, `broadband_fiber`, `broadband_max_down_mbps`, `broadband_provider_count` |
| constraints | `fema_flood_zone`, `pct_sfha`, `pct_floodway`, `wetlands_pct`, `hydric_soils_pct`, `drainage_class`, `slope_mean_pct`, `flu_code`, `flu_description`, `flu_jurisdiction` |
| geometry | `parcel_depth_ft`, `parcel_width_ft`, `rectangularity`, `road_frontage_ft`, `frontage_road_name`, `frontage_aadt`, `on_truck_route`, `interchange_mi`, `interchange_drive_min`, `csx_mainline_mi` |
| score | `suitability_score` (0–100), `score_breakdown jsonb`, `score_version`, `scored_at` |
| bookkeeping | `source_status jsonb` (per-domain `{status, as_of, detail}` — the `appraiser_data` convention), `updated_at` |

Notes:
- Zoning is **not** duplicated here — it already lives on `properties`. FLU is new, so it
  lives here until it earns promotion.
- `wetlands_pct` is polygon-true NWI coverage, kept **separate** from
  `wet_acres_nwi`/`usable_acres` on properties. The two should reconcile (same NWI
  source, same EPSG:5070 math); whether and how the pipeline's number feeds the
  usable-acres model is a phase-2 decision with its own guard rails — nothing in this
  schema writes properties columns.
- Wide row is fine: the book's narrow column slice never selects it; the land book joins
  only the columns it filters/displays.
- `enrichment_score_weights` (factor pk, weight, normalization params jsonb, enabled,
  notes) with seed defaults — the "configurable weights" knob, editable from the UI
  later without touching Python.
- `import_parcel_enrichment(p jsonb)` — security definer, set-based, chunked, payload
  declares `domains: [...]` and only those column groups are overwritten (freshness rule
  in the contract, not in caller discipline); jsonb tally return; granted to
  authenticated + service_role, revoked from anon; RLS + `_auth_all` policies on both
  tables.

## 6. The harvester (`pipeline/`)

Generic, config-driven, three commands that matter:

- `discover <server-root>` — literally "walks any county's endpoints": crawls an ArcGIS
  REST root (folders → services → layers), keyword-filters (water, sewer, force main,
  substation, zoning, FLU…), prints ready-to-paste `sources.yml` stubs. This is how the
  six counties' utility layers get catalogued without hand-hunting.
- `harvest [--source id] [--county name]` — walks `sources.yml`, watermark-checks each
  layer, pages features (resultOffset with objectid-window fallback, honors
  `maxRecordCount`, esriJSON→GeoJSON conversion when `f=geojson` is unsupported), clips
  to the 6-county envelope where the source is statewide/national, staged atomic swap
  into `gis.layer_features`.
- `parcels` — pulls the tracked book from Supabase (keyset-paged), fetches parcel
  **polygons** by county parcel id from the county parcel layers (chunked `WHERE id IN`),
  falls back to point-in-polygon at the property's lat/lng for the ~20% id mismatches,
  stores them in `gis.parcels` keyed by `property_id` with a `match_method` provenance
  column. **This is the foundation everything else joins against.**

`join`, `score`, and `push` exist as stubs that name their plan and exit — not written
yet, per the ask.

## 7. Source catalog + the honest caveats

| Signal | Source | Access | Caveat |
| --- | --- | --- | --- |
| Water/sewer mains, diameters | County/city utility ArcGIS layers | free REST | Least standardized layer class; entries ship `verified: false` until `discover` + a harvest confirms each. Municipal providers (Tampa, St. Pete, Lakeland…) are separate servers. |
| Water/sewer service likelihood | **FDEP Florida Water Management Inventory (FLWMI)** | free REST | Parcel-level statewide "likely on central water/sewer vs well/septic" — the baseline in/out-of-service-area signal even where a county hides its mains. Best FL-specific shortcut in this whole plan. |
| Service area boundaries | County utility service area layers + FDEP | free REST | Same per-county variability. |
| Substations, transmission | HIFLD Open | free REST | HIFLD reorganized 2024–25; endpoints verified at harvest time, loudly. |
| Electric provider + "can power be run" | HIFLD retail service territories + our own parcel cache | free REST / internal | Alex's big question (2026-08-21). What's answerable from data: `electric_provider` (who to call for a will-serve letter), substation/transmission distance, and `nearest_powered_parcel_ft` — distance to the nearest county-synced built parcel, a self-join on our own cache. A served neighbor means distribution is at the road. What ISN'T: capacity and three-phase — utility distribution GIS is proprietary, so the score says "power likely at/near the road" and the will-serve letter stays a human step. |
| Gas transmission | PHMSA NPMS | **restricted** | Public viewer is county-at-a-time and the REST layer throttles/denies bulk. Plan: request the state extract from NPMS (they grant it for siting use), fall back to FGDL/county energy layers. Don't promise this column until access is confirmed. |
| Broadband/fiber | FCC BDC | free download | Availability is published per **census block / hex**, and the location fabric is licensed — so `broadband_*` is block-level truth, not parcel-level. Fine for a score input. |
| Flood | FEMA NFHL (S_FLD_HAZ_AR) | free REST | Straightforward; % overlap per zone. |
| Wetlands | USFWS NWI | free REST | Already precedented in-house (EPSG:5070 math). |
| Hydric soils, drainage | NRCS SSURGO via Soil Data Access | free, **not ArcGIS** (T-SQL POST API) | Own source `kind: sda` in the harvester; county AOI pulls of mupolygon + muaggatt. |
| Slope | USGS 3DEP | free | Raster, not a feature layer — computed at join time (DEM samples over the parcel), not harvested as a layer. |
| FLU + zoning + overlays | County/city planning ArcGIS | free REST | 25 zoning endpoints already field-verified in `zoning-sources.ts` — when zoning layers join the config (phase 3), copy from that list rather than re-hunting; `sources.yml` already carries the two FLU URLs it proved out (Polk, Pasco). FLU elsewhere is net-new hunting. |
| Road frontage, AADT, truck routes | FDOT Open Data (AADT, SIS, truck network) | free REST | Frontage = parcel-edge ∩ road buffer, so it needs the parcel polygons first. |
| Interstate interchanges | FDOT interchanges layer (fallback: OSM motorway junctions) | free | v1 ships straight-line miles + a speed-factor estimate for `interchange_drive_min`; real drive time needs a routing engine (OSRM + FL extract) — phase 4, noted on the column comment. |
| CSX mainline | FRA/BTS North American Rail Network Lines (`RROWNER1='CSXT'`) | free REST | Distance to *mainline* ≠ spur feasibility; it's a screening signal. |

## 8. What you're missing (my adds)

1. **Parcel polygons are the whole ballgame.** Nothing in the stack stores them, and
   every requested metric except broadband (wetlands %, soils %, slope, depth/width/
   rectangularity, frontage, distances measured from the boundary not the centroid)
   needs them. That's why `parcels` is a first-class harvester command and why the ~20%
   parcel-id mismatch gets an explicit geometric fallback with provenance.
2. **FLU has no data model today** — anyone selling "land for developers" leads with FLU
   before zoning. It's in the schema proposal from day one.
3. **FDEP FLWMI** (above) — cheap statewide water/sewer likelihood before any per-utility
   layer hunt.
4. **Contamination & environmental red flags:** FDEP cleanup sites, petroleum storage
   tanks, wellhead/aquifer protection zones. One more harvested layer each; a dealbreaker
   flag on the score. Cheap to add, expensive to miss.
5. **Impact/mobility fees** — often the #1 developer question after utilities, per-county
   fee schedules, no API. Proposal: a small hand-maintained `county` keyed table, phase 3.
6. **Assemblage detection** — once parcel polygons are cached, "same owner, adjacent
   parcels" is one spatial self-join. That's a land-sourcing superpower the big shops
   don't have; the schema reserves nothing for it yet, deliberately — phase 4.
7. **Sinkhole/subsidence** (FGS incident layer) — matters in Pasco/Hernando; optional
   score input, worth a config entry.
8. **Entitlement signals** (rezoning/permit applications) — the real "developer intent"
   feed; county Accela/portal scraping, phase 4+, not in this schema.
9. **Score inputs you already own:** $/acre vs county median (`v_county_land_metrics`),
   `land_value_share`, opportunity zone flag, last-sale recency — the score config
   should reach these existing columns, not re-derive them.
10. **Runtime** — decided 2026-08-21: cache in the hosted Supabase `gis` schema,
    compute as a scheduled GitHub Actions workflow (§4). No machine of Alex's involved.

## 8b. The land download (run 2026-08-21)

"Go through all the counties again and download the land" — done via a new committed
edge function, `supabase/functions/import-county-land`: one invocation fetches one page
of land-class parcels (DOR 00/10/40/50–69/70/99, ≥ 0.5 ac) straight from the county's
parcel layer and feeds it through `import_county_parcels`. Loop it per county until
`next_offset` is null. Fully idempotent — **this is also the repeatable land sweep**
(schedule it monthly from n8n or Actions with the anon key; it re-matches and fills
blanks, never duplicates).

What made this safe to run into a live book:
- `import_county_parcels` grew a **format-drift dedupe tier** (parcel_key first-segment
  match) — stored parcel formats are mixed within counties and exact-match would have
  minted duplicates — plus the **'Parcel <id>' placeholder rule** for land with no situs
  address but real coordinates (Polk's layer has no situs street at all; Pasco is ~56%
  situs-less vacant).
- City names ride along only when `county_lookup` maps them — the `properties_set_county`
  trigger derives county from city, and an unmapped city would have NULLed it.
- Every inserted owner runs through the owner-company trigger (companies minted/linked
  by normalized name) — the same spine the verified-contact filter reads, so land owners
  are immediately skip-traceable.

Scope counts at harvest (≥ 0.5 ac): Polk 66,469 (36k of it class 99 acreage) ·
Hillsborough 14,539 · Pasco 11,939 · Manatee 5,369 · Sarasota 4,407 · Pinellas 2,613 —
**105,336 parcels**. Post-import: `refresh_land_book()` + `refresh_condo_units()` +
analyze; final tallies in the session summary.

## 9. Phasing

- **P1 — DONE 2026-08-21:** schema applied live (migrations 20260821120000/121000/
  122000, `database.types.ts` regenerated), land book stamped (4,861 rows), harvester +
  parcel-polygon fetcher committed, Actions workflow armed pending secrets.
- **P2:** joins + score + `import_parcel_enrichment` push; backfill the industrial book.
- **P3:** land book county import (wider DOR slice, ≥0.5 ac), land book page (fork of
  `/properties` with its own book fetch, `not land_only` predicate on the normal book),
  FLU/utility filters, residential-in-industrial-FLU list.
- **P4:** drive-time via OSRM, assemblage detection, entitlement feeds.

## Decisions log (2026-08-21)

1. Migrations — **approved and applied** same day.
2. Acreage floor — **0.5 acres** (Alex).
3. Residential — **in**, via just-land or the 5% ratio arm only; DOR 00 rides with the
   land classes, improved 01–09 needs a real building at ≤5%. Later: cross land-book
   residential with FLU-industrial / industrial zoning (Alex's list idea).
4. PHMSA NPMS — request **drafted in Alex's Gmail** (to npms-nr@dot.gov; phone
   placeholder to fill before sending).
5. n8n `land` assetClass — **Alex is handling it in another session** (API access being
   added there); nothing needed from this branch.
6. Runtime — **Supabase-hosted cache + GitHub Actions runner** (§4). Outstanding: add
   the three Actions secrets (`GIS_PG_DSN` session-pooler string, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`) once the branch merges to main.
7. Electricity (Alex: "the big thing — can power be run or is it already there") —
   `electric_provider` + `nearest_powered_parcel_ft` added to the schema and score
   (§7's electric row explains what's answerable vs what stays a will-serve call).
