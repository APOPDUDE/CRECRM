-- Buyers pipeline: buyer profile fields on clients.
--
-- A buyer is a client with deal_type <> 'lease' (mirrors boardSides(): 'both' works
-- both pipelines). The Buyers page is a searchable roster, not a kanban — the point
-- is answering "a deal just hit the market, who do I call?" — so the criteria that
-- power that search are fixed enums (product subclass, investment strategy), numeric
-- price capacity, and drawn map areas instead of free text that automations can't
-- match against.

create type industrial_subclass as enum
  ('ios','small_bay','big_box','cold_storage','flex','land_development');

create type investment_strategy as enum
  ('stnl','value_add','core_stabilized','development','sale_leaseback','covered_land');

-- Identity, not strategy: an owner-user with no strategies is coherent; an investor
-- filters on stnl/value_add. Two independent axes.
create type buyer_kind as enum ('investor','owner_user','developer');

alter table public.clients
  add column product_subclasses industrial_subclass[] not null default '{}',
  add column strategies investment_strategy[] not null default '{}',
  add column buyer_kind buyer_kind,
  add column price_min numeric check (price_min >= 0),
  add column price_max numeric check (price_max >= 0),
  add column exchange_1031 boolean not null default false,
  add column exchange_deadline date,
  -- Named target areas drawn on a map: [{"name":"East Tampa","ring":[[lat,lng],...]},...]
  -- Polygons, not city names or zips: an address either falls inside or it doesn't,
  -- so AI/n8n matching has zero format ambiguity. Ring vertices are in draw order,
  -- closing edge implicit (same convention as src/lib/geo.ts pointInPolygon).
  add column target_areas jsonb not null default '[]'::jsonb;

alter table public.clients add constraint clients_price_range
  check (price_min is null or price_max is null or price_min <= price_max);

-- A deadline without the 1031 flag is a data-entry mistake, not a state.
alter table public.clients add constraint clients_exchange_deadline_needs_flag
  check (exchange_deadline is null or exchange_1031);

alter table public.clients add constraint clients_target_areas_is_array
  check (jsonb_typeof(target_areas) = 'array');

-- Ray-cast point-in-polygon over one jsonb ring of [lat,lng] pairs. Planar math is
-- fine at Tampa Bay scale (same shortcut geo.ts takes client-side).
create or replace function public.point_in_ring(p_lat numeric, p_lng numeric, ring jsonb)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  n int;
  i int;
  j int;
  yi numeric; xi numeric;
  yj numeric; xj numeric;
  inside boolean := false;
begin
  if ring is null or jsonb_typeof(ring) <> 'array' then return false; end if;
  n := jsonb_array_length(ring);
  if n < 3 then return false; end if;
  j := n - 1;
  for i in 0..n - 1 loop
    yi := (ring->i->>0)::numeric; xi := (ring->i->>1)::numeric;
    yj := (ring->j->>0)::numeric; xj := (ring->j->>1)::numeric;
    if (yi > p_lat) <> (yj > p_lat)
       and p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
exception when others then
  -- malformed vertex (non-numeric) — treat the ring as not covering anything
  return false;
end $$;

-- "Who buys at this address?" for automations: geocode -> lat/lng -> this.
-- Lost buyers excluded; buyers with no drawn areas are not returned (no area
-- drawn means geography unknown, not everywhere).
create or replace function public.buyers_covering_point(p_lat numeric, p_lng numeric)
returns setof public.clients
language sql stable
set search_path = public, pg_temp
as $$
  select c.*
    from public.clients c
   where c.is_rep
     and c.deal_type <> 'lease'
     and c.status <> 'lost'
     and exists (
       select 1
         from jsonb_array_elements(c.target_areas) area
        where public.point_in_ring(p_lat, p_lng, area->'ring')
     )
$$;

-- Backfill the handful of existing sale-side clients: purpose='investment' reads
-- as investor; anyone else buying is doing it for their own operation.
update public.clients
   set buyer_kind = case when purpose = 'investment' then 'investor'::buyer_kind
                         else 'owner_user'::buyer_kind end
 where is_rep
   and deal_type in ('sale','both');
