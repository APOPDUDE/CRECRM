-- 0045: keep executed (closed) tenant-rep deals in the Finder sync folder tree.
--
-- v_fs_entity dropped clients the moment status left prospect/searching/negotiating, so marking
-- a deal closed made the sync reconciler quarantine its local folder and queue a mass cloud
-- delete that tripped bisync's --max-delete guard (sync hard-down since 2026-07-23; Stevens
-- Transport / Generational Roofing / Victoria Morillo folders missing locally).
-- Closed deals now keep their folders; only lost deals are pruned from the tree.

create or replace view public.v_fs_entity
with (security_invoker = true) as
with active_listing_on_property as (
  select property_id, id as listing_id
    from listings
   where status = 'active'::engagement_status
),
l_raw as (
  select l.id, l.created_at,
         fs_safe_name(concat_ws(' - ', pr.address,
           coalesce(nullif(co.name, ''), nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), '')))) as nm
    from listings l
    join properties pr on pr.id = l.property_id
    left join companies co on co.id = l.landlord_company_id
    left join contacts  ct on ct.id = l.landlord_contact_id
   where l.status = 'active'::engagement_status
     and pr.address is not null
     and pr.address not ilike '%unavailable%'
     and pr.address not ilike 'Portfolio of %'
),
l_rn as (
  select id, created_at, nm,
         row_number() over (partition by nm order by created_at, id) as rn
    from l_raw
),
listing_folder as (
  select id,
         'Landlord rep/' || nm || case when rn > 1 then ' (' || rn || ')' else '' end as prefix
    from l_rn
),
c_raw as (
  select cl.id, cl.created_at,
         fs_safe_name(coalesce(nullif(co.name, ''), nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''))) as nm
    from clients cl
    left join companies co on co.id = cl.company_id
    left join contacts  ct on ct.id = cl.contact_id
   where cl.is_rep
     and cl.status <> 'lost'::client_status  -- closed (executed) deals stay; only lost is pruned
),
c_rn as (
  select id, created_at, nm,
         row_number() over (partition by nm order by created_at, id) as rn
    from c_raw
),
client_folder as (
  select id,
         'Tenant rep/' || nm || case when rn > 1 then ' (' || rn || ')' else '' end as prefix
    from c_rn
),
client_name as (
  select cl.id,
         fs_safe_name(coalesce(nullif(co.name, ''), nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''))) as nm
    from clients cl
    left join companies co on co.id = cl.company_id
    left join contacts  ct on ct.id = cl.contact_id
),
p_raw as (
  select pu.id, pu.created_at, lf.prefix as parent_prefix, cn.nm as pname
    from pursuits pu
    join active_listing_on_property al on al.property_id = pu.property_id
    join listing_folder lf on lf.id = al.listing_id
    join client_name cn on cn.id = pu.client_id
  union all
  select pu.id, pu.created_at, cf.prefix as parent_prefix, fs_safe_name(pr.address) as pname
    from pursuits pu
    join client_folder cf on cf.id = pu.client_id
    join properties pr on pr.id = pu.property_id
   where not exists (select 1 from active_listing_on_property al where al.property_id = pu.property_id)
),
p_rn as (
  select id, parent_prefix, pname,
         row_number() over (partition by parent_prefix, pname order by created_at, id) as rn
    from p_raw
),
pursuit_folder as (
  select id,
         parent_prefix || '/Prospects/' || pname || case when rn > 1 then ' (' || rn || ')' else '' end as prefix
    from p_rn
)
select 'listing'::text as entity_type, id as entity_id, prefix,
       jsonb_build_object('type', 'listing', 'id', id) as crm_id
  from listing_folder
union all
select 'client'::text, id, prefix, jsonb_build_object('type', 'client', 'id', id)
  from client_folder
union all
select 'pursuit'::text, id, prefix, jsonb_build_object('type', 'pursuit', 'id', id)
  from pursuit_folder;
