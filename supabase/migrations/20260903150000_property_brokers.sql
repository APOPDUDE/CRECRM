-- Broker <-> property association as a real row (2026-09-03, Alex: "I added the broker
-- for 11612 N Florida and I don't see her on the property page"). The note-only design
-- buried the broker at the bottom of the page under Tenant feedback; a link table lets
-- the OWNER CARD show "owner's broker: Rania (813...)" and the contact page later list
-- what they represent. The property note stays - it carries the conversation detail.
create table public.property_brokers (
  property_id uuid not null references public.properties(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  role text not null default 'owner_broker',
  created_at timestamptz not null default now(),
  primary key (property_id, contact_id)
);
create index property_brokers_contact_idx on public.property_brokers(contact_id);

alter table public.property_brokers enable row level security;
create policy property_brokers_auth_all on public.property_brokers
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.property_brokers to authenticated;

-- intake_broker v5: also write the link row.
create or replace function public.intake_broker(p jsonb, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company_id uuid; v_contact_id uuid; v_property_id uuid;
  v_company text := nullif(p->>'brokerage','');
  v_email   text := nullif(lower(p->>'email'),'');
  v_phone   text := nullif(p->>'phone','');
  v_first   text := coalesce(nullif(p->>'first_name',''),'Unknown');
  v_full    text;
  v_addr    text := nullif(p->>'property_address','');
  v_lines   text[];
  v_body    text;
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

  select btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
    into v_full from contacts where id = v_contact_id;

  if v_addr is not null then
    select id into v_property_id from properties where lower(address)=lower(v_addr) limit 1;
    if v_property_id is null then
      insert into properties (address, city, state)
      values (v_addr, nullif(p->>'property_city',''), coalesce(nullif(p->>'property_state',''),'FL'))
      returning id into v_property_id;
    end if;

    insert into property_brokers (property_id, contact_id)
    values (v_property_id, v_contact_id)
    on conflict do nothing;

    insert into notes (body, property_id)
    values (array_to_string(array[
      '[Broker via call form] ' || v_full
        || case when v_company is not null then ' (' || v_company || ')' else '' end
        || ' - the owner''s broker for this property.',
      case when v_phone is not null or v_email is not null
           then 'Reach: ' || concat_ws(' | ', v_phone, v_email) end,
      case when nullif(p->>'brought','') is not null then 'Brought: ' || (p->>'brought') end,
      case when nullif(p->>'notes','') is not null then 'Notes: ' || (p->>'notes') end
    ], e'\n'), v_property_id);
  end if;

  v_lines := array['[Broker contact - via call form]'];
  if v_company is not null then v_lines := v_lines || ('Brokerage: ' || v_company); end if;
  if v_addr is not null then v_lines := v_lines || ('Represents the owner of: ' || v_addr); end if;
  if nullif(p->>'coverage','') is not null then v_lines := v_lines || ('Covers: ' || (p->>'coverage')); end if;
  if nullif(p->>'brought','') is not null then v_lines := v_lines || ('Brought: ' || (p->>'brought')); end if;
  if nullif(p->>'notes','') is not null then v_lines := v_lines || ('Notes: ' || (p->>'notes')); end if;
  if array_length(v_lines, 1) > 1 then
    v_body := array_to_string(v_lines, e'\n');
    update contacts set notes = case
      when notes is null or notes = '' then v_body
      else notes || e'\n\n--- ' || to_char(now() at time zone 'America/New_York', 'Mon DD') || e' ---\n' || v_body
    end
    where id = v_contact_id;
  end if;

  return jsonb_build_object('contact_id', v_contact_id, 'company_id', v_company_id,
                            'property_id', v_property_id);
end $function$;

revoke execute on function public.intake_broker(jsonb, uuid) from public, anon, authenticated;

-- Backfill the one live association logged before this table existed:
-- Rania (813-766-7111) -> 11612 N FLORIDA AVE (2026-09-03 call form submit).
insert into property_brokers (property_id, contact_id)
select 'abb0eb15-6226-40e0-be9c-47858f5cbf6f', c.id
from contacts c where normalize_phone(c.phone) = '8137667111'
on conflict do nothing;
