-- IG (industrial gross) is not a structure this brokerage quotes: a gross
-- industrial lease is MG. It only ever entered lease_structure in
-- 20260714000005 because the CoStar lease-comp exports use the code, and all 22
-- rows carrying it arrived by import -- none typed by hand. They fold to MG here.
--
-- FS (full service) STAYS. It is a genuinely different animal on office, where
-- base rent covers utilities and janitorial on top of taxes/insurance/CAM, and
-- 92 of the 101 FS comps are office. The manual-entry dropdowns keep FS and drop
-- IG.
--
-- The IG enum value itself stays -- Postgres cannot drop one -- but nothing
-- writes it: normalize_lease_structure() is the single choke point every import
-- goes through, so the next CSV folds it instead of reintroducing it. Without
-- that the rule would live only in the React dropdowns, which foundation rule 1
-- forbids and which the importer would quietly undo.

create or replace function normalize_lease_structure(p text)
returns lease_structure language sql immutable as $$
  select case upper(btrim(coalesce(p, '')))
           when ''   then null::lease_structure
           when 'IG' then 'MG'::lease_structure
           else upper(btrim(p))::lease_structure
         end
$$;

comment on function normalize_lease_structure(text) is
  'Folds the CoStar export code IG into MG; a gross industrial lease is MG here. FS is left alone.';

update comps set lease_structure = 'MG' where lease_structure = 'IG';

-- Unchanged from 20260808000003 except the lease_structure cast, which now
-- goes through normalize_lease_structure().
create or replace function import_lease_comps(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r jsonb;
  v_prop uuid;
  v_owner uuid := '33b63bc5-d42b-40b0-9ab6-7cc824450905';
  n_in int := 0;
  n_new int := 0;
  n_dupe int := 0;
  missed jsonb := '[]'::jsonb;
  v_tenant text;
  v_sf int;
begin
  for r in select * from jsonb_array_elements(p) loop
    n_in := n_in + 1;
    v_tenant := nullif(btrim(coalesce(r->>'tenant', '')), '');
    v_sf := nullif(r->>'sf', '')::int;

    select id into v_prop
    from properties
    where normalize_street(address) = normalize_street(r->>'addr')
      and (nullif(r->>'city', '') is null
           or city is null
           or upper(btrim(city)) = upper(btrim(r->>'city')))
    limit 1;

    if v_prop is null then
      missed := missed || jsonb_build_object(
        'addr', r->>'addr', 'city', r->>'city', 'tenant', v_tenant, 'sf', v_sf);
      continue;
    end if;

    if exists (
      select 1 from comps c
      where c.property_id = v_prop
        and c.deal_type = 'lease'
        and coalesce(lower(c.tenant_name), '') = coalesce(lower(v_tenant), '')
        and coalesce(c.sf, 0) = coalesce(v_sf, 0)
    ) then
      n_dupe := n_dupe + 1;
      continue;
    end if;

    insert into comps (
      property_id, owner_id, kind, deal_type, source, source_key,
      tenant_name, sf, executed_lease_rate_psf, lease_structure, term_months,
      commencement_date, expiration_date, executed_at, unit, verified, as_of_date)
    values (
      v_prop, v_owner, 'executed', 'lease', 'import',
      'leasecsv:' || substr(md5(coalesce(r->>'addr', '')
                            || coalesce(v_tenant, '')
                            || coalesce(v_sf::text, '')), 1, 16),
      v_tenant, v_sf,
      nullif(r->>'rate', '')::numeric,
      normalize_lease_structure(r->>'struct'),
      nullif(r->>'term', '')::int,
      nullif(r->>'comm', '')::date,
      nullif(r->>'exp', '')::date,
      nullif(r->>'signed', '')::date,
      nullif(btrim(coalesce(r->>'suite', '')), ''),
      coalesce((r->>'verified')::boolean, false),
      coalesce(nullif(r->>'comm', '')::date, current_date));

    n_new := n_new + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'received', n_in, 'inserted', n_new,
    'already_had', n_dupe, 'unmatched', missed);
end $$;
