-- 2026-09-02 (evening): recorded easements for Hillsborough, Polk (Lakeland) and the
-- statewide conservation inventory. Applied via MCP the same day.
--
-- Alex: "look again to find the recorded easements for polk and hillsborough, look a
-- little harder." The county servers hide nothing more — ArcGIS Online does:
--   * ez_hillsborough_pa         Hillsborough County Property Appraiser parcel-fabric easements,
--                                county-wide, 54,201 polygons, classified by Encumbranc
--                                (Utility 38k / Drainage 8.7k / Conservation / Ingress-Egress /
--                                prescriptive ROW); an instrument ref only where the mapper typed
--                                one into Name.
--   * ez_lakeland                City of Lakeland's master easement layer (30,062), book/page,
--                                width, a flag per purpose, vacated / subordination markers.
--   * ez_fdep_clear_conservation FDEP FL-SOLARIS/CLEAR conservation easements — every recorded
--                                conservation easement in the state (federal, agency, WMD,
--                                county, municipal grantees), clipped to the six counties.
--                                county = null: it applies to EVERY county.
-- Coverage semantics change with the statewide source: a county is covered once its own
-- easement layers AND the statewide ones are done, and the row now records WHO plotted for
-- that county (source_status.easements.coverage) so "none plotted" on the property page is
-- honest about what it means (unincorporated Polk: Lakeland + FDEP only).

begin;

insert into gis.map_layers (source_id, kind, county, jurisdiction, sort) values
  ('ez_hillsborough_pa',         'easement', 'Hillsborough', 'Hillsborough Property Appraiser', 49),
  ('ez_lakeland',                'easement', 'Polk',         'City of Lakeland',                54),
  ('ez_fdep_clear_conservation', 'easement', null,           'FDEP conservation easements',    60)
on conflict (source_id) do update
  set kind = excluded.kind, county = excluded.county,
      jurisdiction = excluded.jurisdiction, sort = excluded.sort;

-- ------------------------------------------------------------------ easement props v2

create or replace function gis.easement_props(p_source text, p_jur text, a jsonb) returns jsonb
language plpgsql stable as $$
declare
  sub   text := 'easement';
  label text;
  ref   text;
  own   text;
  typ   text;
  nm    text;
  m     text[];
  w     numeric;
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
  elsif p_source = 'ez_hillsborough_pa' then
    -- the appraiser's parcel fabric: Encumbranc classifies; Name is usually the
    -- '<New parcel>' placeholder, occasionally the instrument ("Sewer Easement OR26220 PG 1895")
    typ := gis.known(a->>'Encumbranc');
    nm  := gis.known(a->>'Name');
    if nm ~* '^<New parcel>' or nm ~ '^[\d_()]+$' then nm := null; end if;
    label := case typ
      when 'Utility'                   then 'Utility easement'
      when 'Drainage'                  then 'Drainage easement'
      when 'Conservation'              then 'Conservation easement'
      when 'Conservation Setback'      then 'Conservation setback'
      when 'Private Ingress-Egress'    then 'Private ingress/egress easement'
      when 'Prescriptive Right Of Way' then 'Prescriptive right of way'
      else coalesce(nm, 'Easement') end;
    if typ in ('Other', 'Easement') and nm is not null then label := nm; end if;
    if typ = 'Prescriptive Right Of Way' then sub := 'row'; end if;
    if (a->>'Historical') = '1' then sub := 'vacated'; end if;
    m := regexp_match(coalesce(nm, ''), '(OR|PB|CB)\s*(\d+)\s*(?:PG|PAGE|/)\s*(\d+)', 'i');
    if m is not null then ref := upper(m[1]) || ' ' || m[2] || '/' || m[3]; end if;
  elsif p_source = 'ez_lakeland' then
    -- one master layer, a flag per purpose; REC_TYPE + BOOK/PAGE is the instrument
    typ := concat_ws(', ',
      case when a->>'UTILITY' = 'Y' then 'utility' end,
      case when a->>'ELECTRIC' = 'Y' then 'electric' end,
      case when a->>'DRAINAGE' = 'Y' then 'drainage' end,
      case when a->>'WATER' = 'Y' then 'water' end,
      case when a->>'WASTEWATER' = 'Y' then 'wastewater' end,
      case when a->>'GAS' = 'Y' then 'gas' end,
      case when a->>'INGRESS_EGRESS' = 'Y' then 'ingress/egress' end,
      case when a->>'SIDEWALK' = 'Y' then 'sidewalk' end,
      case when a->>'PEDESTRIAN' = 'Y' then 'pedestrian' end,
      case when a->>'LANDSCAPE' = 'Y' then 'landscape' end,
      case when a->>'COMMUNICATION' = 'Y' then 'communication' end,
      case when a->>'LIFTSTATION' = 'Y' then 'lift station' end,
      case when a->>'TRAFFICSIGNALIZATION' = 'Y' then 'traffic signal' end,
      case when a->>'RDWY_DRWY_ALLEY' = 'Y' then 'roadway/driveway' end,
      case when a->>'WALLFENCE' = 'Y' then 'wall/fence' end,
      case when a->>'LINEOFSITE' = 'Y' then 'line of sight' end,
      case when gis.known(a->>'ENVIRONMENTALTYPE') is not null then lower(a->>'ENVIRONMENTALTYPE') end);
    label := coalesce(nullif(initcap(typ), ''), 'Easement');
    if label !~* 'easement' then label := label || ' easement'; end if;
    if (a->>'BLANKET') = 'Y' then label := 'Blanket ' || lower(label); end if;
    if (a->>'PRIVATE_ESMT') = 'Y' then label := 'Private ' || lower(label); end if;
    if (a->>'PRELIMARY') = 'Y' then label := 'Preliminary ' || lower(label); end if;
    if (a->>'SUBORDINATION') = 'Subordination Of' then label := 'Subordination of ' || lower(label); end if;
    w := gis.num(a->>'WIDTH');
    if (a->>'WIDTHVARIES') = 'Y' then label := label || ' · width varies';
    elsif w > 0 then label := label || ' · ' || w::int || ' ft wide'; end if;
    ref := nullif(concat_ws(' ',
             coalesce(gis.known(a->>'REC_TYPE'),
                      case a->>'RECORDED' when 'PLATTED' then 'PB' when 'ACQUIRED' then 'OR' end),
             nullif(concat_ws('/', gis.known(a->>'BOOK'), gis.known(a->>'PAGE')), '')), '');
    own := initcap(gis.known(a->>'OWNER'));
    if gis.known(a->>'VACATED') is not null and (a->>'VACATED') <> 'N' then sub := 'vacated'; end if;
  elsif p_source = 'ez_fdep_clear_conservation' then
    label := 'Conservation easement';
    w := gis.num(a->>'INVENTORY_ACRES_NBR');
    if w > 0 then label := label || ' · ' || round(w, 1) || ' ac'; end if;
    own := gis.known(a->>'AGENCY_NAME');
    ref := case when gis.known(a->>'FL_SOLARIS_LAND_ID') is not null
                then 'FL-SOLARIS ' || gis.known(a->>'FL_SOLARIS_LAND_ID') end;
  else
    label := 'Easement';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'k', 'easement', 'sub', sub, 'j', p_jur, 'label', label, 'ref', ref, 'own', own));
end $$;

-- ------------------------------------------------------------------ enrich_easements v3

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
    -- a county is covered once every easement layer that applies to it — its own AND the
    -- statewide ones (county null) — is fully harvested; who plotted is recorded on the row
    select c.county,
           string_agg(distinct ml.jurisdiction, ' + ') as coverage
    from (select distinct county from gis.parcels) c
    join gis.map_layers ml on ml.kind = 'easement' and (ml.county = c.county or ml.county is null)
    join gis.layers l on l.source_id = ml.source_id and coalesce(l.feature_count, 0) > 0
    where not exists (
        select 1 from gis.map_layers m2
        join gis.harvest_drive hd on hd.source_id = m2.source_id
        where m2.kind = 'easement' and (m2.county = c.county or m2.county is null) and hd.status <> 'done')
    group by c.county
  ),
  todo as (
    select gp.property_id, gp.county, gp.geom_5070, extensions.st_area(gp.geom_5070) as area, cov.coverage
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
    join gis.map_layers ml on ml.kind = 'easement' and (ml.county = t.county or ml.county is null)
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
             'coverage', t.coverage,
             'detail', 'recorded-easement GIS of the jurisdictions in coverage; 0 = they plot easements and none touch this parcel'))
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

-- easements are fast (~10 ms a parcel); a bigger round shortens the book-wide re-pass
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
      r := public.enrich_sweep(2000, 1);
      insert into gis.sweep_log (result) values (r);
      if coalesce((r->>'written')::int, 0) = 0 then perform cron.unschedule('enrich-sweep'); end if;
    end $do$;$job$);
  return 'enrich-sweep scheduled every minute until a round finds nothing left';
end $$;

commit;
