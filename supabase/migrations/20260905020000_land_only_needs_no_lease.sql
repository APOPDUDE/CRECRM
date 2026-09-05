-- 2026-09-05 (Alex): 5910 Breckenridge Pkwy (DOR 4860, 8 lease comps) only showed in the
-- Land book, and 116 "land only" rows carry lease comps. A recorded lease is evidence of a
-- building the county figures may be missing, so it vetoes land_only. The War Room is ONE
-- book from today (the flags no longer partition it), but the land valuation model and
-- the map RPC's p_book still read them, so the rule is fixed rather than abandoned.
create or replace function public.refresh_land_book()
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_changed int;
  v_in int;
  v_only int;
begin
  with calc as (
    select id,
      is_condo_unit,
      dor_class(dor_use_code) as dc,
      land_acres,
      greatest(coalesce(gross_sf, 0), coalesce(heated_sf, 0)) as bldg_sf,
      county_synced_at is not null
        and greatest(coalesce(gross_sf, 0), coalesce(heated_sf, 0)) < 1000
        as known_vacant,
      exists (select 1 from comps c where c.property_id = properties.id and c.deal_type = 'lease') as has_lease
    from properties
  ),
  target as (
    select id, known_vacant, has_lease,
      dc in (0, 10, 40, 70, 99) or dc between 50 and 69 as dor_land,
      bldg_sf,
      coalesce(
        land_acres >= 0.5
        and not is_condo_unit
        and (
          dc in (0, 10, 40, 70, 99)
          or dc between 50 and 69
          or known_vacant
          or (bldg_sf >= 1000
              and land_acres > 0
              and bldg_sf / (land_acres * 43560.0) <= 0.05)
        ), false) as want_in
    from calc
  ),
  final as (
    select id, want_in,
      want_in
        and not has_lease
        and (known_vacant or (coalesce(dor_land, false) and bldg_sf < 1000))
        as want_only
    from target
  )
  update properties p
  set in_land_book = f.want_in,
      land_only    = f.want_only
  from final f
  where p.id = f.id
    and (p.in_land_book is distinct from f.want_in
         or p.land_only is distinct from f.want_only);

  get diagnostics v_changed = row_count;
  select count(*) filter (where in_land_book),
         count(*) filter (where land_only)
    into v_in, v_only
  from properties;

  return jsonb_build_object(
    'changed', v_changed, 'in_land_book', v_in, 'land_only', v_only);
end $$;
