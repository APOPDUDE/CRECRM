-- STAGE 2b (D): communications learn the company-side owner key.
--
-- 1. communications.owner_company_id uuid -> companies(id), backfilled through
--    communications.owner_id -> owners.company_id (every owner row is linked), indexed.
-- 2. resolve_communication_identity (BEFORE INSERT trigger) now sets BOTH owner_id and
--    owner_company_id: the owners-side resolution is kept verbatim (it dies with the
--    table); owner_company_id mirrors it via owners.company_id, and when no owner link
--    resolves but the contact is seated at a property-owning company, that company is
--    used directly — the post-retirement path, live early.
--    Patched with the anchored pg_get_functiondef replace + single-occurrence assert.

alter table communications
  add column if not exists owner_company_id uuid references companies(id);

update communications cm
set owner_company_id = o.company_id
from owners o
where cm.owner_id = o.id
  and cm.owner_company_id is null
  and o.company_id is not null;

create index if not exists communications_owner_company_idx
  on communications(owner_company_id);

do $do$
declare
  src text := pg_get_functiondef('public.resolve_communication_identity()'::regprocedure);
  anchor1 text := $a$    limit 1;
  end if;

  return new;
end$a$;
  repl1 text := $a$    limit 1;
  end if;

  if new.owner_company_id is null then
    if new.owner_id is not null then
      select o.company_id into new.owner_company_id
      from owners o where o.id = new.owner_id;
    elsif new.contact_id is not null then
      select c.company_id into new.owner_company_id
      from contacts c
      where c.id = new.contact_id
        and c.company_id is not null
        and exists (select 1 from properties p where p.owner_company_id = c.company_id);
    end if;
  end if;

  return new;
end$a$;
begin
  if (length(src) - length(replace(src, anchor1, ''))) / length(anchor1) <> 1 then
    raise exception 'resolve_communication_identity: tail anchor not found exactly once';
  end if;
  src := replace(src, anchor1, repl1);
  execute src;
end $do$;
