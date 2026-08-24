-- Applied 2026-08-23 via MCP.
--
-- The infrastructure half of the enrichment pipeline: electricity, gas, road
-- and rail, computed as PostGIS joins against the layer cache.
--
-- Alex, 2026-08-21, on what matters most: "what about eletricity cause that's
-- the big thing, like I want to know if power can be run to the property or is
-- it already there." No public dataset answers that outright — every utility
-- treats its distribution network (the poles on the street) as proprietary. So
-- the question gets decomposed into three things that ARE public, and the
-- answer is the three together:
--
--   electric_provider          WHO serves the parcel (HIFLD retail territory
--                              polygon) — the utility you call for a will-serve
--   substation_dist_ft         how far to the nearest in-service substation,
--                              which is where capacity actually lives
--   transmission_line_dist_ft  how far to the transmission backbone, and at
--   transmission_kv            what voltage — the tap a large load would need
--
-- None of these is a will-serve letter and the score treats them as proximity
-- signals, not guarantees. What they do give is a first cut: a 40-acre parcel
-- 800 ft from a 230 kV substation inside Duke's territory is a different
-- conversation than one 6 miles from anything.
--
-- Radius caps and sentinels. Every measurement bounds its search (10 mi for
-- utilities, 25 mi for interchange/rail) so the KNN scan stays indexed, and
-- writes the CAP rather than null when nothing is found. That keeps "measured,
-- and the answer is far" distinct from "never looked" — the same convention
-- enrich_power_proximity already uses with its 5,280 ft floor.
--
-- Slice-at-a-time over one county, like enrich_parcel_geometry: a whole-book
-- pass outlives every client timeout.

begin;

-- KNN over the shared layer cache has to be filtered by source_id, and a plain
-- GIST index on geometry alone would walk every layer's features before the
-- filter rejected them. btree_gist lets source_id live inside the same index.
create extension if not exists btree_gist with schema extensions;

create index if not exists layer_features_src_geom5070_idx
  on gis.layer_features using gist (source_id, geom_5070);

comment on index gis.layer_features_src_geom5070_idx is
  'Composite (source_id, geom_5070) so per-layer nearest-neighbour searches stay '
  'inside one layer''s features. Needs btree_gist for the text column.';

-- ------------------------------------------------------------- electricity

create or replace function enrich_electric(p_county text, p_limit int default 2000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
  c_m constant numeric := 3.280839895;   -- metres -> feet
  r_m constant numeric := 16093;         -- 10 mile search radius, in metres
begin
  with todo as (
    select gp.property_id, gp.geom_5070
    from gis.parcels gp
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and pe.substation_dist_ft is null       -- not yet measured
    limit greatest(p_limit, 1)
  ),
  measured as (
    select t.property_id,
           (select extensions.st_distance(t.geom_5070, f.geom_5070) * c_m
              from gis.layer_features f
             where f.source_id = 'electric_substations'
               -- HIFLD carries planned and retired sites too; only an in-service
               -- substation is capacity you could actually be fed from
               and coalesce(f.attrs->>'STATUS', '') ilike 'IN SERVICE'
               and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_m)
             order by t.geom_5070 <-> f.geom_5070
             limit 1) as sub_ft,
           (select jsonb_build_object(
                     'ft', extensions.st_distance(t.geom_5070, f.geom_5070) * c_m,
                     -- HIFLD's null sentinel for voltage is -999999
                     'kv', nullif(greatest((f.attrs->>'VOLTAGE')::numeric, 0), 0))
              from gis.layer_features f
             where f.source_id = 'electric_transmission'
               and coalesce(f.attrs->>'STATUS', '') ilike 'IN SERVICE'
               and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_m)
             order by t.geom_5070 <-> f.geom_5070
             limit 1) as tx,
           (select f.attrs->>'NAME'
              from gis.layer_features f
             where f.source_id = 'electric_territories'
               -- generalized territory polygons can leave hairline gaps at the
               -- boundary, so fall back to the nearest one within 1 km
               and extensions.st_dwithin(t.geom_5070, f.geom_5070, 1000)
             order by t.geom_5070 <-> f.geom_5070
             limit 1) as provider
    from todo t
  ),
  up as (
    insert into parcel_enrichment as pe (
      property_id, substation_dist_ft, transmission_line_dist_ft,
      transmission_kv, electric_provider, source_status)
    select m.property_id,
           least(coalesce(m.sub_ft, r_m * c_m), r_m * c_m)::numeric(10,1),
           least(coalesce((m.tx->>'ft')::numeric, r_m * c_m), r_m * c_m)::numeric(10,1),
           (m.tx->>'kv')::numeric::int,
           m.provider,
           jsonb_build_object('utilities_electric', jsonb_build_object(
             'status', case when m.sub_ft is null and m.tx is null then 'partial' else 'ok' end,
             'as_of', now(),
             'detail', 'HIFLD substations/transmission/retail territories, 10 mi cap'))
    from measured m
    on conflict (property_id) do update
      set substation_dist_ft        = excluded.substation_dist_ft,
          transmission_line_dist_ft = excluded.transmission_line_dist_ft,
          transmission_kv           = excluded.transmission_kv,
          electric_provider         = excluded.electric_provider,
          source_status             = pe.source_status || excluded.source_status
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_electric(text, int) is
  'Electricity signals from the HIFLD cache: serving utility (territory polygon), '
  'distance to the nearest IN SERVICE substation, and distance + voltage of the '
  'nearest transmission line. 52,800 ft means "nothing within the 10 mile cap", '
  'not unknown. Proximity only — never a substitute for a will-serve letter.';

revoke all on function enrich_electric(text, int) from public, anon;
grant execute on function enrich_electric(text, int) to service_role, authenticated;

-- --------------------------------------------------------------------- gas

create or replace function enrich_gas(p_county text, p_limit int default 2000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
  c_m constant numeric := 3.280839895;
  r_m constant numeric := 16093;
begin
  with todo as (
    select gp.property_id, gp.geom_5070
    from gis.parcels gp
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and pe.gas_transmission_dist_ft is null
    limit greatest(p_limit, 1)
  ),
  measured as (
    select t.property_id,
           (select jsonb_build_object(
                     'ft', extensions.st_distance(t.geom_5070, f.geom_5070) * c_m,
                     'op', f.attrs->>'Operator')
              from gis.layer_features f
             where f.source_id = 'gas_transmission'
               and coalesce(f.attrs->>'Status', '') ilike 'Operating'
               and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_m)
             order by t.geom_5070 <-> f.geom_5070
             limit 1) as g
    from todo t
  ),
  up as (
    insert into parcel_enrichment as pe (
      property_id, gas_transmission_dist_ft, gas_operator, source_status)
    select m.property_id,
           least(coalesce((m.g->>'ft')::numeric, r_m * c_m), r_m * c_m)::numeric(10,1),
           m.g->>'op',
           jsonb_build_object('utilities_gas', jsonb_build_object(
             'status', case when m.g is null then 'partial' else 'ok' end,
             'as_of', now(),
             'detail', 'EIA/HIFLD interstate+intrastate transmission, 10 mi cap; '
                       'local distribution mains are not public (PHMSA NPMS pending)'))
    from measured m
    on conflict (property_id) do update
      set gas_transmission_dist_ft = excluded.gas_transmission_dist_ft,
          gas_operator             = excluded.gas_operator,
          source_status            = pe.source_status || excluded.source_status
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_gas(text, int) is
  'Distance to the nearest operating natural-gas TRANSMISSION line (EIA/HIFLD) and '
  'its operator. Transmission only — distribution mains are unpublished, so a null '
  'here never means "no gas on the street".';

revoke all on function enrich_gas(text, int) from public, anon;
grant execute on function enrich_gas(text, int) to service_role, authenticated;

-- --------------------------------------------------------- roads and rail

create or replace function enrich_roads(p_county text, p_limit int default 2000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
  c_mi  constant numeric := 0.000621371;   -- metres -> miles
  r_far constant numeric := 40234;         -- 25 mile cap for interchange / rail
  r_frt constant numeric := 91;            -- 300 ft: "the parcel fronts this road"
begin
  with todo as (
    select gp.property_id, gp.geom_5070
    from gis.parcels gp
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and pe.interchange_mi is null
    limit greatest(p_limit, 1)
  ),
  measured as (
    select t.property_id,
           -- FDOT's traffic layer covers the STATE highway system only, so a
           -- parcel on a county road simply has no fronting segment: null AADT
           -- means "not on a state road", never "no traffic".
           (select jsonb_build_object(
                     'aadt',  nullif((f.attrs->>'AADT')::numeric, 0),
                     'truck', nullif((f.attrs->>'TRUCKAADT')::numeric, 0))
              from gis.layer_features f
             where f.source_id = 'fdot_traffic'
               and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_frt)
             order by t.geom_5070 <-> f.geom_5070
             limit 1) as road,
           (select extensions.st_distance(t.geom_5070, f.geom_5070) * c_mi
              from gis.layer_features f
             where f.source_id = 'fdot_interchanges'
               and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_far)
             order by t.geom_5070 <-> f.geom_5070
             limit 1) as ramp_mi,
           -- RROUTE is <county digits><carrier code><line>; 'CS' is CSX and is
           -- 583 of the 660 rail segments across the six counties.
           (select extensions.st_distance(t.geom_5070, f.geom_5070) * c_mi
              from gis.layer_features f
             where f.source_id = 'fdot_rail'
               and coalesce(f.attrs->>'RROUTE', '') ~ '^[0-9]+CS'
               and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_far)
             order by t.geom_5070 <-> f.geom_5070
             limit 1) as rail_mi
    from todo t
  ),
  up as (
    insert into parcel_enrichment as pe (
      property_id, frontage_aadt, on_truck_route, interchange_mi,
      csx_mainline_mi, source_status)
    select m.property_id,
           (m.road->>'aadt')::numeric::int,
           -- FDOT publishes no truck-route flag, so this is a stated threshold,
           -- not a designation: 250+ trucks/day on the fronting state road.
           case when m.road is null then null
                else coalesce((m.road->>'truck')::numeric, 0) >= 250 end,
           least(coalesce(m.ramp_mi, r_far * c_mi), r_far * c_mi)::numeric(6,2),
           least(coalesce(m.rail_mi, r_far * c_mi), r_far * c_mi)::numeric(6,2),
           jsonb_build_object('roads', jsonb_build_object(
             'status', case when m.road is null then 'partial' else 'ok' end,
             'as_of', now(),
             'detail', 'FDOT RCI truck volumes (300 ft frontage), interchanges and '
                       'CSX rail (25 mi cap). Straight-line, not drive time.'))
    from measured m
    on conflict (property_id) do update
      set frontage_aadt   = excluded.frontage_aadt,
          on_truck_route  = excluded.on_truck_route,
          interchange_mi  = excluded.interchange_mi,
          csx_mainline_mi = excluded.csx_mainline_mi,
          source_status   = pe.source_status || excluded.source_status
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('county', p_county, 'written', v_written);
end $$;

comment on function enrich_roads(text, int) is
  'Road and rail signals from the FDOT RCI cache: AADT + truck volume of the state '
  'road the parcel fronts (within 300 ft; null = not on a state road), straight-line '
  'miles to the nearest interstate interchange, and to the nearest CSX line. '
  'interchange_drive_min stays null — drive time needs a routing engine.';

revoke all on function enrich_roads(text, int) from public, anon;
grant execute on function enrich_roads(text, int) to service_role, authenticated;

commit;
