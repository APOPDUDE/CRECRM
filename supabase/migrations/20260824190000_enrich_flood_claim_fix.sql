-- Applied 2026-08-24 via MCP.
--
-- Two flood-enrichment defects found by the first real run:
--
-- 1. RECLAIM LOOP. enrich_flood claimed rows on `pe.pct_sfha is null`, but an
--    UNMAPPED parcel (no NFHL polygon covers it) legitimately keeps pct_sfha
--    null — so every tick re-claimed and re-processed the same unmapped rows
--    forever. First tick: 500 claims, 288 distinct parcels. The claim now keys
--    on the `flood` mark in source_status, which every processed row gets
--    regardless of outcome; unmapped stays visibly unmapped without being
--    re-ground each tick. A partial index makes the shrinking todo-scan cheap.
--
-- 2. BAD CACHE. 247 of those 288 parcels found no zone at all — impossible in
--    Florida, where where=1=1 includes zone X. Root cause: fema_flood was the
--    ONE layer harvested without orderByFields, and unordered offset paging
--    skipped features wholesale (the harvester's own comment warned of exactly
--    this). The layer config now carries oid OBJECTID and the cache is being
--    re-walked ordered; this migration also clears the flood marks written
--    against the bad cache so those parcels re-measure against the good one.

begin;

create index if not exists parcel_enrichment_flood_todo_idx
  on parcel_enrichment (property_id)
  where not (source_status ? 'flood');

comment on index parcel_enrichment_flood_todo_idx is
  'The flood-enrichment work queue: rows not yet measured against the NFHL cache. '
  'Partial, so it shrinks to nothing as enrich_flood completes.';

create or replace function enrich_flood(p_county text, p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare v_written int;
begin
  with todo as (
    -- Driven from parcel_enrichment (every parcel has a row once the infra
    -- sweep touches it) via the partial index; claimed on the flood MARK, not
    -- the value, so an unmapped parcel is processed exactly once.
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
           (array_agg(zone order by ov_m2 desc))[1] as zone
    from hits
    where ov_m2 > 0
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
          'detail', 'FEMA NFHL area overlap; unmapped = no NFHL polygon covers this parcel'))
    from todo t left join rolled r on r.property_id = t.property_id
    where pe.property_id = t.property_id
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_flood(text, int) is
  'FEMA NFHL overlap per parcel: dominant zone by area, % in an SFHA, % in the '
  'regulatory floodway. Claims on the flood mark in source_status (not the value), '
  'so unmapped parcels are processed once, never looped. Run only against a COMPLETE '
  'ordered-walk NFHL cache.';

revoke all on function enrich_flood(text, int) from public, anon;
grant execute on function enrich_flood(text, int) to service_role, authenticated;

-- Un-mark the rows measured against the skip-riddled first cache so they
-- re-measure against the re-walked one.
update parcel_enrichment
set source_status = source_status - 'flood',
    fema_flood_zone = null, pct_sfha = null, pct_floodway = null
where source_status ? 'flood';

commit;
