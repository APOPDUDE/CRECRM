-- Redesign A: rename core tables to AI-native names, create new enums,
-- add company_type 'vendor', and drop the old RPCs (they reference the
-- old table/column names; new ones are created at the end of the redesign).

alter table public.tenant_reps       rename to clients;
alter table public.matches           rename to pursuits;
alter table public.match_suggestions rename to suggestions;
alter table public.lease_comps       rename to comps;

-- keep primary-key + updated_at names in step with the new table names
alter table public.clients     rename constraint tenant_reps_pkey       to clients_pkey;
alter table public.pursuits    rename constraint matches_pkey           to pursuits_pkey;
alter table public.suggestions rename constraint match_suggestions_pkey to suggestions_pkey;
alter table public.comps       rename constraint lease_comps_pkey       to comps_pkey;

alter trigger tenant_reps_updated_at on public.clients  rename to clients_updated_at;
alter trigger matches_updated_at     on public.pursuits rename to pursuits_updated_at;
alter trigger lease_comps_updated_at on public.comps    rename to comps_updated_at;

-- new enums
create type public.client_status    as enum ('prospect','active','closed','lost');
create type public.client_purpose   as enum ('expansion','first_location','relocation','investment');
create type public.pursuit_stage    as enum ('inquiring','touring','negotiation','executed','passed');
create type public.comp_kind        as enum ('asking','executed');
create type public.suggestion_status as enum ('pending','dismissed');

-- drop the old RPCs (replaced at the end of the redesign)
do $$
declare r record;
begin
  for r in
    select oid::regprocedure::text as sig
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('approve_match_suggestion','create_property_and_listing',
                      'cross_reference_open_tenant_reps','import_scraped_listings',
                      'intake_landlord_listing','intake_tenant_rep','promote_match_to_tenant_rep')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;
