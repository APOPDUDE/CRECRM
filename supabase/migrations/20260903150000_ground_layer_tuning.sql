-- 2026-09-03: tuning the smoothed ground layers after measuring. The 20% viewport pad
-- doubled the wetland payload (2x the area for a seam nobody sees) - 6% keeps the edge
-- honest at a fifth of the cost; Chaikin quadruples vertices, so a cheap ST_Simplify at
-- 0.4x the tolerance drops the near-collinear points it leaves on straight runs; and the
-- ground cap rises to 250 km2 so a wide screen at zoom 12 (a 174 km2 viewport) still
-- paints instead of silently returning nothing. Applied via MCP.

begin;

create or replace function public.map_layer_features(
  p_kinds text[],
  p_west double precision, p_south double precision, p_east double precision, p_north double precision,
  p_zoom int default 16)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  env      geometry := extensions.st_makeenvelope(p_west, p_south, p_east, p_north, 4326);
  env5070  geometry;
  env_pad  geometry;
  area_km2 numeric;
  tol      numeric;
  digits   int;
  lim      constant int := 4000;
  ground   constant text[] := array['flood_zone', 'wetland'];
  feats    jsonb;
  n        int;
begin
  -- the VA silo never sees the book's geography
  if public.is_va() then
    return jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  end if;
  env5070  := extensions.st_transform(env, 5070);
  area_km2 := extensions.st_area(env5070) / 1e6;
  -- simplification in degrees: none close up, ~2 m at street zoom, ~10 m at zoom 13 and
  -- ~20 m at the district view; 5 decimals (~1 m) is plenty until the camera is on one block
  tol    := case when p_zoom >= 16 then 0 when p_zoom >= 14 then 0.00002 when p_zoom >= 13 then 0.0001 else 0.0002 end;
  digits := case when p_zoom >= 17 then 6 else 5 end;
  -- ground shapes are clipped to a padded viewport so a shape that runs off-screen keeps
  -- its edge and a small pan never shows a hard cut at the old boundary
  env_pad := extensions.st_expand(env, greatest(p_east - p_west, p_north - p_south) * 0.06);

  with sel as (
    select ml.kind, ml.source_id, ml.jurisdiction, f.attrs, f.geom
    from gis.map_layers ml
    join gis.layer_features f on f.source_id = ml.source_id
    where ml.kind = any(p_kinds)
      and not (ml.kind = any(ground))
      and f.geom_5070 && env5070
      and (ml.kind in ('water_service_area', 'sewer_service_area',
                       'electric_transmission', 'electric_substation', 'gas_transmission',
                       'rail_line', 'rail_crossing')
           or area_km2 <= 40)
    order by ml.sort
    limit lim + 1
  ),
  cut as (select * from sel limit lim),
  line_feats as (
    select jsonb_build_object(
      'type', 'Feature',
      'geometry', extensions.st_asgeojson(
         case when tol > 0 then extensions.st_simplifypreservetopology(c.geom, tol) else c.geom end, digits)::jsonb,
      'properties', gis.feature_props(c.kind, c.source_id, c.jurisdiction, c.attrs)) as f
    from cut c
  ),
  ground_src as (
    select ml.kind,
           gis.feature_props(ml.kind, ml.source_id, ml.jurisdiction, f.attrs) as props,
           extensions.st_intersection(extensions.st_makevalid(f.geom), env_pad) as geom
    from gis.map_layers ml
    join gis.layer_features f on f.source_id = ml.source_id
    where ml.kind = any(p_kinds)
      and ml.kind = any(ground)
      and area_km2 <= 250
      and f.geom_5070 && extensions.st_transform(env_pad, 5070)
      -- unshaded X (minimal hazard), open water and undetermined zones are not painted
      and (ml.kind <> 'flood_zone' or f.attrs->>'SFHA_TF' = 'T' or f.attrs->>'ZONE_SUBTY' ilike '%0.2 PCT%')
  ),
  ground_dissolved as (
    -- one shape per class (+ BFE for flood); NWI props differ per polygon, so no merge
    select kind, props, extensions.st_union(geom) as geom
    from ground_src
    group by kind, props
  ),
  ground_feats as (
    select jsonb_build_object(
      'type', 'Feature',
      -- simplify, smooth, then drop the near-collinear points Chaikin leaves on straight runs
      'geometry', extensions.st_asgeojson(
         extensions.st_simplify(
           extensions.st_chaikinsmoothing(
             extensions.st_simplifypreservetopology(extensions.st_makevalid(geom), greatest(tol, 0.00004)),
             2, false),
           greatest(tol, 0.00004) * 0.4), digits)::jsonb,
      'properties', props) as f
    from ground_dissolved
    where not extensions.st_isempty(geom)
  )
  select (select count(*) from sel),
         (select jsonb_agg(f) from (select f from ground_feats union all select f from line_feats) x)
  into n, feats;

  return jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(feats, '[]'::jsonb),
    'truncated', coalesce(n, 0) > lim);
end $$;

commit;
