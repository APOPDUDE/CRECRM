-- 2026-09-02: Lakeland easement labels read "Drainage, N easement" — the layer's
-- ENVIRONMENTALTYPE holds 'N' for none (a type name otherwise) and gis.known() let it
-- through as a purpose. Applied via MCP; Polk's claims were reset so the stored
-- instruments carry the corrected label.

begin;

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
      -- ENVIRONMENTALTYPE is 'N' for none, a type name otherwise
      case when gis.known(a->>'ENVIRONMENTALTYPE') not in ('N', 'Y') then lower(a->>'ENVIRONMENTALTYPE') end);
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

commit;
