-- Redesign C: every pursuit gets exactly one client_id + owner_id.

-- 1) a listing-only inquiry whose contact is already a client -> link to that client
update public.pursuits p
   set tenant_rep_id = c.id
  from public.clients c
 where p.tenant_rep_id is null
   and c.contact_id = p.tenant_contact_id;

-- 2) synthesize a lightweight client for any remaining listing-only inquiry
--    (a prospect IS a client; executed ones come in already-closed)
do $$
declare r record; v_client uuid;
begin
  for r in
    select p.id, p.tenant_contact_id, p.tenant_company_id, p.stage::text as stage,
           p.source, l.owner_id
    from public.pursuits p
    join public.listings l on l.id = p.listing_id
    where p.tenant_rep_id is null
  loop
    insert into public.clients (owner_id, contact_id, company_id, status, deal_type, source)
    values (r.owner_id, r.tenant_contact_id, r.tenant_company_id,
            (case when r.stage = 'executed' then 'closed' else 'prospect' end)::public.client_status,
            'lease', r.source)
    returning id into v_client;
    update public.pursuits set tenant_rep_id = v_client where id = r.id;
  end loop;
end $$;

-- 3) client_id is now mandatory
alter table public.pursuits rename column tenant_rep_id to client_id;
alter table public.pursuits alter column client_id set not null;

-- 4) owner_id on the pursuit (from its client)
alter table public.pursuits add column owner_id uuid;
update public.pursuits p set owner_id = c.owner_id from public.clients c where c.id = p.client_id;
alter table public.pursuits alter column owner_id set not null;
alter table public.pursuits add constraint pursuits_owner_id_fkey
  foreign key (owner_id) references auth.users(id);

-- 5) rename the surviving FK constraints to the pursuits_* vocabulary
alter table public.pursuits rename constraint matches_tenant_rep_id_fkey to pursuits_client_id_fkey;
alter table public.pursuits rename constraint matches_property_id_fkey   to pursuits_property_id_fkey;
