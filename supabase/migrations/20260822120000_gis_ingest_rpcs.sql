-- Applied 2026-08-22 via MCP.
--
-- The enrichment pipeline's ingest path, server-side. Alex 2026-08-21 asked for
-- the pipeline to run in the cloud; the land import proved the edge-function
-- pattern (server-side fetch -> SECURITY DEFINER RPC) needs no credentials from
-- him and no GitHub Actions secrets. PostGIS is already enabled, so both the
-- layer cache AND the spatial joins live in the database.
--
-- Two writers, both set-based and both idempotent:
--   import_gis_features  -- county/federal layers into gis.layer_features
--   import_parcel_geoms  -- parcel polygons into gis.parcels, keyed properties.id
--
-- Geometry is stored twice, as the cache schema defines: 4326 as harvested and
-- 5070 (CONUS Albers, metres) for planar distance/area — the CRS the DuckDB
-- wetlands job already used, so acreage math stays comparable.

begin;

-- ---------------------------------------------------------------- layers

create or replace function import_gis_features(p jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'gis', 'public', 'extensions'
as $$
declare
  v_source text := p->>'source_id';
  v_county text := p->>'county';
  v_url    text := p->>'url';
  v_received int;
  v_written  int;
begin
  if v_source is null then
    return jsonb_build_object('error', 'source_id required');
  end if;

  insert into gis.layers (source_id, url, kind, county, status)
  values (v_source, v_url, 'arcgis', v_county, 'never')
  on conflict (source_id) do update
    set url = coalesce(excluded.url, gis.layers.url),
        county = coalesce(excluded.county, gis.layers.county);

  create temp table _gis_in on commit drop as
  select r.oid::bigint as source_oid,
         coalesce(r.attrs, '{}'::jsonb) as attrs,
         extensions.st_makevalid(
           extensions.st_force2d(
             extensions.st_setsrid(extensions.st_geomfromgeojson(r.geom::text), 4326))) as g
  from jsonb_to_recordset(p->'features') as r(oid bigint, attrs jsonb, geom jsonb)
  where r.oid is not null and r.geom is not null;

  select count(*) into v_received from _gis_in;

  -- last write wins inside one payload; the PK dedupes across payloads
  delete from _gis_in a using _gis_in b
  where a.source_oid = b.source_oid and a.ctid < b.ctid;

  insert into gis.layer_features (source_id, source_oid, attrs, geom, geom_5070)
  select v_source, i.source_oid, i.attrs, i.g, extensions.st_transform(i.g, 5070)
  from _gis_in i
  where i.g is not null and not extensions.st_isempty(i.g)
  on conflict (source_id, source_oid) do update
    set attrs = excluded.attrs, geom = excluded.geom, geom_5070 = excluded.geom_5070;

  get diagnostics v_written = row_count;

  update gis.layers
  set feature_count = (select count(*) from gis.layer_features f where f.source_id = v_source),
      harvested_at = now(),
      status = 'ok'
  where source_id = v_source;

  return jsonb_build_object('received', v_received, 'written', v_written,
                            'total', (select feature_count from gis.layers where source_id = v_source));
end $$;

comment on function import_gis_features(jsonb) is
  'Cache one page of an ArcGIS layer into gis.layer_features. Payload '
  '{source_id, url?, county?, features:[{oid, attrs, geom(GeoJSON)}]}. Upserts on '
  '(source_id, source_oid) so re-running a page is a no-op; stamps gis.layers.';

revoke all on function import_gis_features(jsonb) from public, anon;
grant execute on function import_gis_features(jsonb) to service_role, authenticated;

-- ---------------------------------------------------------------- parcels

create or replace function import_parcel_geoms(p jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'gis', 'public', 'extensions'
as $$
declare
  v_county text := p->>'county';
  v_received int;
  v_written  int;
begin
  if v_county is null then
    return jsonb_build_object('error', 'county required');
  end if;

  create temp table _pg_in on commit drop as
  select lower(regexp_replace(r.parcel, '[^a-zA-Z0-9]', '', 'g')) as k,
         extensions.st_multi(extensions.st_makevalid(
           extensions.st_force2d(
             extensions.st_setsrid(extensions.st_geomfromgeojson(r.geom::text), 4326)))) as g
  from jsonb_to_recordset(p->'rows') as r(parcel text, geom jsonb)
  where nullif(btrim(coalesce(r.parcel, '')), '') is not null and r.geom is not null;

  select count(*) into v_received from _pg_in;

  delete from _pg_in a using _pg_in b where a.k = b.k and a.ctid > b.ctid;

  -- Parcel ids are resolvers, not keys: match the same way the land import does,
  -- on the normalized first segment of parcel_key, riding
  -- properties_county_parcel_norm_idx.
  insert into gis.parcels (property_id, county, parcel_number, match_method,
                           matched_value, acres_gis, geom, geom_5070)
  select distinct on (pr.id)
         pr.id, v_county, pr.parcel_number, 'id_normalized', i.k,
         extensions.st_area(extensions.st_transform(i.g, 5070)) / 4046.8564224,
         i.g, extensions.st_transform(i.g, 5070)
  from _pg_in i
  join properties pr
    on pr.county = v_county
   and split_part(pr.parcel_key, '|', 1) = i.k
  where i.g is not null and not extensions.st_isempty(i.g)
    and extensions.st_geometrytype(i.g) in ('ST_MultiPolygon', 'ST_Polygon')
  on conflict (property_id) do update
    set geom = excluded.geom, geom_5070 = excluded.geom_5070,
        acres_gis = excluded.acres_gis, fetched_at = now();

  get diagnostics v_written = row_count;

  return jsonb_build_object('received', v_received, 'written', v_written,
                            'total', (select count(*) from gis.parcels where county = v_county));
end $$;

comment on function import_parcel_geoms(jsonb) is
  'Cache parcel polygons into gis.parcels, keyed properties.id. Payload '
  '{county, rows:[{parcel, geom(GeoJSON)}]}. Matches on the normalized parcel_key '
  'segment (parcel ids are resolvers, not keys); idempotent per property.';

revoke all on function import_parcel_geoms(jsonb) from public, anon;
grant execute on function import_parcel_geoms(jsonb) to service_role, authenticated;

commit;
