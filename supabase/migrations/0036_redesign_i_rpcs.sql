-- Redesign I: RPCs rebuilt for the clients / pursuits / comps schema.

-- one executed comp per pursuit (lets execute_pursuit be idempotent)
create unique index if not exists comps_pursuit_uq on public.comps(pursuit_id) where pursuit_id is not null;

-- ---------------------------------------------------------------------------
-- intake_client: Slack/form intake -> find-or-create company+contact+client,
-- optionally open a pursuit on a listing's property.
-- ---------------------------------------------------------------------------
create or replace function public.intake_client(p jsonb, p_owner uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
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
  -- company (dedupe by name)
  if v_company is not null then
    select id into v_company_id from companies where lower(name)=lower(v_company) limit 1;
    if v_company_id is null then
      insert into companies (name, type, website, industry, phone)
      values (v_company,'tenant',nullif(p->>'website',''),nullif(p->>'industry',''),v_phone)
      returning id into v_company_id;
    end if;
  end if;

  -- contact (dedupe by email then phone)
  if v_email is not null then select id into v_contact_id from contacts where lower(email)=v_email limit 1; end if;
  if v_contact_id is null and v_phone is not null then select id into v_contact_id from contacts where phone=v_phone limit 1; end if;
  if v_contact_id is null then
    insert into contacts (company_id, first_name, last_name, email, phone, title)
    values (v_company_id, v_first, nullif(p->>'last_name',''), v_email, v_phone, nullif(p->>'title',''))
    returning id into v_contact_id;
  end if;

  -- cooperating broker (only when source = broker); demote source if none resolvable
  if v_source = 'broker' then
    if nullif(p->>'broker_email','') is not null then
      select id into v_broker from contacts where lower(email)=lower(p->>'broker_email') limit 1;
    end if;
    if v_broker is null and nullif(p->>'broker_name','') is not null then
      insert into contacts (first_name, phone, email)
      values (p->>'broker_name', nullif(p->>'broker_phone',''), nullif(p->>'broker_email',''))
      returning id into v_broker;
    end if;
    if v_broker is null then v_source := null; end if;
  end if;

  -- find-or-create the client (reuse a live one for this contact)
  select id into v_client_id from clients
   where owner_id=p_owner and contact_id=v_contact_id and status in ('prospect','active')
   order by created_at limit 1;
  if v_client_id is null then
    insert into clients (owner_id, company_id, contact_id, status, deal_type, source, broker_contact_id,
      purpose, property_type, target_markets, budget, must_haves,
      building_sf_min, building_sf_max, land_acres_min, land_acres_max, cap_rate_min,
      commission_pct, move_in_date, move_in_context)
    values (p_owner, v_company_id, v_contact_id, 'active',
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
      nullif(p->>'move_in_date','')::date, nullif(p->>'move_in_context',''))
    returning id into v_client_id;
  end if;

  -- optional inquiry on a specific property (prefer an existing active listing)
  if v_addr is not null then
    select l.id, l.property_id into v_listing_id, v_property_id
    from listings l join properties pr on pr.id = l.property_id
    where l.status='active' and lower(pr.address)=lower(v_addr) limit 1;
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
end $$;

-- ---------------------------------------------------------------------------
-- intake_landlord_listing: create landlord company/contact + property + listing
-- ---------------------------------------------------------------------------
create or replace function public.intake_landlord_listing(p jsonb, p_owner uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
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
      values (v_company,'landlord',nullif(p->>'website',''),v_phone) returning id into v_company_id;
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
  values (v_addr, nullif(p->>'city',''), nullif(p->>'state',''), (nullif(p->>'property_type',''))::public.property_kind,
          nullif(p->>'building_sf','')::int, nullif(p->>'land_acres','')::numeric)
  returning id into v_property_id;

  insert into listings (owner_id, property_id, landlord_company_id, landlord_contact_id, deal_type, stage, status, source,
    asking_rate_psf, asking_price, commission_pct, landlord_requirements)
  values (p_owner, v_property_id, v_company_id, v_contact_id,
    coalesce((nullif(p->>'deal_type',''))::public.deal_type,'lease'),'proposal','active',(nullif(p->>'source',''))::public.lead_source,
    nullif(p->>'asking_rate_psf','')::numeric, nullif(p->>'asking_price','')::numeric, nullif(p->>'commission_pct','')::numeric,
    nullif(p->>'notes',''))
  returning id into v_listing_id;

  if nullif(p->>'notes','') is not null then
    insert into notes (body, listing_id) values (p->>'notes', v_listing_id);
  end if;

  return jsonb_build_object('listing_id', v_listing_id, 'property_id', v_property_id, 'contact_id', v_contact_id, 'company_id', v_company_id);
end $$;

-- ---------------------------------------------------------------------------
-- import_scraped_listings: upsert scraped properties + asking comps; optional pursuits
-- ---------------------------------------------------------------------------
create or replace function public.import_scraped_listings(p_props jsonb, p_client_id uuid default null, p_flagged_new boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  r jsonb; v_prop_id uuid; v_comp_id uuid; v_pursuit_id uuid; v_owner uuid;
  v_sid text; v_rate numeric; v_price numeric;
  v_props int:=0; v_pursuits int:=0; v_comps int:=0;
  v_prop_ids uuid[]:='{}'; v_pursuit_ids uuid[]:='{}';
begin
  if p_client_id is not null then
    select owner_id into v_owner from clients where id=p_client_id;
    if not found then raise exception 'client % not found', p_client_id; end if;
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_props,'[]'::jsonb)) as t(value) loop
    v_sid := coalesce(nullif(r->>'source_key',''), nullif(r->>'source_listing_id',''));

    insert into properties (address, city, state, zip, property_type, building_sf, land_acres, specs,
      source, source_key, listing_url, asking_price, asking_rate_psf, cap_rate_pct,
      broker_name, broker_company, broker_phone, broker_email, days_on_market, listed_at, photo_urls, scraped_at, lat, lng)
    values (coalesce(nullif(r->>'address',''),'Address unavailable'), r->>'city', r->>'state', r->>'zip',
      (nullif(r->>'property_type',''))::public.property_kind, nullif(r->>'building_sf','')::int, nullif(r->>'land_acres','')::numeric, r->>'specs',
      coalesce(nullif(r->>'source',''),'scrape'), v_sid,
      coalesce(r->>'listing_url', r->>'source_url'), nullif(r->>'asking_price','')::numeric, nullif(r->>'asking_rate_psf','')::numeric, nullif(r->>'cap_rate_pct','')::numeric,
      r->>'broker_name', r->>'broker_company', r->>'broker_phone', r->>'broker_email',
      nullif(r->>'days_on_market','')::int, nullif(r->>'listed_at','')::date,
      case when jsonb_typeof(r->'photo_urls')='array' then array(select jsonb_array_elements_text(r->'photo_urls')) end,
      nullif(r->>'scraped_at','')::timestamptz, nullif(r->>'lat','')::numeric, nullif(r->>'lng','')::numeric)
    on conflict (source_key) where source_key is not null
    do update set asking_price=coalesce(excluded.asking_price, properties.asking_price),
      asking_rate_psf=coalesce(excluded.asking_rate_psf, properties.asking_rate_psf),
      cap_rate_pct=coalesce(excluded.cap_rate_pct, properties.cap_rate_pct),
      days_on_market=excluded.days_on_market,
      broker_name=coalesce(excluded.broker_name, properties.broker_name),
      broker_company=coalesce(excluded.broker_company, properties.broker_company),
      broker_phone=coalesce(excluded.broker_phone, properties.broker_phone),
      broker_email=coalesce(excluded.broker_email, properties.broker_email),
      photo_urls=coalesce(excluded.photo_urls, properties.photo_urls),
      listing_url=coalesce(excluded.listing_url, properties.listing_url),
      lat=coalesce(excluded.lat, properties.lat), lng=coalesce(excluded.lng, properties.lng),
      scraped_at=excluded.scraped_at, updated_at=now()
    returning id into v_prop_id;
    v_prop_ids := v_prop_ids || v_prop_id; v_props := v_props+1;

    -- asking comp (lease when a rate is present, else sale when a price is present)
    v_rate := nullif(r->>'asking_rate_psf','')::numeric;
    v_price := nullif(r->>'asking_price','')::numeric;
    if v_sid is not null and (v_rate is not null or v_price is not null) then
      insert into comps (property_id, source, source_key, deal_type, kind, asking_lease_rate_psf, sale_price, cap_rate_pct, sf)
      values (v_prop_id, 'scrape', v_sid,
        (case when v_rate is not null then 'lease' else 'sale' end)::public.deal_type, 'asking',
        v_rate, case when v_rate is null then v_price else null end,
        nullif(r->>'cap_rate_pct','')::numeric, nullif(r->>'building_sf','')::int)
      on conflict (source_key) where source_key is not null
      do update set asking_lease_rate_psf=excluded.asking_lease_rate_psf, sale_price=excluded.sale_price,
        cap_rate_pct=excluded.cap_rate_pct, deal_type=excluded.deal_type,
        sf=coalesce(excluded.sf, comps.sf), property_id=coalesce(excluded.property_id, comps.property_id), updated_at=now()
      returning id into v_comp_id;
      v_comps := v_comps+1;
    end if;

    -- pursuit when a client is supplied
    if p_client_id is not null then
      select id into v_pursuit_id from pursuits where client_id=p_client_id and property_id=v_prop_id limit 1;
      if v_pursuit_id is null then
        insert into pursuits (property_id, client_id, owner_id, stage, inquiry_date, flagged_new)
        values (v_prop_id, p_client_id, v_owner, 'inquiring', current_date, p_flagged_new)
        returning id into v_pursuit_id;
        v_pursuit_ids := v_pursuit_ids || v_pursuit_id; v_pursuits := v_pursuits+1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('properties_upserted', v_props, 'pursuits_created', v_pursuits,
    'asking_comps_upserted', v_comps, 'property_ids', to_jsonb(v_prop_ids), 'pursuit_ids', to_jsonb(v_pursuit_ids));
end $$;

-- ---------------------------------------------------------------------------
-- cross_reference: scraped properties -> suggestions for ACTIVE clients
-- ---------------------------------------------------------------------------
create or replace function public.cross_reference(p_property_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_created int := 0;
begin
  with new_suggestions as (
    insert into suggestions (property_id, client_id, status)
    select p.id, c.id, 'pending'
    from properties p
    join clients c on c.status = 'active'
    where p.id = any(p_property_ids)
      and p.source = 'scrape'
      and (c.property_type is null or p.property_type is null or c.property_type = p.property_type)
      and (c.building_sf_min is null or p.building_sf is null or p.building_sf >= c.building_sf_min * 0.8)
      and (c.building_sf_max is null or p.building_sf is null or p.building_sf <= c.building_sf_max * 1.25)
      and (
        (c.deal_type = 'lease' and p.asking_rate_psf is not null) or
        (c.deal_type = 'sale'  and p.asking_price   is not null) or
        (c.deal_type = 'both'  and (p.asking_rate_psf is not null or p.asking_price is not null))
      )
      and (c.target_markets is null or (p.city is not null and c.target_markets ilike '%' || p.city || '%'))
      and not exists (select 1 from pursuits   pu where pu.client_id = c.id and pu.property_id = p.id)
      and not exists (select 1 from suggestions s  where s.client_id  = c.id and s.property_id  = p.id)
    on conflict (property_id, client_id) do nothing
    returning 1
  )
  select count(*) into v_created from new_suggestions;
  return jsonb_build_object('suggestions_created', v_created);
end $$;

-- ---------------------------------------------------------------------------
-- approve_suggestion: suggestion -> inquiring pursuit
-- ---------------------------------------------------------------------------
create or replace function public.approve_suggestion(p_suggestion_id uuid)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_pursuit uuid; v_prop uuid; v_client uuid;
begin
  select property_id, client_id into v_prop, v_client from suggestions where id = p_suggestion_id;
  if v_prop is null then raise exception 'suggestion % not found', p_suggestion_id; end if;
  select id into v_pursuit from pursuits where client_id = v_client and property_id = v_prop limit 1;
  if v_pursuit is null then
    insert into pursuits (property_id, client_id, owner_id, stage, inquiry_date, flagged_new)
    select v_prop, v_client, c.owner_id, 'inquiring', current_date, true from clients c where c.id = v_client
    returning id into v_pursuit;
  end if;
  delete from suggestions where id = p_suggestion_id;
  return v_pursuit;
end $$;

-- ---------------------------------------------------------------------------
-- promote_client: flip a prospect to an active (signed) client
-- ---------------------------------------------------------------------------
create or replace function public.promote_client(p_client_id uuid)
returns public.clients language plpgsql as $$
declare v public.clients;
begin
  update public.clients set status='active' where id=p_client_id and status='prospect' returning * into v;
  if v.id is null then select * into v from public.clients where id=p_client_id; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- execute_pursuit: mark a pursuit executed + write the executed comp
-- ---------------------------------------------------------------------------
create or replace function public.execute_pursuit(p_pursuit_id uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
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
    update clients set status='closed' where id = (select client_id from pursuits where id = p_pursuit_id);
  end if;
  if coalesce((p->>'close_listing')::boolean, false) then
    update listings set stage='closed' where property_id = v_prop and status='active';
    update pursuits set stage='passed'
      where property_id = v_prop and id <> p_pursuit_id and stage not in ('executed','passed');
  end if;

  return jsonb_build_object('pursuit_id', p_pursuit_id, 'comp_id', v_comp);
end $$;

-- ---------------------------------------------------------------------------
-- create_property_and_listing: quick-add (recreated; new property_kind)
-- ---------------------------------------------------------------------------
create or replace function public.create_property_and_listing(
  p_owner uuid, p_address text, p_deal_type public.deal_type,
  p_city text default null, p_state text default null, p_property_type public.property_kind default null,
  p_landlord_company_id uuid default null, p_source public.lead_source default null,
  p_asking_rate_psf numeric default null, p_asking_price numeric default null)
returns public.listings language plpgsql as $$
declare new_property public.properties; new_listing public.listings;
begin
  insert into properties (address, city, state, property_type)
    values (p_address, p_city, p_state, p_property_type) returning * into new_property;
  insert into listings (owner_id, property_id, landlord_company_id, deal_type, source, asking_rate_psf, asking_price)
    values (p_owner, new_property.id, p_landlord_company_id, p_deal_type, p_source, p_asking_rate_psf, p_asking_price)
    returning * into new_listing;
  return new_listing;
end $$;
