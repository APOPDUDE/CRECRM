-- STNL is a product category, not an investment strategy — a single-tenant net lease deal
-- IS the stabilized play, so "core / stabilized" already says it. Drop the value and fold
-- anyone carrying it into core_stabilized.
--
-- Postgres cannot remove an enum value in place, so the type is rebuilt.

alter type investment_strategy rename to investment_strategy_v1;

create type investment_strategy as enum
  ('value_add','core_stabilized','development','sale_leaseback','covered_land');

-- A USING clause cannot contain a subquery, so the per-row array rewrite lives in a
-- throwaway function. distinct collapses the case where someone held both values.
create function public.__map_strategies(old investment_strategy_v1[])
returns investment_strategy[]
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(
           array_agg(distinct (case when o::text = 'stnl' then 'core_stabilized'
                                    else o::text end)::investment_strategy),
           '{}'::investment_strategy[])
    from unnest(old) o
$$;

alter table public.clients
  alter column strategies drop default;

alter table public.clients
  alter column strategies type investment_strategy[]
  using public.__map_strategies(strategies);

alter table public.clients
  alter column strategies set default '{}'::investment_strategy[];

drop function public.__map_strategies(investment_strategy_v1[]);

drop type investment_strategy_v1;
