-- Same treatment for tenants that buyers got: one meaning per column, geography as
-- drawn shapes, so an automation reading `clients` never has to interpret prose.
--
-- Geography becomes target_areas for EVERY client. `target_markets` was a comma string
-- an AI had to guess at ("Sarasota / Manatee", "Lakeland, auburndale"); a polygon either
-- contains an address or it does not.
--
-- Budget splits by side rather than being overloaded: a buyer's is a purchase price
-- (price_min/max, already done), a tenant's is monthly rent ("3k"), which gets its own
-- pair. Reusing price_min for rent would put two meanings in one column — the exact
-- thing this migration is undoing.

alter table public.clients
  add column rent_budget_min numeric check (rent_budget_min >= 0),
  add column rent_budget_max numeric check (rent_budget_max >= 0);

alter table public.clients add constraint clients_rent_budget_range
  check (rent_budget_min is null or rent_budget_max is null or rent_budget_min <= rent_budget_max);

comment on column public.clients.rent_budget_min is 'Monthly rent budget in dollars (lease side).';
comment on column public.clients.rent_budget_max is 'Monthly rent budget in dollars (lease side).';

-- 1. Lease-side budget text -> monthly dollars. "3k" -> 3000, "$2,500" -> 2500.
with parsed as (
  select id,
         (regexp_match(replace(lower(budget), ',', ''), '([0-9]+(?:\.[0-9]+)?)\s*(m|k)?'))[1]::numeric as n,
         (regexp_match(replace(lower(budget), ',', ''), '([0-9]+(?:\.[0-9]+)?)\s*(m|k)?'))[2] as unit
    from public.clients
   where deal_type = 'lease' and budget is not null
)
update public.clients c
   set rent_budget_max = case when p.unit = 'm' then p.n * 1000000
                              when p.unit = 'k' then p.n * 1000
                              else p.n end
  from parsed p
 where c.id = p.id and p.n is not null
   and c.rent_budget_min is null and c.rent_budget_max is null;

-- 2. target_markets -> drawn boxes for anyone still without areas. The box is the extent
--    of the properties we already hold in that city, so it is real geography, not invented.
with cities as (
  select initcap(lower(city)) as name,
         min(lat) as mn_lat, max(lat) as mx_lat, min(lng) as mn_lng, max(lng) as mx_lng
    from public.properties
   where lat is not null and lng is not null and city is not null and length(city) > 3
   group by initcap(lower(city))
  having count(*) >= 5
), hits as (
  select c.id,
         jsonb_build_object('name', ci.name, 'ring', jsonb_build_array(
           jsonb_build_array(round((ci.mn_lat - 0.01)::numeric, 4), round((ci.mn_lng - 0.01)::numeric, 4)),
           jsonb_build_array(round((ci.mn_lat - 0.01)::numeric, 4), round((ci.mx_lng + 0.01)::numeric, 4)),
           jsonb_build_array(round((ci.mx_lat + 0.01)::numeric, 4), round((ci.mx_lng + 0.01)::numeric, 4)),
           jsonb_build_array(round((ci.mx_lat + 0.01)::numeric, 4), round((ci.mn_lng - 0.01)::numeric, 4))
         )) as area
    from public.clients c
    join cities ci on c.target_markets ilike '%' || ci.name || '%'
   where c.target_areas = '[]'::jsonb and c.target_markets is not null
)
update public.clients c
   set target_areas = agg.areas
  from (select id, jsonb_agg(distinct area) as areas from hits group by id) agg
 where c.id = agg.id;

-- 3. Keep every word that was typed, labelled, then retire the columns' contents.
update public.clients
   set must_haves = concat_ws(E'\n\n', nullif(must_haves, ''),
         case when budget is not null then '[from budget] ' || budget end,
         case when target_markets is not null then '[from target markets] ' || target_markets end),
       budget = null,
       target_markets = null
 where budget is not null or target_markets is not null;
