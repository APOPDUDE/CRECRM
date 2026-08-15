-- STAGE 2b end-game (2b): county imports stop minting owners — properties mint/link the
-- owning COMPANY directly from owner_name.
--
-- BEFORE INSERT OR UPDATE OF owner_name: when owner_name is non-null and the row either
-- has no owning company yet or the name actually changed, find-or-create the company by
-- normalize_owner_name(owner_name) and (re)seat owner_company_id. Mint shape mirrors the
-- retired owners_mirror_company trigger: type owning_entity, source county_appraiser,
-- entity_kind 'unknown' (no classifier at import time), mailing from the property's
-- county-provided owner_mailing_address. companies.normalized_name is a stored generated
-- column, so the insert supplies only the raw name.
--
-- companies.normalized_name gets a btree index for this exact-match lookup (only the
-- trigram GIN existed).

create index if not exists companies_normalized_name_btree_idx
  on companies (normalized_name);

create or replace function public.set_owner_company_from_name()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co uuid;
begin
  if new.owner_name is null then
    return new;
  end if;
  if new.owner_company_id is not null
     and (tg_op = 'INSERT' or new.owner_name is not distinct from old.owner_name) then
    return new;
  end if;

  select id into v_co from companies
  where normalized_name = normalize_owner_name(new.owner_name)
  order by created_at limit 1;

  if v_co is null then
    insert into companies (name, type, source, entity_kind, mailing_address)
    values (new.owner_name, 'owning_entity', 'county_appraiser', 'unknown',
            new.owner_mailing_address)
    returning id into v_co;
  end if;

  new.owner_company_id := v_co;
  return new;
end $function$;

drop trigger if exists properties_owner_company_from_name on properties;
create trigger properties_owner_company_from_name
before insert or update of owner_name on properties
for each row execute function set_owner_company_from_name();
