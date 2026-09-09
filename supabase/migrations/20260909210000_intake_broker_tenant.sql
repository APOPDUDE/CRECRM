-- Call form: a broker calling on one of our listings while representing a tenant
-- (Jack Venneman, 2026-09-09). The broker is logged by intake_broker; this RPC logs
-- the TENANT they brought as a landlord-side prospect on that listing:
--   company (type tenant, industry = business type)
--   contact = the tenant's own person when the broker shared one, else the broker
--             (contacts_needs_identity forbids a phone-less placeholder person, and
--              the broker IS who you reach for this deal)
--   client  is_rep=false, status prospect, source broker, broker_contact_id = broker
--           (stays OFF the tenant kanban; shows as a prospect card on the listing board)
--   pursuit on the listing's property, stage inquiring
--   note on the pursuit (or the client when no listing was picked)
-- Machine door (n8n service role) — same grant posture as intake_broker.
create or replace function public.intake_broker_tenant(p jsonb, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_broker      uuid := nullif(p->>'broker_contact_id','')::uuid;
  v_company     text := nullif(p->>'tenant_company','');
  v_business    text := nullif(p->>'business_type','');
  v_tname       text := nullif(p->>'tenant_contact_name','');
  v_tphone      text := nullif(p->>'tenant_contact_phone','');
  v_temail      text := nullif(lower(p->>'tenant_contact_email'),'');
  v_deal        public.deal_type := coalesce((nullif(p->>'deal_type',''))::public.deal_type, 'lease');
  v_ptype       public.property_kind := (nullif(p->>'property_type',''))::public.property_kind;
  v_sf_min      int := nullif(p->>'building_sf_min','')::int;
  v_sf_max      int := nullif(p->>'building_sf_max','')::int;
  v_wants       text := nullif(p->>'must_haves','');
  v_addr        text := nullif(p->>'listing_address','');
  v_notes       text := nullif(p->>'notes','');
  v_brokerage   text := nullif(p->>'brokerage','');
  v_company_id uuid; v_contact_id uuid; v_client_id uuid; v_property_id uuid; v_listing_id uuid; v_pursuit_id uuid;
  v_broker_name text; v_reused boolean := false; v_lines text[];
begin
  if v_broker is null or not exists (select 1 from contacts where id = v_broker) then
    raise exception 'broker_contact_id is required';
  end if;
  if v_deal = 'both' then v_deal := 'lease'; end if;
  select btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into v_broker_name
    from contacts where id = v_broker;

  -- tenant company
  if v_company is not null then
    select id into v_company_id from companies where lower(name) = lower(v_company) limit 1;
    if v_company_id is null then
      insert into companies (name, type, industry) values (v_company, 'tenant', v_business)
      returning id into v_company_id;
    elsif v_business is not null then
      update companies set industry = coalesce(industry, v_business) where id = v_company_id;
    end if;
  end if;

  -- tenant contact: the tenant's own person when we have a way to reach them, else the broker
  if normalize_phone(v_tphone) is not null or v_temail is not null then
    if v_tphone is not null then
      select id into v_contact_id from contacts where normalize_phone(phone) = normalize_phone(v_tphone) limit 1;
    end if;
    if v_contact_id is null and v_temail is not null then
      select id into v_contact_id from contacts where lower(email) = v_temail limit 1;
    end if;
    if v_contact_id is null then
      insert into contacts (company_id, first_name, last_name, phone, email, category)
      values (v_company_id,
              coalesce(split_part(v_tname, ' ', 1), 'Unknown'),
              nullif(btrim(substr(v_tname, length(split_part(v_tname, ' ', 1)) + 1)), ''),
              v_tphone, v_temail, 'tenant')
      returning id into v_contact_id;
    else
      update contacts set company_id = coalesce(company_id, v_company_id) where id = v_contact_id;
    end if;
  else
    v_contact_id := v_broker;
  end if;

  -- one open prospect per (contact, tenant company); a broker can bring several tenants
  select id into v_client_id from clients
   where owner_id = p_owner and contact_id = v_contact_id
     and company_id is not distinct from v_company_id
     and status in ('prospect','searching','negotiating')
   order by created_at limit 1;
  if v_client_id is null then
    insert into clients (owner_id, company_id, contact_id, status, is_rep, deal_type, source, broker_contact_id,
                         property_type, building_sf_min, building_sf_max, must_haves, intended_use)
    values (p_owner, v_company_id, v_contact_id, 'prospect', false, v_deal, 'broker', v_broker,
            v_ptype, v_sf_min, v_sf_max, v_wants, v_business)
    returning id into v_client_id;
  else
    v_reused := true;
    update clients c set
      broker_contact_id = coalesce(c.broker_contact_id, v_broker),
      source            = coalesce(c.source, 'broker'),
      property_type     = coalesce(c.property_type, v_ptype),
      building_sf_min   = coalesce(c.building_sf_min, v_sf_min),
      building_sf_max   = coalesce(c.building_sf_max, v_sf_max),
      must_haves        = coalesce(c.must_haves, v_wants),
      intended_use      = coalesce(c.intended_use, v_business)
    where c.id = v_client_id;
  end if;

  -- the listing they called about -> pursuit on its property
  if v_addr is not null then
    select l.id, l.property_id into v_listing_id, v_property_id
      from listings l join properties pr on pr.id = l.property_id
     where l.status = 'active' and lower(pr.address) = lower(v_addr)
     order by (l.stage = 'listed') desc, l.created_at desc limit 1;
    if v_property_id is null then
      select id into v_property_id from properties where lower(address) = lower(v_addr) limit 1;
    end if;
    if v_property_id is not null then
      insert into pursuits (property_id, client_id, owner_id, stage, inquiry_date, deal_type)
      values (v_property_id, v_client_id, p_owner, 'inquiring', current_date, v_deal)
      on conflict (client_id, property_id) do nothing
      returning id into v_pursuit_id;
      if v_pursuit_id is null then
        select id into v_pursuit_id from pursuits where client_id = v_client_id and property_id = v_property_id;
      end if;
    end if;
  end if;

  v_lines := array['[Tenant via broker - call form] Brought by ' || coalesce(v_broker_name, 'broker')
                   || case when v_brokerage is not null then ' (' || v_brokerage || ')' else '' end];
  if v_company  is not null then v_lines := v_lines || ('Tenant: ' || v_company); end if;
  if v_business is not null then v_lines := v_lines || ('Business: ' || v_business); end if;
  if v_sf_min is not null or v_sf_max is not null then
    v_lines := v_lines || ('Size: ' || coalesce(v_sf_min::text, '?') || '-' || coalesce(v_sf_max::text, '?') || ' SF');
  end if;
  if v_wants is not null then v_lines := v_lines || ('Looking for: ' || v_wants); end if;
  if v_tname is not null then v_lines := v_lines || ('Tenant contact: ' || concat_ws(' | ', v_tname, v_tphone, v_temail)); end if;
  if v_notes is not null then v_lines := v_lines || ('Notes: ' || v_notes); end if;
  if v_pursuit_id is not null then
    insert into notes (body, pursuit_id) values (array_to_string(v_lines, e'\n'), v_pursuit_id);
  else
    insert into notes (body, client_id) values (array_to_string(v_lines, e'\n'), v_client_id);
  end if;

  return jsonb_build_object('client_id', v_client_id, 'contact_id', v_contact_id, 'company_id', v_company_id,
                            'property_id', v_property_id, 'listing_id', v_listing_id, 'pursuit_id', v_pursuit_id,
                            'reused', v_reused);
end $function$;

revoke execute on function public.intake_broker_tenant(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.intake_broker_tenant(jsonb, uuid) to service_role;
