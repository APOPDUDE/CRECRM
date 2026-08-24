-- Applied 2026-08-22 via MCP.
--
-- The enrichment pipeline's first REAL numbers: everything derivable from the
-- parcel polygons themselves plus our own book, with no external layer cache.
--
-- Why this subset first. Alex asked for utilities/flood/wetlands; measuring the
-- sources showed FEMA SFHA is 84,714 polygons and NWI 261,775 polygons over the
-- six counties — gigabytes of geometry that cannot sensibly be cached in the
-- app database, and Polk's utility service-area layers turn out to serve NO
-- geometry at all (attribute-only, verified: rings=0 under both f=json and
-- f=geojson). So those become a per-parcel batch job (they need the remote
-- service anyway), while THESE signals need nothing but gis.parcels:
--
--   parcel_depth_ft / parcel_width_ft  -- the minimum rotated rectangle's sides
--   rectangularity                     -- area / that rectangle's area
--   nearest_powered_parcel_ft          -- distance to the nearest county-synced
--                                         BUILT parcel. Alex 2026-08-21: "the big
--                                         thing... can power be run to the property
--                                         or is it already there". Utility
--                                         distribution GIS is proprietary, so a
--                                         served neighbour is the honest proxy:
--                                         if the parcel next door has a building,
--                                         distribution is at the road.
--
-- Set-based over a county at a time, and the caller drives it in slices, because
-- a whole-book pass over 100k polygons outlives every client timeout (the land
-- book backfill already taught us that — it runs as pg_cron).

begin;

create or replace function enrich_parcel_geometry(p_county text, p_limit int default 5000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
begin
  with todo as (
    select gp.property_id, gp.geom_5070
    from gis.parcels gp
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and pe.parcel_width_ft is null      -- not yet measured
    limit greatest(p_limit, 1)
  ),
  shape as (
    select t.property_id,
           -- the minimum ROTATED rectangle, so a diagonal parcel is measured
           -- along its own axes rather than against north
           extensions.st_orientedenvelope(t.geom_5070) as mbr,
           extensions.st_area(t.geom_5070) as area_m2
    from todo t
  ),
  dims as (
    select s.property_id, s.area_m2,
           extensions.st_area(s.mbr) as mbr_area,
           -- side lengths of the oriented box: distances between consecutive corners
           extensions.st_distance(
             extensions.st_pointn(extensions.st_exteriorring(s.mbr), 1),
             extensions.st_pointn(extensions.st_exteriorring(s.mbr), 2)) as side_a,
           extensions.st_distance(
             extensions.st_pointn(extensions.st_exteriorring(s.mbr), 2),
             extensions.st_pointn(extensions.st_exteriorring(s.mbr), 3)) as side_b
    from shape s
    where extensions.st_geometrytype(s.mbr) = 'ST_Polygon'
  ),
  calc as (
    select property_id,
           -- metres -> feet
           (greatest(side_a, side_b) * 3.280839895)::numeric(10,1) as depth_ft,
           (least(side_a, side_b)    * 3.280839895)::numeric(10,1) as width_ft,
           case when mbr_area > 0
                then least(1.0, (area_m2 / mbr_area))::numeric(4,3) end as rect
    from dims
    where side_a > 0 and side_b > 0
  ),
  up as (
    insert into parcel_enrichment as pe (property_id, parcel_depth_ft, parcel_width_ft,
                                         rectangularity, source_status)
    select c.property_id, c.depth_ft, c.width_ft, c.rect,
           jsonb_build_object('geometry', jsonb_build_object(
             'status', 'ok', 'as_of', now(), 'detail', 'oriented MBR from gis.parcels'))
    from calc c
    on conflict (property_id) do update
      set parcel_depth_ft = excluded.parcel_depth_ft,
          parcel_width_ft = excluded.parcel_width_ft,
          rectangularity  = excluded.rectangularity,
          source_status   = pe.source_status || excluded.source_status
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_parcel_geometry(text, int) is
  'Measure parcel shape from gis.parcels: depth/width from the oriented minimum '
  'bounding rectangle (so diagonal parcels measure along their own axes) and '
  'rectangularity = area / MBR area. Slice-at-a-time; re-running only picks up '
  'parcels not yet measured.';

revoke all on function enrich_parcel_geometry(text, int) from public, anon;
grant execute on function enrich_parcel_geometry(text, int) to service_role, authenticated;

-- ---------------------------------------------------------------- power proxy

create or replace function enrich_power_proximity(p_county text, p_limit int default 2000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
begin
  with todo as (
    select gp.property_id, gp.geom_5070
    from gis.parcels gp
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and pe.nearest_powered_parcel_ft is null
    limit greatest(p_limit, 1)
  ),
  -- A "powered" neighbour is a parcel the COUNTY says carries a real building.
  -- county_synced_at gates it for the same reason refresh_land_book does: a
  -- scraped SF (0 included) is not evidence (20260814100000).
  near as (
    select t.property_id,
           (select extensions.st_distance(t.geom_5070, b.geom_5070) * 3.280839895
            from gis.parcels b
            join properties pr on pr.id = b.property_id
            where b.property_id <> t.property_id
              and pr.county_synced_at is not null
              and greatest(coalesce(pr.gross_sf, 0), coalesce(pr.heated_sf, 0)) >= 1000
              -- bound the search: past a mile the answer is "not near power" anyway
              and extensions.st_dwithin(t.geom_5070, b.geom_5070, 1609)
            order by t.geom_5070 <-> b.geom_5070
            limit 1) as dist_ft
    from todo t
  ),
  up as (
    insert into parcel_enrichment as pe (property_id, nearest_powered_parcel_ft, source_status)
    select n.property_id,
           -- no built neighbour inside a mile: record the floor, not null, so the
           -- row reads as "measured, and the answer is far" rather than "unknown"
           coalesce(n.dist_ft, 5280)::numeric(10,1),
           jsonb_build_object('utilities', jsonb_build_object(
             'status', case when n.dist_ft is null then 'partial' else 'ok' end,
             'as_of', now(),
             'detail', 'nearest county-synced built parcel within 1 mi'))
    from near n
    on conflict (property_id) do update
      set nearest_powered_parcel_ft = excluded.nearest_powered_parcel_ft,
          source_status = pe.source_status || excluded.source_status
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_power_proximity(text, int) is
  'Distance to the nearest county-synced BUILT parcel (>= 1,000 SF) within a mile — '
  'the honest proxy for "is power already at the road", since utility distribution '
  'GIS is proprietary (Alex 2026-08-21). 5280 means "none within a mile", not null.';

revoke all on function enrich_power_proximity(text, int) from public, anon;
grant execute on function enrich_power_proximity(text, int) to service_role, authenticated;

commit;
