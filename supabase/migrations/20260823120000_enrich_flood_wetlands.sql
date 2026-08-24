-- Applied 2026-08-23 via MCP.
--
-- Flood and wetlands: the two biggest weights in the suitability score (12 each
-- of 112) and the two Alex's developers ask about first. Both are computed as
-- real area overlap against the cached polygons, not a point-in-polygon test —
-- "the centroid is in zone X" tells a developer nothing about the 40% of the
-- parcel that is in AE.
--
-- WHEN TO RUN. Only after the layer harvest for that source is COMPLETE. Both
-- enrichers claim rows where their own column is still null, so a parcel scored
-- against a half-cached layer would keep the wrong number forever. gis.layers
-- carries feature_count/harvested_at; check it before adding these to
-- enrich_sweep.
--
-- The zero cases differ, and the difference matters:
--   * NWI maps wetlands, not their absence. No intersecting wetland polygon
--     means no mapped wetland, so wetlands_pct writes 0.
--   * The NFHL includes zone X, so a parcel normally intersects SOMETHING. A
--     parcel intersecting no NFHL polygon at all is UNMAPPED, not dry — it
--     stays null and its source_status says so.

begin;

create or replace function enrich_flood(p_county text, p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare v_written int;
begin
  with todo as (
    select gp.property_id, gp.geom_5070, extensions.st_area(gp.geom_5070) as area_m2
    from gis.parcels gp
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and pe.pct_sfha is null
    limit greatest(p_limit, 1)
  ),
  hits as (
    select t.property_id, t.area_m2,
           f.attrs->>'FLD_ZONE' as zone,
           f.attrs->>'ZONE_SUBTY' as subty,
           coalesce(f.attrs->>'SFHA_TF', '') as sfha,
           extensions.st_area(extensions.st_intersection(t.geom_5070, f.geom_5070)) as ov_m2
    from todo t
    join gis.layer_features f
      on f.source_id = 'fema_flood'
     and extensions.st_intersects(t.geom_5070, f.geom_5070)
  ),
  rolled as (
    select property_id,
           max(area_m2) as area_m2,
           sum(ov_m2) filter (where sfha = 'T') as sfha_m2,
           sum(ov_m2) filter (where coalesce(subty, '') ilike '%FLOODWAY%') as fw_m2,
           -- the zone covering the most of the parcel is the one to print
           (array_agg(zone order by ov_m2 desc))[1] as zone
    from hits
    where ov_m2 > 0
    group by property_id
  ),
  up as (
    insert into parcel_enrichment as pe (property_id, fema_flood_zone, pct_sfha,
                                         pct_floodway, source_status)
    select t.property_id, r.zone,
           case when r.property_id is null then null
                else least(100, greatest(0,
                  100 * coalesce(r.sfha_m2, 0) / nullif(r.area_m2, 0)))::numeric(5,2) end,
           case when r.property_id is null then null
                else least(100, greatest(0,
                  100 * coalesce(r.fw_m2, 0) / nullif(r.area_m2, 0)))::numeric(5,2) end,
           jsonb_build_object('flood', jsonb_build_object(
             'status', case when r.property_id is null then 'unmapped' else 'ok' end,
             'as_of', now(),
             'detail', 'FEMA NFHL area overlap; unmapped = no NFHL polygon covers this parcel'))
    from todo t left join rolled r on r.property_id = t.property_id
    on conflict (property_id) do update
      set fema_flood_zone = excluded.fema_flood_zone,
          pct_sfha        = excluded.pct_sfha,
          pct_floodway    = excluded.pct_floodway,
          source_status   = pe.source_status || excluded.source_status
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_flood(text, int) is
  'FEMA NFHL overlap per parcel: the dominant zone by area, percent in a Special '
  'Flood Hazard Area, and percent in the regulatory floodway. Area overlap, not a '
  'centroid test. A parcel no NFHL polygon covers stays null (unmapped), never 0.';

revoke all on function enrich_flood(text, int) from public, anon;
grant execute on function enrich_flood(text, int) to service_role, authenticated;

create or replace function enrich_wetlands(p_county text, p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare v_written int;
begin
  with todo as (
    select gp.property_id, gp.geom_5070, extensions.st_area(gp.geom_5070) as area_m2
    from gis.parcels gp
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and pe.wetlands_pct is null
    limit greatest(p_limit, 1)
  ),
  rolled as (
    select t.property_id, max(t.area_m2) as area_m2,
           sum(extensions.st_area(extensions.st_intersection(t.geom_5070, f.geom_5070))) as ov_m2
    from todo t
    join gis.layer_features f
      on f.source_id = 'nwi_wetlands'
     and extensions.st_intersects(t.geom_5070, f.geom_5070)
    group by t.property_id
  ),
  up as (
    insert into parcel_enrichment as pe (property_id, wetlands_pct, source_status)
    select t.property_id,
           -- NWI maps wetlands, not their absence: no intersecting polygon is a
           -- measured zero, not a gap.
           least(100, greatest(0,
             100 * coalesce(r.ov_m2, 0) / nullif(t.area_m2, 0)))::numeric(5,2),
           jsonb_build_object('wetlands', jsonb_build_object(
             'status', 'ok', 'as_of', now(),
             'detail', 'USFWS NWI area overlap; no intersecting polygon = 0%'))
    from todo t left join rolled r on r.property_id = t.property_id
    on conflict (property_id) do update
      set wetlands_pct  = excluded.wetlands_pct,
          source_status = pe.source_status || excluded.source_status
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_wetlands(text, int) is
  'USFWS NWI wetland coverage as a percent of parcel area, by real intersection. '
  'No intersecting polygon writes 0 — NWI maps wetlands, so absence is an answer.';

revoke all on function enrich_wetlands(text, int) from public, anon;
grant execute on function enrich_wetlands(text, int) to service_role, authenticated;

commit;
