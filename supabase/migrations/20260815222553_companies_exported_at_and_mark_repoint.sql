-- STAGE 2b (E): the one pipeline fact owners.verification_status carried ('exported' =
-- this owner went out on a skip-trace list) moves to companies.exported_at.
--
-- 1. companies.exported_at timestamptz, backfilled from the 48 verification_status='exported'
--    owners. The owner's verification_updated_at IS the export moment, so it is preserved
--    where present (now() only as fallback).
-- 2. mark_owners_exported stamps BOTH sides: the owners write is kept verbatim (dies with
--    the table); companies.exported_at is stamped through properties.owner_company_id under
--    the same guard the owners side always had (never relabel an already-verified owner —
--    here: a company with a verified contact seated). Return keeps 'owners_marked' and adds
--    'companies_marked'.

alter table companies add column if not exists exported_at timestamptz;

update companies c
set exported_at = coalesce(o.verification_updated_at, now())
from owners o
where o.company_id = c.id
  and o.verification_status = 'exported'
  and c.exported_at is null;

create or replace function public.mark_owners_exported(p_property_ids uuid[])
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with owner_upd as (
    update owners o
    set verification_status = 'exported', verification_updated_at = now()
    where o.id in (select distinct owner_id from properties
                   where id = any(p_property_ids) and owner_id is not null)
      and o.verification_status = 'unverified'
    returning 1
  ),
  company_upd as (
    update companies c
    set exported_at = now()
    where c.id in (select distinct owner_company_id from properties
                   where id = any(p_property_ids) and owner_company_id is not null)
      and c.exported_at is null
      and not exists (select 1 from contacts ct
                      where ct.company_id = c.id and ct.verified_at is not null)
    returning 1
  )
  select jsonb_build_object(
    'owners_marked',    (select count(*) from owner_upd),
    'companies_marked', (select count(*) from company_upd)
  );
$function$;
