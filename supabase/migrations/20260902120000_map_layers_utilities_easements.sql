-- 2026-09-02: utilities + easements on the map, water/sewer + easements per parcel.
-- Applied via MCP the same day.
--
-- What this adds (the Paxiv-style map layers Alex asked for, and the half of the
-- enrichment that never ran):
--   * gis.map_layers — the catalogue that says which harvested source is which KIND
--     (water main, gravity sewer, force main, service area, easement, electric, gas)
--     and which COUNTY it covers. Coverage is the load-bearing part: an enricher may
--     only claim a parcel whose county has a finished layer of that kind. "None
--     within a mile" is an answer; "we never had the layer" is not; the two must
--     never be confused. (0 of 96,876 water/sewer columns were filled on 08-24
--     because the region was written off after one ringless Polk layer —
--     Hillsborough, Tampa, Sarasota and Manatee all publish their mains with
--     geometry, diameter and material.)
--   * enrich_water_sewer()  — nearest active water main (+ its diameter), gravity
--     sewer and force main within a mile (5,280 ft cap = the score's zero point);
--     inside a water/sewer service area and whose, where a county publishes polygons.
--   * enrich_easements()    — recorded easements intersecting the parcel: count, % of
--     parcel area under polygon easements, and the instruments (type, book/page).
--   * map_layer_features()  — the viewport RPC the map paints from: GeoJSON of the
--     requested kinds inside a bbox, simplified by zoom, capped at 4,000 features,
--     with one normalized property set whatever the publisher called its fields.
--   * enrich_sweep() learns the two new enrichers; kick_enrich_sweep() runs a sweep as
--     a one-off self-unscheduling cron job.
--   * gis.harvest_drive + gis_harvest_drive_tick() — the self-driving harvest: pg_cron
--     posts drain requests to harvest-gis through pg_net, reads the responses back
--     from net._http_response to advance each source's offset, keeps four in flight,
--     retires itself when every source is done and kicks the sweep. Lesson 3 of the
--     08-26 run made durable: no container, no runner, the database drives itself.
--     (The cron.schedule call carries the anon key and is issued by hand, not here.)

begin;

-- ------------------------------------------------------------------ catalogue

create table if not exists gis.map_layers (
  source_id    text primary key,
  kind         text not null check (kind in (
                 'water_main', 'sewer_gravity', 'sewer_force',
                 'water_service_area', 'sewer_service_area',
                 'easement',
                 'electric_transmission', 'electric_substation', 'gas_transmission')),
  county       text,                     -- gis.parcels vocabulary ('Hillsborough'); null = regional
  jurisdiction text not null,            -- who publishes it, shown on the map
  sort         int not null default 100
);

comment on table gis.map_layers is
  'Which harvested source (gis.layers) is which kind of map layer, and which county it '
  'covers. Enrichers derive COVERAGE from this + gis.harvest_drive: a parcel is only '
  'measured against a kind its county actually has a finished layer for.';

insert into gis.map_layers (source_id, kind, county, jurisdiction, sort) values
  ('wm_hillsborough',         'water_main',            'Hillsborough', 'Hillsborough County',      10),
  ('sg_hillsborough',         'sewer_gravity',         'Hillsborough', 'Hillsborough County',      10),
  ('sf_hillsborough',         'sewer_force',           'Hillsborough', 'Hillsborough County',      10),
  ('wsa_hillsborough',        'water_service_area',    'Hillsborough', 'Hillsborough County',      10),
  ('ssa_hillsborough',        'sewer_service_area',    'Hillsborough', 'Hillsborough County',      10),
  ('wm_tampa',                'water_main',            'Hillsborough', 'City of Tampa',            11),
  ('sg_tampa',                'sewer_gravity',         'Hillsborough', 'City of Tampa',            11),
  ('sf_tampa',                'sewer_force',           'Hillsborough', 'City of Tampa',            11),
  ('wm_sarasota',             'water_main',            'Sarasota',     'Sarasota County',          20),
  ('sg_sarasota',             'sewer_gravity',         'Sarasota',     'Sarasota County',          20),
  ('sf_sarasota',             'sewer_force',           'Sarasota',     'Sarasota County',          20),
  ('wm_manatee',              'water_main',            'Manatee',      'Manatee County',           30),
  ('sg_manatee',              'sewer_gravity',         'Manatee',      'Manatee County',           30),
  ('sf_manatee',              'sewer_force',           'Manatee',      'Manatee County',           30),
  ('sf_pinellas',             'sewer_force',           'Pinellas',     'Pinellas County',          40),
  ('ez_pasco_general',        'easement',              'Pasco',        'Pasco Property Appraiser', 50),
  ('ez_pasco_hydrology',      'easement',              'Pasco',        'Pasco Property Appraiser', 50),
  ('ez_pasco_utility',        'easement',              'Pasco',        'Pasco Property Appraiser', 50),
  ('ez_pasco_buffer',         'easement',              'Pasco',        'Pasco Property Appraiser', 50),
  ('ez_pinellas',             'easement',              'Pinellas',     'Pinellas County',          51),
  ('ez_stpete',               'easement',              'Pinellas',     'City of St. Petersburg',   52),
  ('ez_manatee_conservation', 'easement',              'Manatee',      'Manatee County',           53),
  ('electric_transmission',   'electric_transmission', null,           'HIFLD',                    90),
  ('electric_substations',    'electric_substation',   null,           'HIFLD',                    90),
  ('gas_transmission',        'gas_transmission',      null,           'EIA / HIFLD',              91)
on conflict (source_id) do update
  set kind = excluded.kind, county = excluded.county,
      jurisdiction = excluded.jurisdiction, sort = excluded.sort;

-- Pasco's ETYPE is a bare code; the labels live only in the service's renderer
-- (read 2026-09-02 from Easements/MapServer/{0..3} uniqueValueInfos).
create table if not exists gis.pasco_easement_types (
  code  int primary key,
  label text not null
);
-- (the 258 code -> label rows are the next migration, 20260902120100)

-- ------------------------------------------------------------------ helpers

-- A number, or null — publishers put '6', '6.0', '' and the odd '6"' in diameter fields.
create or replace function gis.num(t text) returns numeric
language sql immutable as $$
  select case when t ~ '^\s*-?\d+(\.\d+)?\s*$' then t::numeric end
$$;

-- Text, or null — publishers fill unknowns with 'NOT AVAILABLE', 'Unknown', 'N/A'.
create or replace function gis.known(t text) returns text
language sql immutable as $$
  select case when t is null or trim(t) = ''
                or upper(trim(t)) in ('NOT AVAILABLE', 'UNKNOWN', 'N/A', 'NA', 'NONE', 'NULL')
              then null else trim(t) end
$$;

-- Is a utility line still in the ground and in use? Default-active: every publisher
-- spells status its own way (Hillsborough 'In Service', Tampa/Sarasota the Esri
-- Utility Network code 8, Manatee text), so only a KNOWN retired/proposed marker or an
-- explicit enabled=No excludes a line.
create or replace function gis.line_active(a jsonb) returns boolean
language sql immutable as $$
  select not (
    coalesce(a->>'lifecyclestatus', a->>'LIFECYCLESTATUS', a->>'STATUS', '') ~ '^(1|2|4|16|32|64)$'
    or coalesce(a->>'lifecyclestatus', a->>'LIFECYCLESTATUS', a->>'STATUS', '')
         ~* '(abandon|retire|propos|remov|out of service|inactive|under construction|planned)'
    or coalesce(a->>'enabled', a->>'ENABLED', '') ~* '^(no|false|0)$'
    or coalesce(a->>'activeflag', a->>'ACTIVEFLAG', '') ~* '^(no|false|0)$'
  )
$$;

-- 'Hillsborough County Water Service Area' -> 'Hillsborough County'
create or replace function gis.provider_name(t text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(coalesce(t, ''), '\s+(Water|Sewer|Wastewater)\s+Service\s+Area$', '', 'i')), '')
$$;

-- One property set for an easement feature, whatever the county called its columns.
-- sub = easement | row | vacated: a public right-of-way strip is context on the map,
-- not an encumbrance on the parcel, and a vacated instrument is history.
create or replace function gis.easement_props(p_source text, p_jur text, a jsonb) returns jsonb
language plpgsql stable as $$
declare
  sub   text := 'easement';
  label text;
  ref   text;
  own   text;
  typ   text;
begin
  if p_source like 'ez_pasco%' then
    select t.label into label from gis.pasco_easement_types t where t.code = gis.num(a->>'ETYPE')::int;
    label := coalesce(label, case p_source
      when 'ez_pasco_hydrology' then 'Drainage'
      when 'ez_pasco_utility'   then 'Utility'
      when 'ez_pasco_buffer'    then 'Buffer'
      else 'Easement' end);
    if label !~* 'easement' then label := label || ' easement'; end if;
    -- TYPE: OR = official records, PB = plat book, CB = condominium book
    ref := nullif(concat_ws(' ', nullif(a->>'TYPE', ''),
             nullif(concat_ws('/', nullif(a->>'BOOK', ''), nullif(a->>'PAGE', '')), '')), '');
    if label ~* '^ROW' or label ~* 'right.?of.?way' then sub := 'row'; end if;
  elsif p_source = 'ez_pinellas' then
    typ := nullif(a->>'ROWTYPE', '');
    label := initcap(coalesce(typ, nullif(a->>'DOCUMENTTYPE', ''), 'Easement'));
    ref := nullif(coalesce(nullif(a->>'ROWID_', ''), a->>'SRCREF'), '');
    own := nullif(a->>'OWNERNAME', '');
    if (a->>'VACROW') = 'Yes' or typ ~* '(vacat|release)' then sub := 'vacated';
    elsif (a->>'PUBLICROW') = 'Yes' or typ ~* '(right.?of.?way|r/w|\mrow\M)' then sub := 'row';
    end if;
  elsif p_source = 'ez_stpete' then
    label := initcap(coalesce(nullif(a->>'ENCUMTYPE', ''), nullif(a->>'LABELTXT', ''), 'Easement'));
    if label !~* '(easement|esmt)' then label := label || ' easement'; end if;
    if gis.num(a->>'ESMTWIDTH') > 0 then label := label || ' · ' || gis.num(a->>'ESMTWIDTH')::int || ' ft wide'; end if;
    ref := nullif(a->>'SRCREF', '');
    if nullif(a->>'VACATEDATE', '') is not null then sub := 'vacated'; end if;
  elsif p_source = 'ez_manatee_conservation' then
    label := 'Conservation easement';
    ref := nullif(a->>'GIS_LABEL', '');
    own := nullif(a->>'SOURCE', '');
  else
    label := 'Easement';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'k', 'easement', 'sub', sub, 'j', p_jur, 'label', label, 'ref', ref, 'own', own));
end $$;

-- The map's property set for any catalogued kind: k, j (publisher), name, dia (in),
-- mat, st, own, yr (installed), kv, ref. Coded domains we cannot decode (Sarasota's
-- numeric material) are dropped rather than shown as numbers.
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
  elsif p_kind = 'easement' then
    return gis.easement_props(p_source, p_jur, a);
  end if;
  return jsonb_build_object('k', p_kind, 'j', p_jur);
end $$;

-- ------------------------------------------------------------------ parcel_enrichment

alter table parcel_enrichment
  add column if not exists easement_count int          check (easement_count >= 0),
  add column if not exists easement_pct   numeric(5,2) check (easement_pct between 0 and 100),
  add column if not exists easements      jsonb;

comment on column parcel_enrichment.easement_count is
  'Recorded easement polygons/lines intersecting the parcel (public right-of-way strips and '
  'vacated instruments excluded). 0 = the county plots easements and none touch this parcel; '
  'null = the county publishes no easement geometry (Hillsborough, Polk, Sarasota).';
comment on column parcel_enrichment.easement_pct is
  'Percent of the parcel under polygon easements (EPSG:5070 area). Line-only sources (St. Pete) count but add no area.';
comment on column parcel_enrichment.easements is
  'The instruments: [{label, ref (OR/plat book/page), own, sub, j, ia (m2 on this parcel)}] — the same '
  'property set the map shows.';

-- Water main / gravity sewer / force main within a mile, and service-area membership,
-- for every parcel in a county that publishes the layer. The 5,280 ft sentinel is the
-- score''s zero point ("measured, and far"); a kind the county does not publish stays
-- null ("never looked"). The claim marker is source_status, not a column, so a county
-- covered for force mains only (Pinellas) is claimed once and not forever.
create or replace function public.enrich_water_sewer(p_county text default null, p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
  c_ft constant numeric := 3.280839895;   -- metres -> feet
  r_m  constant numeric := 1609.344;      -- one mile
begin
  with cov as (
    -- a county is covered only once EVERY water/sewer layer it has is fully harvested:
    -- a parcel is claimed exactly once, so claiming it while a sibling layer is still
    -- loading would leave that kind unmeasured for good
    select ml.county,
           bool_or(ml.kind = 'water_main')         as wm,
           bool_or(ml.kind = 'sewer_gravity')      as sg,
           bool_or(ml.kind = 'sewer_force')        as sf,
           bool_or(ml.kind = 'water_service_area') as wsa,
           bool_or(ml.kind = 'sewer_service_area') as ssa
    from gis.map_layers ml
    join gis.layers l on l.source_id = ml.source_id and coalesce(l.feature_count, 0) > 0
    where ml.county is not null
      and ml.kind in ('water_main', 'sewer_gravity', 'sewer_force', 'water_service_area', 'sewer_service_area')
      and not exists (
        select 1 from gis.map_layers m2
        join gis.harvest_drive hd on hd.source_id = m2.source_id
        where m2.county = ml.county
          and m2.kind in ('water_main', 'sewer_gravity', 'sewer_force', 'water_service_area', 'sewer_service_area')
          and hd.status <> 'done')
    group by ml.county
  ),
  todo as (
    select gp.property_id, gp.county, gp.geom_5070, c.wm, c.sg, c.sf, c.wsa, c.ssa
    from gis.parcels gp
    join cov c on c.county = gp.county
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and not coalesce(pe.source_status ? 'utilities_water_sewer', false)
    limit greatest(p_limit, 1)
  ),
  near as (
    select t.property_id, t.wm, t.sg, t.sf, t.wsa, t.ssa,
      case when t.wm then (
        select jsonb_build_object('ft', x.d * c_ft, 'dia', x.dia)
        from gis.map_layers ml
        cross join lateral (
          select extensions.st_distance(t.geom_5070, f.geom_5070) as d,
                 gis.num(coalesce(f.attrs->>'diameter', f.attrs->>'DIAMETER')) as dia
          from gis.layer_features f
          where f.source_id = ml.source_id
            and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_m)
            and gis.line_active(f.attrs)
          order by t.geom_5070 <-> f.geom_5070
          limit 1) x
        where ml.kind = 'water_main' and ml.county = t.county
        order by x.d
        limit 1) end as wm_hit,
      case when t.sg then (
        select min(x.d) * c_ft
        from gis.map_layers ml
        cross join lateral (
          select extensions.st_distance(t.geom_5070, f.geom_5070) as d
          from gis.layer_features f
          where f.source_id = ml.source_id
            and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_m)
            and gis.line_active(f.attrs)
          order by t.geom_5070 <-> f.geom_5070
          limit 1) x
        where ml.kind = 'sewer_gravity' and ml.county = t.county) end as sg_ft,
      case when t.sf then (
        select min(x.d) * c_ft
        from gis.map_layers ml
        cross join lateral (
          select extensions.st_distance(t.geom_5070, f.geom_5070) as d
          from gis.layer_features f
          where f.source_id = ml.source_id
            and extensions.st_dwithin(t.geom_5070, f.geom_5070, r_m)
            and gis.line_active(f.attrs)
          order by t.geom_5070 <-> f.geom_5070
          limit 1) x
        where ml.kind = 'sewer_force' and ml.county = t.county) end as sf_ft,
      -- the polygon holding the parcel's interior point wins; a boundary-straddler falls
      -- back to any intersecting polygon — no overlay against county-sized shapes (that
      -- cost 0.4 s a parcel)
      case when t.wsa then (
        select coalesce(f.attrs->>'serviceby', f.attrs->>'SERVICEBY', f.attrs->>'id')
        from gis.map_layers ml
        join gis.layer_features f on f.source_id = ml.source_id
        where ml.kind = 'water_service_area' and ml.county = t.county
          and extensions.st_intersects(f.geom_5070, t.geom_5070)
        order by extensions.st_contains(f.geom_5070, extensions.st_pointonsurface(t.geom_5070)) desc
        limit 1) end as wsa_name,
      case when t.ssa then (
        select coalesce(f.attrs->>'serviceby', f.attrs->>'SERVICEBY', f.attrs->>'id')
        from gis.map_layers ml
        join gis.layer_features f on f.source_id = ml.source_id
        where ml.kind = 'sewer_service_area' and ml.county = t.county
          and extensions.st_intersects(f.geom_5070, t.geom_5070)
        order by extensions.st_contains(f.geom_5070, extensions.st_pointonsurface(t.geom_5070)) desc
        limit 1) end as ssa_name
    from todo t
  ),
  up as (
    insert into parcel_enrichment as pe (
      property_id, water_main_dist_ft, water_main_diameter_in,
      sewer_gravity_dist_ft, sewer_force_dist_ft,
      in_water_service_area, water_provider, in_sewer_service_area, sewer_provider,
      source_status)
    select n.property_id,
      case when n.wm then least(coalesce((n.wm_hit->>'ft')::numeric, r_m * c_ft), r_m * c_ft)::numeric(10,1) end,
      case when n.wm then nullif((n.wm_hit->>'dia')::numeric, 0)::numeric(6,2) end,
      case when n.sg then least(coalesce(n.sg_ft, r_m * c_ft), r_m * c_ft)::numeric(10,1) end,
      case when n.sf then least(coalesce(n.sf_ft, r_m * c_ft), r_m * c_ft)::numeric(10,1) end,
      case when n.wsa then n.wsa_name is not null end,
      case when n.wsa then gis.provider_name(n.wsa_name) end,
      case when n.ssa then n.ssa_name is not null end,
      case when n.ssa then gis.provider_name(n.ssa_name) end,
      jsonb_build_object('utilities_water_sewer', jsonb_build_object(
        'status', 'ok',
        'as_of', now(),
        'detail', format('county/city utility GIS mains, 1 mi cap; coverage wm=%s sg=%s sf=%s wsa=%s ssa=%s',
                         n.wm, n.sg, n.sf, n.wsa, n.ssa)))
    from near n
    on conflict (property_id) do update
      set water_main_dist_ft     = coalesce(excluded.water_main_dist_ft, pe.water_main_dist_ft),
          water_main_diameter_in = coalesce(excluded.water_main_diameter_in, pe.water_main_diameter_in),
          sewer_gravity_dist_ft  = coalesce(excluded.sewer_gravity_dist_ft, pe.sewer_gravity_dist_ft),
          sewer_force_dist_ft    = coalesce(excluded.sewer_force_dist_ft, pe.sewer_force_dist_ft),
          in_water_service_area  = coalesce(excluded.in_water_service_area, pe.in_water_service_area),
          water_provider         = coalesce(excluded.water_provider, pe.water_provider),
          in_sewer_service_area  = coalesce(excluded.in_sewer_service_area, pe.in_sewer_service_area),
          sewer_provider         = coalesce(excluded.sewer_provider, pe.sewer_provider),
          source_status          = pe.source_status || excluded.source_status
    returning 1)
  select count(*) into v_written from up;
  return jsonb_build_object('written', v_written);
end $$;

comment on function public.enrich_water_sewer(text, int) is
  'Nearest active water main (+ diameter), gravity sewer and force main within a mile from the '
  'county/city utility GIS cache (5,280 = none within a mile), plus water/sewer service-area '
  'membership and provider where the county publishes polygons. Only parcels in covered counties '
  'are claimed; the claim marker is source_status.utilities_water_sewer.';

-- Recorded easements on the parcel, from the counties that plot them.
create or replace function public.enrich_easements(p_county text default null, p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  v_written int;
begin
  with cov as (
    -- same rule as enrich_water_sewer: every easement layer of the county must be done
    select distinct ml.county
    from gis.map_layers ml
    join gis.layers l on l.source_id = ml.source_id and coalesce(l.feature_count, 0) > 0
    where ml.kind = 'easement' and ml.county is not null
      and not exists (
        select 1 from gis.map_layers m2
        join gis.harvest_drive hd on hd.source_id = m2.source_id
        where m2.county = ml.county and m2.kind = 'easement' and hd.status <> 'done')
  ),
  todo as (
    select gp.property_id, gp.county, gp.geom_5070, extensions.st_area(gp.geom_5070) as area
    from gis.parcels gp
    join cov on cov.county = gp.county
    left join parcel_enrichment pe on pe.property_id = gp.property_id
    where (p_county is null or gp.county = p_county)
      and not coalesce(pe.source_status ? 'easements', false)
    limit greatest(p_limit, 1)
  ),
  hits as (
    select t.property_id, p.props,
           -- area only for true easements; right-of-way and vacated instruments are context
           case when p.props->>'sub' = 'easement' and extensions.st_dimension(f.geom_5070) = 2
                then extensions.st_area(extensions.st_intersection(f.geom_5070, t.geom_5070)) end as ia,
           -- context polygons count only when they overlap the interior, not just the boundary
           case when p.props->>'sub' <> 'easement' and extensions.st_dimension(f.geom_5070) = 2
                then not extensions.st_touches(f.geom_5070, t.geom_5070) else true end as inside
    from todo t
    join gis.map_layers ml on ml.kind = 'easement' and ml.county = t.county
    join gis.layer_features f on f.source_id = ml.source_id
      and extensions.st_intersects(f.geom_5070, t.geom_5070)
    cross join lateral (select gis.easement_props(ml.source_id, ml.jurisdiction, f.attrs) as props) p
  ),
  real_hits as (
    -- a polygon that only shares a boundary with the parcel is the neighbour's easement
    select * from hits where inside and (ia is null or ia > 2)
  ),
  agg as (
    select property_id,
           count(*)  filter (where props->>'sub' = 'easement') as n,
           sum(ia)   filter (where props->>'sub' = 'easement') as area_in,
           jsonb_agg(props || jsonb_build_object('ia', round(ia)) order by ia desc nulls last) as items
    from real_hits
    group by property_id
  ),
  up as (
    insert into parcel_enrichment as pe (property_id, easement_count, easement_pct, easements, source_status)
    select t.property_id,
           coalesce(a.n, 0),
           least(100, round((100 * coalesce(a.area_in, 0) / nullif(t.area, 0))::numeric, 2)),
           coalesce(a.items, '[]'::jsonb),
           jsonb_build_object('easements', jsonb_build_object(
             'status', 'ok', 'as_of', now(),
             'detail', 'county recorded-easement GIS; 0 = the county plots easements and none touch this parcel'))
    from todo t
    left join agg a on a.property_id = t.property_id
    on conflict (property_id) do update
      set easement_count = excluded.easement_count,
          easement_pct   = excluded.easement_pct,
          easements      = excluded.easements,
          source_status  = pe.source_status || excluded.source_status
    returning 1)
  select count(*) into v_written from up;
  return jsonb_build_object('written', v_written);
end $$;

comment on function public.enrich_easements(text, int) is
  'Recorded easements intersecting the parcel (count, % of area, instruments) from the county GIS '
  'cache. Public right-of-way and vacated instruments ride along in `easements` with their sub-kind '
  'but are not counted. Only parcels in counties with a finished easement layer are claimed.';

revoke execute on function public.enrich_water_sewer(text, int) from public, anon, authenticated;
revoke execute on function public.enrich_easements(text, int)   from public, anon, authenticated;
grant  execute on function public.enrich_water_sewer(text, int) to service_role;
grant  execute on function public.enrich_easements(text, int)   to service_role;

-- ------------------------------------------------------------------ the sweep

create or replace function public.enrich_sweep(p_batch int default 2000, p_max_rounds int default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  r int := 0;
  n int := 0;
  errs jsonb := '{}'::jsonb;
  -- a failing enricher is switched off for the rest of the call; the others keep going
  -- and its error rides back in the result, so a silent half-sweep is impossible
  ok_geom bool := true; ok_pwr bool := true; ok_ele bool := true;
  ok_gas bool := true; ok_road bool := true; ok_ws bool := true; ok_ez bool := true;
begin
  loop
    r := r + 1;
    n := 0;

    if ok_geom then
      begin n := n + coalesce((enrich_parcel_geometry(null, p_batch)->>'written')::int, 0);
      exception when others then
        ok_geom := false; errs := errs || jsonb_build_object('geometry', sqlerrm); end;
    end if;

    if ok_pwr then
      begin n := n + coalesce((enrich_power_proximity(null, p_batch)->>'written')::int, 0);
      exception when others then
        ok_pwr := false; errs := errs || jsonb_build_object('power_nearby', sqlerrm); end;
    end if;

    if ok_ele then
      begin n := n + coalesce((enrich_electric(null, p_batch)->>'written')::int, 0);
      exception when others then
        ok_ele := false; errs := errs || jsonb_build_object('electric', sqlerrm); end;
    end if;

    if ok_gas then
      begin n := n + coalesce((enrich_gas(null, p_batch)->>'written')::int, 0);
      exception when others then
        ok_gas := false; errs := errs || jsonb_build_object('gas', sqlerrm); end;
    end if;

    if ok_road then
      begin n := n + coalesce((enrich_roads(null, p_batch)->>'written')::int, 0);
      exception when others then
        ok_road := false; errs := errs || jsonb_build_object('roads', sqlerrm); end;
    end if;

    -- 2026-09-02: water/sewer (three KNN queries a parcel) and easements run at half
    -- the batch so one round stays inside a few seconds
    if ok_ws then
      begin n := n + coalesce((enrich_water_sewer(null, greatest(p_batch / 2, 100))->>'written')::int, 0);
      exception when others then
        ok_ws := false; errs := errs || jsonb_build_object('water_sewer', sqlerrm); end;
    end if;

    if ok_ez then
      begin n := n + coalesce((enrich_easements(null, greatest(p_batch / 2, 100))->>'written')::int, 0);
      exception when others then
        ok_ez := false; errs := errs || jsonb_build_object('easements', sqlerrm); end;
    end if;

    exit when n = 0 or r >= p_max_rounds;
  end loop;

  -- score last, once the factors for this pass are in place. Scoring re-claims rows
  -- whose factors changed since scored_at (water/sewer landing), so this is where the
  -- book's scores move.
  begin
    loop
      exit when coalesce((score_parcels(null, p_batch)->>'scored')::int, 0) = 0;
    end loop;
  exception when others then
    errs := errs || jsonb_build_object('score', sqlerrm);
  end;

  return jsonb_build_object(
    'rounds', r,
    'written', n,
    'errors', errs,
    'geometry',     (select count(*) from parcel_enrichment where parcel_width_ft is not null),
    'power_nearby', (select count(*) from parcel_enrichment where nearest_powered_parcel_ft is not null),
    'electric',     (select count(*) from parcel_enrichment where substation_dist_ft is not null),
    'gas',          (select count(*) from parcel_enrichment where gas_transmission_dist_ft is not null),
    'roads',        (select count(*) from parcel_enrichment where interchange_mi is not null),
    'water_sewer',  (select count(*) from parcel_enrichment where source_status ? 'utilities_water_sewer'),
    'easements',    (select count(*) from parcel_enrichment where easement_count is not null),
    'scored',       (select count(*) from parcel_enrichment where scored_at is not null),
    'published',    (select count(*) from parcel_enrichment where suitability_score is not null));
end $$;

-- every committed round leaves a line: the sweep's per-enricher errors are otherwise
-- swallowed by its own exception guards and the DO block that runs it
create table if not exists gis.sweep_log (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  result jsonb not null
);
comment on table gis.sweep_log is
  'One row per enrich_sweep round run by the enrich-sweep cron job: written, errors, tallies. '
  'Errors here are the ONLY place a silently failing enricher shows up.';

-- The sweep as per-minute committed rounds: pg_cron runs a command string as ONE
-- implicit transaction, so a whole-book sweep in one job was hours of invisible,
-- all-or-nothing work (learned 2026-09-02 at 23:43 UTC). One round a minute, each its
-- own transaction; a try-lock (778811, the 08-23 sweep's) skips the minute when the
-- previous round is still running; the job retires itself when a round finds nothing.
create or replace function public.kick_enrich_sweep()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if exists (select 1 from cron.job where jobname = 'enrich-sweep') then
    return 'enrich-sweep already running';
  end if;
  perform cron.schedule('enrich-sweep', '* * * * *',
    $job$set statement_timeout = 0; do $do$ declare r jsonb; begin
      if not pg_try_advisory_xact_lock(778811) then return; end if;
      r := public.enrich_sweep(500, 1);
      insert into gis.sweep_log (result) values (r);
      if coalesce((r->>'written')::int, 0) = 0 then perform cron.unschedule('enrich-sweep'); end if;
    end $do$;$job$);
  return 'enrich-sweep scheduled every minute until a round finds nothing left';
end $$;

revoke execute on function public.kick_enrich_sweep() from public, anon, authenticated;
grant  execute on function public.kick_enrich_sweep() to service_role;

-- ------------------------------------------------------------------ the map RPC

-- GeoJSON for the viewport: the requested kinds inside the bbox, simplified by zoom,
-- capped. Street-level kinds (mains, easements) are withheld past ~40 km2 — the
-- answer there would be tens of thousands of segments — so they wait for the camera.
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
                       'electric_transmission', 'electric_substation', 'gas_transmission')
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

comment on function public.map_layer_features(text[], double precision, double precision, double precision, double precision, int) is
  'Map overlay features (water/sewer mains, service areas, electric, gas, easements) inside a '
  'bbox as a GeoJSON FeatureCollection with normalized properties {k, j, name, dia, mat, st, own, '
  'yr, kv, ref, sub}. Capped at 4,000 (truncated:true); mains/easements withheld past 40 km2.';

revoke all on function public.map_layer_features(text[], double precision, double precision, double precision, double precision, int) from public, anon;
grant execute on function public.map_layer_features(text[], double precision, double precision, double precision, double precision, int) to authenticated, service_role;

-- ------------------------------------------------------------------ the self-driving harvest

create table if not exists gis.harvest_drive (
  source_id    text primary key,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  next_offset  int  not null default 0,
  request_id   bigint,
  requested_at timestamptz,
  pages        int  not null default 0,
  sent         int  not null default 0,
  posts        int  not null default 0,
  failures     int  not null default 0,
  detail       text,
  updated_at   timestamptz not null default now()
);

comment on table gis.harvest_drive is
  'Cursor per source for the cron-driven harvest (job gis-harvest-drive, one tick a minute): '
  'each tick settles in-flight pg_net requests from net._http_response, advances next_offset, '
  'keeps four drain requests in flight, and retires the job (+ kicks enrich_sweep) when every '
  'source is done. Re-queue a source by resetting status/next_offset.';

create or replace function public.gis_harvest_drive_tick(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  r        record;
  resp     record;
  body     jsonb;
  inflight int;
  rid      bigint;
  v_url    constant text := 'https://sxlttnxcutnrdzcldafh.supabase.co/functions/v1/harvest-gis';
begin
  -- 1. settle what is in flight
  for r in select * from gis.harvest_drive where status = 'running' and request_id is not null loop
    select * into resp from net._http_response where id = r.request_id;
    if not found then
      -- pg_net keeps responses for hours; none after six minutes means it never ran
      if r.requested_at < now() - interval '6 minutes' then
        update gis.harvest_drive
          set request_id = null, detail = 'no response; retrying', updated_at = now()
          where source_id = r.source_id;
      end if;
      continue;
    end if;
    if resp.status_code = 200 and resp.content is not null and (resp.content::jsonb)->>'error' is null then
      body := resp.content::jsonb;
      update gis.harvest_drive
        set next_offset = coalesce((body->>'next_offset')::int, next_offset),
            pages       = pages + coalesce((body->>'pages')::int, 0),
            sent        = sent + coalesce((body->>'sent')::int, 0),
            status      = case when coalesce((body->>'complete')::boolean, false) then 'done' else 'running' end,
            request_id  = null, detail = null, updated_at = now()
        where source_id = r.source_id;
    elsif coalesce(resp.timed_out, false) then
      -- the edge run may still have landed its pages; upserts make a re-walk harmless
      update gis.harvest_drive
        set request_id = null, detail = 'timed out at offset ' || next_offset, updated_at = now()
        where source_id = r.source_id;
    else
      -- a drain that died mid-walk reports where (`at`); the pages before it are
      -- already cached, so the cursor moves there and only the failure is counted
      body := case when resp.content ~ '^\s*\{' then resp.content::jsonb else '{}'::jsonb end;
      update gis.harvest_drive
        set failures    = failures + 1,
            next_offset = coalesce((body->>'at')::int, next_offset),
            status      = case when failures + 1 >= 3 then 'error' else 'running' end,
            request_id  = null,
            detail      = coalesce(resp.error_msg, resp.status_code::text || ' ' || left(coalesce(resp.content, ''), 300)),
            updated_at  = now()
        where source_id = r.source_id;
    end if;
  end loop;

  -- 2. keep four requests in flight
  select count(*) into inflight from gis.harvest_drive where status = 'running' and request_id is not null;
  for r in select * from gis.harvest_drive
           where status in ('queued', 'running') and request_id is null
           order by status desc, source_id loop
    exit when inflight >= 4;
    select net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', p_key, 'Authorization', 'Bearer ' || p_key),
      body    := jsonb_build_object('mode', 'layer', 'source', r.source_id, 'offset', r.next_offset,
                                    'drain', true, 'budget_ms', 100000),
      timeout_milliseconds := 150000) into rid;
    update gis.harvest_drive
      set request_id = rid, requested_at = now(), status = 'running', posts = posts + 1, updated_at = now()
      where source_id = r.source_id;
    inflight := inflight + 1;
  end loop;

  -- 3. retire, and hand off to the enrichers
  if not exists (select 1 from gis.harvest_drive where status in ('queued', 'running')) then
    if exists (select 1 from cron.job where jobname = 'gis-harvest-drive') then
      perform cron.unschedule('gis-harvest-drive');
    end if;
    perform public.kick_enrich_sweep();
  end if;

  return (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select status, count(*) as n from gis.harvest_drive group by status) s);
end $$;

revoke execute on function public.gis_harvest_drive_tick(text) from public, anon, authenticated;
grant  execute on function public.gis_harvest_drive_tick(text) to service_role;

commit;
