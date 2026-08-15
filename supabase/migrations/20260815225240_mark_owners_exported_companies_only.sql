-- STAGE 2b end-game (2e): mark_owners_exported drops its owners write — companies.exported_at
-- is the only export stamp now. Function name and response keys are kept (the deployed
-- bundle's export toast reads 'owners_marked'); both keys report the same companies count.

create or replace function public.mark_owners_exported(p_property_ids uuid[])
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with company_upd as (
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
    'owners_marked',    (select count(*) from company_upd),
    'companies_marked', (select count(*) from company_upd)
  );
$function$;
