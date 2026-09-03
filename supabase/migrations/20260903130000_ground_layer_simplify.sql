-- 2026-09-03: coarser simplification for the district view. A 40 km2 flood + wetland
-- answer weighed 840 KB at 10 m; at zoom 12 (80 km2) that is a phone-hostile 1.7 MB.
-- 20 m at zoom <= 12 costs nothing visible on photo-interpreted polygons. Applied via MCP.

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
  area_km2 numeric;
  tol      numeric;
  digits   int;
  lim      constant int := 4000;
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
  -- ~20 m at the district view (a 40 km2 flood + wetland answer was 840 KB at 10 m; the
  -- ground polygons are photo-interpreted and lose nothing at 20 m on a screen);
  -- 5 decimals (~1 m) is plenty until the camera is on one block
  tol    := case when p_zoom >= 16 then 0 when p_zoom >= 14 then 0.00002 when p_zoom >= 13 then 0.0001 else 0.0002 end;
  digits := case when p_zoom >= 17 then 6 else 5 end;

  with sel as (
    select ml.kind, ml.source_id, ml.jurisdiction, f.attrs, f.geom
    from gis.map_layers ml
    join gis.layer_features f on f.source_id = ml.source_id
    where ml.kind = any(p_kinds)
      and f.geom_5070 && env5070
      -- unshaded X (minimal hazard), open water and undetermined zones are not painted
      and (ml.kind <> 'flood_zone' or f.attrs->>'SFHA_TF' = 'T' or f.attrs->>'ZONE_SUBTY' ilike '%0.2 PCT%')
      and (ml.kind in ('water_service_area', 'sewer_service_area',
                       'electric_transmission', 'electric_substation', 'gas_transmission',
                       'rail_line', 'rail_crossing')
           or (ml.kind in ('flood_zone', 'wetland') and area_km2 <= 150)
           or area_km2 <= 40)
    order by ml.sort
    limit lim + 1
  ),
  cut as (select * from sel limit lim)
  select (select count(*) from sel),
         jsonb_agg(jsonb_build_object(
           'type', 'Feature',
           'geometry', extensions.st_asgeojson(
              case when tol > 0 then extensions.st_simplifypreservetopology(c.geom, tol) else c.geom end, digits)::jsonb,
           'properties', gis.feature_props(c.kind, c.source_id, c.jurisdiction, c.attrs)))
  into n, feats
  from cut c;

  return jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(feats, '[]'::jsonb),
    'truncated', coalesce(n, 0) > lim);
end $$;

commit;
