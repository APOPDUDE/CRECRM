-- Applied 2026-08-23 via MCP.
--
-- `v_property_owner_context` runs five lateral joins per row. As a per-page lookup that is
-- fine (25 ms for 1,000 rows, warm). As a FILTER PREDICATE over a whole book it is not:
--
--   select count(*) from properties p
--   join v_property_owner_context ctx on ctx.property_id = p.id
--   where not p.land_only and ctx.owner_contact_verified;
--   -- 13,596 ms as postgres, 494 rows.  (measured 2026-08-23)
--
-- That is past the 8s statement timeout before any other filter is applied, so the
-- "Verified owner" and "Recent activity" filters can never be evaluated server-side
-- against the live view. This table is what makes them possible.
--
-- GRAIN. Everything the view computes is company-grain (portfolio counts, contact counts,
-- best contact) EXCEPT the communications rollup, which is property-grain because its
-- predicate is an OR across both:
--     cm.property_id = p.id  OR  cm.owner_company_id = p.owner_company_id
-- Dropping either arm silently changes what "Touched in 30d" / "Quiet 30d+" returns.
-- The table is therefore PROPERTY-grain: one row per property, so every filter is a
-- single join on the primary key and there is no null-company edge case at query time.
--
-- SCOPE. This carries what the FILTERS and the click-time push/owner-message lists need.
-- Display-only fields that depend on CURRENT_DATE (off_market_days, was_on_market) are
-- deliberately NOT here -- they stay on the view, which the page still uses to hydrate
-- the ~100 rows actually on screen. A cached value of a "days since" column would be
-- wrong by however long ago the refresh ran.
--
-- STALENESS. Refreshed every 20 minutes by pg_cron, so the verified-owner and activity
-- answers can be up to 20 minutes behind a skip trace or a logged call. Accepted
-- deliberately (Alex, 2026-08-23) against filters that currently cannot run at all.

create table if not exists public.property_owner_rollup (
  property_id                    uuid primary key references public.properties(id) on delete cascade,
  owner_company_id               uuid,
  owner_name                     text,
  owner_verification_status      text,
  owner_property_count           bigint not null default 0,
  owner_contact_verified         boolean not null default false,
  owner_email_verified           boolean not null default false,
  owner_reachable                boolean not null default false,
  owner_do_not_call              boolean not null default false,
  comm_count                     bigint not null default 0,
  last_contacted_at              timestamptz,
  best_contact_name              text,
  best_contact_phone             text,
  best_contact_email             text,
  best_contact_confidence        text,
  best_contact_email_verified_at timestamptz,
  -- Normalised last-10-digits, the key the GHL push dedupes on. Precomputed so the
  -- click-time push list does not re-derive it per row (and so the rail's count and the
  -- dialog's list can never disagree about what "one owner" means).
  best_contact_phone_key         text,
  refreshed_at                   timestamptz not null default now()
);

-- The filter predicates. Partial indexes because each is a small minority of the book
-- (494 industrial properties have a verified owner contact, 2026-08-23).
create index if not exists property_owner_rollup_verified_idx
  on public.property_owner_rollup (property_id) where owner_contact_verified;
create index if not exists property_owner_rollup_email_verified_idx
  on public.property_owner_rollup (property_id) where owner_email_verified;
create index if not exists property_owner_rollup_reachable_idx
  on public.property_owner_rollup (property_id) where owner_reachable;
create index if not exists property_owner_rollup_last_contacted_idx
  on public.property_owner_rollup (last_contacted_at) where last_contacted_at is not null;
create index if not exists property_owner_rollup_company_idx
  on public.property_owner_rollup (owner_company_id) where owner_company_id is not null;

alter table public.property_owner_rollup enable row level security;

-- The VA silo is NOT inherited by new relations -- it is the permissive/restrictive pair
-- below, by hand, exactly as property_market_position carries it.
drop policy if exists property_owner_rollup_auth_all on public.property_owner_rollup;
create policy property_owner_rollup_auth_all on public.property_owner_rollup
  for all to authenticated using (true) with check (true);

drop policy if exists property_owner_rollup_va_deny on public.property_owner_rollup;
create policy property_owner_rollup_va_deny on public.property_owner_rollup
  as restrictive for all to authenticated using (not public.is_va()) with check (not public.is_va());

revoke all on public.property_owner_rollup from anon, public;
grant select on public.property_owner_rollup to authenticated;
revoke insert, update, delete on public.property_owner_rollup from authenticated;

create or replace function public.refresh_property_owner_rollup()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_n integer;
begin
  create temp table _por on commit drop as
  with port as (
    select p2.owner_company_id as cid, count(*) as property_count
    from public.properties p2
    where p2.owner_company_id is not null
    group by 1
  ),
  oc as (
    select ct.company_id as cid,
           count(*) filter (where ct.verified_at is not null)       as confirmed_count,
           count(*) filter (where ct.email_verified_at is not null) as email_verified_count,
           count(*) filter (where ct.do_not_call)                   as do_not_call_count
    from public.contacts ct
    where ct.company_id is not null
    group by 1
  ),
  best as (
    -- Identical ORDER BY to the view's `best` lateral. Changing it changes which person
    -- the push dials.
    select distinct on (ct.company_id)
           ct.company_id as cid,
           nullif(btrim((ct.first_name || ' ') || coalesce(ct.last_name, '')), '') as contact_name,
           ct.phone, ct.email, ct.email_verified_at,
           case when ct.verified_at is not null then 'confirmed' else 'likely' end as confidence
    from public.contacts ct
    where ct.company_id is not null and not ct.do_not_call
    order by ct.company_id,
             (ct.verified_at is null), (ct.email_verified_at is null),
             (ct.phone is null), (ct.email is null)
  ),
  -- The communications OR, as inclusion-exclusion rather than an OR-join: a 127k x 5.3k
  -- nested loop would be ~673M comparisons. `ovl` is the double-counted middle -- rows
  -- that name BOTH this property and its owner company.
  comm_p as (
    select cm.property_id as pid, count(*) as c, max(cm.occurred_at) as last_at
    from public.communications cm where cm.property_id is not null group by 1
  ),
  comm_c as (
    select cm.owner_company_id as cid, count(*) as c, max(cm.occurred_at) as last_at
    from public.communications cm where cm.owner_company_id is not null group by 1
  ),
  ovl as (
    select cm.property_id as pid, cm.owner_company_id as cid, count(*) as c
    from public.communications cm
    where cm.property_id is not null and cm.owner_company_id is not null
    group by 1, 2
  )
  select p.id as property_id,
         p.owner_company_id,
         c.name as owner_name,
         case
           when c.id is null then null::text
           when coalesce(oc.confirmed_count, 0) > 0 then 'verified'
           when c.exported_at is not null then 'exported'
           else 'unverified'
         end as owner_verification_status,
         coalesce(port.property_count, 0) as owner_property_count,
         coalesce(oc.confirmed_count, 0) > 0 as owner_contact_verified,
         coalesce(oc.email_verified_count, 0) > 0 as owner_email_verified,
         (coalesce(oc.confirmed_count, 0) > 0 or coalesce(oc.email_verified_count, 0) > 0) as owner_reachable,
         coalesce(oc.do_not_call_count, 0) > 0 as owner_do_not_call,
         (coalesce(comm_p.c, 0) + coalesce(comm_c.c, 0) - coalesce(ovl.c, 0)) as comm_count,
         greatest(comm_p.last_at, comm_c.last_at) as last_contacted_at,
         best.contact_name, best.phone, best.email, best.confidence, best.email_verified_at,
         nullif(right(regexp_replace(coalesce(best.phone, ''), '\D', '', 'g'), 10), '') as best_contact_phone_key,
         now() as refreshed_at
  from public.properties p
  left join public.companies c on c.id = p.owner_company_id
  left join port    on port.cid = p.owner_company_id
  left join oc      on oc.cid   = p.owner_company_id
  left join best    on best.cid = p.owner_company_id
  left join comm_p  on comm_p.pid = p.id
  left join comm_c  on comm_c.cid = p.owner_company_id
  left join ovl     on ovl.pid = p.id and ovl.cid = p.owner_company_id;

  select count(*) into v_n from _por;
  -- The house guard from refresh_property_market_position: never blank the table on a
  -- bad run. An empty rollup would silently answer "no owner is verified".
  if v_n = 0 then
    raise exception 'refresh_property_owner_rollup: 0 rows -- refusing to blank the rollup';
  end if;

  truncate public.property_owner_rollup;
  insert into public.property_owner_rollup select * from _por;
  analyze public.property_owner_rollup;
  return v_n;
end $$;

revoke all on function public.refresh_property_owner_rollup() from public, anon, authenticated;

comment on table public.property_owner_rollup is
  'Property-grain precompute of v_property_owner_context''s FILTERABLE fields, so the '
  'Verified-owner and Recent-activity filters can run as SQL predicates (the live view is '
  '13.6s over one book). Refreshed every 20 min by pg_cron; answers can be that stale. '
  'Display-only CURRENT_DATE fields (off_market_days) stay on the view by design.';
