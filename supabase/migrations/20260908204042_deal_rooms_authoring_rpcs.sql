-- ---------------------------------------------------------------------------
-- Authoring side. One call makes a shareable room for any property; a second
-- fills the comp set by radius. Both authenticated-only.
-- ---------------------------------------------------------------------------
create or replace function deal_room_slug(p_address text)
returns text language sql volatile as $fn$
  select left(regexp_replace(lower(coalesce(p_address,'deal')), '[^a-z0-9]+', '-', 'g'), 48)
         || '-' || encode(gen_random_bytes(4), 'hex')
$fn$;

create or replace function create_deal_room(
  p_property_id uuid,
  p_title text default null,
  p_subtitle text default null,
  p_summary text default null,
  p_headline_price numeric default null,
  p_headline_rate_psf numeric default null,
  p_highlights text[] default '{}',
  p_publish boolean default true
) returns deal_rooms
language plpgsql security invoker set search_path to 'public' as $fn$
declare
  p properties;
  out_row deal_rooms;
begin
  select * into p from properties where id = p_property_id;
  if not found then raise exception 'no such property: %', p_property_id; end if;

  insert into deal_rooms (
    property_id, slug, title, subtitle, summary,
    headline_price, headline_price_psf, headline_rate_psf, highlights,
    status, published_at
  ) values (
    p.id,
    regexp_replace(deal_room_slug(p.address), '^-+', ''),
    coalesce(p_title, p.address),
    coalesce(p_subtitle, nullif(concat_ws(', ', p.city, p.state), '')),
    p_summary,
    p_headline_price,
    case when p_headline_price is not null and coalesce(p.gross_sf,0) > 0
         then round(p_headline_price / p.gross_sf, 2) end,
    p_headline_rate_psf,
    coalesce(p_highlights, '{}'),
    case when p_publish then 'published' else 'draft' end::deal_room_status,
    case when p_publish then now() end
  ) returning * into out_row;

  return out_row;
end;
$fn$;

/**
 * Pull nearby comps into a room. Defaults mirror how a broker actually picks a
 * set: same-ish size, recent, priced, within a few miles, nearest first.
 * Re-running is safe -- existing rows are left alone.
 */
create or replace function deal_room_fill_comps(
  p_deal_room_id uuid,
  p_radius_mi numeric default 6,
  p_sf_min integer default null,
  p_sf_max integer default null,
  p_since date default null,
  p_deal_type text default null,
  p_limit integer default 25
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
           geo_miles(p.lat, p.lng, pr.lat, pr.lng) as miles
    from comps cp
    join properties pr on pr.id = cp.property_id
    where cp.kind = 'executed'
      and pr.id <> p.id
      and pr.lat is not null and pr.lng is not null
      and geo_miles(p.lat, p.lng, pr.lat, pr.lng) <= p_radius_mi
      and (p_sf_min is null or cp.sf >= p_sf_min)
      and (p_sf_max is null or cp.sf <= p_sf_max)
      and (p_since is null or cp.executed_at >= p_since)
      and (p_deal_type is null or cp.deal_type::text = p_deal_type)
      and (cp.executed_lease_rate_psf is not null
           or cp.price_per_sf is not null
           or cp.sale_price is not null)
    order by miles
    limit p_limit
  )
  insert into deal_room_comps (deal_room_id, comp_id, sort_order)
  select p_deal_room_id, pick.id, row_number() over (order by pick.miles)
  from pick
  on conflict (deal_room_id, comp_id) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$fn$;
