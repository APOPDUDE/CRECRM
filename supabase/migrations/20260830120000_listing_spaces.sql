-- U3: per-suite listing spaces (2026-08-30). Approved by Alex 08-29 ("if we can do it and
-- it not be problematic then we can go ahead and try") — unblocked now the scraper Mac is
-- set up. Design + audit: context/deal-flags-and-unit-sf-2026-08-29.md §U3.
--
-- The Apify placard feed can never say WHICH spaces a lease listing offers (only the sum
-- + a count + a rate range). A Playwright worker on the scraper Mac
-- (scripts/listing-spaces/) opens each multi/partial-space on-market lease listing and
-- reads LoopNet's "All Available Spaces" grid: per suite {label, SF, rate, use,
-- build-out, available}. This migration is its DB half.
--
-- Shape decisions:
-- * listing_spaces is a child of market_listings, NOT of units — advertised sizes churned
--   on 178 of 560 listings between scrapes (the 08-14 lesson), so scraped spaces stay
--   DERIVED and self-refreshing. Minting a real `units` row remains a one-click HUMAN
--   action in the UI, so hand-entered specs are never clobbered by a scrape.
-- * A space that disappears from the grid gets gone_at stamped, never deleted — a let
--   suite is market evidence (what leased, when, at what ask).
-- * v_property_available_space gains a third source ('listing_space', real labels); the
--   old single listing-derived row now only appears when a listing has NO live scraped
--   spaces, so nothing double-counts.
-- * Worker-facing RPCs are service-role only (kick pattern precedent); the worker runs
--   with the service key from the Mac's .env, same as the Deal Radar worker.

create table listing_spaces (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references market_listings(id) on delete cascade,
  label text not null,
  size_sf integer check (size_sf > 0),
  rate_psf numeric,          -- $/SF/YR; null = "Upon Request"
  space_use text,
  build_out text,
  available text,            -- kept raw: 'Now', '30 Days', a date…
  term text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  gone_at timestamptz,       -- set when a scrape no longer shows this suite
  constraint listing_spaces_listing_label_uq unique (listing_id, label)
);

create index listing_spaces_listing_idx on listing_spaces (listing_id);

alter table listing_spaces enable row level security;

create policy listing_spaces_auth_all on listing_spaces
  for all to authenticated using (true) with check (true);

create policy listing_spaces_va_deny on listing_spaces
  as restrictive for all to authenticated
  using ((select not public.is_va())) with check ((select not public.is_va()));

-- Run telemetry — the sweep lessons: a silent block must be visible as a logged run,
-- never inferred from absence ("SUCCEEDED with 0 items = BLOCKED").
create table listing_space_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz,
  pages int not null default 0,
  pages_ok int not null default 0,
  spaces_seen int not null default 0,
  challenges int not null default 0,
  errors int not null default 0,
  ok boolean,
  error_detail jsonb
);

alter table listing_space_runs enable row level security;

create policy listing_space_runs_auth_all on listing_space_runs
  for all to authenticated using (true) with check (true);

create policy listing_space_runs_va_deny on listing_space_runs
  as restrictive for all to authenticated
  using ((select not public.is_va())) with check ((select not public.is_va()));

-- ---------------------------------------------------------------------------
-- Worker RPCs
-- ---------------------------------------------------------------------------

-- Which listings to visit, least-recently-scraped first. Targets: on-market LoopNet
-- lease listings that advertise more than one space, or less than the whole building.
create or replace function public.listing_space_targets(p_limit int default 40)
returns table (listing_id uuid, source_listing_id text, url text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select m.id, m.source_listing_id, m.url
    from market_listings m
    join properties p on p.id = m.property_id
   where m.source = 'loopnet'
     and m.status = 'on_market'
     and m.listing_type = 'lease'
     and m.url is not null
     and p.listing_status = 'on_market'
     and (coalesce(m.space_count, 1) > 1
          or (m.sqft is not null and m.building_sf is not null and m.sqft < m.building_sf * 0.95))
   order by coalesce((select max(ls.last_seen_at) from listing_spaces ls
                       where ls.listing_id = m.id), '-infinity'::timestamptz) asc,
            m.last_seen_at desc
   limit greatest(p_limit, 1)
$$;

revoke execute on function public.listing_space_targets(int) from public, anon, authenticated;
grant execute on function public.listing_space_targets(int) to service_role;

-- Set-based upsert of one listing's scraped grid. Missing suites get gone_at stamped;
-- a suite that reappears is revived. Also trues up market_listings.space_count.
create or replace function public.import_listing_spaces(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r jsonb; s jsonb;
  v_listing uuid;
  v_labels text[];
  v_upserted int := 0; v_gone int := 0; v_gone_now int; v_listings int := 0;
begin
  for r in select value from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    select id into v_listing from market_listings
     where source = 'loopnet' and source_listing_id = r->>'source_listing_id';
    if v_listing is null then continue; end if;

    v_labels := '{}';
    for s in select value from jsonb_array_elements(coalesce(r->'spaces', '[]'::jsonb)) loop
      if nullif(s->>'label','') is null then continue; end if;
      v_labels := v_labels || (s->>'label');
      insert into listing_spaces as ls
        (listing_id, label, size_sf, rate_psf, space_use, build_out, available, term)
      values
        (v_listing, s->>'label',
         nullif(s->>'size_sf','')::int, nullif(s->>'rate_psf','')::numeric,
         nullif(s->>'space_use',''), nullif(s->>'build_out',''),
         nullif(s->>'available',''), nullif(s->>'term',''))
      on conflict (listing_id, label) do update set
        size_sf   = coalesce(excluded.size_sf, ls.size_sf),
        rate_psf  = excluded.rate_psf,
        space_use = coalesce(excluded.space_use, ls.space_use),
        build_out = coalesce(excluded.build_out, ls.build_out),
        available = coalesce(excluded.available, ls.available),
        term      = coalesce(excluded.term, ls.term),
        last_seen_at = now(),
        gone_at = null;
      v_upserted := v_upserted + 1;
    end loop;

    -- Stamp vanished suites gone ONLY when the scrape saw at least one suite. A
    -- 0-space extraction is a layout change or a block, not "everything let" — the
    -- SUCCEEDED-with-0-items lesson. The listing going off_market retires the rows
    -- from the view regardless.
    if array_length(v_labels, 1) > 0 then
      update listing_spaces set gone_at = now()
       where listing_id = v_listing and gone_at is null
         and not (label = any(v_labels));
      get diagnostics v_gone_now = row_count;
      v_gone := v_gone + v_gone_now;

      update market_listings set space_count = array_length(v_labels, 1)
       where id = v_listing
         and space_count is distinct from array_length(v_labels, 1);
    end if;
    v_listings := v_listings + 1;
  end loop;

  return jsonb_build_object('listings', v_listings, 'spaces_upserted', v_upserted, 'spaces_gone', v_gone);
end $$;

revoke execute on function public.import_listing_spaces(jsonb) from public, anon, authenticated;
grant execute on function public.import_listing_spaces(jsonb) to service_role;

-- Run log insert for the worker (service key inserts directly; table RLS applies to
-- authenticated only, service role bypasses — no RPC needed).

-- ---------------------------------------------------------------------------
-- v_property_available_space: third source, no double-counting
-- ---------------------------------------------------------------------------

create or replace view v_property_available_space as
-- What Alex recorded. `status` gates it: a let unit must stop offering space
-- that is gone, which is worse than never having recorded it.
select u.property_id,
       u.size_sf,
       u.size_acres,
       'unit'::text  as space_source,
       u.label,
       u.asking_rate_psf
from units u
where coalesce(u.status, 'available') = 'available'
  and (u.size_sf is not null or u.size_acres is not null)

union all

-- What the listing's own Availability grid shows, per suite (U3 scraper). Real labels,
-- real per-suite rates — supersedes the single listing-derived row below.
select m.property_id,
       ls.size_sf,
       null::numeric as size_acres,
       'listing_space'::text as space_source,
       ls.label,
       -- cast: the view column is numeric(10,2) via units; a plain numeric here would
       -- change the output type and make create-or-replace refuse
       ls.rate_psf::numeric(10,2) as asking_rate_psf
from listing_spaces ls
join market_listings m on m.id = ls.listing_id
join properties p on p.id = m.property_id
where ls.gone_at is null
  and ls.size_sf is not null
  and m.status = 'on_market'
  and p.listing_status = 'on_market'

union all

-- What the market advertises, taken from the LATEST asking comp only — but ONLY where
-- no live scraped grid exists for the property (else this would double-count the sum
-- row on top of the per-suite rows).
select c.property_id,
       c.sf        as size_sf,
       null::numeric as size_acres,
       'listing'::text as space_source,
       null::text  as label,
       c.asking_lease_rate_psf
from (
  select distinct on (property_id)
         property_id, sf, asking_lease_rate_psf, as_of_date, created_at
  from comps
  where kind = 'asking' and deal_type in ('lease', 'both')
  order by property_id, as_of_date desc nulls last, created_at desc
) c
join properties p on p.id = c.property_id
where c.sf is not null
  and c.sf > 0
  and p.gross_sf > 0
  and c.sf < p.gross_sf * 0.95
  and p.listing_status = 'on_market'
  and not exists (
    select 1 from listing_spaces ls
    join market_listings m on m.id = ls.listing_id
    where m.property_id = c.property_id
      and ls.gone_at is null and m.status = 'on_market'
  );

alter view v_property_available_space set (security_invoker = true);

comment on view v_property_available_space is
  'Lettable space per property from THREE sources: hand-entered units (what Alex knows), scraped per-suite listing_spaces (what the listing''s Availability grid shows — U3 worker), and the latest sub-building asking comp as a fallback where no grid was scraped. Derived, never copied into units.';

grant select on v_property_available_space to authenticated, anon;
