-- Executing a landlord-side deal must NOT turn a non-repped prospect tenant into a
-- closed tenant-rep deal. Only close the client if they are actively repped
-- (searching/negotiating); a 'prospect' stays a prospect (landlord-board only).
-- Pairs with the frontend change that hides 'prospect' clients from the tenant board.
create or replace function public.execute_pursuit(p_pursuit_id uuid, p jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_comp uuid; v_owner uuid; v_prop uuid; v_company uuid; v_deal public.deal_type; v_sf int;
begin
  update pursuits set stage='executed',
    executed_date = coalesce((nullif(p->>'executed_date',''))::date, executed_date, current_date),
    actual_fee    = coalesce((nullif(p->>'actual_fee',''))::numeric, actual_fee)
  where id = p_pursuit_id
  returning owner_id, property_id into v_owner, v_prop;
  if v_owner is null then raise exception 'pursuit % not found', p_pursuit_id; end if;

  select c.deal_type, c.company_id into v_deal, v_company
  from pursuits pu join clients c on c.id = pu.client_id where pu.id = p_pursuit_id;
  select building_sf into v_sf from properties where id = v_prop;
  if v_deal = 'both' then
    v_deal := case when nullif(p->>'sale_price','') is not null then 'sale' else 'lease' end;
  end if;

  insert into comps (owner_id, property_id, pursuit_id, tenant_company_id, deal_type, kind,
    executed_lease_rate_psf, lease_structure, term_months, free_rent_months, ti_psf, escalations,
    commencement_date, expiration_date, sale_price, cap_rate_pct, sf, executed_at, source)
  values (v_owner, v_prop, p_pursuit_id, v_company, coalesce(v_deal,'lease'), 'executed',
    nullif(p->>'executed_rate_psf','')::numeric, (nullif(p->>'lease_structure',''))::public.lease_structure,
    nullif(p->>'term_months','')::int, nullif(p->>'free_rent_months','')::numeric, nullif(p->>'ti_psf','')::numeric,
    nullif(p->>'escalations',''), nullif(p->>'commencement_date','')::date, nullif(p->>'lease_expiration','')::date,
    nullif(p->>'sale_price','')::numeric, nullif(p->>'cap_rate_pct','')::numeric,
    v_sf, coalesce((nullif(p->>'executed_date',''))::date, current_date), 'manual')
  on conflict (pursuit_id) where pursuit_id is not null
  do update set executed_lease_rate_psf=excluded.executed_lease_rate_psf, lease_structure=excluded.lease_structure,
    term_months=excluded.term_months, free_rent_months=excluded.free_rent_months, ti_psf=excluded.ti_psf,
    escalations=excluded.escalations, commencement_date=excluded.commencement_date, expiration_date=excluded.expiration_date,
    sale_price=excluded.sale_price, cap_rate_pct=excluded.cap_rate_pct, deal_type=excluded.deal_type,
    sf=coalesce(excluded.sf, comps.sf), executed_at=excluded.executed_at, updated_at=now()
  returning id into v_comp;

  if coalesce((p->>'close_client')::boolean, false) then
    update clients set status='closed'
    where id = (select client_id from pursuits where id = p_pursuit_id)
      and status in ('searching','negotiating');
  end if;
  if coalesce((p->>'close_listing')::boolean, false) then
    update listings set stage='closed' where property_id = v_prop and status='active';
    update pursuits set stage='passed'
      where property_id = v_prop and id <> p_pursuit_id and stage not in ('executed','passed');
  end if;

  return jsonb_build_object('pursuit_id', p_pursuit_id, 'comp_id', v_comp);
end $function$;
