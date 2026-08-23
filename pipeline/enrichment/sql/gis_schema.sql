-- PostGIS cache schema — LOCAL-DEV bootstrap. The canonical cache lives in
-- the hosted Supabase project (migration 20260821122000_gis_cache_schema.sql,
-- gis schema; Alex 2026-08-21: run in the cloud, not on my machine) — keep
-- this file in lockstep with that migration. Applied idempotently by
-- `python -m enrichment init-db` when pointing GIS_PG_DSN at the local
-- docker-compose PostGIS instead.
--
-- Only derived scalars ever reach the public schema (via
-- import_parcel_enrichment) — see context/land-book-parcel-enrichment.md §4.
-- Geometry is stored twice: 4326 as harvested, 5070 (CONUS Albers, meters) for
-- planar distance/area math — the same CRS the DuckDB wetlands job used.

create extension if not exists postgis;
create schema if not exists gis;

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
-- so a re-map never forces a re-harvest).
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
  matched_value text,                       -- the id (or 'lat,lng') that actually matched
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
