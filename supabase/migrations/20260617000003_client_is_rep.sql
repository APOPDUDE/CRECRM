-- Distinguish tenants the broker actually represents from landlord-side prospects.
--   is_rep = true  -> shows on the tenant-rep client kanban (Prospect/Searching/Negotiating/Closed)
--   is_rep = false -> a prospect that only exists on a landlord listing's board (not repped)
-- This lets the Prospect column return to the tenant board while keeping landlord-side
-- prospects (e.g. tenants added to a listing via "Add tenant -> No") off it.

alter table clients add column if not exists is_rep boolean not null default true;

-- Every current 'prospect' is landlord-side (the only path to that status is the landlord
-- board's "Add tenant -> No"), so hide them from the tenant kanban. Everything else is repped.
update clients set is_rep = false where status = 'prospect';

comment on column clients.is_rep is
  'True when the broker represents this tenant (appears on the tenant-rep kanban, any status). False for landlord-side prospects that live only on a listing board.';

-- New tenant-rep intakes now start in Prospect (a lead being courted); the broker moves them
-- to Searching to turn on automatic matching. is_rep defaults true so they show on the kanban.
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
      commission_pct, move_in_date)
    values (p_owner, v_company_id, v_contact_id, 'prospect',
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

-- Promoting a client to tenant rep marks it repped (so it shows on the kanban) and starts its search.
create or replace function public.promote_client(p_client_id uuid)
 returns clients
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare v public.clients;
begin
  update public.clients
    set is_rep = true,
        status = case when status = 'prospect' then 'searching'::client_status else status end
  where id = p_client_id
  returning * into v;
  if v.id is null then select * into v from public.clients where id = p_client_id; end if;
  return v;
end $function$;
