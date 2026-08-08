-- A communications row that arrives with only a phone number is real data the UI cannot
-- see: the contact page filters on contact_id and the owner page on owner_id/contact_id,
-- so a phone-only row renders nowhere. The GHL note sync wrote exactly such rows -- the
-- Umholtz case: notes synced fine, landed in the table, and never appeared on his page.
--
-- Resolution belongs in the database, not in each writer: any pipe that inserts a
-- phone-keyed row (note sync, call logger, future writers) gets the same linking for free.
-- Applied live 2026-08-08 via MCP (with backfill of the phone-only rows then present).

create index if not exists contacts_phone_digits_idx
  on contacts ((regexp_replace(coalesce(phone,''), '\D', '', 'g')));

create or replace function resolve_communication_identity() returns trigger
language plpgsql as $$
declare
  digits text;
begin
  if new.phone is null then return new; end if;
  digits := regexp_replace(new.phone, '\D', '', 'g');
  if length(digits) = 11 and digits like '1%' then digits := substr(digits, 2); end if;
  if length(digits) <> 10 then return new; end if;

  if new.contact_id is null then
    -- If several contacts share the number (merged twins exist), prefer the one that is
    -- linked to an owner -- that is the record the owner page will surface.
    select c.id into new.contact_id
    from contacts c
    left join owner_contacts oc on oc.contact_id = c.id
    where regexp_replace(coalesce(c.phone,''), '\D', '', 'g') = digits
    order by (oc.owner_id is not null) desc, c.created_at asc
    limit 1;
  end if;

  if new.owner_id is null and new.contact_id is not null then
    select oc.owner_id into new.owner_id
    from owner_contacts oc
    where oc.contact_id = new.contact_id
    order by (oc.confidence = 'confirmed') desc
    limit 1;
  end if;

  return new;
end $$;

drop trigger if exists communications_resolve_identity on communications;
create trigger communications_resolve_identity
  before insert on communications
  for each row execute function resolve_communication_identity();

-- Backfill the phone-only rows already written (GHL notes and any others).
update communications c
set contact_id = sub.contact_id
from (
  select c2.id as comm_id,
         (select ct.id from contacts ct
            left join owner_contacts oc on oc.contact_id = ct.id
            where regexp_replace(coalesce(ct.phone,''), '\D', '', 'g') =
                  case when length(regexp_replace(c2.phone,'\D','','g')) = 11
                        and regexp_replace(c2.phone,'\D','','g') like '1%'
                       then substr(regexp_replace(c2.phone,'\D','','g'), 2)
                       else regexp_replace(c2.phone,'\D','','g') end
            order by (oc.owner_id is not null) desc, ct.created_at asc
            limit 1) as contact_id
  from communications c2
  where c2.contact_id is null and c2.phone is not null
) sub
where c.id = sub.comm_id and sub.contact_id is not null;

update communications c
set owner_id = (
  select oc.owner_id from owner_contacts oc
  where oc.contact_id = c.contact_id
  order by (oc.confidence = 'confirmed') desc
  limit 1)
where c.owner_id is null and c.contact_id is not null
  and exists (select 1 from owner_contacts oc where oc.contact_id = c.contact_id);
