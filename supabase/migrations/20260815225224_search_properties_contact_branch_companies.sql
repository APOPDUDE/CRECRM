-- STAGE 2b end-game (2c): search_properties' person-name branch loses its owner_contacts
-- join — a person now reaches a building through their seat:
-- contacts.company_id -> properties.owner_company_id.
-- Anchored pg_get_functiondef replace with single-occurrence asserts; the rest of the
-- function (address anchor, owner/company/tenant branches, ranking) is untouched.

do $do$
declare
  src text := pg_get_functiondef('public.search_properties(text, integer)'::regprocedure);
  anchor1 text := $a$select oc.owner_id
    from owner_contacts oc join contacts c on c.id = oc.contact_id, q, ntoks
    where q.name_anchor is not null
      and c.normalized_name like q.name_anchor$a$;
  repl1 text := $a$select c.company_id
    from contacts c, q, ntoks
    where q.name_anchor is not null
      and c.company_id is not null
      and c.normalized_name like q.name_anchor$a$;
  anchor2 text := $a$select p2.id from properties p2 join contact_hit ch on ch.owner_id = p2.owner_id$a$;
  repl2 text := $a$select p2.id from properties p2 join contact_hit ch on ch.company_id = p2.owner_company_id$a$;
begin
  if (length(src) - length(replace(src, anchor1, ''))) / length(anchor1) <> 1 then
    raise exception 'search_properties: contact_hit anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, anchor2, ''))) / length(anchor2) <> 1 then
    raise exception 'search_properties: name_props join anchor not found exactly once';
  end if;
  src := replace(src, anchor1, repl1);
  src := replace(src, anchor2, repl2);
  execute src;
end $do$;
