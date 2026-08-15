-- owners -> companies STAGE 2a: the entity table becomes self-sufficient (mailing address),
-- and every kept contact with an owner link lands on the owning company. Still additive;
-- owners/owner_contacts keep working (retirement = stage 2b, ships with the app rewrite).
-- Verified after apply: 0 linkable contacts left, contacts.company_id 578 -> 1,004,
-- companies.mailing_address on 11,322 rows.

alter table companies add column if not exists mailing_address text;
alter table companies add column if not exists mailing_city text;
alter table companies add column if not exists mailing_state text;
alter table companies add column if not exists mailing_zip text;

update companies c
set mailing_address = o.mailing_address,
    mailing_city    = o.mailing_city,
    mailing_state   = o.mailing_state,
    mailing_zip     = o.mailing_zip
from owners o
where o.company_id = c.id
  and c.mailing_address is null
  and o.mailing_address is not null;

create or replace function owners_mirror_company() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if new.company_id is not null then return new; end if;
  select id into v_company from companies
    where normalized_name = normalize_owner_name(new.display_name)
    order by created_at limit 1;
  if v_company is null then
    insert into companies (name, type, source, entity_kind,
                           mailing_address, mailing_city, mailing_state, mailing_zip)
    values (new.display_name, 'owning_entity', 'county_appraiser', new.kind,
            new.mailing_address, new.mailing_city, new.mailing_state, new.mailing_zip)
    returning id into v_company;
  end if;
  new.company_id := v_company;
  return new;
end $$;

update contacts ct
set company_id = pick.company_id
from (
  select distinct on (oc.contact_id) oc.contact_id, o.company_id
  from owner_contacts oc
  join owners o on o.id = oc.owner_id
  where o.company_id is not null
  order by oc.contact_id, oc.confidence, oc.created_at
) pick
where ct.id = pick.contact_id
  and ct.company_id is null;
