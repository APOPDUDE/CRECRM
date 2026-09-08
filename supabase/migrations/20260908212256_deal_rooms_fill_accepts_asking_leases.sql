-- The "row carries a number" guard listed executed_lease_rate_psf / price_per_sf /
-- sale_price. An ASKING LEASE comp has none of those -- its number lives in
-- asking_lease_rate_psf -- so every asking lease was silently filtered out while
-- asking sales (which do carry sale_price) came through. Guard the psf value
-- itself instead, which is what the band filter already uses.
create or replace function deal_room_fill_comps(
  p_deal_room_id uuid,
  p_radius_mi numeric default 6,
  p_sf_min integer default null,
  p_sf_max integer default null,
  p_since date default null,
  p_deal_type text default null,
  p_limit integer default 25,
  p_kinds text[] default array['executed','transfer'],
  p_psf_min numeric default null,
  p_psf_max numeric default null
) returns integer
language plpgsql security invoker set search_path to 'public' as $fn$
declare
  r deal_rooms;
  p properties;
  n integer;
begin
  select * into r from deal_rooms where id = p_deal_room_id;
  if not found then raise exception 'no such deal room: %', p_deal_room_id; end if;
  select * into p from properties where id = r.property_id;
  if p.lat is null or p.lng is null then
    raise exception 'subject property % has no coordinates', p.id;
  end if;

  with pick as (
    select cp.id,
           geo_miles(p.lat, p.lng, pr.lat, pr.lng) as miles,
           case when cp.deal_type = 'sale'
                then coalesce(cp.price_per_sf, cp.sale_price / nullif(pr.gross_sf, 0))
                else coalesce(cp.executed_lease_rate_psf, cp.asking_lease_rate_psf)
           end as psf
    from comps cp
    join properties pr on pr.id = cp.property_id
    where cp.kind::text = any(p_kinds)
      and pr.id <> p.id
      and pr.lat is not null and pr.lng is not null
      and geo_miles(p.lat, p.lng, pr.lat, pr.lng) <= p_radius_mi
      and (p_sf_min is null or coalesce(cp.sf, pr.gross_sf) >= p_sf_min)
      and (p_sf_max is null or coalesce(cp.sf, pr.gross_sf) <= p_sf_max)
      and (p_since is null or coalesce(cp.executed_at, cp.as_of_date) >= p_since)
      and (p_deal_type is null or cp.deal_type::text = p_deal_type)
      -- a portfolio allocation is not a comp for a single building
      and pr.address !~* 'portfolio'
  ),
  insert into deal_room_comps (deal_room_id, comp_id, sort_order)
  select p_deal_room_id, s.id, row_number() over (order by s.miles)
  from (
    select pick.* from pick
    where psf is not null
      and (p_psf_min is null or psf >= p_psf_min)
      and (p_psf_max is null or psf <= p_psf_max)
    order by miles
    limit p_limit
  ) s
  on conflict (deal_room_id, comp_id) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function deal_room_fill_comps(uuid,numeric,integer,integer,date,text,integer,text[],numeric,numeric) from public, anon;
grant execute on function deal_room_fill_comps(uuid,numeric,integer,integer,date,text,integer,text[],numeric,numeric) to authenticated;
