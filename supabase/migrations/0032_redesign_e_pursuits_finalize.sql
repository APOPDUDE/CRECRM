-- Redesign E: finalize pursuits — comp the executed deal, remap stage,
-- drop dead columns + dual-side checks, add unique + date-stamping trigger.

-- 1) migrate any executed pursuit's economics into an executed comp
insert into public.comps (owner_id, property_id, pursuit_id, tenant_company_id, deal_type, kind,
   executed_lease_rate_psf, lease_structure, term_months, free_rent_months, ti_psf, escalations,
   sale_price, executed_at, sf, source)
select c.owner_id, p.property_id, p.id, p.tenant_company_id,
   (case when p.executed_price is not null and p.executed_rate_psf is null then 'sale' else 'lease' end)::public.deal_type,
   'executed',
   p.executed_rate_psf, p.lease_structure, p.term_months, p.free_rent_months, p.ti_psf, p.escalations,
   p.executed_price, coalesce(p.execution_date, current_date), pr.building_sf, 'manual'
from public.pursuits p
join public.clients c on c.id = p.client_id
left join public.properties pr on pr.id = p.property_id
where p.stage::text = 'executed' and (p.executed_rate_psf is not null or p.executed_price is not null);

-- 2) remap the 7-value match_stage into the 5-value pursuit_stage
alter table public.pursuits add column stage_new public.pursuit_stage;
update public.pursuits set stage_new = case stage::text
    when 'inquiring'         then 'inquiring'
    when 'lead'              then 'inquiring'
    when 'toured'            then 'touring'
    when 'loi'               then 'negotiation'
    when 'lease_negotiation' then 'negotiation'
    when 'executed'          then 'executed'
    when 'dead'              then 'passed'
    else 'inquiring' end::public.pursuit_stage;
alter table public.pursuits drop column stage;
alter table public.pursuits rename column stage_new to stage;
alter table public.pursuits alter column stage set default 'inquiring';
alter table public.pursuits alter column stage set not null;

-- 3) rename execution_date -> executed_date
alter table public.pursuits rename column execution_date to executed_date;

-- 4) drop dual-side checks then the dead columns
alter table public.pursuits drop constraint if exists matches_must_have_side;
alter table public.pursuits drop constraint if exists matches_tenant_identity;
alter table public.pursuits drop constraint if exists matches_broker_needs_contact;

alter table public.pursuits
  drop column listing_id,
  drop column tenant_company_id,
  drop column tenant_contact_id,
  drop column source,
  drop column broker_contact_id,
  drop column tour_at,
  drop column loi_date,
  drop column lease_negotiation_date,
  drop column commencement_date,
  drop column lease_expiration,
  drop column psa_execution_date,
  drop column dd_expiration_date,
  drop column closing_date,
  drop column lease_renewal_date,
  drop column executed_rate_psf,
  drop column executed_price,
  drop column lease_structure,
  drop column escalations,
  drop column ti_psf,
  drop column term_months,
  drop column free_rent_months;

-- 5) one pursuit per (client, property)
alter table public.pursuits add constraint pursuits_client_property_uq unique (client_id, property_id);

-- 6) auto-stamp milestone dates on stage advance (so a bare stage UPDATE just works)
create or replace function public.pursuit_stamp_dates() returns trigger language plpgsql as $$
begin
  if new.stage = 'touring'  and new.tour_date     is null then new.tour_date := current_date; end if;
  if new.stage = 'executed' and new.executed_date is null then new.executed_date := current_date; end if;
  return new;
end $$;
create trigger pursuits_stamp_dates before insert or update on public.pursuits
  for each row execute function public.pursuit_stamp_dates();
