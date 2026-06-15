-- When the tenant intake names a specific property, match it to an EXISTING active
-- listing (by address) and link the match to that listing (so the tenant shows up on
-- the landlord's board too). Only create a bare property if no listing matches.
create or replace function public.intake_tenant_rep(p jsonb, p_owner uuid)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_company_id uuid; v_contact_id uuid; v_tenant_rep_id uuid; v_property_id uuid; v_listing_id uuid;
  v_company text := nullif(p->>'company','');
  v_email   text := nullif(lower(p->>'email'),'');
  v_phone   text := nullif(p->>'phone','');
  v_addr    text := nullif(p->>'address','');
  v_first   text := coalesce(nullif(p->>'first_name',''),'Unknown');
begin
  if v_company is not null then
    select id into v_company_id from companies where lower(name)=lower(v_company) limit 1;
    if v_company_id is null then
      insert into companies (name, type, website, industry, phone)
      values (v_company, 'tenant', nullif(p->>'website',''), nullif(p->>'industry',''), v_phone)
      returning id into v_company_id;
    end if;
  end if;

  if v_email is not null then select id into v_contact_id from contacts where lower(email)=v_email limit 1; end if;
  if v_contact_id is null and v_phone is not null then select id into v_contact_id from contacts where phone=v_phone limit 1; end if;
  if v_contact_id is null then
    insert into contacts (company_id, first_name, last_name, email, phone, title)
    values (v_company_id, v_first, nullif(p->>'last_name',''), v_email, v_phone, nullif(p->>'title',''))
    returning id into v_contact_id;
  end if;

  insert into tenant_reps (
    owner_id, tenant_company_id, tenant_contact_id, deal_type, stage, status, source,
    property_type, target_area, budget, must_haves, warehouse_sf_min, outdoor_storage_min_ac,
    clear_height, loading_type, power_requirements, move_in_date, move_in_context
  ) values (
    p_owner, v_company_id, v_contact_id,
    coalesce((nullif(p->>'deal_type',''))::deal_type, 'lease'), 'lead', 'active',
    (nullif(p->>'source',''))::lead_source,
    (nullif(p->>'property_type',''))::property_kind,
    nullif(p->>'target_area',''), nullif(p->>'budget',''), nullif(p->>'must_haves',''),
    (nullif(p->>'building_sf',''))::int, (nullif(p->>'outdoor_acres',''))::numeric,
    nullif(p->>'clear_height',''), nullif(p->>'loading_type',''), nullif(p->>'power',''),
    (nullif(p->>'move_in_date',''))::date, nullif(p->>'move_in_context','')
  ) returning id into v_tenant_rep_id;

  -- optional inquiry on a specific property
  if v_addr is not null then
    -- prefer an existing active listing with that address (links both boards)
    select l.id, l.property_id into v_listing_id, v_property_id
    from listings l join properties pr on pr.id = l.property_id
    where l.status = 'active' and lower(pr.address) = lower(v_addr)
    limit 1;

    if v_property_id is null then
      insert into properties (address, city, state, property_type)
      values (v_addr, nullif(p->>'city',''), nullif(p->>'state',''), (nullif(p->>'property_type',''))::property_kind)
      returning id into v_property_id;
    end if;

    insert into matches (property_id, listing_id, tenant_company_id, tenant_contact_id, tenant_rep_id, stage, source, inquiry_date)
    values (v_property_id, v_listing_id, v_company_id, v_contact_id, v_tenant_rep_id, 'inquiring', (nullif(p->>'source',''))::lead_source, current_date);
  end if;

  if nullif(p->>'notes','') is not null then
    insert into notes (entity_type, entity_id, body) values ('tenant_rep', v_tenant_rep_id, p->>'notes');
  end if;

  return jsonb_build_object('tenant_rep_id', v_tenant_rep_id, 'contact_id', v_contact_id, 'company_id', v_company_id, 'property_id', v_property_id, 'listing_id', v_listing_id);
end $function$;
