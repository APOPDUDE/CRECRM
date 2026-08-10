-- Companies grow the firmographic fields the lease-comp imports always carried.
--
-- The two CoStar exports (MS Lease Comps / Expiring Leases) had Tenant Website,
-- Employees, NAICS, SIC, Industry and a location phone on most rows -- columns the
-- comp import deliberately dropped because the job then was comps. Now that every
-- tenant name is a company, those columns finally have somewhere to live.
--
-- annual_revenue has no source in the files; it exists so Alex can fill it by hand.
-- The enrichment import fills ONLY null fields -- it never overwrites a value someone
-- typed, per "I can fill in stuff later so don't make anything up".

alter table companies
  add column if not exists employee_count integer,
  add column if not exists annual_revenue numeric,
  add column if not exists naics text,
  add column if not exists sic text;

comment on column companies.employee_count is 'Headcount, from CoStar exports or by hand.';
comment on column companies.annual_revenue is 'Yearly revenue in dollars. No import carries this; hand-filled.';
comment on column companies.naics is 'NAICS code (digits only where parseable).';
comment on column companies.sic is 'SIC code (digits only where parseable).';

-- The lease export needs the decision maker's email too, not just name and phone.
drop view if exists v_lease_comps;

create view v_lease_comps
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
  dm.dm_status, dm.dm_name, dm.dm_title, dm.dm_phone, dm.dm_email,
  (dm.dm_status = 'verified') as dm_verified,
  p.address, p.city, p.state, p.county, p.lat, p.lng,
  p.building_sf, p.land_acres, p.property_type
from comps c
join properties p on p.id = c.property_id
left join companies co on co.id = c.tenant_company_id
left join lateral (
  select ct.decision_maker as dm_status,
         btrim(ct.first_name || ' ' || coalesce(ct.last_name, '')) as dm_name,
         ct.title as dm_title,
         ct.phone as dm_phone,
         ct.email as dm_email
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
