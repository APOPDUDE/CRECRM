-- Harden anonymous access.
--
-- The anon API key ships inside the public JS bundle, so anything the `anon` role (or PUBLIC,
-- which anon belongs to) can execute/read is reachable by anyone on the internet without logging
-- in. Postgres grants EXECUTE to PUBLIC by default on every CREATE FUNCTION, so at the time of
-- this migration ALL nine SECURITY DEFINER RPCs below (which run as their definer and bypass RLS)
-- are anon-callable, and four views leak data to anon.
--
-- None of these are called by the app before login. The React app calls them with the logged-in
-- user's JWT (role `authenticated`); external automations (n8n) authenticate with the service_role
-- key; the in-app intake forms POST through n8n (service_role) rather than hitting PostgREST as
-- anon. So restricting to `authenticated` + `service_role` keeps every real caller working.
--
-- Pattern: GRANT the two legitimate roles first, THEN revoke anon + PUBLIC — so a caller that only
-- reached a function/view via the PUBLIC grant can't lose access. Existence-guarded and idempotent.

-- 1. SECURITY DEFINER RPCs (the privilege-escalation surface): authenticated + service_role only.
do $$
declare
  sig text;
  sigs text[] := array[
    'public.add_parcel_to_listing(uuid, uuid, boolean)', -- in-app (authenticated)
    'public.approve_suggestion(uuid, uuid)',             -- match-suggestion approve
    'public.cross_reference(uuid[])',                    -- matching sweep (n8n)
    'public.ensure_payment_checks()',                    -- daily payment sweep (n8n)
    'public.execute_pursuit(uuid, jsonb)',               -- in-app execute (authenticated)
    'public.import_scraped_listings(jsonb, uuid, boolean)', -- Apify import (n8n)
    'public.intake_client(jsonb, uuid)',                 -- live tenant form (n8n)
    'public.intake_landlord_listing(jsonb, uuid)',       -- live landlord form (n8n)
    'public.sweep_mark_off_market(uuid[])'               -- off-market sweep (n8n)
  ];
begin
  foreach sig in array sigs loop
    if to_regprocedure(sig) is not null then
      execute format('grant execute on function %s to authenticated, service_role', sig);
      execute format('revoke execute on function %s from anon, public', sig);
    end if;
  end loop;
end $$;

-- 2. Superseded tenant-intake RPC (replaced by intake_client in the 2026-06 redesign). Remove any
--    surviving signature entirely (already dropped in 0027 — this is a safe no-op if absent).
drop function if exists public.intake_tenant_rep(jsonb, uuid);

-- 3. Views: the authenticated broker (and service_role automations) only, never anon.
--    v_fs_entity in particular exposes deal/client/property folder names.
do $$
declare
  v text;
  vs text[] := array[
    'public.v_county_market_stats',
    'public.v_property_market_position',
    'public.v_property_current_asking',
    'public.v_fs_entity'
  ];
begin
  foreach v in array vs loop
    if to_regclass(v) is not null then
      execute format('grant select on %s to authenticated, service_role', v);
      execute format('revoke select on %s from anon, public', v);
    end if;
  end loop;
end $$;
