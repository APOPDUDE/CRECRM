-- Slack /deal intake → CRM. Two RPCs that dedupe company/contact and create the deal.
-- Called by the n8n workflow "CRE CRM · Prospect Intake (/deal → Supabase)" (service role).
-- Payload `p` is a flat jsonb of already-mapped values (enum strings; empty -> null via nullif).
-- p_owner is the app's auth user (listings/tenant_reps.owner_id).

create or replace function intake_tenant_rep(p jsonb, p_owner uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_company_id uuid; v_contact_id uuid; v_tenant_rep_id uuid; v_property_id uuid;
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

  if v_addr is not null then
    insert into properties (address, city, state, property_type)
    values (v_addr, nullif(p->>'city',''), nullif(p->>'state',''), (nullif(p->>'property_type',''))::property_kind)
    returning id into v_property_id;
    insert into matches (property_id, tenant_company_id, tenant_contact_id, tenant_rep_id, stage, source, inquiry_date)
    values (v_property_id, v_company_id, v_contact_id, v_tenant_rep_id, 'inquiring', (nullif(p->>'source',''))::lead_source, current_date);
  end if;

  if nullif(p->>'notes','') is not null then
    insert into notes (entity_type, entity_id, body) values ('tenant_rep', v_tenant_rep_id, p->>'notes');
  end if;

  return jsonb_build_object('tenant_rep_id', v_tenant_rep_id, 'contact_id', v_contact_id, 'company_id', v_company_id, 'property_id', v_property_id);
end $$;

create or replace function intake_landlord_listing(p jsonb, p_owner uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_company_id uuid; v_contact_id uuid; v_property_id uuid; v_listing_id uuid;
  v_company text := nullif(p->>'company','');
  v_email   text := nullif(lower(p->>'email'),'');
  v_phone   text := nullif(p->>'phone','');
  v_addr    text := coalesce(nullif(p->>'address',''),'(no address)');
begin
  if v_company is not null then
    select id into v_company_id from companies where lower(name)=lower(v_company) limit 1;
    if v_company_id is null then
      insert into companies (name, type, website, phone)
      values (v_company, 'landlord', nullif(p->>'website',''), v_phone)
      returning id into v_company_id;
    end if;
  end if;

  if v_email is not null then select id into v_contact_id from contacts where lower(email)=v_email limit 1; end if;
  if v_contact_id is null and v_phone is not null then select id into v_contact_id from contacts where phone=v_phone limit 1; end if;
  if v_contact_id is null and nullif(p->>'first_name','') is not null then
    insert into contacts (company_id, first_name, last_name, email, phone, title)
    values (v_company_id, p->>'first_name', nullif(p->>'last_name',''), v_email, v_phone, nullif(p->>'title',''))
    returning id into v_contact_id;
  end if;

  insert into properties (address, city, state, property_type, building_sf, land_acres)
  values (v_addr, nullif(p->>'city',''), nullif(p->>'state',''), (nullif(p->>'property_type',''))::property_kind,
          (nullif(p->>'building_sf',''))::int, (nullif(p->>'land_acres',''))::numeric)
  returning id into v_property_id;

  insert into listings (
    owner_id, property_id, landlord_company_id, landlord_contact_id, deal_type, stage, status, source,
    asking_rate_psf, asking_price, commission_pct, landlord_requirements
  ) values (
    p_owner, v_property_id, v_company_id, v_contact_id,
    coalesce((nullif(p->>'deal_type',''))::deal_type, 'lease'), 'proposal', 'active', (nullif(p->>'source',''))::lead_source,
    (nullif(p->>'asking_rate_psf',''))::numeric, (nullif(p->>'asking_price',''))::numeric, (nullif(p->>'commission_pct',''))::numeric,
    nullif(p->>'notes','')
  ) returning id into v_listing_id;

  if nullif(p->>'notes','') is not null then
    insert into notes (entity_type, entity_id, body) values ('listing', v_listing_id, p->>'notes');
  end if;

  return jsonb_build_object('listing_id', v_listing_id, 'property_id', v_property_id, 'contact_id', v_contact_id, 'company_id', v_company_id);
end $$;

grant execute on function intake_tenant_rep(jsonb, uuid) to anon, authenticated, service_role;
grant execute on function intake_landlord_listing(jsonb, uuid) to anon, authenticated, service_role;
