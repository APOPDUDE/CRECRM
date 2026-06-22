-- Phase D: the canonical "current asking" per property — the latest asking comp for
-- each (property_id, deal_type). Readers (matching, market views, cards, widgets)
-- move onto this in Phases E/F so the duplicated properties.asking_* columns can go
-- away in Phase H. One row per property per deal_type.
create or replace view public.v_property_current_asking as
select distinct on (property_id, deal_type)
  property_id,
  deal_type,
  asking_lease_rate_psf,
  sale_price,
  cap_rate_pct,
  sf,
  as_of_date,
  id as comp_id
from public.comps
where kind = 'asking'
order by property_id, deal_type, as_of_date desc nulls last, created_at desc;

grant select on public.v_property_current_asking to authenticated, anon, service_role;
