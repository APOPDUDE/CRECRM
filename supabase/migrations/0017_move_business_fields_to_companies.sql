-- Business attributes (website, industry) belong to the COMPANY, not the tenant rep.
alter table companies add column if not exists industry text;

-- Migrate any existing tenant_rep business fields onto their linked company,
-- only filling empty company slots (no-op on current data, which has none).
update companies c
set industry = sub.bi
from (
  select tenant_company_id, max(business_industry) as bi
  from tenant_reps
  where tenant_company_id is not null and business_industry is not null
  group by tenant_company_id
) sub
where c.id = sub.tenant_company_id and c.industry is null;

update companies c
set website = sub.bw
from (
  select tenant_company_id, max(business_website) as bw
  from tenant_reps
  where tenant_company_id is not null and business_website is not null
  group by tenant_company_id
) sub
where c.id = sub.tenant_company_id and c.website is null;

alter table tenant_reps drop column if exists business_website;
alter table tenant_reps drop column if exists business_industry;
