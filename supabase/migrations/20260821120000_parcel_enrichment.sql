-- Applied 2026-08-21 via MCP (schema approved by Alex same day: "Those
-- migrations sound good"). Plan: context/land-book-parcel-enrichment.md.
--
-- Site intelligence for the land book (Alex, 2026-08-21): every parcel gets
-- utility proximity, site constraints, shape/access metrics, and a 0-100
-- developer suitability score with configurable weights.
--
-- Design decisions (the WHY):
-- * One row per PROPERTY, keyed properties.id (uuid). "Keyed to parcel ID"
--   cannot literally mean the county parcel number: 104 duplicate
--   (county, parcel) groups exist, 343 rows carry comma-separated assemblage
--   lists, and ~20% of stored parcel numbers don't line up with county GIS
--   keys. The uuid is the identity; the county id is a lookup aid the
--   pipeline uses (with a point-in-polygon fallback) to FIND the geometry.
-- * A separate table, not columns on properties: the book fetch keeps its
--   narrow column slice (big blobs on properties already made the map take
--   tens of seconds once); the land book joins only what it filters on.
-- * Geometry itself never lands here. Layers and parcel polygons live in the
--   gis schema cache (20260821122000, not PostgREST-exposed); public gets
--   derived scalars only — same shape as the DuckDB wetlands math that
--   feeds wet_acres_nwi.
-- * Zoning is NOT duplicated here (it lives on properties + zoning_code_map).
--   FLU is new — no FLU model exists anywhere — so it starts here.
-- * source_status follows the appraiser_data convention: per-domain
--   {status, as_of, detail} blobs, written LOUDLY on every attempt including
--   not_found/error. Freshness rule from the sweep lessons is enforced in the
--   import RPC's contract (see below), not caller discipline: a failed source
--   can never null out yesterday's good values.

begin;

create table parcel_enrichment (
  property_id uuid primary key references properties(id) on delete cascade,

  -- utilities ----------------------------------------------------------------
  water_main_dist_ft       numeric(10,1) check (water_main_dist_ft >= 0),
  water_main_diameter_in   numeric(6,2)  check (water_main_diameter_in > 0),
  water_provider           text,
  sewer_gravity_dist_ft    numeric(10,1) check (sewer_gravity_dist_ft >= 0),
  sewer_force_dist_ft      numeric(10,1) check (sewer_force_dist_ft >= 0),
  sewer_provider           text,
  in_water_service_area    boolean,
  in_sewer_service_area    boolean,
  substation_dist_ft       numeric(10,1) check (substation_dist_ft >= 0),
  transmission_line_dist_ft numeric(10,1) check (transmission_line_dist_ft >= 0),
  transmission_kv          integer       check (transmission_kv > 0),
  electric_provider        text,
  nearest_powered_parcel_ft numeric(10,1) check (nearest_powered_parcel_ft >= 0),
  gas_transmission_dist_ft numeric(10,1) check (gas_transmission_dist_ft >= 0),
  gas_operator             text,
  broadband_fiber          boolean,
  broadband_max_down_mbps  integer       check (broadband_max_down_mbps >= 0),
  broadband_provider_count integer       check (broadband_provider_count >= 0),

  -- constraints ----------------------------------------------------------------
  fema_flood_zone          text,
  pct_sfha                 numeric(5,2) check (pct_sfha between 0 and 100),
  pct_floodway             numeric(5,2) check (pct_floodway between 0 and 100),
  wetlands_pct             numeric(5,2) check (wetlands_pct between 0 and 100),
  hydric_soils_pct         numeric(5,2) check (hydric_soils_pct between 0 and 100),
  drainage_class           text,
  slope_mean_pct           numeric(5,2) check (slope_mean_pct >= 0),
  flu_code                 text,
  flu_description          text,
  flu_jurisdiction         text,

  -- geometry-derived ----------------------------------------------------------
  parcel_depth_ft          numeric(10,1) check (parcel_depth_ft > 0),
  parcel_width_ft          numeric(10,1) check (parcel_width_ft > 0),
  rectangularity           numeric(4,3)  check (rectangularity between 0 and 1),
  road_frontage_ft         numeric(10,1) check (road_frontage_ft >= 0),
  frontage_road_name       text,
  frontage_aadt            integer       check (frontage_aadt >= 0),
  on_truck_route           boolean,
  interchange_mi           numeric(6,2)  check (interchange_mi >= 0),
  interchange_drive_min    numeric(6,1)  check (interchange_drive_min >= 0),
  csx_mainline_mi          numeric(6,2)  check (csx_mainline_mi >= 0),

  -- score ---------------------------------------------------------------------
  suitability_score        numeric(5,2) check (suitability_score between 0 and 100),
  score_breakdown          jsonb,
  score_version            text,
  scored_at                timestamptz,

  -- bookkeeping ---------------------------------------------------------------
  source_status            jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table parcel_enrichment is
  'Site intelligence per property (utilities, constraints, shape/access, suitability '
  'score), computed by the pipeline/ PostGIS job and pushed via import_parcel_enrichment(). '
  'Geometry stays in the gis schema cache — only derived scalars live here.';

comment on column parcel_enrichment.water_main_dist_ft is
  'Boundary (not centroid) distance to the nearest potable water main, planar EPSG:5070 feet.';
comment on column parcel_enrichment.in_water_service_area is
  'Inside a water service-area boundary; FDEP FLWMI likelihood is the fallback where the '
  'utility publishes no boundary layer.';
comment on column parcel_enrichment.in_sewer_service_area is
  'Inside a sewer service-area boundary; FDEP FLWMI likelihood fallback, same as water.';
comment on column parcel_enrichment.electric_provider is
  'Serving electric utility from HIFLD retail service territories (TECO, Duke, FPL, '
  'co-ops) — who to call for a will-serve letter.';
comment on column parcel_enrichment.nearest_powered_parcel_ft is
  'Distance to the nearest county-synced parcel with a real building (>= 1,000 SF) — '
  'computed from our own parcel cache. A served neighbor means distribution is at the '
  'road; the honest proxy for "can power be run here" (Alex 2026-08-21), since utility '
  'distribution-line GIS is proprietary. Capacity/three-phase still needs the utility.';
comment on column parcel_enrichment.gas_transmission_dist_ft is
  'Distance to nearest gas TRANSMISSION line (PHMSA NPMS). NPMS bulk access is restricted — '
  'null until the state extract is granted; never fake it from distribution lines.';
comment on column parcel_enrichment.broadband_max_down_mbps is
  'FCC BDC availability at the parcel''s census block — block-level truth, not parcel-level '
  '(the location fabric is licensed).';
comment on column parcel_enrichment.pct_sfha is
  'Percent of the parcel inside a FEMA special flood hazard area (A/AE/AH/AO/VE zones); '
  'fema_flood_zone holds the worst zone touching the parcel.';
comment on column parcel_enrichment.wetlands_pct is
  'NWI wetland coverage as percent of the parcel polygon (EPSG:5070 math, same convention '
  'as the DuckDB job behind wet_acres_nwi). Reconciling with wet_acres_nwi/usable_acres is '
  'a phase-2 decision with its own guard rails — nothing here writes properties columns.';
comment on column parcel_enrichment.drainage_class is
  'Dominant SSURGO drainage class (Excessively drained ... Very poorly drained), by percent '
  'of parcel area.';
comment on column parcel_enrichment.slope_mean_pct is
  'Mean slope over the parcel from USGS 3DEP DEM samples, percent rise.';
comment on column parcel_enrichment.flu_code is
  'Future Land Use designation — a NEW axis (no FLU model existed before this table). '
  'Jurisdiction spellings follow zoning_jurisdiction (''Hillsborough County'', city names), '
  'not the bare properties.county vocabulary.';
comment on column parcel_enrichment.rectangularity is
  'Parcel area / area of its minimum rotated bounding rectangle. 1.0 = perfect rectangle.';
comment on column parcel_enrichment.interchange_drive_min is
  'v1 is straight-line miles x a speed factor, honestly labeled in score_breakdown; real '
  'routing (OSRM) is phase 4.';
comment on column parcel_enrichment.csx_mainline_mi is
  'Distance to the nearest CSXT-owned line in the FRA North American Rail Network. A '
  'screening signal — mainline proximity, not spur feasibility.';
comment on column parcel_enrichment.source_status is
  'Per-domain harvest bookkeeping, appraiser_data convention: '
  '{utilities:{status,as_of,detail}, constraints:{...}, geometry:{...}, score:{...}} — '
  'status ok|partial|not_found|error, written loudly on every attempt.';

alter table parcel_enrichment enable row level security;
create policy parcel_enrichment_auth_all on parcel_enrichment
  for all to authenticated using (true) with check (true);

create trigger parcel_enrichment_updated_at
  before update on parcel_enrichment
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Configurable score weights: the knob Alex turns without touching Python.
-- The pipeline reads this table when scoring; score_breakdown records the
-- weights actually used so an old score stays explainable after a re-tune.
-- params carries the normalization curve per factor (how a raw value becomes
-- 0..1 before weighting), e.g. {"kind":"decay","full_at":300,"zero_at":5280}.
-- ---------------------------------------------------------------------------

create table enrichment_score_weights (
  factor  text primary key,
  weight  numeric(6,2) not null check (weight >= 0),
  params  jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  notes   text,
  updated_at timestamptz not null default now()
);

comment on table enrichment_score_weights is
  'Developer-suitability score configuration. Score = 100 x sum(weight_i x norm_i(value)) '
  '/ sum(weight_i) over enabled factors with non-null inputs; dealbreaker factors can zero '
  'the score via params {"dealbreaker": true}. Edited by hand/UI; the pipeline only reads.';

alter table enrichment_score_weights enable row level security;
create policy enrichment_score_weights_auth_all on enrichment_score_weights
  for all to authenticated using (true) with check (true);

create trigger enrichment_score_weights_updated_at
  before update on enrichment_score_weights
  for each row execute function set_updated_at();

-- Seed defaults: utilities heaviest (what land developers underwrite first),
-- then buildable ground, then access. Sums are irrelevant (normalized on read).
insert into enrichment_score_weights (factor, weight, params, notes) values
  ('water_main',     10, '{"kind":"decay","input":"water_main_dist_ft","full_at":300,"zero_at":5280}',  'Full credit inside 300 ft, none past a mile.'),
  ('sewer_gravity',  15, '{"kind":"decay","input":"sewer_gravity_dist_ft","full_at":300,"zero_at":5280}', 'Gravity sewer is the #1 land question; force main scores via sewer_force.'),
  ('sewer_force',     5, '{"kind":"decay","input":"sewer_force_dist_ft","full_at":300,"zero_at":5280}',  'Half-credit utility: needs a lift station.'),
  ('service_area',   10, '{"kind":"bool_pair","inputs":["in_water_service_area","in_sewer_service_area"]}', 'Inside both boundaries = 1, one = 0.5, neither = 0.'),
  ('power',           8, '{"kind":"decay","input":"substation_dist_ft","full_at":2640,"zero_at":26400}', 'Substation within a half mile is full credit.'),
  ('power_nearby',    6, '{"kind":"decay","input":"nearest_powered_parcel_ft","full_at":300,"zero_at":5280}', 'A served neighbor within 300 ft = distribution already at the road.'),
  ('gas',             3, '{"kind":"decay","input":"gas_transmission_dist_ft","full_at":2640,"zero_at":26400}', 'Null until NPMS access lands — normalized-out, not zero.'),
  ('broadband',       2, '{"kind":"bool","input":"broadband_fiber"}',                                    'Block-level FCC BDC fiber flag.'),
  ('flood',          12, '{"kind":"inverse_pct","input":"pct_sfha","dealbreaker_at":90}',                'pct_sfha 0 = full credit; >=90% SFHA zeroes the whole score.'),
  ('wetlands',       12, '{"kind":"inverse_pct","input":"wetlands_pct","dealbreaker_at":85}',            'NWI coverage of the parcel.'),
  ('soils',           6, '{"kind":"inverse_pct","input":"hydric_soils_pct"}',                            'Hydric % as a drainage proxy alongside drainage_class.'),
  ('slope',           3, '{"kind":"inverse_linear","input":"slope_mean_pct","zero_at":12}',              'Florida-flat gets full credit; >=12% mean slope gets none.'),
  ('shape',           5, '{"kind":"direct","input":"rectangularity"}',                                   'Rectangular parcels lay out; flag lots don''t.'),
  ('frontage',        5, '{"kind":"decay_inverse","input":"road_frontage_ft","full_at":300,"zero_at":0}', 'Credit grows with frontage feet, full at 300 ft.'),
  ('highway_access',  8, '{"kind":"decay","input":"interchange_mi","full_at":2,"zero_at":15}',           'Interstate interchange within 2 mi is full credit.'),
  ('rail',            2, '{"kind":"decay","input":"csx_mainline_mi","full_at":1,"zero_at":10}',          'CSX mainline proximity, screening only.');

-- ---------------------------------------------------------------------------
-- The pipeline's write path. House importer contract: security definer,
-- jsonb in / jsonb tally out, set-based, chunk from the caller (~1,000 rows).
--
-- Freshness lives in the CONTRACT: p->'domains' names which column groups this
-- payload is authoritative for; only those groups are overwritten. A run whose
-- utilities sources failed simply omits 'utilities' and yesterday's distances
-- survive (sweep_finalize_off_market's freeze-don't-decay lesson). source_status
-- keys merge per-domain so one domain's bookkeeping never erases another's.
--
-- Sentinel zeros (a 0 diameter/kV/depth/width in a source layer means "not
-- recorded") are nulled here rather than allowed to abort a whole ~1,000-row
-- chunk against the strictly-positive CHECKs.
-- ---------------------------------------------------------------------------

create or replace function import_parcel_enrichment(p jsonb) returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_domains text[];
  v_received int;
  v_written int;
  v_unknown int;
begin
  v_domains := coalesce(
    (select array_agg(d) from jsonb_array_elements_text(p->'domains') d), '{}');
  if v_domains = '{}' then
    raise exception 'import_parcel_enrichment: payload must name domains';
  end if;
  if exists (select 1 from unnest(v_domains) d
             where d not in ('utilities','constraints','geometry','score')) then
    raise exception 'import_parcel_enrichment: unknown domain in %', v_domains;
  end if;

  create temp table _pe_in on commit drop as
  select r.*
  from jsonb_to_recordset(p->'rows') as r(
    property_id uuid,
    water_main_dist_ft numeric, water_main_diameter_in numeric, water_provider text,
    sewer_gravity_dist_ft numeric, sewer_force_dist_ft numeric, sewer_provider text,
    in_water_service_area boolean, in_sewer_service_area boolean,
    substation_dist_ft numeric, transmission_line_dist_ft numeric, transmission_kv int,
    electric_provider text, nearest_powered_parcel_ft numeric,
    gas_transmission_dist_ft numeric, gas_operator text,
    broadband_fiber boolean, broadband_max_down_mbps int, broadband_provider_count int,
    fema_flood_zone text, pct_sfha numeric, pct_floodway numeric,
    wetlands_pct numeric, hydric_soils_pct numeric, drainage_class text,
    slope_mean_pct numeric, flu_code text, flu_description text, flu_jurisdiction text,
    parcel_depth_ft numeric, parcel_width_ft numeric, rectangularity numeric,
    road_frontage_ft numeric, frontage_road_name text, frontage_aadt int,
    on_truck_route boolean, interchange_mi numeric, interchange_drive_min numeric,
    csx_mainline_mi numeric,
    suitability_score numeric, score_breakdown jsonb, score_version text,
    scored_at timestamptz,
    source_status jsonb
  );

  -- 0 = "not recorded" in source layers; null it before the strict CHECKs see it
  update _pe_in set
    water_main_diameter_in = nullif(water_main_diameter_in, 0),
    transmission_kv        = nullif(transmission_kv, 0),
    parcel_depth_ft        = nullif(parcel_depth_ft, 0),
    parcel_width_ft        = nullif(parcel_width_ft, 0);

  select count(*) into v_received from _pe_in;

  -- Rows for properties that don't exist are counted, not exploded on: the
  -- pipeline's book snapshot can trail a deletion.
  select count(*) into v_unknown
  from _pe_in i where not exists (select 1 from properties pr where pr.id = i.property_id);
  delete from _pe_in i
  where not exists (select 1 from properties pr where pr.id = i.property_id);

  insert into parcel_enrichment as pe (
    property_id,
    water_main_dist_ft, water_main_diameter_in, water_provider,
    sewer_gravity_dist_ft, sewer_force_dist_ft, sewer_provider,
    in_water_service_area, in_sewer_service_area,
    substation_dist_ft, transmission_line_dist_ft, transmission_kv,
    electric_provider, nearest_powered_parcel_ft,
    gas_transmission_dist_ft, gas_operator,
    broadband_fiber, broadband_max_down_mbps, broadband_provider_count,
    fema_flood_zone, pct_sfha, pct_floodway,
    wetlands_pct, hydric_soils_pct, drainage_class,
    slope_mean_pct, flu_code, flu_description, flu_jurisdiction,
    parcel_depth_ft, parcel_width_ft, rectangularity,
    road_frontage_ft, frontage_road_name, frontage_aadt,
    on_truck_route, interchange_mi, interchange_drive_min, csx_mainline_mi,
    suitability_score, score_breakdown, score_version, scored_at,
    source_status)
  select
    i.property_id,
    case when 'utilities' = any(v_domains) then i.water_main_dist_ft end,
    case when 'utilities' = any(v_domains) then i.water_main_diameter_in end,
    case when 'utilities' = any(v_domains) then i.water_provider end,
    case when 'utilities' = any(v_domains) then i.sewer_gravity_dist_ft end,
    case when 'utilities' = any(v_domains) then i.sewer_force_dist_ft end,
    case when 'utilities' = any(v_domains) then i.sewer_provider end,
    case when 'utilities' = any(v_domains) then i.in_water_service_area end,
    case when 'utilities' = any(v_domains) then i.in_sewer_service_area end,
    case when 'utilities' = any(v_domains) then i.substation_dist_ft end,
    case when 'utilities' = any(v_domains) then i.transmission_line_dist_ft end,
    case when 'utilities' = any(v_domains) then i.transmission_kv end,
    case when 'utilities' = any(v_domains) then i.electric_provider end,
    case when 'utilities' = any(v_domains) then i.nearest_powered_parcel_ft end,
    case when 'utilities' = any(v_domains) then i.gas_transmission_dist_ft end,
    case when 'utilities' = any(v_domains) then i.gas_operator end,
    case when 'utilities' = any(v_domains) then i.broadband_fiber end,
    case when 'utilities' = any(v_domains) then i.broadband_max_down_mbps end,
    case when 'utilities' = any(v_domains) then i.broadband_provider_count end,
    case when 'constraints' = any(v_domains) then i.fema_flood_zone end,
    case when 'constraints' = any(v_domains) then i.pct_sfha end,
    case when 'constraints' = any(v_domains) then i.pct_floodway end,
    case when 'constraints' = any(v_domains) then i.wetlands_pct end,
    case when 'constraints' = any(v_domains) then i.hydric_soils_pct end,
    case when 'constraints' = any(v_domains) then i.drainage_class end,
    case when 'constraints' = any(v_domains) then i.slope_mean_pct end,
    case when 'constraints' = any(v_domains) then i.flu_code end,
    case when 'constraints' = any(v_domains) then i.flu_description end,
    case when 'constraints' = any(v_domains) then i.flu_jurisdiction end,
    case when 'geometry' = any(v_domains) then i.parcel_depth_ft end,
    case when 'geometry' = any(v_domains) then i.parcel_width_ft end,
    case when 'geometry' = any(v_domains) then i.rectangularity end,
    case when 'geometry' = any(v_domains) then i.road_frontage_ft end,
    case when 'geometry' = any(v_domains) then i.frontage_road_name end,
    case when 'geometry' = any(v_domains) then i.frontage_aadt end,
    case when 'geometry' = any(v_domains) then i.on_truck_route end,
    case when 'geometry' = any(v_domains) then i.interchange_mi end,
    case when 'geometry' = any(v_domains) then i.interchange_drive_min end,
    case when 'geometry' = any(v_domains) then i.csx_mainline_mi end,
    case when 'score' = any(v_domains) then i.suitability_score end,
    case when 'score' = any(v_domains) then i.score_breakdown end,
    case when 'score' = any(v_domains) then i.score_version end,
    case when 'score' = any(v_domains) then i.scored_at end,
    coalesce(i.source_status, '{}'::jsonb)
  from _pe_in i
  on conflict (property_id) do update set
    water_main_dist_ft       = case when 'utilities' = any(v_domains) then excluded.water_main_dist_ft       else pe.water_main_dist_ft end,
    water_main_diameter_in   = case when 'utilities' = any(v_domains) then excluded.water_main_diameter_in   else pe.water_main_diameter_in end,
    water_provider           = case when 'utilities' = any(v_domains) then excluded.water_provider           else pe.water_provider end,
    sewer_gravity_dist_ft    = case when 'utilities' = any(v_domains) then excluded.sewer_gravity_dist_ft    else pe.sewer_gravity_dist_ft end,
    sewer_force_dist_ft      = case when 'utilities' = any(v_domains) then excluded.sewer_force_dist_ft      else pe.sewer_force_dist_ft end,
    sewer_provider           = case when 'utilities' = any(v_domains) then excluded.sewer_provider           else pe.sewer_provider end,
    in_water_service_area    = case when 'utilities' = any(v_domains) then excluded.in_water_service_area    else pe.in_water_service_area end,
    in_sewer_service_area    = case when 'utilities' = any(v_domains) then excluded.in_sewer_service_area    else pe.in_sewer_service_area end,
    substation_dist_ft       = case when 'utilities' = any(v_domains) then excluded.substation_dist_ft       else pe.substation_dist_ft end,
    transmission_line_dist_ft = case when 'utilities' = any(v_domains) then excluded.transmission_line_dist_ft else pe.transmission_line_dist_ft end,
    transmission_kv          = case when 'utilities' = any(v_domains) then excluded.transmission_kv          else pe.transmission_kv end,
    electric_provider        = case when 'utilities' = any(v_domains) then excluded.electric_provider        else pe.electric_provider end,
    nearest_powered_parcel_ft = case when 'utilities' = any(v_domains) then excluded.nearest_powered_parcel_ft else pe.nearest_powered_parcel_ft end,
    gas_transmission_dist_ft = case when 'utilities' = any(v_domains) then excluded.gas_transmission_dist_ft else pe.gas_transmission_dist_ft end,
    gas_operator             = case when 'utilities' = any(v_domains) then excluded.gas_operator             else pe.gas_operator end,
    broadband_fiber          = case when 'utilities' = any(v_domains) then excluded.broadband_fiber          else pe.broadband_fiber end,
    broadband_max_down_mbps  = case when 'utilities' = any(v_domains) then excluded.broadband_max_down_mbps  else pe.broadband_max_down_mbps end,
    broadband_provider_count = case when 'utilities' = any(v_domains) then excluded.broadband_provider_count else pe.broadband_provider_count end,
    fema_flood_zone          = case when 'constraints' = any(v_domains) then excluded.fema_flood_zone        else pe.fema_flood_zone end,
    pct_sfha                 = case when 'constraints' = any(v_domains) then excluded.pct_sfha               else pe.pct_sfha end,
    pct_floodway             = case when 'constraints' = any(v_domains) then excluded.pct_floodway           else pe.pct_floodway end,
    wetlands_pct             = case when 'constraints' = any(v_domains) then excluded.wetlands_pct           else pe.wetlands_pct end,
    hydric_soils_pct         = case when 'constraints' = any(v_domains) then excluded.hydric_soils_pct       else pe.hydric_soils_pct end,
    drainage_class           = case when 'constraints' = any(v_domains) then excluded.drainage_class         else pe.drainage_class end,
    slope_mean_pct           = case when 'constraints' = any(v_domains) then excluded.slope_mean_pct         else pe.slope_mean_pct end,
    flu_code                 = case when 'constraints' = any(v_domains) then excluded.flu_code               else pe.flu_code end,
    flu_description          = case when 'constraints' = any(v_domains) then excluded.flu_description        else pe.flu_description end,
    flu_jurisdiction         = case when 'constraints' = any(v_domains) then excluded.flu_jurisdiction       else pe.flu_jurisdiction end,
    parcel_depth_ft          = case when 'geometry' = any(v_domains) then excluded.parcel_depth_ft           else pe.parcel_depth_ft end,
    parcel_width_ft          = case when 'geometry' = any(v_domains) then excluded.parcel_width_ft           else pe.parcel_width_ft end,
    rectangularity           = case when 'geometry' = any(v_domains) then excluded.rectangularity            else pe.rectangularity end,
    road_frontage_ft         = case when 'geometry' = any(v_domains) then excluded.road_frontage_ft          else pe.road_frontage_ft end,
    frontage_road_name       = case when 'geometry' = any(v_domains) then excluded.frontage_road_name        else pe.frontage_road_name end,
    frontage_aadt            = case when 'geometry' = any(v_domains) then excluded.frontage_aadt             else pe.frontage_aadt end,
    on_truck_route           = case when 'geometry' = any(v_domains) then excluded.on_truck_route            else pe.on_truck_route end,
    interchange_mi           = case when 'geometry' = any(v_domains) then excluded.interchange_mi            else pe.interchange_mi end,
    interchange_drive_min    = case when 'geometry' = any(v_domains) then excluded.interchange_drive_min     else pe.interchange_drive_min end,
    csx_mainline_mi          = case when 'geometry' = any(v_domains) then excluded.csx_mainline_mi           else pe.csx_mainline_mi end,
    suitability_score        = case when 'score' = any(v_domains) then excluded.suitability_score            else pe.suitability_score end,
    score_breakdown          = case when 'score' = any(v_domains) then excluded.score_breakdown              else pe.score_breakdown end,
    score_version            = case when 'score' = any(v_domains) then excluded.score_version                else pe.score_version end,
    scored_at                = case when 'score' = any(v_domains) then excluded.scored_at                    else pe.scored_at end,
    source_status            = pe.source_status || excluded.source_status;

  get diagnostics v_written = row_count;

  return jsonb_build_object(
    'received', v_received,
    'written', v_written,
    'unknown_property', v_unknown,
    'domains', to_jsonb(v_domains));
end $$;

comment on function import_parcel_enrichment(jsonb) is
  'Pipeline write path. Payload {domains:[utilities|constraints|geometry|score,...], '
  'rows:[{property_id,...}]}: only the named domains'' column groups are overwritten, so a '
  'run with a failed source omits that domain and existing values survive (freeze, don''t '
  'decay). source_status keys merge. Chunk ~1,000 rows/call. Returns a jsonb tally.';

revoke all on function import_parcel_enrichment(jsonb) from public, anon;
grant execute on function import_parcel_enrichment(jsonb) to authenticated, service_role;

commit;
