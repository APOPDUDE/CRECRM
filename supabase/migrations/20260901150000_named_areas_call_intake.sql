-- Call-categories intake (2026-09-01)
-- 1. named_areas: county + city boundary rings so "type Lakeland" becomes a polygon
--    in clients.target_areas with zero drawing. Same {name, ring} convention as the
--    drawn areas (src/lib/clients.ts TargetArea / point_in_ring), so matching is unchanged.
-- 2. resolve_named_areas(): names -> TargetArea[] jsonb.
-- 3. intake_client v2: accepts the investor/buyer half of clients (buyer_kind, price
--    band, strategies, 1031, target areas by name or ring, rent budget) and MERGES
--    onto an existing open client instead of silently ignoring the new facts.
-- 4. intake_broker(): the "caller is a broker" branch of the call form - contact +
--    brokerage company (type broker) + a note, never a client/prospect.

-- 1 ─────────────────────────────────────────────────────────────────────────────
create table public.named_areas (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('county','city')),
  name text not null,               -- display name: 'Hillsborough County', 'Lakeland'
  county text,                      -- the county a city sits in (null for counties)
  state text not null default 'FL',
  rings jsonb not null check (jsonb_typeof(rings) = 'array'),  -- [ [[lat,lng],...], ... ]
  center_lat numeric,
  center_lng numeric,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

comment on table public.named_areas is
  'Public boundary polygons (Census cartographic, simplified) for counties + cities/CDPs. '
  'rings = array of outer rings [[lat,lng],...]; holes dropped on purpose - target areas '
  'are broker intent, not cadastral truth. Loaded by scripts/named-areas/.';

alter table public.named_areas enable row level security;
create policy named_areas_auth_read on public.named_areas
  for select to authenticated using (true);
grant select on public.named_areas to authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────────
-- Names in, TargetArea[] out. Accepts 'Hillsborough', 'Hillsborough County', 'Lakeland'
-- (case-insensitive); a multi-part boundary expands to one entry per part, suffixed #2+.
-- Unknown names are skipped, not errors - the caller shows what resolved.
create or replace function public.resolve_named_areas(p_names text[])
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'name', x.name || case when x.part > 1 then ' #' || x.part::text else '' end,
             'ring', x.ring)
           order by x.ord, x.part), '[]'::jsonb)
  from (
    select nm.ord, na.name, r.part, r.ring
    from unnest(coalesce(p_names, '{}')) with ordinality nm(raw, ord)
    cross join lateral (
      select a.name, a.rings
      from public.named_areas a
      where lower(a.name) = lower(btrim(nm.raw))
         or (a.kind = 'county' and lower(a.name) = lower(btrim(nm.raw) || ' county'))
      order by case a.kind when 'city' then 0 else 1 end
      limit 1
    ) na
    cross join lateral jsonb_array_elements(na.rings) with ordinality r(ring, part)
  ) x
$$;

grant execute on function public.resolve_named_areas(text[]) to authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────────
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
  v_reused  boolean := false;
  -- investor/buyer half (all optional; absent keys leave everything as before)
  v_buyer_kind public.buyer_kind := (nullif(p->>'buyer_kind',''))::public.buyer_kind;
  v_subclasses public.industrial_subclass[] :=
    case when nullif(p->>'product_subclasses','') is null then null
         else (select array_agg(t::public.industrial_subclass)
                 from unnest(string_to_array(p->>'product_subclasses', ',')) s(t)
                where btrim(t) <> '') end;
  v_strategies public.investment_strategy[] :=
    case when nullif(p->>'strategies','') is null then null
         else (select array_agg(t::public.investment_strategy)
                 from unnest(string_to_array(p->>'strategies', ',')) s(t)
                where btrim(t) <> '') end;
  v_price_min numeric := nullif(p->>'price_min','')::numeric;
  v_price_max numeric := nullif(p->>'price_max','')::numeric;
  v_1031 boolean := coalesce(nullif(p->>'exchange_1031','') in ('1','true','on','yes'), false);
  v_1031_deadline date := nullif(p->>'exchange_deadline','')::date;
  v_rent_min numeric := nullif(p->>'rent_budget_min','')::numeric;
  v_rent_max numeric := nullif(p->>'rent_budget_max','')::numeric;
  -- target areas: pre-built rings and/or names to resolve against named_areas
  v_areas jsonb := coalesce(
      case when jsonb_typeof(p->'target_areas') = 'array' then p->'target_areas' end, '[]'::jsonb)
    || public.resolve_named_areas(
         case when jsonb_typeof(p->'target_area_names') = 'array'
              then (select array_agg(e.v) from jsonb_array_elements_text(p->'target_area_names') e(v))
              when nullif(p->>'target_area_names','') is not null
              then string_to_array(p->>'target_area_names', ',')
              else null end);
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
      commission_pct, move_in_date,
      buyer_kind, product_subclasses, strategies, price_min, price_max,
      exchange_1031, exchange_deadline, rent_budget_min, rent_budget_max, target_areas)
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
      nullif(p->>'move_in_date','')::date,
      v_buyer_kind, coalesce(v_subclasses, '{}'), coalesce(v_strategies, '{}'),
      v_price_min, v_price_max, v_1031, case when v_1031 then v_1031_deadline end,
      v_rent_min, v_rent_max, v_areas)
    returning id into v_client_id;
  else
    v_reused := true;
    -- Merge the new facts onto the open client: fill blanks, never blank a filled field.
    -- A tenant who turns out to also buy (or vice versa) widens deal_type to 'both'.
    update clients c set
      company_id  = coalesce(c.company_id, v_company_id),
      source      = coalesce(c.source, v_source),
      broker_contact_id = coalesce(c.broker_contact_id, v_broker),
      purpose     = coalesce(c.purpose, (nullif(p->>'purpose',''))::public.client_purpose),
      property_type = coalesce(c.property_type, (nullif(p->>'property_type',''))::public.property_kind),
      target_markets = coalesce(c.target_markets, coalesce(nullif(p->>'target_markets',''), nullif(p->>'target_area',''))),
      budget      = coalesce(c.budget, nullif(p->>'budget','')),
      must_haves  = coalesce(c.must_haves, nullif(p->>'must_haves','')),
      building_sf_min = coalesce(c.building_sf_min, coalesce(nullif(p->>'building_sf_min','')::int, nullif(p->>'building_sf','')::int)),
      building_sf_max = coalesce(c.building_sf_max, nullif(p->>'building_sf_max','')::int),
      land_acres_min  = coalesce(c.land_acres_min, coalesce(nullif(p->>'land_acres_min','')::numeric, nullif(p->>'outdoor_acres','')::numeric)),
      land_acres_max  = coalesce(c.land_acres_max, nullif(p->>'land_acres_max','')::numeric),
      cap_rate_min    = coalesce(c.cap_rate_min, nullif(p->>'cap_rate_min','')::numeric),
      move_in_date    = coalesce(c.move_in_date, nullif(p->>'move_in_date','')::date),
      buyer_kind      = coalesce(c.buyer_kind, v_buyer_kind),
      product_subclasses = case when coalesce(array_length(c.product_subclasses,1),0) = 0
                                then coalesce(v_subclasses, c.product_subclasses) else c.product_subclasses end,
      strategies      = case when coalesce(array_length(c.strategies,1),0) = 0
                             then coalesce(v_strategies, c.strategies) else c.strategies end,
      price_min       = coalesce(c.price_min, v_price_min),
      price_max       = coalesce(c.price_max, v_price_max),
      exchange_1031   = c.exchange_1031 or v_1031,
      exchange_deadline = coalesce(c.exchange_deadline, case when v_1031 then v_1031_deadline end),
      rent_budget_min = coalesce(c.rent_budget_min, v_rent_min),
      rent_budget_max = coalesce(c.rent_budget_max, v_rent_max),
      target_areas    = c.target_areas || (
        select coalesce(jsonb_agg(a), '[]'::jsonb)
        from jsonb_array_elements(v_areas) a
        where not exists (
          select 1 from jsonb_array_elements(c.target_areas) e
          where e->>'name' = a->>'name')),
      deal_type = case
        when c.deal_type = 'both' then c.deal_type
        when nullif(p->>'deal_type','') is null then c.deal_type
        when c.deal_type::text = p->>'deal_type' then c.deal_type
        else 'both'::public.deal_type end
    where c.id = v_client_id;
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
                           'property_id', v_property_id, 'listing_id', v_listing_id, 'pursuit_id', v_pursuit_id,
                           'reused', v_reused);
end $function$;

-- 4 ─────────────────────────────────────────────────────────────────────────────
-- The caller IS a broker: contact + brokerage (company type 'broker') + a note on the
-- contact recording what they cover / what they brought. Deliberately NOT a client or
-- prospect - a broker relationship is a rolodex fact, not a pipeline card.
create or replace function public.intake_broker(p jsonb, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company_id uuid; v_contact_id uuid; v_note_id uuid;
  v_company text := nullif(p->>'brokerage','');
  v_email   text := nullif(lower(p->>'email'),'');
  v_phone   text := nullif(p->>'phone','');
  v_first   text := coalesce(nullif(p->>'first_name',''),'Unknown');
  v_lines   text[];
begin
  if normalize_phone(v_phone) is null and v_email is null then
    raise exception 'a phone or email is required for a broker contact';
  end if;

  if v_company is not null then
    select id into v_company_id from companies where lower(name)=lower(v_company) limit 1;
    if v_company_id is null then
      insert into companies (name, type, phone) values (v_company, 'broker', v_phone)
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
    values (v_company_id, v_first, nullif(p->>'last_name',''), v_email, v_phone,
            coalesce(nullif(p->>'title',''), 'Broker'))
    returning id into v_contact_id;
  else
    update contacts set
      company_id = coalesce(v_company_id, company_id),
      first_name = case when v_first <> 'Unknown' then v_first else first_name end,
      last_name  = coalesce(nullif(p->>'last_name',''), last_name),
      email      = coalesce(v_email, email),
      title      = coalesce(title, 'Broker')
    where id = v_contact_id;
  end if;

  v_lines := array['[Broker contact - via call form]'];
  if nullif(p->>'brokerage','') is not null then v_lines := v_lines || ('Brokerage: ' || (p->>'brokerage')); end if;
  if nullif(p->>'coverage','') is not null then v_lines := v_lines || ('Covers: ' || (p->>'coverage')); end if;
  if nullif(p->>'brought','') is not null then v_lines := v_lines || ('Brought: ' || (p->>'brought')); end if;
  if nullif(p->>'notes','') is not null then v_lines := v_lines || ('Notes: ' || (p->>'notes')); end if;
  if array_length(v_lines, 1) > 1 then
    insert into notes (body, contact_id) values (array_to_string(v_lines, e'\n'), v_contact_id)
    returning id into v_note_id;
  end if;

  return jsonb_build_object('contact_id', v_contact_id, 'company_id', v_company_id, 'note_id', v_note_id);
end $function$;

-- Service-role only door (n8n): keep authenticated/anon off the intake fns, matching
-- the anon-grant sweep posture. intake_client's existing grants are left as they are.
revoke execute on function public.intake_broker(jsonb, uuid) from public, anon, authenticated;
