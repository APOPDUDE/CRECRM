-- owners -> companies merge, STAGE 1 (R4): every county title-holder gets a companies row
-- (type='owning_entity'), owners carries the link, properties carry owner_company_id.
-- ADDITIVE ONLY: owners and every function/view/automation reading it keep working unchanged.
-- Stage 2 (repoint views/functions/app, retire owners + owner_contacts) is a later block.
-- Race-safety without an automation freeze: the BEFORE INSERT mirror trigger is installed FIRST,
-- so an owner minted mid-backfill (ghl_verify_owner) links itself; the backfill only touches
-- company_id IS NULL rows. Individuals stay one row each (entity_kind='individual') — the deed
-- position is the entity even when a human holds it directly (R5.3).
-- Verified after apply: 11,487/11,487 owners linked (11,456 minted + 31 to existing companies),
-- properties.owner_company_id on all 14,899 owner-bearing rows, war-room invariant 573 unchanged,
-- 461 confirmed owner-people now carry the owning company on contacts.company_id.

alter table companies add column if not exists entity_kind owner_kind;
comment on column companies.entity_kind is 'individual|entity|government for county-roll owning entities absorbed from owners; null for ordinary companies';

alter table owners add column if not exists company_id uuid references companies(id);
comment on column owners.company_id is 'stage-1 merge link: the companies row this title-holder IS; stage 2 retires owners in its favor';

create or replace function owners_mirror_company() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if new.company_id is not null then return new; end if;
  select id into v_company from companies
    where normalized_name = normalize_owner_name(new.display_name)
    order by created_at limit 1;
  if v_company is null then
    insert into companies (name, type, source, entity_kind)
    values (new.display_name, 'owning_entity', 'county_appraiser', new.kind)
    returning id into v_company;
  end if;
  new.company_id := v_company;
  return new;
end $$;

drop trigger if exists owners_mirror_company on owners;
create trigger owners_mirror_company before insert on owners
for each row execute function owners_mirror_company();

update owners o
set company_id = (select c.id from companies c
                  where c.normalized_name = o.normalized_name
                  order by c.created_at, c.id limit 1)
where o.company_id is null
  and exists (select 1 from companies c where c.normalized_name = o.normalized_name);

insert into companies (name, type, source, entity_kind)
select o.display_name, 'owning_entity', 'county_appraiser', o.kind
from owners o where o.company_id is null;

update owners o
set company_id = c.id
from companies c
where o.company_id is null
  and c.type = 'owning_entity'
  and c.normalized_name = o.normalized_name;

alter table properties add column if not exists owner_company_id uuid references companies(id);
update properties p
set owner_company_id = o.company_id
from owners o
where o.id = p.owner_id and p.owner_company_id is distinct from o.company_id;
create index if not exists properties_owner_company_idx on properties(owner_company_id) where owner_company_id is not null;

update contacts ct
set company_id = o.company_id
from owner_contacts oc
join owners o on o.id = oc.owner_id
where oc.contact_id = ct.id
  and oc.confidence = 'confirmed'
  and ct.company_id is null
  and o.company_id is not null;
