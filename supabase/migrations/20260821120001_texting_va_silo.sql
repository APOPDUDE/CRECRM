-- VA cold-texting silo, part 2 of 2: wall the VA off from the book.
--
-- A VA login is an ordinary Supabase auth user whose JWT carries
-- app_metadata.crm_role = 'va'. Three fences, all in Postgres:
--
--   1. RESTRICTIVE RLS policies: full deny on every table for the VA, except the
--      six texting tables which stay readable (write paths blocked -- the VA acts
--      only through the five va_* SECURITY DEFINER RPCs).
--   2. storage.objects: full deny (the VA must not read deal-files).
--   3. A PostgREST pre-request guard that rejects every /rpc/ call from a VA JWT
--      except the five console functions.
--
-- Plus a security_invoker sweep over every public view: definer views bypass
-- table RLS, so without this the silo is theater. Today every blanket policy is
-- using(true) for authenticated, so the sweep is a NO-OP for Alex -- it only
-- matters once the VA restrictive policies exist.
--
-- NOTE: the restrictive-policy loop covers tables that exist NOW. A future table
-- with RLS enabled starts VA-invisible only if you add its va_deny policy --
-- copy the pattern below.

begin;

--------------------------------------------------------------------------------
-- Role detection
--------------------------------------------------------------------------------

create or replace function public.is_va() returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt()->'app_metadata'->>'crm_role', '') = 'va';
$$;

comment on function public.is_va() is
  'True when the current JWT carries app_metadata.crm_role = ''va''. '
  'app_metadata is server-controlled (users cannot edit it), so this is a safe role gate.';

--------------------------------------------------------------------------------
-- Restrictive policies on every public RLS table
--------------------------------------------------------------------------------
-- Texting tables the VA console must READ (writes still blocked -- the console
-- writes only through the va_* SECURITY DEFINER RPCs, which run as postgres):
--   outreach_texts, text_messages, text_campaigns, text_sends, texting_settings,
--   phone_suppressions.
-- Everything else (including send_authorizations and phone_scrubs -- the VA has
-- no business reading scrub data): full deny.

do $$
declare
  t record;
  texting_read constant text[] := array[
    'outreach_texts','text_messages','text_campaigns','text_sends',
    'texting_settings','phone_suppressions'];
begin
  for t in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    order by c.relname
  loop
    if t.tbl = any (texting_read) then
      execute format(
        'create policy %I on public.%I as restrictive for insert to authenticated with check (not public.is_va())',
        t.tbl || '_va_deny_insert', t.tbl);
      execute format(
        'create policy %I on public.%I as restrictive for update to authenticated using (not public.is_va()) with check (not public.is_va())',
        t.tbl || '_va_deny_update', t.tbl);
      execute format(
        'create policy %I on public.%I as restrictive for delete to authenticated using (not public.is_va())',
        t.tbl || '_va_deny_delete', t.tbl);
    else
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (not public.is_va()) with check (not public.is_va())',
        t.tbl || '_va_deny', t.tbl);
    end if;
  end loop;
end $$;

--------------------------------------------------------------------------------
-- Storage: the VA must not read deal-files (or any bucket)
--------------------------------------------------------------------------------

create policy storage_objects_va_deny on storage.objects
  as restrictive for all to authenticated
  using (not public.is_va())
  with check (not public.is_va());

--------------------------------------------------------------------------------
-- security_invoker sweep: definer views bypass table RLS
--------------------------------------------------------------------------------
-- Every public view runs with the CALLER's rights from here on, so the VA's
-- restrictive policies apply through views too. No-op for Alex today (blanket
-- using(true) policies), load-bearing for the VA.

do $$
declare
  v record;
begin
  for v in select viewname from pg_views where schemaname = 'public'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.viewname);
  end loop;
end $$;

--------------------------------------------------------------------------------
-- PostgREST pre-request guard: VA may call ONLY the five console RPCs
--------------------------------------------------------------------------------
-- PostgREST sets the transaction-scoped GUC request.path on every request
-- (available since v7, present in the v12+ Supabase runs; the Kong gateway
-- strips /rest/v1, so PostgREST sees paths like /rpc/va_send_reply).
-- Fail-closed: if the GUC is ever missing for a VA request, the request dies.

create or replace function public.va_guard_pre_request() returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_path text := current_setting('request.path', true);
begin
  if not public.is_va() then
    return;
  end if;

  if v_path is null then
    raise insufficient_privilege using
      message = 'va_guard_pre_request: request.path unavailable -- VA requests fail closed';
  end if;

  if v_path like '/rpc/%'
     and v_path not in ('/rpc/va_send_reply',
                        '/rpc/va_confirm_owner',
                        '/rpc/va_wrong_person',
                        '/rpc/va_not_interested',
                        '/rpc/va_thread_context') then
    raise insufficient_privilege using
      message = format('VA role may not call %s', v_path);
  end if;
end;
$$;

alter role authenticator set pgrst.db_pre_request = 'public.va_guard_pre_request';
notify pgrst, 'reload config';

commit;
