-- Suggestions respect the client's drawn areas (Alex, 2026-08-20: Down To Earth is set to
-- Sarasota and was being recommended 7818 Causeway Blvd in Tampa).
--
-- Client geography moved from the legacy target_markets TEXT to target_areas polygon rings on
-- 2026-08-10 (unify_client_geography_and_budget), but cross_reference -- the matcher that runs
-- on every new scraped listing -- was still checking only target_markets. Down To Earth has
-- target_markets NULL + a Sarasota ring, so the matcher read them as "anywhere".
--
-- client_area_match(): true when the client has no drawn areas (no geographic constraint);
-- when areas exist, the property's point must fall inside ANY ring -- and a property with no
-- coordinates does NOT match (can't prove it's in the area, so don't recommend it).
-- Rings are [[lat,lng],...]; Postgres geometric types are (x,y) so points build as (lng,lat).
--
-- Also purges pending suggestions that violate their client's areas.

begin;

create or replace function client_area_match(p_lat double precision, p_lng double precision, p_areas jsonb)
returns boolean
language sql stable
as $$
  select case
    when p_areas is null or jsonb_typeof(p_areas) <> 'array' or jsonb_array_length(p_areas) = 0
      then true
    when p_lat is null or p_lng is null
      then false
    else coalesce((
      select bool_or(point(p_lng, p_lat) <@ poly)
      from (
        select ('(' || string_agg('(' || (pt->>1) || ',' || (pt->>0) || ')', ',' order by ord) || ')')::polygon as poly
        from jsonb_array_elements(p_areas) with ordinality as a(area, aord),
             lateral jsonb_array_elements(a.area->'ring') with ordinality as r(pt, ord)
        group by a.aord
        having count(*) >= 3
      ) rings
    ), false)
  end
$$;

comment on function client_area_match(double precision, double precision, jsonb) is
  'Does a property point fall inside any of a client''s drawn target_areas rings? No areas = '
  'no constraint (true); areas but no coordinates = false (never recommend what cannot be '
  'placed). Rings store [[lat,lng],...]; points build as (lng,lat).';

create or replace function public.cross_reference(p_property_ids uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_created int := 0;
begin
  with ca as (
    select property_id,
      max(asking_lease_rate_psf) filter (where deal_type='lease') as lease_rate,
      max(sale_price)            filter (where deal_type='sale')  as sale_price,
      max(sf)                    filter (where deal_type='lease') as lease_space,
      max(cap_rate_pct) as cap,
      max(occupancy) as occupancy,
      max(sale_type) as sale_type,
      max(sale_conditions) as sale_conditions
    from v_property_current_asking where property_id = any(p_property_ids) group by property_id
  ), new_suggestions as (
    insert into suggestions (property_id, client_id, status)
    select p.id, c.id, 'pending'
    from properties p
    left join ca on ca.property_id = p.id
    join clients c on c.status = 'searching'
    where p.id = any(p_property_ids) and p.source = 'scrape'
      and (c.property_type is null or p.property_type is null or c.property_type = p.property_type)
      and (case when c.deal_type = 'sale' then
            (c.building_sf_min is null or p.gross_sf is null or p.gross_sf >= c.building_sf_min*0.8)
            and (c.building_sf_max is null or p.gross_sf is null or p.gross_sf <= c.building_sf_max*1.25)
          else
            (c.building_sf_min is null or coalesce(ca.lease_space,p.gross_sf) is null or coalesce(ca.lease_space,p.gross_sf) >= c.building_sf_min*0.8)
            and (c.building_sf_max is null or coalesce(ca.lease_space,p.gross_sf) is null or coalesce(ca.lease_space,p.gross_sf) <= c.building_sf_max*1.25)
          end)
      and ((c.deal_type='lease' and ca.lease_rate is not null)
        or (c.deal_type='sale'  and ca.sale_price is not null)
        or (c.deal_type='both'  and (ca.lease_rate is not null or ca.sale_price is not null)))
      and (c.target_markets is null or (p.city is not null and c.target_markets ilike '%'||p.city||'%'))
      -- The drawn areas are the real geography (target_markets is the legacy text field).
      and client_area_match(p.lat, p.lng, c.target_areas)
      and (c.purpose is distinct from 'investment' or (
            ca.sale_price is not null
            and (ca.cap is null or c.cap_rate_min is null or ca.cap >= c.cap_rate_min)
            and (ca.cap is not null or ca.occupancy ~ '[0-9]' or ca.sale_type ilike '%investment%'
                 or ca.sale_conditions ~* 'exchange|investment|triple net|net lease|leased|portfolio'
                 or p.opportunity_zone is true)))
      and not exists (select 1 from pursuits pu where pu.client_id=c.id and pu.property_id=p.id)
      and not exists (select 1 from suggestions s where s.client_id=c.id and s.property_id=p.id)
    on conflict (property_id, client_id) do nothing
    returning 1
  )
  select count(*) into v_created from new_suggestions;
  return jsonb_build_object('suggestions_created', v_created);
end $function$;

-- Purge pending suggestions already violating their client's drawn areas.
delete from suggestions s
using properties p, clients c
where s.property_id = p.id and s.client_id = c.id
  and s.status = 'pending'
  and not client_area_match(p.lat, p.lng, c.target_areas);

commit;
