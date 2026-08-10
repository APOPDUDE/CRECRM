-- The tenant on a lease comp becomes a real company, and companies get decision makers.
--
-- Before this, 1,326 of 1,331 executed lease comps carried only a TEXT tenant name --
-- the tenant_company_id FK existed but nothing filled it. So a lease was a rate and a
-- date with no one attached: no company to open, no contact to add, no way to ask "who
-- do I call before this expires". The lease lens found the building but not the person.
--
-- Three moves:
--
-- 1. Every distinct tenant name on an executed lease comp becomes a company
--    (type 'tenant', source 'lease_comp'), and every comp links to its company.
--    Exact fold only (lower/trim) -- "FedEx Ground" and "FedEx" stay separate
--    companies, because merging brands is a judgment call a migration must not make.
--
-- 2. A trigger keeps this true forever: any executed lease comp inserted or updated
--    with a tenant name and no company gets found-or-created a company. The rule lives
--    in Postgres, so bulk-load imports and n8n get it too, per the foundation rule
--    that no business rule may exist only in frontend code.
--
-- 3. Contacts gain decision_maker ('none' | 'suspected' | 'verified').
--    'suspected' is a title on LinkedIn; 'verified' means Alex talked to them and they
--    make the real-estate call. The lease-lens filter is binary on verified -- same
--    philosophy as the owner lens: either you can call the decision maker today, or
--    the company belongs on the enrichment list.

-- ---------------------------------------------------------------- decision makers

create type decision_maker_status as enum ('none', 'suspected', 'verified');

alter table contacts
  add column decision_maker decision_maker_status not null default 'none';

comment on column contacts.decision_maker is
  'Whether this person makes the real-estate decision for their company. suspected = '
  'inferred from title; verified = confirmed in conversation.';

-- ------------------------------------------------------------ companies get a source

alter table companies add column if not exists source text;

comment on column companies.source is
  'Where the row came from. lease_comp = bulk-created from a lease comp tenant name; '
  'null = created by hand.';

-- ------------------------------------------------- backfill: tenants become companies

-- Link comps whose tenant name already matches an existing company.
update comps c
set tenant_company_id = co.id
from companies co
where c.deal_type = 'lease' and c.kind = 'executed'
  and c.tenant_company_id is null
  and c.tenant_name is not null
  and lower(btrim(co.name)) = lower(btrim(c.tenant_name));

-- Create a company for every remaining distinct tenant name.
insert into companies (name, type, source)
select distinct on (lower(btrim(tenant_name)))
       btrim(tenant_name), 'tenant', 'lease_comp'
from comps
where deal_type = 'lease' and kind = 'executed'
  and tenant_company_id is null
  and nullif(btrim(coalesce(tenant_name, '')), '') is not null
order by lower(btrim(tenant_name));

-- Link everything to the companies that now exist.
update comps c
set tenant_company_id = co.id
from companies co
where c.deal_type = 'lease' and c.kind = 'executed'
  and c.tenant_company_id is null
  and c.tenant_name is not null
  and lower(btrim(co.name)) = lower(btrim(c.tenant_name));

-- --------------------------------------------- trigger: future comps stay linked

create or replace function comps_link_tenant_company() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid;
begin
  if new.deal_type = 'lease' and new.kind = 'executed'
     and new.tenant_company_id is null
     and nullif(btrim(coalesce(new.tenant_name, '')), '') is not null then
    select id into v_company from companies
    where lower(btrim(name)) = lower(btrim(new.tenant_name))
    limit 1;
    if v_company is null then
      insert into companies (name, type, source)
      values (btrim(new.tenant_name), 'tenant', 'lease_comp')
      returning id into v_company;
    end if;
    new.tenant_company_id := v_company;
  end if;
  return new;
end $$;

create trigger comps_link_tenant_company
  before insert or update of tenant_name on comps
  for each row execute function comps_link_tenant_company();

-- ------------------------------------------------ the view learns who to call

create or replace view v_lease_comps
with (security_invoker = true) as
select
  c.id as comp_id, c.property_id, c.tenant_name, c.tenant_company_id,
  co.name as tenant_company_name,
  c.sf, c.executed_lease_rate_psf, c.lease_structure, c.term_months,
  c.commencement_date, c.expiration_date, c.executed_at as signed_date,
  (c.expiration_date - current_date) as days_to_expiry,
  case
    when c.expiration_date is null then null
    when c.expiration_date < current_date then
      least(-1, (date_part('year',  age(c.expiration_date, current_date)) * 12
                 + date_part('month', age(c.expiration_date, current_date)))::int)
    else (date_part('year',  age(c.expiration_date, current_date)) * 12
          + date_part('month', age(c.expiration_date, current_date)))::int
  end as months_to_expiry,
  case
    when c.executed_at is null then null
    else (date_part('year',  age(current_date, c.executed_at)) * 12
          + date_part('month', age(current_date, c.executed_at)))::int
  end as months_since_signed,
  -- The best person at the tenant: verified decision maker first, then suspected.
  -- One row so the map tooltip can print a name and number without a second query.
  dm.dm_status, dm.dm_name, dm.dm_phone,
  (dm.dm_status = 'verified') as dm_verified,
  p.address, p.city, p.state, p.county, p.lat, p.lng,
  p.building_sf, p.land_acres, p.property_type
from comps c
join properties p on p.id = c.property_id
left join companies co on co.id = c.tenant_company_id
left join lateral (
  select ct.decision_maker as dm_status,
         btrim(ct.first_name || ' ' || coalesce(ct.last_name, '')) as dm_name,
         ct.phone as dm_phone
  from contacts ct
  where ct.company_id = c.tenant_company_id
    and ct.decision_maker <> 'none'
    and ct.archived is not true
  order by ct.decision_maker = 'verified' desc, ct.updated_at desc
  limit 1
) dm on true
where c.deal_type = 'lease' and c.kind = 'executed';

comment on view v_lease_comps is
  'Every executed lease comp joined to its parcel, tenant company and best decision '
  'maker. months_to_expiry is negative once the lease has run out; months_since_signed '
  'is positive for a lease signed in the past. dm_verified means a verified decision '
  'maker exists at the tenant company.';
