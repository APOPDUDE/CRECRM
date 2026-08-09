-- Bulk loader for lease comps arriving as CSV exports.
--
-- Called through the bulk-load edge function so large files stream from disk
-- straight into Postgres. Two things it deliberately does NOT do:
--
--   * It will not mint a property for a comp whose address is unknown. A comp
--     is market noise until it is attached to a real parcel; creating one row
--     per unmatched comp would bury the 13k genuine properties. Unmatched rows
--     come back in the return value so they can be triaged by hand.
--   * It does not dedupe on source_key. The earlier import wrote
--     'imp:<hash>' keys that cannot be reproduced from these files, so
--     identity is (property, tenant, sf) instead.

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
      nullif(r->>'struct', '')::lease_structure,
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
