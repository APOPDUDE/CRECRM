-- 2026-09-03: the click card links the FRA crossing report. Crossings are 1,489 points,
-- so the URL costs nothing on the wire (unlike the mains' as-built links). Applied via MCP.

begin;

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
      'tracks', nullif(gis.num(a->>'NumberOfMainTracks'), 0),
      -- the FRA crossing report (inventory + accident history), one per crossing
      'link', gis.known(a->>'URL')));
  elsif p_kind = 'flood_zone' then
    -- FEMA NFHL: FLD_ZONE + ZONE_SUBTY; STATIC_BFE -9999 means no static BFE on the panel
    nm := gis.known(a->>'FLD_ZONE');
    st := gis.known(a->>'ZONE_SUBTY');
    return jsonb_strip_nulls(jsonb_build_object(
      'k', p_kind, 'j', p_jur, 'zone', nm,
      'sub', case
        when st ilike '%FLOODWAY%' then 'floodway'
        when st ilike '%0.2 PCT%' then '0.2%'
        when st ilike '%LEVEE%'   then 'levee'
        when st ilike '%MINIMAL%' then 'minimal'
        when st ilike '%COASTAL%' then 'coastal' end,
      'name', case
        when st ilike '%FLOODWAY%' then 'Regulatory floodway (' || nm || ')'
        when st ilike '%0.2 PCT%' then '0.2% annual chance (500-year), shaded X'
        when nm like 'V%' then 'Coastal high hazard, 1% annual chance (' || nm || ')'
        when nm in ('A', 'AE', 'AH', 'AO', 'A99', 'AR') then '1% annual chance (100-year), zone ' || nm
        when st ilike '%MINIMAL%' then 'Minimal flood hazard (unshaded X)'
        when nm = 'D' then 'Undetermined risk (D)'
        else coalesce(st, nm) end,
      'bfe', case when gis.num(a->>'STATIC_BFE') > -9000 then gis.num(a->>'STATIC_BFE') end,
      'st', initcap(st)));
  elsif p_kind = 'wetland' then
    -- USFWS NWI: the Cowardin code and its plain-English class
    return jsonb_strip_nulls(jsonb_build_object(
      'k', p_kind, 'j', p_jur,
      'name', gis.known(coalesce(a->>'Wetlands.WETLAND_TYPE', a->>'WETLAND_TYPE')),
      'code', gis.known(coalesce(a->>'Wetlands.ATTRIBUTE', a->>'ATTRIBUTE')),
      'acres', gis.num(coalesce(a->>'Wetlands.ACRES', a->>'ACRES'))));
  elsif p_kind = 'easement' then
    return gis.easement_props(p_source, p_jur, a);
  end if;
  return jsonb_build_object('k', p_kind, 'j', p_jur);
end $$;

commit;
