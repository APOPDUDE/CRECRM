-- The daily sweep no longer drops matches straight onto tenant boards. It creates
-- pending SUGGESTIONS the broker reviews on the dashboard, then approves or dismisses.
create or replace function public.cross_reference_open_tenant_reps(p_property_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_created int := 0;
begin
  with new_suggestions as (
    insert into match_suggestions (property_id, tenant_rep_id, status)
    select p.id, tr.id, 'pending'
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
      -- skip anything already on the board or already suggested (pending or dismissed)
      and not exists (select 1 from matches m where m.tenant_rep_id = tr.id and m.property_id = p.id)
      and not exists (select 1 from match_suggestions s where s.tenant_rep_id = tr.id and s.property_id = p.id)
    on conflict (property_id, tenant_rep_id) do nothing
    returning 1
  )
  select count(*) into v_created from new_suggestions;
  return jsonb_build_object('suggestions_created', v_created);
end $$;

-- Approve a suggestion: create the inquiring match, then remove the suggestion.
create or replace function public.approve_match_suggestion(p_suggestion_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_match_id uuid;
  v_prop uuid;
  v_tr uuid;
  v_tc uuid;
  v_tk uuid;
begin
  select s.property_id, s.tenant_rep_id into v_prop, v_tr
    from match_suggestions s where s.id = p_suggestion_id;
  if v_prop is null then
    raise exception 'suggestion % not found', p_suggestion_id;
  end if;
  select tenant_company_id, tenant_contact_id into v_tc, v_tk from tenant_reps where id = v_tr;

  select id into v_match_id from matches where tenant_rep_id = v_tr and property_id = v_prop limit 1;
  if v_match_id is null then
    insert into matches (property_id, tenant_rep_id, tenant_company_id, tenant_contact_id, stage, inquiry_date, flagged_new, source)
    values (v_prop, v_tr, v_tc, v_tk, 'inquiring', current_date, true, 'loopnet')
    returning id into v_match_id;
  end if;
  delete from match_suggestions where id = p_suggestion_id;
  return v_match_id;
end $$;
