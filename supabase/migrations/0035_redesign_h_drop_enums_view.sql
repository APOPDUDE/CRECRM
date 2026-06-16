-- Redesign H: drop the retired enums and add the landlord-board view.

-- snapshot copies still reference the retired enums; demote them to text
alter table backup_predesign.notes       alter column entity_type type text using entity_type::text;
alter table backup_predesign.files       alter column entity_type type text using entity_type::text;
alter table backup_predesign.tasks       alter column entity_type type text using entity_type::text;
alter table backup_predesign.matches     alter column stage       type text using stage::text;
alter table backup_predesign.tenant_reps alter column stage       type text using stage::text;

drop type public.note_entity;
drop type public.match_stage;
drop type public.tenant_rep_stage;

-- landlord board: a listing and the tenants/buyers pursuing its property.
-- LEFT JOIN from listings so a listing with no prospects still appears.
create or replace view public.v_listing_pursuits as
select
  l.id            as listing_id,
  l.property_id   as property_id,
  l.deal_type     as listing_deal_type,
  l.stage         as listing_stage,
  l.status        as listing_status,
  p.id            as pursuit_id,
  p.stage         as pursuit_stage,
  p.inquiry_date  as inquiry_date,
  p.tour_date     as tour_date,
  p.executed_date as executed_date,
  p.flagged_new   as flagged_new,
  p.actual_fee    as actual_fee,
  p.notes         as pursuit_notes,
  c.id            as client_id,
  c.status        as client_status,
  c.deal_type     as client_deal_type,
  co.id           as company_id,
  co.name         as company_name,
  ct.id           as contact_id,
  ct.first_name   as contact_first_name,
  ct.last_name    as contact_last_name,
  (l.status = 'active' and c.status = 'active') as double_ended
from public.listings l
left join public.pursuits  p  on p.property_id = l.property_id
left join public.clients   c  on c.id = p.client_id
left join public.companies co on co.id = c.company_id
left join public.contacts  ct on ct.id = c.contact_id;
