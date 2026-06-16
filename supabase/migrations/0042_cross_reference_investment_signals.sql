-- Investment matching: cap rate is rarely published (~2% of listings), so don't
-- require it. For purpose='investment' clients, match FOR-SALE properties that show
-- a real investment signal (a listed cap rate meeting the min, a leased occupancy %,
-- an investment sale type/condition like 1031 or triple-net, or an opportunity zone).
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
      and (
        c.purpose is distinct from 'investment'
        or (
          p.asking_price is not null
          and (p.cap_rate_pct is null or c.cap_rate_min is null or p.cap_rate_pct >= c.cap_rate_min)
          and (
               p.cap_rate_pct is not null
            or p.occupancy ~ '[0-9]'
            or p.sale_type ilike '%investment%'
            or p.sale_conditions ~* 'exchange|investment|triple net|net lease|leased|portfolio'
            or p.opportunity_zone is true
          )
        )
      )
      and not exists (select 1 from pursuits   pu where pu.client_id = c.id and pu.property_id = p.id)
      and not exists (select 1 from suggestions s  where s.client_id  = c.id and s.property_id  = p.id)
    on conflict (property_id, client_id) do nothing
    returning 1
  )
  select count(*) into v_created from new_suggestions;
  return jsonb_build_object('suggestions_created', v_created);
end $$;
