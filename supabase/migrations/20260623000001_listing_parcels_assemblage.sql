-- Multi-parcel assemblage support: a landlord listing can market several contiguous
-- parcels as one deal. listings.property_id STAYS the primary/display parcel (unchanged) —
-- this join table is purely additive and only consulted when the full assemblage is needed.

create table public.listing_parcels (
  listing_id  uuid not null references public.listings(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (listing_id, property_id)
);

create index on public.listing_parcels (property_id);

-- at most one primary parcel per listing
create unique index listing_parcels_one_primary
  on public.listing_parcels (listing_id)
  where is_primary;

-- RLS: match the existing listings/properties policies (authenticated full access; the
-- whole app is single-user authenticated-full-access today and tightens to per-owner later).
alter table public.listing_parcels enable row level security;
create policy listing_parcels_auth_all on public.listing_parcels
  for all to authenticated using (true) with check (true);

-- Backfill: each existing listing's current property_id becomes its primary parcel, so all
-- current data keeps working unchanged.
insert into public.listing_parcels (listing_id, property_id, is_primary)
select id, property_id, true
from public.listings
where property_id is not null
on conflict do nothing;

-- Helper RPC: attach a parcel to a listing (so callers don't do raw multi-table writes).
-- When p_is_primary, it demotes any current primary and syncs listings.property_id to keep
-- the display parcel in lockstep, then upserts the new link.
create or replace function public.add_parcel_to_listing(
  p_listing_id uuid,
  p_property_id uuid,
  p_is_primary boolean default false
) returns public.listing_parcels
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare r public.listing_parcels;
begin
  if p_is_primary then
    update public.listing_parcels
       set is_primary = false
     where listing_id = p_listing_id;
    update public.listings
       set property_id = p_property_id
     where id = p_listing_id;
  end if;

  insert into public.listing_parcels (listing_id, property_id, is_primary)
  values (p_listing_id, p_property_id, p_is_primary)
  on conflict (listing_id, property_id)
    do update set is_primary = excluded.is_primary
  returning * into r;

  return r;
end$$;
