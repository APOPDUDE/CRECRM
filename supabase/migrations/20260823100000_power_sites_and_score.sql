-- Applied 2026-08-23 via MCP.
--
-- Two things: fix the power-proximity proxy, and turn the enrichment columns
-- into the 0-100 developer suitability score Alex asked for.
--
-- WHY THE POWER PROXY WAS BROKEN. enrich_power_proximity looked for a built
-- neighbour inside gis.parcels — but gis.parcels is populated by the LAND
-- harvest (land DOR classes, >= 0.5 ac), so built parcels are almost absent
-- from it: 72 of Pinellas's 2,004 cached polygons, 117 of Polk's 66,000. The
-- first run measured 200 Pinellas parcels and returned "nothing within a mile"
-- for all 200 — impossible in a county that dense, and the tell that the join
-- had nothing to find. It now measures against gis.powered_sites, a point per
-- county-synced built parcel drawn from properties.lat/lng: 11,621 sites
-- instead of ~5,000 polygons, and covering the whole book rather than the land
-- slice of it.
--
-- What this signal honestly is: distance to the nearest BUILDING WE KNOW OF.
-- Our book is industrial-biased, so in a rural stretch the nearest house with a
-- meter on it may be far closer than the nearest thing we have a record of.
-- Read it as "there is served development this close", never as "there is no
-- power nearer than this". The authoritative electricity answers are
-- electric_provider / substation_dist_ft / transmission_line_dist_ft
-- (20260823090000); this is the supporting signal, weighted 6 against power's 8.

begin;

create table if not exists gis.powered_sites (
  property_id uuid primary key,
  geom_5070   geometry(Point, 5070) not null
);

create index if not exists powered_sites_geom_idx
  on gis.powered_sites using gist (geom_5070);

comment on table gis.powered_sites is
  'Point per county-synced BUILT parcel (>= 1,000 SF), from properties.lat/lng. '
  'Derived cache — rebuild with refresh_powered_sites(); never written by hand.';

create or replace function refresh_powered_sites() returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare v_n int;
begin
  truncate gis.powered_sites;
  insert into gis.powered_sites (property_id, geom_5070)
  select pr.id,
         extensions.st_transform(
           extensions.st_setsrid(extensions.st_makepoint(pr.lng, pr.lat), 4326), 5070)
  from properties pr
  where pr.lat is not null and pr.lng is not null
    -- county_synced_at gates it for the same reason refresh_land_book does: a
    -- scraped square footage (0 included) is not evidence (20260814100000).
    and pr.county_synced_at is not null
    and greatest(coalesce(pr.gross_sf, 0), coalesce(pr.heated_sf, 0)) >= 1000;
  get diagnostics v_n = row_count;
  return jsonb_build_object('sites', v_n);
end $$;

revoke all on function refresh_powered_sites() from public, anon;
grant execute on function refresh_powered_sites() to service_role, authenticated;

create or replace function enrich_power_proximity(p_county text, p_limit int default 2000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
  c_m constant numeric := 3.280839895;
  r_m constant numeric := 1609;          -- one mile
begin
  with todo as (
    select gp.property_id, gp.geom_5070
    from gis.parcels gp
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and pe.nearest_powered_parcel_ft is null
    limit greatest(p_limit, 1)
  ),
  near as (
    select t.property_id,
           (select extensions.st_distance(t.geom_5070, s.geom_5070) * c_m
              from gis.powered_sites s
             where s.property_id <> t.property_id
               and extensions.st_dwithin(t.geom_5070, s.geom_5070, r_m)
             order by t.geom_5070 <-> s.geom_5070
             limit 1) as dist_ft
    from todo t
  ),
  up as (
    insert into parcel_enrichment as pe (property_id, nearest_powered_parcel_ft, source_status)
    select n.property_id,
           coalesce(n.dist_ft, r_m * c_m)::numeric(10,1),
           jsonb_build_object('power_nearby', jsonb_build_object(
             'status', case when n.dist_ft is null then 'partial' else 'ok' end,
             'as_of', now(),
             'detail', 'nearest county-synced built parcel in our book within 1 mi; '
                       'book is industrial-biased, so this is a floor on development, '
                       'not a ceiling on where power is'))
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
  'Distance to the nearest county-synced BUILT parcel in our book (>= 1,000 SF) '
  'within a mile, via gis.powered_sites. 5,280 means "none within a mile", not null. '
  'Supporting signal only — our book is industrial-biased, so a far value does not '
  'mean no power nearby; enrich_electric carries the authoritative answers.';

revoke all on function enrich_power_proximity(text, int) from public, anon;
grant execute on function enrich_power_proximity(text, int) to service_role, authenticated;

-- ------------------------------------------------------- suitability score

-- Generic on purpose: the factor list, its weights, and every threshold live in
-- enrichment_score_weights, and the scorer reads the enrichment row as jsonb so
-- adding a factor is an INSERT, not a migration.
--
-- Normalized over AVAILABLE factors: a parcel with no wetlands measurement yet
-- is scored on the factors it does have, and score_breakdown.coverage says what
-- fraction of the total weight that was. Scoring a half-measured parcel against
-- the full denominator would read as "bad site" when it means "not looked at
-- yet" — the same distinction the sentinel distances protect.
create or replace function score_parcels(p_county text default null, p_limit int default 5000,
                                         p_min_coverage numeric default 0.25)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
  v_version constant text := 'v1';
begin
  with wts as (
    select factor, weight, params from enrichment_score_weights where enabled
  ),
  todo as (
    select pe.property_id, to_jsonb(pe) as j
    from parcel_enrichment pe
    join properties pr on pr.id = pe.property_id
    where (p_county is null or pr.county = p_county)
      and (pe.scored_at is null or pe.updated_at > pe.scored_at)
    limit greatest(p_limit, 1)
  ),
  raw as (
    select t.property_id, w.factor, w.weight, w.params,
           nullif(t.j->>(w.params->>'input'), '') as txt,
           case when (w.params->>'kind') = 'bool_pair' then w.params->'inputs' end as pair,
           t.j as j
    from todo t cross join wts w
  ),
  val as (
    select r.property_id, r.factor, r.weight, r.params,
           case r.params->>'kind'
             -- closer is better: full credit at full_at, none at zero_at
             when 'decay' then
               case when r.txt is null then null
                    else greatest(0, least(1,
                      ((r.params->>'zero_at')::numeric - r.txt::numeric)
                      / nullif((r.params->>'zero_at')::numeric - (r.params->>'full_at')::numeric, 0))) end
             -- more is better (road frontage): full credit at full_at
             when 'decay_inverse' then
               case when r.txt is null then null
                    else greatest(0, least(1,
                      (r.txt::numeric - (r.params->>'zero_at')::numeric)
                      / nullif((r.params->>'full_at')::numeric - (r.params->>'zero_at')::numeric, 0))) end
             -- a 0-100 percentage where less is better
             when 'inverse_pct' then
               case when r.txt is null then null
                    else greatest(0, least(1, 1 - r.txt::numeric / 100)) end
             when 'inverse_linear' then
               case when r.txt is null then null
                    else greatest(0, least(1, 1 - r.txt::numeric
                      / nullif((r.params->>'zero_at')::numeric, 0))) end
             -- already 0-1 (rectangularity)
             when 'direct' then
               case when r.txt is null then null
                    else greatest(0, least(1, r.txt::numeric)) end
             when 'bool' then
               case when r.txt is null then null when r.txt::boolean then 1 else 0 end
             when 'bool_pair' then (
               select avg(case when r.j->>k is null then null
                               when (r.j->>k)::boolean then 1 else 0 end)
               from jsonb_array_elements_text(r.pair) k)
           end as v,
           -- a dealbreaker threshold zeroes the WHOLE score, not just its factor
           case when r.params ? 'dealbreaker_at' and r.txt is not null
                     and r.txt::numeric >= (r.params->>'dealbreaker_at')::numeric
                then true else false end as kill
    from raw r
  ),
  agg as (
    select property_id,
           bool_or(kill) as killed,
           sum(weight) filter (where v is not null) as w_have,
           sum(weight) as w_all,
           sum(weight * v) filter (where v is not null) as earned,
           jsonb_object_agg(factor, jsonb_build_object(
             'value', round(v, 4), 'weight', weight,
             'points', round(weight * v, 2))) filter (where v is not null) as parts
    from val
    group by property_id
  ),
  calc as (
    select property_id, killed, w_have, w_all, parts,
           coalesce(w_have, 0) / nullif(w_all, 0) as cover,
           case when killed then 0
                -- Below the coverage floor the score is WITHHELD, not published.
                -- Normalizing over one measured factor produced honest arithmetic
                -- and a dishonest number: the first Pinellas run scored parcels
                -- 100/100 off nothing but a substation distance (coverage 0.071).
                -- score_breakdown still records what was measured, so the row
                -- reads as "not enough measured yet" instead of "perfect site".
                when coalesce(w_have, 0) / nullif(w_all, 0) < p_min_coverage then null
                else round(100 * earned / w_have, 2) end as score
    from agg
  ),
  up as (
    update parcel_enrichment pe
    set suitability_score = c.score,
        score_breakdown = jsonb_build_object(
          'factors', coalesce(c.parts, '{}'::jsonb),
          'coverage', round(c.cover, 3),
          'min_coverage', p_min_coverage,
          'killed', c.killed),
        score_version = v_version,
        scored_at = now()
    from calc c
    where pe.property_id = c.property_id
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'scored', v_written,
                            'version', v_version, 'min_coverage', p_min_coverage);
end $$;

comment on function score_parcels(text, int, numeric) is
  'Composite 0-100 developer suitability score from enrichment_score_weights. '
  'Normalized over the factors actually measured, and WITHHELD (score null, breakdown '
  'still written) below p_min_coverage of the total weight — a score off one factor is '
  'a lie, not a headline. The infrastructure pass alone covers 0.286 (power, power_nearby, '
  'gas, highway_access, rail, shape), which is why the floor sits at 0.25; it rises as '
  'flood/wetlands/utilities land. A factor past its dealbreaker_at (90% SFHA, 85% '
  'wetlands) zeroes the whole score. Re-scores only rows changed since scored_at.';

revoke all on function score_parcels(text, int, numeric) from public, anon;
grant execute on function score_parcels(text, int, numeric) to service_role, authenticated;

commit;
