-- Zoning, phase 1 (plan: context/plan-zoning-layer.md).
--
-- Three facts per property, in Alex's words: a TYPE that is one vocabulary app-wide, a
-- CODE that is the jurisdiction's own, and a DESCRIPTION straight from the county. Plus
-- the jurisdiction itself, because "C-2" means nothing without knowing whose C-2 it is.
--
-- The four buckets Alex works are industrial, office, retail, multifamily. The rest of
-- the enum exists so 'other' stays meaningful — ag land beside an industrial park is a
-- rezone play, not noise, and single-family residential is most of any county's polygons.

create type zoning_kind as enum (
  'industrial',
  'office',
  'retail',
  'multifamily',
  'residential',          -- single-family / non-multifamily residential
  'agricultural',
  'mixed_use',
  'planned_development',  -- PD/PUD where the description doesn't reveal the underlying use
  'other'
);

alter table properties
  add column zoning_type zoning_kind,
  add column zoning_code text,
  add column zoning_jurisdiction text,
  add column zoning_updated_at timestamptz;

comment on column properties.zoning_type is
  'Normalized bucket, derived from zoning_code_map at import. The scraped zoning_district '
  'column is deprecated in favour of zoning_code.';
comment on column properties.zoning_code is 'The jurisdiction''s zoning code, verbatim (M-1, IG, PD-I).';
comment on column properties.zoning_jurisdiction is
  'Who zones it: the city for incorporated land, else the county. A code is only meaningful with this.';

create index properties_zoning_type_idx on properties (zoning_type) where zoning_type is not null;

-- One row per (jurisdiction, code): the normalisation, and the one place a human
-- judgement about a code is recorded. PDs and county oddities get verified=true after
-- Alex's review pass; auto-guesses stay false so a wrong guess is findable.
create table zoning_code_map (
  jurisdiction text not null,
  code text not null,
  zoning_type zoning_kind not null,
  description text,
  verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (jurisdiction, code)
);

create trigger zoning_code_map_updated_at before update on zoning_code_map
  for each row execute function set_updated_at();

alter table zoning_code_map enable row level security;
create policy zoning_code_map_auth_all on zoning_code_map
  for all to authenticated using (true) with check (true);

/**
 * Bulk writer for the zoning extraction. Rows:
 *   { id?: uuid, sk?: source_key, j: jurisdiction, code: text, d?: description }
 * matched by CRM id when the extraction knew it (crm_cov snapshot rows), else by
 * source_key (the parcel-import rows the snapshot predates).
 *
 * An unmapped (jurisdiction, code) still lands — code, description and jurisdiction are
 * facts regardless — with zoning_type left null and counted, so the map review knows its
 * work. apply_zoning_map() re-derives types after the map is edited.
 *
 * A scraped zoning_description is preserved into appraiser_data->'scraped_zoning' the
 * first time an official value overwrites it: county truth wins, but nothing is erased.
 */
create or replace function import_zoning(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_id uuid;
  v_type zoning_kind;
  n_set int := 0;
  n_unmapped int := 0;
  n_miss int := 0;
begin
  for r in select * from jsonb_array_elements(p->'rows')
  loop
    v_id := null;
    if r ? 'id' then
      select id into v_id from properties where id = (r->>'id')::uuid;
    end if;
    if v_id is null and r ? 'sk' then
      select id into v_id from properties where source_key = r->>'sk';
    end if;
    if v_id is null then
      n_miss := n_miss + 1;
      continue;
    end if;

    select m.zoning_type into v_type
    from zoning_code_map m
    where m.jurisdiction = r->>'j' and m.code = r->>'code';
    if v_type is null then n_unmapped := n_unmapped + 1; end if;

    update properties pr
    set appraiser_data = case
          when pr.zoning_description is not null and pr.zoning_updated_at is null
          then coalesce(pr.appraiser_data, '{}'::jsonb)
               || jsonb_build_object('scraped_zoning', pr.zoning_description)
          else pr.appraiser_data
        end,
        zoning_code         = r->>'code',
        zoning_jurisdiction = r->>'j',
        zoning_description  = coalesce(nullif(btrim(coalesce(r->>'d','')), ''), pr.zoning_description),
        zoning_type         = v_type,
        zoning_updated_at   = now()
    where pr.id = v_id;
    n_set := n_set + 1;
  end loop;

  return jsonb_build_object('set', n_set, 'unmapped', n_unmapped, 'not_found', n_miss);
end $$;

/** Re-derive zoning_type after zoning_code_map edits (the review pass). */
create or replace function apply_zoning_map()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with changed as (
    update properties p
    set zoning_type = m.zoning_type
    from zoning_code_map m
    where p.zoning_jurisdiction = m.jurisdiction
      and p.zoning_code = m.code
      and p.zoning_type is distinct from m.zoning_type
    returning 1
  )
  select jsonb_build_object('retyped', count(*)) from changed;
$$;

grant execute on function apply_zoning_map() to authenticated;
