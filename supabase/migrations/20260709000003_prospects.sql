-- Prospecting: a lightweight pre-pipeline lead — a contact (and/or company), one or more
-- properties, a short description, and tasks — that can later be PUSHED into either
-- pipeline: landlord rep (one 'proposal' listing per attached property, the contact as
-- landlord) or tenant rep (a 'searching' client + one 'inquiring' pursuit per property).
-- Conversion is a single SECURITY DEFINER RPC so automations can drive it too.

create type prospect_status as enum ('open','converted','dead');

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  description text,
  status prospect_status not null default 'open',
  converted_to text check (converted_to in ('listing','client')),
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospects_need_identity check (contact_id is not null or company_id is not null)
);
create index prospects_status_idx on public.prospects(status);

create table public.prospect_properties (
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (prospect_id, property_id)
);
create index prospect_properties_property_idx on public.prospect_properties(property_id);

alter table public.tasks
  add column if not exists prospect_id uuid references public.prospects(id) on delete set null;
create index if not exists tasks_prospect_idx on public.tasks(prospect_id);

create trigger prospects_updated_at before update on public.prospects
  for each row execute function set_updated_at();

alter table public.prospects enable row level security;
alter table public.prospect_properties enable row level security;
create policy prospects_auth_all on public.prospects
  for all to authenticated using (true) with check (true);
create policy prospect_properties_auth_all on public.prospect_properties
  for all to authenticated using (true) with check (true);

-- Push a prospect into a pipeline. target 'listing' -> landlord rep (needs >=1 property);
-- target 'client' -> tenant rep (needs a contact; clients.contact_id is NOT NULL).
-- Open prospect tasks follow the deal (first listing / the client).
create or replace function public.convert_prospect(
  p_prospect_id uuid, p_target text, p_deal_type deal_type default 'lease')
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_p prospects%rowtype;
  v_company uuid;
  v_client uuid; v_listing uuid; v_pursuit uuid; v_prop uuid;
  v_listing_ids uuid[] := '{}'; v_pursuit_ids uuid[] := '{}';
begin
  select * into v_p from prospects where id = p_prospect_id for update;
  if not found then raise exception 'prospect % not found', p_prospect_id; end if;
  if v_p.status <> 'open' then raise exception 'prospect already %', v_p.status; end if;
  if p_target not in ('listing','client') then
    raise exception 'target must be listing or client';
  end if;

  -- company: explicit on the prospect, else the contact's company
  select coalesce(v_p.company_id, c.company_id) into v_company
    from (select 1) one left join contacts c on c.id = v_p.contact_id;

  if p_target = 'listing' then
    if not exists (select 1 from prospect_properties where prospect_id = p_prospect_id) then
      raise exception 'attach at least one property before pushing to landlord rep';
    end if;
    for v_prop in
      select property_id from prospect_properties where prospect_id = p_prospect_id
    loop
      insert into listings (owner_id, property_id, landlord_company_id, landlord_contact_id,
                            deal_type, stage, status)
      values (v_p.owner_id, v_prop, v_company, v_p.contact_id, p_deal_type, 'proposal', 'active')
      returning id into v_listing;
      v_listing_ids := v_listing_ids || v_listing;
    end loop;
    update tasks set listing_id = v_listing_ids[1]
     where prospect_id = p_prospect_id and status = 'open' and listing_id is null;
  else
    if v_p.contact_id is null then
      raise exception 'a contact is required to push to tenant rep';
    end if;
    -- One ACTIVE client per contact (uq_active_client_per_contact): reuse it when present,
    -- promoting it onto the tenant board (is_rep) and out of 'prospect' status.
    select id into v_client from clients
     where owner_id = v_p.owner_id and contact_id = v_p.contact_id
       and status in ('prospect','searching','negotiating')
     limit 1;
    if v_client is null then
      insert into clients (owner_id, company_id, contact_id, status, is_rep, deal_type)
      values (v_p.owner_id, v_company, v_p.contact_id, 'searching', true, p_deal_type)
      returning id into v_client;
    else
      update clients
         set is_rep = true,
             status = case when status = 'prospect' then 'searching' else status end
       where id = v_client;
    end if;
    for v_prop in
      select property_id from prospect_properties where prospect_id = p_prospect_id
    loop
      if not exists (select 1 from pursuits where client_id = v_client and property_id = v_prop) then
        insert into pursuits (property_id, client_id, owner_id, stage, inquiry_date)
        values (v_prop, v_client, v_p.owner_id, 'inquiring', current_date)
        returning id into v_pursuit;
        v_pursuit_ids := v_pursuit_ids || v_pursuit;
      end if;
    end loop;
    update tasks set client_id = v_client
     where prospect_id = p_prospect_id and status = 'open' and client_id is null;
  end if;

  update prospects
     set status = 'converted', converted_to = p_target, converted_at = now()
   where id = p_prospect_id;

  return jsonb_build_object('target', p_target, 'client_id', v_client,
    'listing_ids', to_jsonb(v_listing_ids), 'pursuit_ids', to_jsonb(v_pursuit_ids));
end $$;

grant execute on function public.convert_prospect(uuid, text, deal_type) to authenticated, service_role;
revoke execute on function public.convert_prospect(uuid, text, deal_type) from anon, public;
