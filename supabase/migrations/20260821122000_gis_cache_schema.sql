-- Applied 2026-08-21 via MCP (enables postgis, extensions schema).
--
-- The enrichment pipeline's PostGIS cache, in the hosted project (Alex,
-- 2026-08-21: "I would prefer the pipeline not to run on my machine but run
-- on supabase or some other cloud based platform"). Cache state lives HERE in
-- a dedicated `gis` schema; compute is a scheduled GitHub Actions run of
-- pipeline/ connecting over the session pooler. Keeping state in the hosted
-- DB makes the runner stateless — any cloud cron can execute it.
--
-- The `gis` schema is deliberately NOT in PostgREST's exposed schemas: the
-- app and n8n never read geometry — they read the scalars the pipeline
-- derives into public.parcel_enrichment. RLS is enabled belt-and-braces
-- with no policies (deny for API roles if it were ever exposed; the
-- pipeline connects as postgres, which owns these tables).
--
-- Mirror of pipeline/enrichment/sql/gis_schema.sql (the local-dev
-- bootstrap) — keep the two in lockstep.

begin;

create extension if not exists postgis with schema extensions;

create schema if not exists gis;

-- unqualified geometry(...) below resolves via extensions
set local search_path = gis, public, extensions;

-- One row per configured source layer: the harvest watermark and loud status.
create table if not exists gis.layers (
  source_id     text primary key,           -- sources.yml id
  url           text,
  kind          text not null default 'arcgis',
  county        text,                       -- bare name ('Hillsborough') or null for regional/national
  geom_type     text,
  last_edit_ms  bigint,                     -- service editingInfo.lastEditDate (ms epoch), watermark #1
  source_count  bigint,                     -- server-side feature count at harvest, watermark #2
  feature_count bigint,                     -- rows actually cached
  harvested_at  timestamptz,
  status        text not null default 'never'
                check (status in ('never','ok','empty','error','skipped','unconfigured')),
  detail        jsonb not null default '{}'::jsonb
);

-- Every harvested feature, generic across layers. attrs keeps the source
-- attributes verbatim (renaming happens at join time, never at harvest time,
-- so a re-map never forces a re-harvest). Geometry twice: 4326 as harvested,
-- 5070 (CONUS Albers, meters) for planar distance/area math — the CRS the
-- DuckDB wetlands job used.
create table if not exists gis.layer_features (
  source_id  text not null references gis.layers(source_id) on delete cascade,
  source_oid bigint not null,               -- the layer's objectIdField value
  attrs      jsonb not null default '{}'::jsonb,
  geom       geometry(Geometry, 4326),
  geom_5070  geometry(Geometry, 5070),
  primary key (source_id, source_oid)
);
create index if not exists layer_features_geom_gix
  on gis.layer_features using gist (geom);
create index if not exists layer_features_geom_5070_gix
  on gis.layer_features using gist (geom_5070);

-- Staging for the atomic swap: a harvest loads here first and replaces the
-- live rows only on COMPLETE success, so a mid-harvest failure leaves the
-- previous good copy in place (freeze, don't decay).
create table if not exists gis.layer_features_stage (
  like gis.layer_features including all
);

-- Parcel polygons for the tracked book, keyed by the CRM uuid — parcel ids
-- are resolvers, not keys (dupes, comma-lists, ~20% county-key mismatch).
create table if not exists gis.parcels (
  property_id   uuid primary key,
  county        text not null,
  parcel_number text,
  match_method  text not null
                check (match_method in ('id_exact','id_normalized','point_in_polygon')),
  matched_value text,                       -- the id(s) (or 'lat,lng') that actually matched
  acres_gis     numeric,                    -- polygon area in acres (5070), sanity check vs land_acres
  geom          geometry(MultiPolygon, 4326) not null,
  geom_5070     geometry(MultiPolygon, 5070) not null,
  fetched_at    timestamptz not null default now()
);
create index if not exists parcels_geom_gix on gis.parcels using gist (geom);
create index if not exists parcels_geom_5070_gix on gis.parcels using gist (geom_5070);

-- Append-only run log: every attempt, loud, including empties and errors.
create table if not exists gis.harvest_runs (
  id          bigint generated always as identity primary key,
  source_id   text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running'
              check (status in ('running','ok','empty','error','skipped')),
  features    bigint,
  message     text
);
create index if not exists harvest_runs_source_idx on gis.harvest_runs (source_id, started_at desc);

alter table gis.layers enable row level security;
alter table gis.layer_features enable row level security;
alter table gis.layer_features_stage enable row level security;
alter table gis.parcels enable row level security;
alter table gis.harvest_runs enable row level security;

commit;
