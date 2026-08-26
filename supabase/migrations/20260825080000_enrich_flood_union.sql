-- Applied 2026-08-25 via MCP.
--
-- FEMA rebuilds the NFHL and reassigns OBJECTIDs between editions, so a cache
-- that survives more than one edition accumulates the same polygon under two
-- keys (observed: 272,710 cached rows against a ~190k ordered walk). Summing
-- raw intersection areas would double-count those — pct_sfha / pct_floodway
-- are now measured on the ST_Union of the intersections per class, which
-- collapses duplicate-edition polygons and legitimate overlap alike.
--
-- Verified after the ordered re-walk: 100/100 spot-checked parcels mapped
-- (the skip-riddled first cache managed 41/288), zones A/AE/X, avg 21.6% SFHA,
-- none over 100.
--
-- Also recorded here: the flood_finish cron pattern that drains the queue —
-- every minute, try-lock 778812, statement_timeout 0, two enrich_flood(null,600)
-- calls, and a final score_parcels + self-unschedule when no unmarked rows
-- remain.

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
    select pe.property_id, gp.geom_5070, extensions.st_area(gp.geom_5070) as area_m2
    from parcel_enrichment pe
    join gis.parcels gp on gp.property_id = pe.property_id
    where (p_county is null or gp.county = p_county)
      and not (pe.source_status ? 'flood')
    limit greatest(p_limit, 1)
  ),
  hits as (
    select t.property_id, t.area_m2,
           f.attrs->>'FLD_ZONE' as zone,
           coalesce(f.attrs->>'ZONE_SUBTY', '') as subty,
           coalesce(f.attrs->>'SFHA_TF', '') as sfha,
           extensions.st_intersection(t.geom_5070, f.geom_5070) as ov
    from todo t
    join gis.layer_features f
      on f.source_id = 'fema_flood'
     and extensions.st_intersects(t.geom_5070, f.geom_5070)
  ),
  rolled as (
    select property_id,
           max(area_m2) as area_m2,
           extensions.st_area(extensions.st_union(ov) filter (where sfha = 'T')) as sfha_m2,
           extensions.st_area(extensions.st_union(ov) filter (where subty ilike '%FLOODWAY%')) as fw_m2,
           (array_agg(zone order by extensions.st_area(ov) desc))[1] as zone
    from hits
    group by property_id
  ),
  up as (
    update parcel_enrichment pe
    set fema_flood_zone = r.zone,
        pct_sfha = case when r.property_id is null then null
             else least(100, greatest(0,
               100 * coalesce(r.sfha_m2, 0) / nullif(r.area_m2, 0)))::numeric(5,2) end,
        pct_floodway = case when r.property_id is null then null
             else least(100, greatest(0,
               100 * coalesce(r.fw_m2, 0) / nullif(r.area_m2, 0)))::numeric(5,2) end,
        source_status = pe.source_status || jsonb_build_object('flood', jsonb_build_object(
          'status', case when r.property_id is null then 'unmapped' else 'ok' end,
          'as_of', now(),
          'detail', 'FEMA NFHL union-of-intersections overlap; duplicate-edition-proof'))
    from todo t left join rolled r on r.property_id = t.property_id
    where pe.property_id = t.property_id
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_flood(text, int) is
  'FEMA NFHL overlap per parcel: dominant zone, % SFHA, % floodway, measured on the '
  'ST_Union of intersections per class so duplicate polygons from successive NFHL '
  'editions cannot double-count. Claims on the flood mark; unmapped stays null and '
  'is processed exactly once.';

revoke all on function enrich_flood(text, int) from public, anon;
grant execute on function enrich_flood(text, int) to service_role, authenticated;

commit;
