-- Redesign J: security hardening for the new objects.

-- the landlord-board view should run with the caller's RLS, not the creator's
alter view public.v_listing_pursuits set (security_invoker = on);

-- pin search_path on the helper / non-definer functions
do $$
declare r record;
begin
  for r in
    select oid::regprocedure::text as sig from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('set_updated_at','pursuit_stamp_dates','promote_client','create_property_and_listing')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
