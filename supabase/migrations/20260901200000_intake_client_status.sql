-- intake_client(p jsonb, p_owner uuid): optional p->>'status' (client_status) for the client
-- row it CREATES. Website leads (alexpoplawski.com, n8n "Website lead" workflow) land as
-- 'prospect' - a lead Alex has not qualified yet, which gets no auto-suggestions - instead of
-- 'searching'. An absent/blank key keeps the old 'searching' default, so the in-app tenant
-- form and the call form are unchanged. The merge-on-reuse path never touches status.
--
-- Applied as a guarded in-place edit of the live definition (the full body is in the most
-- recent migration that CREATE OR REPLACEs intake_client). It fails loudly if the expected
-- insert line is gone, rather than silently doing nothing.
do $$
declare
  d      text;
  needle text := $n$values (p_owner, v_company_id, v_contact_id, 'searching',$n$;
  repl   text := $r$values (p_owner, v_company_id, v_contact_id,
      coalesce((nullif(p->>'status',''))::public.client_status, 'searching'),$r$;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'intake_client'
     and pg_get_function_arguments(p.oid) = 'p jsonb, p_owner uuid';
  if d is null then
    raise exception 'intake_client(jsonb, uuid) not found';
  end if;
  if position(needle in d) = 0 then
    raise exception 'intake_client: expected insert line not found - the body changed, edit this migration';
  end if;
  execute replace(d, needle, repl);
end $$;
