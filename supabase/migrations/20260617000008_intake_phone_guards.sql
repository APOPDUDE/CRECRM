-- Phone is now NOT NULL on contacts. Harden the intake RPCs so they only create
-- a contact when a phone is present (a landlord with no phone, or a broker with
-- no phone, simply doesn't get a contact row instead of erroring).

create or replace function public.intake_client(p jsonb, p_owner uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company_id uuid; v_contact_id uuid; v_client_id uuid; v_property_id uuid; v_listing_id uuid; v_pursuit_id uuid;
  v_company text := nullif(p->>'company','');
  v_email   text := nullif(lower(p->>'email'),'');
  v_phone   text := nullif(p->>'phone','');
  v_addr    text := nullif(p->>'address','');
  v_first   text := coalesce(nullif(p->>'first_name',''),'Unknown');
  v_source  public.lead_source := (nullif(p->>'source',''))::public.lead_source;
  v_broker  uuid;
begin
  if v_company is not null then
    select id into v_company_id from companies where lower(name)=lower(v_company) limit 1;
    if v_company_id is null then
      insert into companies (name, type, website, industry, phone)
      values (v_company,'tenant',nullif(p->>'website',''),nullif(p->>'industry',''),v_phone)
      returning id into v_company_id;
    end if;
  end if;

  if v_phone is not null then
    select id into v_contact_id from contacts where normalize_phone(phone)=normalize_phone(v_phone) limit 1;
  end if;
  if v_contact_id is null and v_email is not null then
    select id into v_contact_id from contacts where lower(email)=v_email limit 1;
  end if;
  if v_contact_id is null then
    insert into contacts (company_id, first_name, last_name, email, phone, title)
    values (v_company_id, v_first, nullif(p->>'last_name',''), v_email, v_phone, nullif(p->>'title',''))
    returning id into v_contact_id;
  else
    update contacts set
      company_id = coalesce(v_company_id, company_id),
      first_name = case when v_first <> 'Unknown' then v_first else first_name end,
      last_name  = coalesce(nullif(p->>'last_name',''), last_name),
      email      = coalesce(v_email, email),
      phone      = coalesce(v_phone, phone),
      title      = coalesce(nullif(p->>'title',''), title)
    where id = v_contact_id;
  end if;

  if v_source = 'broker' then
    if nullif(p->>'broker_email','') is not null then
      select id into v_broker from contacts where lower(email)=lower(p->>'broker_email') limit 1;
    end if;
    if v_broker is null and nullif(p->>'broker_phone','') is not null then
      select id into v_broker from contacts where normalize_phone(phone)=normalize_phone(p->>'broker_phone') limit 1;
    end if;
    if v_broker is null and nullif(p->>'broker_name','') is not null and nullif(p->>'broker_phone','') is not null then
      insert into contacts (first_name, phone, email)
      values (p->>'broker_name', p->>'broker_phone', nullif(p->>'broker_email',''))
      returning id into v_broker;
    end if;
    if v_broker is null then v_source := null; end if;
  end if;

  select id into v_client_id from clients
   where owner_id=p_owner and contact_id=v_contact_id and status in ('prospect','searching','negotiating')
   order by created_at limit 1;
  if v_client_id is null then
    insert into clients (owner_id, company_id, contact_id, status, deal_type, source, broker_contact_id,
      purpose, property_type, target_markets, budget, must_haves,
      building_sf_min, building_sf_max, land_acres_min, land_acres_max, cap_rate_min,
      commission_pct, move_in_date)
    values (p_owner, v_company_id, v_contact_id, 'searching',
      coalesce((nullif(p->>'deal_type',''))::public.deal_type,'lease'), v_source, v_broker,
      (nullif(p->>'purpose',''))::public.client_purpose,
      (nullif(p->>'property_type',''))::public.property_kind,
      coalesce(nullif(p->>'target_markets',''), nullif(p->>'target_area','')),
      nullif(p->>'budget',''), nullif(p->>'must_haves',''),
      coalesce(nullif(p->>'building_sf_min','')::int, nullif(p->>'building_sf','')::int),
      nullif(p->>'building_sf_max','')::int,
      coalesce(nullif(p->>'land_acres_min','')::numeric, nullif(p->>'outdoor_acres','')::numeric),
      nullif(p->>'land_acres_max','')::numeric,
      nullif(p->>'cap_rate_min','')::numeric,
      nullif(p->>'commission_pct','')::numeric,
      nullif(p->>'move_in_date','')::date)
    returning id into v_client_id;
  end if;

  if v_addr is not null then
    select l.id, l.property_id into v_listing_id, v_property_id
    from listings l join properties pr on pr.id = l.property_id
    where l.status='active' and lower(pr.address)=lower(v_addr) limit 1;
    if v_property_id is null then
      select id into v_property_id from properties where lower(address)=lower(v_addr) limit 1;
    end if;
    if v_property_id is null then
      insert into properties (address, city, state, property_type)
      values (v_addr, nullif(p->>'city',''), nullif(p->>'state',''), (nullif(p->>'property_type',''))::public.property_kind)
      returning id into v_property_id;
    end if;
    insert into pursuits (property_id, client_id, owner_id, stage, inquiry_date)
    values (v_property_id, v_client_id, p_owner, 'inquiring', current_date)
    on conflict (client_id, property_id) do nothing
    returning id into v_pursuit_id;
  end if;

  if nullif(p->>'notes','') is not null then
    insert into notes (body, client_id) values (p->>'notes', v_client_id);
  end if;

  return jsonb_build_object('client_id', v_client_id, 'contact_id', v_contact_id, 'company_id', v_company_id,
                           'property_id', v_property_id, 'listing_id', v_listing_id, 'pursuit_id', v_pursuit_id);
end $function$;

create or replace function public.intake_landlord_listing(p jsonb, p_owner uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company_id uuid; v_contact_id uuid; v_property_id uuid; v_listing_id uuid;
  v_company text := nullif(p->>'company','');
  v_email   text := nullif(lower(p->>'email'),'');
  v_phone   text := nullif(p->>'phone','');
  v_addr    text := coalesce(nullif(p->>'address',''),'(no address)');
  v_dtype   public.deal_type := coalesce((nullif(p->>'deal_type',''))::public.deal_type,'lease');
begin
  if v_company is not null then
    select id into v_company_id from companies where lower(name)=lower(v_company) limit 1;
    if v_company_id is null then
      insert into companies (name, type, website, phone)
      values (v_company,'landlord',nullif(p->>'website',''),v_phone) returning id into v_company_id;
    end if;
  end if;

  if v_phone is not null then
    select id into v_contact_id from contacts where normalize_phone(phone)=normalize_phone(v_phone) limit 1;
  end if;
  if v_contact_id is null and v_email is not null then
    select id into v_contact_id from contacts where lower(email)=v_email limit 1;
  end if;
  if v_contact_id is null and nullif(p->>'first_name','') is not null and v_phone is not null then
    insert into contacts (company_id, first_name, last_name, email, phone, title)
    values (v_company_id, p->>'first_name', nullif(p->>'last_name',''), v_email, v_phone, nullif(p->>'title',''))
    returning id into v_contact_id;
  elsif v_contact_id is not null then
    update contacts set
      company_id = coalesce(v_company_id, company_id),
      first_name = coalesce(nullif(p->>'first_name',''), first_name),
      last_name  = coalesce(nullif(p->>'last_name',''), last_name),
      email      = coalesce(v_email, email),
      phone      = coalesce(v_phone, phone),
      title      = coalesce(nullif(p->>'title',''), title)
    where id = v_contact_id;
  end if;

  select id into v_property_id from properties where lower(address)=lower(v_addr) limit 1;
  if v_property_id is null then
    insert into properties (address, city, state, property_type, building_sf, land_acres)
    values (v_addr, nullif(p->>'city',''), nullif(p->>'state',''), (nullif(p->>'property_type',''))::public.property_kind,
            nullif(p->>'building_sf','')::int, nullif(p->>'land_acres','')::numeric)
    returning id into v_property_id;
  else
    update properties set
      city          = coalesce(nullif(p->>'city',''), city),
      state         = coalesce(nullif(p->>'state',''), state),
      property_type = coalesce((nullif(p->>'property_type',''))::public.property_kind, property_type),
      building_sf   = coalesce(nullif(p->>'building_sf','')::int, building_sf),
      land_acres    = coalesce(nullif(p->>'land_acres','')::numeric, land_acres)
    where id = v_property_id;
  end if;

  select id into v_listing_id from listings where property_id=v_property_id and status='active' limit 1;
  if v_listing_id is null then
    insert into listings (owner_id, property_id, landlord_company_id, landlord_contact_id, deal_type, stage, status, source,
      asking_rate_psf, asking_price, commission_pct, listing_expiration, landlord_requirements)
    values (p_owner, v_property_id, v_company_id, v_contact_id, v_dtype, 'proposal','active',(nullif(p->>'source',''))::public.lead_source,
      nullif(p->>'asking_rate_psf','')::numeric, nullif(p->>'asking_price','')::numeric, nullif(p->>'commission_pct','')::numeric,
      nullif(p->>'listing_expiration','')::date, nullif(p->>'landlord_requirements',''))
    returning id into v_listing_id;
  else
    update listings set
      landlord_company_id   = coalesce(v_company_id, landlord_company_id),
      landlord_contact_id   = coalesce(v_contact_id, landlord_contact_id),
      deal_type             = v_dtype,
      source                = coalesce((nullif(p->>'source',''))::public.lead_source, source),
      asking_rate_psf       = coalesce(nullif(p->>'asking_rate_psf','')::numeric, asking_rate_psf),
      asking_price          = coalesce(nullif(p->>'asking_price','')::numeric, asking_price),
      commission_pct        = coalesce(nullif(p->>'commission_pct','')::numeric, commission_pct),
      listing_expiration    = coalesce(nullif(p->>'listing_expiration','')::date, listing_expiration),
      landlord_requirements = coalesce(nullif(p->>'landlord_requirements',''), landlord_requirements)
    where id = v_listing_id;
  end if;

  if nullif(p->>'notes','') is not null then
    insert into notes (body, listing_id) values (p->>'notes', v_listing_id);
  end if;

  return jsonb_build_object('listing_id', v_listing_id, 'property_id', v_property_id, 'contact_id', v_contact_id, 'company_id', v_company_id);
end $function$;
