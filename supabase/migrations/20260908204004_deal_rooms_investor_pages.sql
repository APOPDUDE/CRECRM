-- Investor deal rooms: a public, unguessable-URL page per property showing the
-- subject plus a curated comp set. Anon reaches it through ONE security-definer
-- function with a hard field whitelist -- never through RLS, because anon already
-- holds table GRANTs on everything and RLS is the only gate.

create type deal_room_status as enum ('draft','published','archived');

create table deal_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  property_id uuid not null references properties(id) on delete cascade,
  -- The share secret. Human-readable head + random tail so the URL is neither
  -- ugly nor enumerable.
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{5,79}$'),
  title text not null,
  subtitle text,
  summary text,
  headline_price numeric(14,2),
  headline_price_psf numeric(10,2),
  headline_rate_psf numeric(10,2),
  lease_structure lease_structure,
  highlights text[] not null default '{}',
  broker_name text,
  broker_phone text,
  broker_email text,
  -- Investor-facing disclosure switches. Tenant names are normal in a package;
  -- everything genuinely private (contacts, fees, pursuits) is simply never selected.
  show_tenant_names boolean not null default true,
  show_comp_detail boolean not null default true,
  status deal_room_status not null default 'draft',
  published_at timestamptz,
  expires_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_rooms_published_has_date
    check (status <> 'published' or published_at is not null)
);
create index deal_rooms_property_idx on deal_rooms(property_id);
create index deal_rooms_slug_idx on deal_rooms(slug);

create table deal_room_comps (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references deal_rooms(id) on delete cascade,
  comp_id uuid not null references comps(id) on delete cascade,
  note text,
  featured boolean not null default false,
  sort_order integer,
  created_at timestamptz not null default now(),
  unique (deal_room_id, comp_id)
);
create index deal_room_comps_room_idx on deal_room_comps(deal_room_id);

create trigger deal_rooms_updated_at before update on deal_rooms
  for each row execute function set_updated_at();

alter table deal_rooms enable row level security;
alter table deal_room_comps enable row level security;

create policy deal_rooms_auth_all on deal_rooms for all to authenticated using (true) with check (true);
create policy deal_room_comps_auth_all on deal_room_comps for all to authenticated using (true) with check (true);

-- The VA silo never sees deal rooms, same restrictive shape as properties/comps.
create policy deal_rooms_va_deny on deal_rooms as restrictive for all to authenticated
  using ((select not is_va())) with check ((select not is_va()));
create policy deal_room_comps_va_deny on deal_room_comps as restrictive for all to authenticated
  using ((select not is_va())) with check ((select not is_va()));

-- Miles between two lat/lng pairs. No earthdistance extension on this project.
create or replace function geo_miles(lat1 double precision, lng1 double precision,
                                     lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $fn$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 3958.7613 * acos(least(1, greatest(-1,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2)))))
  end
$fn$;
