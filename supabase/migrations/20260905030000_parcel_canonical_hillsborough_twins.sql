-- 2026-09-05 (Alex: "fix the Hillsborough parcel id normalization so those twins merge
-- automatically"). Hillsborough parcels arrive in two spellings of the same id:
--   PIN  (county GIS, scrapes, GHL):  U-36-28-19-1MD-000001-A0000.0   = JUR-SEC-TWP-RNG-SUB-BLOCK-LOT.D
--   FDOR (NAL roll, county import):   1928361MD000001A00000U          = RNG TWP SEC SUB BLOCK LOT D JUR
-- Every matcher keyed on alnum/digit text (parcel_key, normalize_parcel) saw two different
-- parcels, so the county import minted a twin next to the scraped row (178 groups today,
-- 5910 Breckenridge Pkwy among them). Digits-only keys had a second flaw: lots that differ
-- only by a letter (A0000 vs B0000) collide — 259 such collisions in Hillsborough — so the
-- canonical key keeps its letters.
-- APPLIED 2026-09-05 as parcel_canonical_hillsborough_twins. Note: the first two attempts failed
-- (unqualified canonical_parcel during index inlining; import_scraped_listings takes
-- (jsonb,uuid,boolean)) — both fixed below.

create or replace function public.canonical_parcel(p text)
returns text language sql immutable parallel safe as $$
  with x as (
    select upper(regexp_replace(split_part(coalesce(p, ''), ',', 1), '[^A-Za-z0-9]', '', 'g')) as raw
  )
  select nullif(
    case when raw ~ '^[0-9]{6}[A-Z0-9]{3}[0-9]{6}[A-Z0-9]{5}[0-9][A-Z]$'
      then regexp_replace(raw,
             '^([0-9]{2})([0-9]{2})([0-9]{2})([A-Z0-9]{3})([0-9]{6})([A-Z0-9]{5})([0-9])([A-Z])$',
             '\8\3\2\1\4\5\6\7')
      else raw end, '')
  from x;
$$;
comment on function public.canonical_parcel(text) is
  'Letter-preserving parcel key: first id, upper alnum; Hillsborough FDOR-form ids (RRTTSS…U) are reordered to PIN order (U SS TT RR …) so both spellings of one parcel are equal.';

create or replace function public.normalize_parcel(p text)
returns text language sql immutable parallel safe as $$
  select case
    when public.canonical_parcel(p) ~ '^[A-Z][0-9]{6}[A-Z0-9]{3}[0-9]{6}[A-Z0-9]{5}[0-9]$' then public.canonical_parcel(p)
    else nullif(regexp_replace(split_part(coalesce(p, ''), ',', 1), '[^0-9]', '', 'g'), '')
  end;
$$;
comment on function public.normalize_parcel(text) is
  'Matching key for a parcel id: digits of the first id (a Hillsborough FOLIO matches a stored FOLIO), except Hillsborough PIN/FDOR ids, which keep their letters in canonical PIN order.';
reindex index public.properties_parcel_norm_idx;

-- parcel_key: the importers' match column. Same shape (lower alnum | folio digits) but the
-- alnum half is now canonical, so the county roll and the scrape agree.
drop index if exists public.properties_parcel_key_idx;
drop index if exists public.properties_county_parcel_norm_idx;
drop index if exists public.properties_parcel_alnum_idx;
alter table public.properties drop column parcel_key;
alter table public.properties add column parcel_key text generated always as (
  lower(coalesce(public.canonical_parcel(parcel_number), '')) || '|' ||
  regexp_replace(coalesce(folio, ''), '[^0-9]', '', 'g')
) stored;
create index properties_parcel_key_idx on public.properties (parcel_key);
create index properties_county_parcel_norm_idx on public.properties (county, split_part(parcel_key, '|', 1));
create index properties_parcel_alnum_idx on public.properties (split_part(parcel_key, '|', 1));

-- The two importers build the INPUT side of that key themselves; repoint them at
-- canonical_parcel in place (each expression occurs exactly once — asserted).
do $$
declare def text; n int;
begin
  def := pg_get_functiondef('public.import_county_parcels(jsonb)'::regprocedure);
  n := (length(def) - length(replace(def, 'lower(regexp_replace(v_parcel, ''[^a-zA-Z0-9]'', '''', ''g''))', ''))) / length('lower(regexp_replace(v_parcel, ''[^a-zA-Z0-9]'', '''', ''g''))');
  if n <> 1 then raise exception 'import_county_parcels: expected 1 match site, found %', n; end if;
  execute replace(def, 'lower(regexp_replace(v_parcel, ''[^a-zA-Z0-9]'', '''', ''g''))', 'lower(coalesce(public.canonical_parcel(v_parcel), ''''))');

  def := pg_get_functiondef('public.import_scraped_listings(jsonb,uuid,boolean)'::regprocedure);
  n := (length(def) - length(replace(def, 'nullif(lower(regexp_replace(split_part(coalesce(v_parcel,''''), '','', 1), ''[^a-zA-Z0-9]'', '''', ''g'')), '''')', ''))) / length('nullif(lower(regexp_replace(split_part(coalesce(v_parcel,''''), '','', 1), ''[^a-zA-Z0-9]'', '''', ''g'')), '''')');
  if n <> 1 then raise exception 'import_scraped_listings: expected 1 match site, found %', n; end if;
  execute replace(def, 'nullif(lower(regexp_replace(split_part(coalesce(v_parcel,''''), '','', 1), ''[^a-zA-Z0-9]'', '''', ''g'')), '''')', 'lower(public.canonical_parcel(v_parcel))');
end $$;

-- merge_parcel_twins: fold rows that share (county, canonical parcel) into one. Guards: no
-- multi-parcel lists (assemblages), no condo units, house numbers must agree (or be absent)
-- and pins within ~300 m — the same parcel string on two different buildings is a bad
-- import, not a twin. Survivor = most attached evidence, then a non-county-roll row (folio,
-- listing links, site address), then the oldest. merge_properties() does the fold and
-- returns pre-images; a pursuit conflict raises and the group is skipped (reported in errors).
create or replace function public.merge_parcel_twins(p_dry_run boolean default true, p_county text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  g record;
  v_survivor uuid;
  v_dups uuid[];
  v_res jsonb;
  n_groups int := 0; n_merged int := 0; n_rows int := 0; n_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_plan jsonb := '[]'::jsonb;
begin
  for g in
    with base as (
      select p.id, p.county, p.source, p.created_at, p.lat, p.lng,
             public.canonical_parcel(p.parcel_number) as ck,
             position(',' in coalesce(p.parcel_number, '')) > 0 as multi,
             coalesce(p.is_condo_unit, false) as condo,
             substring(coalesce(p.site_address, p.address) from '^\s*(\d+)') as house,
             (select count(*) from comps c where c.property_id = p.id)
             + (select count(*) from market_listings m where m.property_id = p.id)
             + (select count(*) from pursuits u where u.property_id = p.id)
             + (select count(*) from listings l where l.property_id = p.id) as evidence
      from properties p
      where p.parcel_number is not null
        and (p_county is null or p.county = p_county)
    ),
    grp as (
      select county, ck,
             array_agg(id order by evidence desc, (source <> 'county_appraiser') desc, created_at) as ids,
             count(*) as n,
             bool_or(multi) as any_multi,
             bool_or(condo) as any_condo,
             count(distinct house) as houses,
             greatest(max(lat) - min(lat), max(lng) - min(lng)) as spread
      from base
      where ck is not null
      group by county, ck
      having count(*) > 1
    )
    select * from grp
  loop
    n_groups := n_groups + 1;
    if g.any_multi or g.any_condo or g.houses > 1 or coalesce(g.spread, 0) > 0.003 then
      n_skipped := n_skipped + 1;
      continue;
    end if;
    v_survivor := g.ids[1];
    v_dups := g.ids[2:];
    if p_dry_run then
      v_plan := v_plan || jsonb_build_object('county', g.county, 'parcel', g.ck, 'survivor', v_survivor, 'duplicates', to_jsonb(v_dups));
      n_merged := n_merged + 1;
      n_rows := n_rows + coalesce(array_length(v_dups, 1), 0);
      continue;
    end if;
    begin
      v_res := public.merge_properties(v_survivor, v_dups);
      n_merged := n_merged + 1;
      n_rows := n_rows + coalesce(array_length(v_dups, 1), 0);
    exception when others then
      v_errors := v_errors || jsonb_build_object('county', g.county, 'parcel', g.ck, 'survivor', v_survivor, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object(
    'dry_run', p_dry_run, 'groups', n_groups, 'merged_groups', n_merged, 'rows_folded', n_rows,
    'skipped_guarded', n_skipped, 'errors', v_errors, 'plan', case when p_dry_run then v_plan else null end);
end $$;
revoke execute on function public.merge_parcel_twins(boolean, text) from public, anon, authenticated;
comment on function public.merge_parcel_twins(boolean, text) is
  'Folds properties sharing (county, canonical_parcel) into one via merge_properties(); guarded by house number, pin spread, condo and assemblage checks. Daily cron; call with p_dry_run=true to see the plan.';

-- Daily, before the 07:10 distress job.
select cron.unschedule('merge-parcel-twins') where exists (select 1 from cron.job where jobname = 'merge-parcel-twins');
select cron.schedule('merge-parcel-twins', '50 6 * * *', $$set statement_timeout = '10min'; select public.merge_parcel_twins(false);$$);

-- First run 2026-09-05: 607 groups, 330 merged (368 rows folded: Hillsborough 237 groups,
-- Sarasota 30, Pinellas 20, Pasco 19, Manatee 14, Polk 12), 275 held by the guards, 2 pursuit
-- conflicts left for a human (4528 Transport Dr — four rows; 3875 Correia Dr, Pasco).
