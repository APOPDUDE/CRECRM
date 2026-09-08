-- ---------------------------------------------------------------------------
-- The one anon-reachable door. Every field is named explicitly: nothing from
-- contacts, clients, pursuits, outreach, owner phone/email or commission_fee
-- can leak, because none of it is selected.
-- ---------------------------------------------------------------------------
create or replace function public_deal_room(p_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  r deal_rooms;
  p properties;
  v_comps jsonb;
  v_stats jsonb;
begin
  select * into r from deal_rooms
  where slug = p_slug
    and status = 'published'
    and (expires_at is null or expires_at > now());

  if not found then
    return null;
  end if;

  select * into p from properties where id = r.property_id;

  update deal_rooms
     set view_count = view_count + 1, last_viewed_at = now()
   where id = r.id;

  select coalesce(jsonb_agg(c order by c.sort_order, c.miles), '[]'::jsonb)
    into v_comps
  from (
    select
      drc.sort_order,
      drc.featured,
      drc.note,
      cp.id,
      cp.deal_type::text                         as deal_type,
      cp.kind::text                              as kind,
      cp.sf,
      cp.executed_lease_rate_psf                 as rate_psf,
      cp.asking_lease_rate_psf                   as asking_psf,
      cp.lease_structure::text                   as lease_structure,
      cp.term_months,
      cp.free_rent_months,
      cp.ti_psf,
      cp.opex_psf,
      cp.sale_price,
      cp.price_per_sf,
      cp.cap_rate_pct,
      cp.executed_at,
      cp.commencement_date,
      case when r.show_tenant_names
           then coalesce(cp.tenant_name, cp.normalized_tenant_name) end as tenant_name,
      pr.address, pr.city, pr.state, pr.zip,
      pr.lat, pr.lng, pr.year_built, pr.gross_sf, pr.land_acres,
      pr.property_type::text                     as property_type,
      round(geo_miles(p.lat, p.lng, pr.lat, pr.lng)::numeric, 1) as miles
    from deal_room_comps drc
    join comps cp on cp.id = drc.comp_id
    join properties pr on pr.id = cp.property_id
    where drc.deal_room_id = r.id
  ) c;

  -- Medians the page prints as its market read, computed server-side so the
  -- investor page and the CRM can never disagree.
  select jsonb_build_object(
      'lease_median_psf', (
        select round(percentile_cont(0.5) within group (
                 order by coalesce(cp.executed_lease_rate_psf, cp.asking_lease_rate_psf))::numeric, 2)
        from deal_room_comps drc join comps cp on cp.id = drc.comp_id
        where drc.deal_room_id = r.id and cp.deal_type = 'lease'
          and coalesce(cp.executed_lease_rate_psf, cp.asking_lease_rate_psf) is not null),
      'sale_median_psf', (
        select round(percentile_cont(0.5) within group (order by cp.price_per_sf)::numeric, 2)
        from deal_room_comps drc join comps cp on cp.id = drc.comp_id
        where drc.deal_room_id = r.id and cp.deal_type = 'sale' and cp.price_per_sf is not null),
      'lease_count', (select count(*) from deal_room_comps drc join comps cp on cp.id = drc.comp_id
                      where drc.deal_room_id = r.id and cp.deal_type = 'lease'),
      'sale_count',  (select count(*) from deal_room_comps drc join comps cp on cp.id = drc.comp_id
                      where drc.deal_room_id = r.id and cp.deal_type = 'sale')
    ) into v_stats;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'slug', r.slug, 'title', r.title, 'subtitle', r.subtitle, 'summary', r.summary,
      'headline_price', r.headline_price, 'headline_price_psf', r.headline_price_psf,
      'headline_rate_psf', r.headline_rate_psf, 'lease_structure', r.lease_structure::text,
      'highlights', to_jsonb(r.highlights),
      'broker_name', r.broker_name, 'broker_phone', r.broker_phone, 'broker_email', r.broker_email,
      'show_comp_detail', r.show_comp_detail,
      'published_at', r.published_at
    ),
    'property', jsonb_build_object(
      'address', p.address, 'city', p.city, 'state', p.state, 'zip', p.zip,
      'lat', p.lat, 'lng', p.lng,
      'property_type', p.property_type::text, 'gross_sf', p.gross_sf, 'heated_sf', p.heated_sf,
      'land_acres', p.land_acres, 'usable_acres', p.usable_acres,
      'year_built', p.year_built, 'year_renovated', p.year_renovated,
      'building_class', p.building_class, 'stories', p.stories,
      'clear_height_ft', p.clear_height_ft, 'dock_high_doors', p.dock_high_doors,
      'grade_level_doors', p.grade_level_doors, 'column_spacing', p.column_spacing,
      'sprinkler_system', p.sprinkler_system, 'three_phase_power', p.three_phase_power,
      'parking_spaces', p.parking_spaces, 'truck_court_ft', p.truck_court_ft,
      'zoning_district', p.zoning_district, 'zoning_description', p.zoning_description,
      'zoning_type', p.zoning_type, 'county', p.county, 'parcel_number', p.parcel_number,
      'just_value', p.just_value, 'specs', p.specs, 'description', p.description,
      'photo_urls', to_jsonb(p.photo_urls)
    ),
    'comps', v_comps,
    'stats', v_stats
  );
end;
$fn$;

revoke all on function public_deal_room(text) from public;
grant execute on function public_deal_room(text) to anon, authenticated;
