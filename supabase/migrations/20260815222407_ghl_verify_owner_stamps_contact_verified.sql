-- STAGE 2b: ghl_verify_owner must stamp the PERSON, not only the owner_contacts link.
--
-- The retirement derivation ("verified owner" := a contact with verified_at seated at the
-- owning company) can only stay live if the VA verification path writes contacts.verified_at.
-- Today it writes owner_contacts.confidence/verified_at + contacts.company_id but never
-- contacts.verified_at — so every FUTURE VA confirmation would be invisible to the new
-- v_property_owner_context. Fill-only stamps ('ghl_va'), matching R3: a VA confirmation IS
-- "a human confirmed this person".
--
-- Anchored pg_get_functiondef replace with single-occurrence asserts (the proven pattern
-- from 20260815212103): the function body is untouched except the two contact-write sites.

do $do$
declare
  src text := pg_get_functiondef('public.ghl_verify_owner(jsonb)'::regprocedure);
  anchor1 text := $a$(first_name, last_name, phone, email, source_system, ghl_contact_id)
    values (coalesce(v_first, 'Unknown'), v_last, v_phone, v_email, 'ghl', v_ghl)$a$;
  repl1 text := $a$(first_name, last_name, phone, email, source_system, ghl_contact_id, verified_at, verified_by)
    values (coalesce(v_first, 'Unknown'), v_last, v_phone, v_email, 'ghl', v_ghl, now(), 'ghl_va')$a$;
  anchor2 text := $a$ghl_contact_id = coalesce(c.ghl_contact_id, v_ghl),
        archived   = false$a$;
  repl2 text := $a$ghl_contact_id = coalesce(c.ghl_contact_id, v_ghl),
        verified_at = coalesce(c.verified_at, now()),
        verified_by = coalesce(c.verified_by, 'ghl_va'),
        archived   = false$a$;
begin
  if (length(src) - length(replace(src, anchor1, ''))) / length(anchor1) <> 1 then
    raise exception 'ghl_verify_owner: anchor1 (contact insert) not found exactly once';
  end if;
  if (length(src) - length(replace(src, anchor2, ''))) / length(anchor2) <> 1 then
    raise exception 'ghl_verify_owner: anchor2 (contact update) not found exactly once';
  end if;
  src := replace(src, anchor1, repl1);
  src := replace(src, anchor2, repl2);
  execute src;
end $do$;
