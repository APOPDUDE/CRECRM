-- Structured owner mailing city/state/zip ON THE PROPERTY, for postcard campaigns over the whole book.
--
-- Why not just use companies.mailing_*: 17,145 of 31,978 properties have NO owning company, so they
-- can never inherit one -- only 14,070 properties could. The mailing address is a fact about the
-- PARCEL's owner of record, so it belongs on the parcel too.
--
-- properties.owner_mailing_address stays as-is: it is the county's raw string and is NOT truncated.
-- An earlier 2026-08-17 analysis claimed ~3,000 values were truncated at a C/O line; that was an
-- artifact of split_part(addr, ',', 1) IN THE COMPARISON, not the data. The stored values are
-- complete ("C/o Vulcan Materials Co Indirect Tax Dept, 1200 Urban Center Dr, Vestavia, Al,
-- 35242-2545"); 10,944 of 29,375 already carry a full comma-delimited address and only 27 rows have
-- no street number at all.
alter table properties add column if not exists owner_mailing_city  text;
alter table properties add column if not exists owner_mailing_state text;
alter table properties add column if not exists owner_mailing_zip   text;

comment on column properties.owner_mailing_city is
  'Owner mailing city, backfilled from the FDOR NAL roll. Use with owner_mailing_state/_zip for postcard exports; owner_mailing_address holds the county raw string.';

-- Extend the bulk-load importer to accept PROPERTY rows as well as COMPANY rows, so the same
-- allowlisted function serves both and no edge-function redeploy is needed.
-- Still FILL-NULL ONLY (coalesce): never overwrites an existing value, and replaying is a no-op.
create or replace function public.import_owner_addresses(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co_updated   int := 0;
  v_prop_updated int := 0;
  v_seen         int;
begin
  select count(*) into v_seen from jsonb_array_elements(coalesce(p, '[]'::jsonb));

  with src as (
    select nullif(btrim(x->>'company_id'), '')  as cid_t,
           nullif(btrim(x->>'property_id'), '') as pid_t,
           nullif(btrim(x->>'address'), '')     as addr,
           nullif(btrim(x->>'city'), '')        as city,
           nullif(btrim(x->>'state'), '')       as st,
           nullif(btrim(x->>'zip'), '')         as zip
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
  ),
  upd_co as (
    update companies c
    set mailing_address = coalesce(c.mailing_address, s.addr),
        mailing_city    = coalesce(c.mailing_city,    s.city),
        mailing_state   = coalesce(c.mailing_state,   s.st),
        mailing_zip     = coalesce(c.mailing_zip,     s.zip)
    from src s
    where s.cid_t is not null and c.id = s.cid_t::uuid
      and (c.mailing_address is null or c.mailing_city is null
           or c.mailing_state is null or c.mailing_zip is null)
    returning 1
  ),
  upd_prop as (
    update properties pr
    set owner_mailing_address = coalesce(pr.owner_mailing_address, s.addr),
        owner_mailing_city    = coalesce(pr.owner_mailing_city,    s.city),
        owner_mailing_state   = coalesce(pr.owner_mailing_state,   s.st),
        owner_mailing_zip     = coalesce(pr.owner_mailing_zip,     s.zip)
    from src s
    where s.pid_t is not null and pr.id = s.pid_t::uuid
      and (pr.owner_mailing_address is null or pr.owner_mailing_city is null
           or pr.owner_mailing_state is null or pr.owner_mailing_zip is null)
    returning 1
  )
  select (select count(*) from upd_co), (select count(*) from upd_prop)
    into v_co_updated, v_prop_updated;

  return jsonb_build_object('ok', true, 'seen', v_seen,
                            'companies_updated', v_co_updated,
                            'properties_updated', v_prop_updated);
end $function$;

-- Applied 2026-08-17. Loaded 27,974 properties in 19 chunks through /functions/v1/bulk-load
-- (seen 27,974 / updated 27,974, zero failures). Mailable properties 0 -> 27,974 of 31,978 (87%),
-- across 21,242 distinct owners, including 2,552 owner-occupier parcels.
-- Remaining: 1,550 have a street line but no city (no FDOR match), 2,454 have no mailing at all.
