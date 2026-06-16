-- Cap-rate gating: only matters for investment-purpose clients. For those, only
-- suggest properties that LIST a cap rate that meets the client's minimum.
create or replace function public.cross_reference(p_property_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_created int := 0;
begin
  with new_suggestions as (
    insert into suggestions (property_id, client_id, status)
    select p.id, c.id, 'pending'
    from properties p
    join clients c on c.status = 'active'
    where p.id = any(p_property_ids)
      and p.source = 'scrape'
      and (c.property_type is null or p.property_type is null or c.property_type = p.property_type)
      and (c.building_sf_min is null or p.building_sf is null or p.building_sf >= c.building_sf_min * 0.8)
      and (c.building_sf_max is null or p.building_sf is null or p.building_sf <= c.building_sf_max * 1.25)
      and (
        (c.deal_type = 'lease' and p.asking_rate_psf is not null) or
        (c.deal_type = 'sale'  and p.asking_price   is not null) or
        (c.deal_type = 'both'  and (p.asking_rate_psf is not null or p.asking_price is not null))
      )
      and (c.target_markets is null or (p.city is not null and c.target_markets ilike '%' || p.city || '%'))
      -- cap rate only gates investment clients; for them require a listed cap rate >= their minimum
      and (
        c.purpose is distinct from 'investment'
        or (p.cap_rate_pct is not null and (c.cap_rate_min is null or p.cap_rate_pct >= c.cap_rate_min))
      )
      and not exists (select 1 from pursuits   pu where pu.client_id = c.id and pu.property_id = p.id)
      and not exists (select 1 from suggestions s  where s.client_id  = c.id and s.property_id  = p.id)
    on conflict (property_id, client_id) do nothing
    returning 1
  )
  select count(*) into v_created from new_suggestions;
  return jsonb_build_object('suggestions_created', v_created);
end $$;

-- bring the current review queue in line with the new rule
delete from public.suggestions s
using public.clients c, public.properties p
where s.status = 'pending' and s.client_id = c.id and s.property_id = p.id
  and c.purpose = 'investment'
  and (p.cap_rate_pct is null or (c.cap_rate_min is not null and p.cap_rate_pct < c.cap_rate_min));
