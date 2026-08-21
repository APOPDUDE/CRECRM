-- POST_APPLY_CHECKS.texting.sql -- NOT a migration. Read-only smoke test for
-- 20260821120000_texting_channel + 20260821120001_texting_va_silo.
--
-- Run the whole file as one script (SQL editor or psql). Every write happens
-- inside BEGIN ... ROLLBACK; nothing persists. Each DO block RAISES EXCEPTION on
-- failure and NOTICEs a PASS line on success. If the script finishes, all checks
-- passed and the database is untouched.

begin;

--------------------------------------------------------------------------------
-- 1. The outbound gate trigger blocks a suppressed send (and names the gate)
--------------------------------------------------------------------------------
do $$
declare
  v_caught boolean := false;
  v_msg text;
begin
  -- Open every other gate as far as possible so 'suppressed' is the story.
  update texting_settings set paused = false, ramp_started_on = current_date where id = 1;
  insert into phone_scrubs (phone, vendor, rnd_ok, federal_dnc, state_dnc, litigator, scrubbed_at)
  values ('+18135550199', 'smoke_test', true, false, false, false, now())
  on conflict ((normalize_phone(phone))) do update
    set rnd_ok = true, scrubbed_at = now();
  insert into phone_suppressions (phone, reason, source)
  values ('+18135550199', 'manual', 'smoke_test')
  on conflict do nothing;

  begin
    insert into text_messages (phone, direction, body, status)
    values ('+18135550199', 'outbound', 'smoke test -- must not insert', 'queued');
  exception when others then
    v_caught := true;
    v_msg := sqlerrm;
  end;

  if not v_caught then
    raise exception 'FAIL(1): outbound insert to a SUPPRESSED phone was not blocked';
  end if;
  if v_msg not like '%suppressed%' then
    raise exception 'FAIL(1): gate blocked but did not name the suppressed gate: %', v_msg;
  end if;
  raise notice 'PASS(1): outbound gate blocked suppressed phone (%)', v_msg;
end $$;

--------------------------------------------------------------------------------
-- 2. STOP regex fires on inbound: opt_out suppression appears
--------------------------------------------------------------------------------
do $$
begin
  insert into text_messages (phone, direction, body, status)
  values ('+18135550142', 'inbound', 'Please STOP texting me', 'received');

  if not exists (
    select 1 from phone_suppressions
    where normalize_phone(phone) = '8135550142'
      and reason = 'opt_out' and source = 'inbound_stop') then
    raise exception 'FAIL(2): inbound STOP did not create an opt_out suppression';
  end if;

  -- Control: a non-STOP inbound must NOT suppress.
  insert into text_messages (phone, direction, body, status)
  values ('+18135550143', 'inbound', 'Yes this is Bob, what is the offer?', 'received');
  if exists (
    select 1 from phone_suppressions
    where normalize_phone(phone) = '8135550143') then
    raise exception 'FAIL(2): a normal inbound reply was wrongly suppressed';
  end if;

  raise notice 'PASS(2): STOP regex fires; normal replies do not suppress';
end $$;

--------------------------------------------------------------------------------
-- 3. claim_text_sends blocks (never skips) when paused
--------------------------------------------------------------------------------
do $$
declare
  v_send uuid;
  v_claimed int;
  v_status text;
  v_reason text;
begin
  update texting_settings set paused = true where id = 1;

  insert into text_sends (phone, body, status, approved_at)
  values ('+18135550177', 'smoke test body', 'approved', now())
  returning id into v_send;

  select count(*) into v_claimed from claim_text_sends(5);
  if v_claimed <> 0 then
    raise exception 'FAIL(3): claim_text_sends returned % rows while paused', v_claimed;
  end if;

  select status::text, blocked_reason into v_status, v_reason
  from text_sends where id = v_send;
  if v_status <> 'blocked' then
    raise exception 'FAIL(3): paused claim left send in status % (expected blocked)', v_status;
  end if;
  if v_reason not like '%paused%' then
    raise exception 'FAIL(3): blocked_reason does not name the paused gate: %', v_reason;
  end if;
  raise notice 'PASS(3): paused claim blocks with reason "%"', v_reason;
end $$;

--------------------------------------------------------------------------------
-- 4. is_va() is false for a normal (or absent) JWT
--------------------------------------------------------------------------------
do $$
begin
  if is_va() then
    raise exception 'FAIL(4): is_va() returned true without a va JWT';
  end if;
  raise notice 'PASS(4): is_va() = false for this session';
end $$;

--------------------------------------------------------------------------------
-- 5. Every public view runs security_invoker = true
--------------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_n int;
  v_total int;
begin
  select count(*) into v_total
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v';

  select string_agg(c.relname, ', '), count(*) into v_bad, v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not exists (
      select 1 from unnest(coalesce(c.reloptions, '{}'::text[])) as o(opt)
      where opt in ('security_invoker=true','security_invoker=on','security_invoker=1'));
  if v_n > 0 then
    raise exception 'FAIL(5): % public view(s) NOT security_invoker: %', v_n, v_bad;
  end if;
  raise notice 'PASS(5): all % public views are security_invoker=true', v_total;
end $$;

--------------------------------------------------------------------------------
-- 6. Restrictive VA policies exist everywhere they should
--------------------------------------------------------------------------------
do $$
declare
  texting_read constant text[] := array[
    'outreach_texts','text_messages','text_campaigns','text_sends',
    'texting_settings','phone_suppressions'];
  v_missing text;
  v_n int;
  v_covered int;
begin
  -- 6a. Every public RLS-enabled table carries at least one RESTRICTIVE policy.
  select string_agg(c.relname, ', '), count(*) into v_missing, v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
        and p.permissive = 'RESTRICTIVE');
  if v_n > 0 then
    raise exception 'FAIL(6a): % RLS table(s) missing a restrictive VA policy: %', v_n, v_missing;
  end if;

  -- 6b. The six texting tables must NOT have a restrictive policy covering
  --     SELECT (reads stay open for the VA console).
  select string_agg(p.tablename, ', '), count(*) into v_missing, v_n
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = any (texting_read)
    and p.permissive = 'RESTRICTIVE'
    and p.cmd in ('ALL','SELECT');
  if v_n > 0 then
    raise exception 'FAIL(6b): restrictive policy covers SELECT on texting table(s): %', v_missing;
  end if;

  -- 6c. storage.objects carries the VA deny.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and permissive = 'RESTRICTIVE' and policyname = 'storage_objects_va_deny') then
    raise exception 'FAIL(6c): storage.objects is missing storage_objects_va_deny';
  end if;

  -- 6d. send_authorizations is append-only for authenticated.
  if has_table_privilege('authenticated', 'public.send_authorizations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.send_authorizations', 'DELETE') then
    raise exception 'FAIL(6d): authenticated still holds UPDATE/DELETE on send_authorizations';
  end if;

  -- 6e. contacts verified_by vocabulary accepts va_text.
  if position('va_text' in (
       select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.contacts'::regclass
         and conname = 'contacts_verified_by_vocab')) = 0 then
    raise exception 'FAIL(6e): contacts_verified_by_vocab does not include va_text';
  end if;

  select count(*) into v_covered
  from (select distinct tablename from pg_policies
        where schemaname = 'public' and permissive = 'RESTRICTIVE') s;
  raise notice 'PASS(6): restrictive policies on % public tables; texting reads open; storage denied; send_authorizations append-only; va_text in vocab', v_covered;
end $$;

--------------------------------------------------------------------------------
-- 7. Pre-request guard is installed on the authenticator role
--------------------------------------------------------------------------------
do $$
declare
  v_cfg text;
begin
  select coalesce(
           (select regexp_replace(cfg, '^pgrst\.db_pre_request=', '')
            from unnest((select rolconfig from pg_roles where rolname = 'authenticator')) cfg
            where cfg like 'pgrst.db_pre_request=%'), '')
    into v_cfg;
  if v_cfg <> 'public.va_guard_pre_request' then
    raise exception 'FAIL(7): authenticator pgrst.db_pre_request is % (expected public.va_guard_pre_request)', coalesce(nullif(v_cfg,''), '<unset>');
  end if;
  raise notice 'PASS(7): pgrst.db_pre_request = public.va_guard_pre_request';
end $$;

rollback;
