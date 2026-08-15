-- Stage 2a continued: the verify writer dual-writes the company link, and property name-search
-- resolves owners through companies. Anchored pg_get_functiondef patches, single-occurrence
-- asserted. Verified after apply: search parity exact (benski 3, procacci 1), owners scan gone
-- from search_properties, company-stamp present in ghl_verify_owner.

do $patch$
declare
  src text; occ int;
  old_frag text := $f$        notes = coalesce(excluded.notes, owner_contacts.notes);

  update owners
  set verification_status = 'verified',$f$;
  new_frag text := $f$        notes = coalesce(excluded.notes, owner_contacts.notes);

  update contacts c
  set company_id = o.company_id
  from owners o
  where c.id = v_contact and o.id = v_owner
    and c.company_id is null and o.company_id is not null;

  update owners
  set verification_status = 'verified',$f$;
begin
  src := pg_get_functiondef('ghl_verify_owner(jsonb)'::regprocedure);
  occ := (length(src) - length(replace(src, old_frag, ''))) / length(old_frag);
  if occ <> 1 then
    raise exception 'ghl_verify_owner anchor found % times, expected 1 - aborting', occ;
  end if;
  execute replace(src, old_frag, new_frag);
end
$patch$;

do $patch$
declare
  src text; occ int;
  old_frag text := $f$  owner_hit as (
    select o.id from owners o, q, ntoks
    where q.name_anchor is not null
      and o.normalized_name like q.name_anchor
      and name_has_all_tokens(o.normalized_name, ntoks.list, ntoks.n)
  ),$f$;
  new_frag text := $f$  owner_hit as (
    select co.id from companies co, q, ntoks
    where q.name_anchor is not null
      and co.normalized_name like q.name_anchor
      and name_has_all_tokens(co.normalized_name, ntoks.list, ntoks.n)
  ),$f$;
  old_join text := $f$select p2.id from properties p2 join owner_hit oh on oh.id = p2.owner_id$f$;
  new_join text := $f$select p2.id from properties p2 join owner_hit oh on oh.id = p2.owner_company_id$f$;
begin
  src := pg_get_functiondef('search_properties(text, integer)'::regprocedure);
  occ := (length(src) - length(replace(src, old_frag, ''))) / length(old_frag);
  if occ <> 1 then
    raise exception 'search_properties owner_hit anchor found % times, expected 1 - aborting', occ;
  end if;
  occ := (length(src) - length(replace(src, old_join, ''))) / length(old_join);
  if occ <> 1 then
    raise exception 'search_properties owner join anchor found % times, expected 1 - aborting', occ;
  end if;
  src := replace(src, old_frag, new_frag);
  src := replace(src, old_join, new_join);
  execute src;
end
$patch$;
