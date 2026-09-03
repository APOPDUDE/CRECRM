-- 2026-09-03: Railroads on the map (Alex: "highlight where the railroad is, whether
-- active, and if possible the schedule"). Applied via MCP the same day.
--
-- Two NTAD (USDOT/BTS) sources: the FRA North American Rail Network lines and the FRA
-- grade-crossing inventory. Freight railroads publish no timetables, so "schedule" is
-- answered the only public way there is — the crossing inventory's trains per day
-- (daylight / night) and maximum timetable speed at every crossing — and the rail line
-- itself carries owner, trackage rights, subdivision, status and track count.

begin;

alter table gis.map_layers drop constraint if exists map_layers_kind_check;
alter table gis.map_layers add constraint map_layers_kind_check check (kind in (
  'water_main', 'sewer_gravity', 'sewer_force',
  'water_service_area', 'sewer_service_area',
  'easement',
  'electric_transmission', 'electric_substation', 'gas_transmission',
  'rail_line', 'rail_crossing'));

insert into gis.map_layers (source_id, kind, county, jurisdiction, sort) values
  ('rail_lines_narn',     'rail_line',     null, 'FRA rail network (NTAD)',        80),
  ('rail_crossings_ntad', 'rail_crossing', null, 'FRA grade crossings (NTAD)',     81)
on conflict (source_id) do update
  set kind = excluded.kind, county = excluded.county,
      jurisdiction = excluded.jurisdiction, sort = excluded.sort;

-- reporting marks -> names, for the owners that run through the six counties
create or replace function gis.railroad_name(mark text) returns text
language sql immutable as $$
  select case upper(trim(coalesce(mark, '')))
    when 'CSXT' then 'CSX Transportation (CSXT)'
    when 'FCEN' then 'Florida Central Railroad (FCEN)'
    when 'FMID' then 'Florida Midland Railroad (FMID)'
    when 'FNOR' then 'Florida Northern Railroad (FNOR)'
    when 'SGLR' then 'Seminole Gulf Railway (SGLR)'
    when 'SCFE' then 'South Central Florida Express (SCFE)'
    when 'AMTK' then 'Amtrak (AMTK)'
    when 'FEC'  then 'Florida East Coast Railway (FEC)'
    when 'BAYL' then 'Bay Line Railroad (BAYL)'
    when 'TALL' then 'Tallahassee'
    when ''     then null
    else upper(trim(mark)) end
$$;

create or replace function gis.feature_props(p_kind text, p_source text, p_jur text, a jsonb) returns jsonb
language plpgsql stable as $$
declare
  st   text;
  inst text;
  yr   int;
  dia  numeric;
  mat  text;
  own  text;
  nm   text;
  kv   numeric;
  d    numeric;
  n    numeric;
begin
  if p_kind in ('water_main', 'sewer_gravity', 'sewer_force') then
    dia := nullif(gis.num(coalesce(a->>'diameter', a->>'DIAMETER')), 0);
    mat := gis.known(coalesce(a->>'material', a->>'MATERIAL'));
    if mat ~ '^\d+$' then mat := null; end if;
    st := gis.known(coalesce(a->>'lifecyclestatus', a->>'LIFECYCLESTATUS', a->>'STATUS'));
    st := case st
      when '0' then null when '1' then 'Proposed' when '2' then 'Approved'
      when '4' then 'Under construction' when '8' then 'In service'
      when '16' then 'Out of service' when '32' then 'Abandoned' when '64' then 'Removed'
      else st end;
    if st is null and coalesce(a->>'enabled', a->>'ENABLED', a->>'activeflag', a->>'ACTIVEFLAG') ~* '^(yes|true|1)$' then
      st := 'Active';
    end if;
    own := gis.known(coalesce(a->>'administrativearea', a->>'OWNER', a->>'OWNEDBY'));
    if own is null and (a->>'ownedby') ~* '^[a-z]' then own := gis.known(a->>'ownedby'); end if;
    -- Tampa and Sarasota code the owner; 1 is the utility itself
    if own is null and coalesce(a->>'ownedby', a->>'OWNEDBY') = '1' then own := p_jur; end if;
    inst := coalesce(a->>'installdate', a->>'INSTALLDATE', a->>'INSTALL_DATE');
    yr := case
      when inst ~ '^\d{11,}$' then extract(year from to_timestamp(inst::bigint / 1000))::int
      when inst ~ '^\d{4}-' then left(inst, 4)::int end;
    if yr is not null and yr < 1850 then yr := null; end if;
    nm := gis.known(coalesce(a->>'name', a->>'description', a->>'subtypename', a->>'SUBTYPE', a->>'pipetype'));
    -- the as-built link stays in attrs; on the wire it was 40% of a Tampa viewport
    return jsonb_strip_nulls(jsonb_build_object(
      'k', p_kind, 'j', p_jur, 'dia', dia, 'mat', mat, 'st', st, 'own', own, 'yr', yr, 'name', nm));
  elsif p_kind in ('water_service_area', 'sewer_service_area') then
    nm := gis.provider_name(coalesce(a->>'serviceby', a->>'SERVICEBY', a->>'id'));
    return jsonb_strip_nulls(jsonb_build_object('k', p_kind, 'j', p_jur, 'name', nm, 'own', nm));
  elsif p_kind = 'electric_transmission' then
    kv := nullif(greatest(coalesce(gis.num(a->>'VOLTAGE'), 0), 0), 0);
    return jsonb_strip_nulls(jsonb_build_object(
      'k', p_kind, 'j', p_jur, 'kv', kv, 'own', gis.known(a->>'OWNER'), 'st', initcap(gis.known(a->>'STATUS'))));
  elsif p_kind = 'electric_substation' then
    kv := nullif(greatest(coalesce(gis.num(a->>'MAX_VOLT'), 0), 0), 0);
    return jsonb_strip_nulls(jsonb_build_object(
      'k', p_kind, 'j', p_jur, 'name', initcap(gis.known(a->>'NAME')), 'kv', kv, 'st', initcap(gis.known(a->>'STATUS'))));
  elsif p_kind = 'gas_transmission' then
    return jsonb_strip_nulls(jsonb_build_object(
      'k', p_kind, 'j', p_jur, 'own', gis.known(a->>'Operator'), 'name', gis.known(a->>'TYPEPIPE'), 'st', gis.known(a->>'Status')));
  elsif p_kind = 'rail_line' then
    -- FRA NET code = the honest "active or not"
    st := case a->>'NET'
      when 'M' then 'Main line'
      when 'I' then 'Industrial lead'
      when 'O' then 'Minor industrial lead'
      when 'S' then 'Passing siding'
      when 'Y' then 'Yard track'
      when 'F' then 'Rail ferry'
      when 'X' then 'Out of service'
      when 'A' then 'Abandoned'
      when 'R' then 'Abandoned (track removed)'
      when 'T' then 'Trail'
      when 'Z' then 'Transit / tourist'
      else gis.known(a->>'NET') end;
    own := gis.railroad_name(a->>'RROWNER1');
    if gis.known(a->>'TRKRGHTS1') is not null then
      own := concat_ws(' · ', own, 'rights: ' || gis.railroad_name(a->>'TRKRGHTS1'));
    end if;
    nm := coalesce(gis.known(a->>'SUBDIV'), gis.known(a->>'YARDNAME'),
                   case when gis.known(a->>'BRANCH') !~ '^#N' then gis.known(a->>'BRANCH') end);
    if nm is not null then nm := initcap(nm) || ' subdivision'; end if;
    if gis.known(a->>'DIVISION') is not null and nm is not null then nm := nm || ' (' || initcap(a->>'DIVISION') || ' division)'; end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'k', p_kind, 'j', p_jur, 'name', nm, 'own', own, 'st', st,
      'tracks', nullif(gis.num(a->>'TRACKS'), 0),
      'pass', case a->>'PASSNGR'
        when 'A' then 'Amtrak' when 'B' then 'Amtrak + commuter' when 'C' then 'Commuter'
        when 'T' then 'Tourist / museum' when 'R' then 'Rapid transit'
        when 'I' then 'Intercity high-speed' when 'E' then 'Intercity high-speed + commuter' end));
  elsif p_kind = 'rail_crossing' then
    -- trains per day at the crossing: the only public stand-in for a freight schedule
    d := gis.num(a->>'TotalDaylightThruTrains');
    n := gis.num(a->>'TotalNighttimeThruTrains');
    own := gis.railroad_name(a->>'RailroadCode');
    if gis.known(a->>'ParentRailroadCode') is not null and upper(a->>'ParentRailroadCode') <> upper(coalesce(a->>'RailroadCode', '')) then
      own := concat_ws(' · ', own, 'parent: ' || gis.railroad_name(a->>'ParentRailroadCode'));
    end if;
    st := concat_ws(' · ',
      gis.known(a->>'CrossingType'),
      gis.known(a->>'CrossingPosition'),
      case when gis.known(a->>'WDCODE') is not null and a->>'WDCODE' <> 'None' then a->>'WDCODE' else 'no active warning device' end,
      case when a->>'WhistleBan' = 'Yes' then 'whistle ban' end);
    return jsonb_strip_nulls(jsonb_build_object(
      'k', p_kind, 'j', p_jur,
      'name', 'Crossing ' || coalesce(gis.known(a->>'CrossingID'), '?')
              || coalesce(' · ' || initcap(gis.known(a->>'RailroadSubdivision')) || ' subdivision', ''),
      'street', initcap(regexp_replace(coalesce(gis.known(a->>'STREET'), gis.known(a->>'HighwayName'), ''), '\s+', ' ', 'g')),
      'own', own, 'st', st,
      'tpd', case when d is null and n is null then null else coalesce(d, 0) + coalesce(n, 0) end,
      'tpd_day', d, 'tpd_night', n,
      'spd', nullif(gis.num(a->>'MaximumTimetableSpeed'), 0),
      'tracks', nullif(gis.num(a->>'NumberOfMainTracks'), 0)));
  elsif p_kind = 'easement' then
    return gis.easement_props(p_source, p_jur, a);
  end if;
  return jsonb_build_object('k', p_kind, 'j', p_jur);
end $$;

-- rail is a regional layer: the whole network is 1,421 segments + 1,489 crossings in the
-- six counties, so it paints at any zoom like the transmission lines
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
  -- simplification in degrees: none close up, ~2 m at street zoom, ~10 m further out;
  -- 5 decimals (~1 m) is plenty until the camera is on one block
  tol    := case when p_zoom >= 16 then 0 when p_zoom >= 14 then 0.00002 else 0.0001 end;
  digits := case when p_zoom >= 17 then 6 else 5 end;

  with sel as (
    select ml.kind, ml.source_id, ml.jurisdiction, f.attrs, f.geom
    from gis.map_layers ml
    join gis.layer_features f on f.source_id = ml.source_id
    where ml.kind = any(p_kinds)
      and f.geom_5070 && env5070
      and (ml.kind in ('water_service_area', 'sewer_service_area',
                       'electric_transmission', 'electric_substation', 'gas_transmission',
                       'rail_line', 'rail_crossing')
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
