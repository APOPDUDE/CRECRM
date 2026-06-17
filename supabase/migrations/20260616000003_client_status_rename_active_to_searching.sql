-- Rename client_status 'active' -> 'searching' (existing rows relabel in place) and
-- update the functions/index that referenced the client_status 'active' literal.
-- 'negotiating' clients deliberately get NO new suggestions (cross_reference matches
-- only 'searching'). NOTE: execute_pursuit's 'active' is listings.engagement_status, unchanged.
alter type client_status rename value 'active' to 'searching';

create or replace function public.cross_reference(p_property_ids uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_created int := 0;
begin
  with new_suggestions as (
    insert into suggestions (property_id, client_id, status)
    select p.id, c.id, 'pending'
    from properties p
    join clients c on c.status = 'searching'
    where p.id = any(p_property_ids)
      and p.source = 'scrape'
      and (c.property_type is null or p.property_type is null or c.property_type = p.property_type)
      and (
        case when c.deal_type = 'sale' then
          (c.building_sf_min is null or p.building_sf is null or p.building_sf >= c.building_sf_min * 0.8)
          and (c.building_sf_max is null or p.building_sf is null or p.building_sf <= c.building_sf_max * 1.25)
        else
          (c.building_sf_min is null or coalesce(p.space_sf_max, p.building_sf) is null or coalesce(p.space_sf_max, p.building_sf) >= c.building_sf_min * 0.8)
          and (c.building_sf_max is null or coalesce(p.space_sf_min, p.building_sf) is null or coalesce(p.space_sf_min, p.building_sf) <= c.building_sf_max * 1.25)
        end
      )
      and (
        (c.deal_type = 'lease' and p.asking_rate_psf is not null) or
        (c.deal_type = 'sale'  and p.asking_price   is not null) or
        (c.deal_type = 'both'  and (p.asking_rate_psf is not null or p.asking_price is not null))
      )
      and (c.target_markets is null or (p.city is not null and c.target_markets ilike '%' || p.city || '%'))
      and (
        c.purpose is distinct from 'investment'
        or (
          p.asking_price is not null
          and (p.cap_rate_pct is null or c.cap_rate_min is null or p.cap_rate_pct >= c.cap_rate_min)
          and (
               p.cap_rate_pct is not null
            or p.occupancy ~ '[0-9]'
            or p.sale_type ilike '%investment%'
            or p.sale_conditions ~* 'exchange|investment|triple net|net lease|leased|portfolio'
            or p.opportunity_zone is true
          )
        )
      )
      and not exists (select 1 from pursuits   pu where pu.client_id = c.id and pu.property_id = p.id)
      and not exists (select 1 from suggestions s  where s.client_id  = c.id and s.property_id  = p.id)
    on conflict (property_id, client_id) do nothing
    returning 1
  )
  select count(*) into v_created from new_suggestions;
  return jsonb_build_object('suggestions_created', v_created);
end $function$;

create or replace function public.promote_client(p_client_id uuid)
 returns clients
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare v public.clients;
begin
  update public.clients set status='searching' where id=p_client_id and status='prospect' returning * into v;
  if v.id is null then select * into v from public.clients where id=p_client_id; end if;
  return v;
end $function$;

-- intake_client: find existing client across all live statuses; new client starts 'searching'.
create or replace function public.intake_client(p jsonb, p_owner uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
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

  if v_email is not null then select id into v_contact_id from contacts where lower(email)=v_email limit 1; end if;
  if v_contact_id is null and v_phone is not null then select id into v_contact_id from contacts where phone=v_phone limit 1; end if;
  if v_contact_id is null then
    insert into contacts (company_id, first_name, last_name, email, phone, title)
    values (v_company_id, v_first, nullif(p->>'last_name',''), v_email, v_phone, nullif(p->>'title',''))
    returning id into v_contact_id;
  end if;

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

  select id into v_client_id from clients
   where owner_id=p_owner and contact_id=v_contact_id and status in ('prospect','searching','negotiating')
   order by created_at limit 1;
  if v_client_id is null then
    insert into clients (owner_id, company_id, contact_id, status, deal_type, source, broker_contact_id,
      purpose, property_type, target_markets, budget, must_haves,
      building_sf_min, building_sf_max, land_acres_min, land_acres_max, cap_rate_min,
      commission_pct, move_in_date, move_in_context)
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
      nullif(p->>'move_in_date','')::date, nullif(p->>'move_in_context',''))
    returning id into v_client_id;
  end if;

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
end $function$;

drop index if exists uq_active_client_per_contact;
create unique index uq_active_client_per_contact on public.clients (owner_id, contact_id)
  where status in ('prospect','searching','negotiating');
