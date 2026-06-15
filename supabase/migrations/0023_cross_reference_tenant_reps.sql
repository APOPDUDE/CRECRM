-- Daily-sweep matching: given freshly imported scraped properties, create a match
-- for every OPEN tenant rep (lead/searching, i.e. not executed/lost) whose
-- requirements the property fits. Dedup-safe and idempotent.
create or replace function public.cross_reference_open_tenant_reps(p_property_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_created int := 0;
begin
  with new_matches as (
    insert into matches (
      property_id, tenant_rep_id, tenant_company_id, tenant_contact_id,
      stage, source, inquiry_date, flagged_new
    )
    select p.id, tr.id, tr.tenant_company_id, tr.tenant_contact_id,
           'inquiring', 'loopnet', current_date, true
    from properties p
    join tenant_reps tr
      on tr.status = 'active'
     and tr.stage in ('lead', 'touring', 'loi', 'lease_negotiation')
    where p.id = any(p_property_ids)
      and p.source = 'scrape'
      and (tr.property_type is null or p.property_type is null or tr.property_type = p.property_type)
      and (tr.warehouse_sf_min is null or p.building_sf is null or p.building_sf >= tr.warehouse_sf_min * 0.8)
      and (tr.warehouse_sf_max is null or p.building_sf is null or p.building_sf <= tr.warehouse_sf_max * 1.25)
      and (
        (coalesce(tr.deal_type, 'lease') = 'lease' and p.asking_rate_psf is not null) or
        (coalesce(tr.deal_type, 'lease') = 'sale'  and p.asking_price is not null) or
        (coalesce(tr.deal_type, 'lease') = 'both'  and (p.asking_rate_psf is not null or p.asking_price is not null))
      )
      and (tr.target_area is null or (p.city is not null and tr.target_area ilike '%' || p.city || '%'))
      and not exists (
        select 1 from matches m where m.tenant_rep_id = tr.id and m.property_id = p.id
      )
    returning 1
  )
  select count(*) into v_created from new_matches;
  return jsonb_build_object('matches_created', v_created);
end $$;
