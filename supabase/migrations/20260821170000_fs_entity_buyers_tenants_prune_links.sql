-- Finder mirror, take 3: split the client side into Buyers/Tenants, stop generating folders that
-- never hold anything, and cross-link a listing-side pursuit back into its client's Prospects.
--
-- Three problems this fixes.
--
-- 1) A pursuit was filed in exactly ONE place: under the listing's Prospects when the property had
--    an active listing, otherwise under the client's Prospects. So Axis Partners' Frontage Road
--    deal (executed, on our own listing) lived only at
--      Landlord rep/Frontage Road - Powerscreen FLA/Prospects/Axis Partners
--    and was invisible from Buyers/Axis Partners/Prospects. The broker works both sides, so both
--    sides must show it. A folder can only exist once, so the canonical folder stays on the listing
--    side (that is where the files sync) and the client side gets a SYMLINK row (entity_type
--    'link', with the canonical prefix in target). rclone skips symlinks -- verified: it logs
--    "Can't follow symlink without -L/--copy-links" and exits 0 -- so links stay local to Finder
--    and never reach Storage. Stage is irrelevant: closed/executed deals link like any other.
--
-- 2) 238 generated folders held a real file in 8 of them. 119 of 177 pursuits are stage 'passed'
--    (zero files between them) and 35 clients had no pursuit and no file. Both now have to earn a
--    folder. Anything that gains a file or a live stage gets its folder back on the next reconcile.
--
-- 3) 'Tenant rep' held buyers and tenants in one flat list of 61. Buyers (sale/both deal_type, or
--    an investment purpose) now live under Buyers/, tenants under Tenants/.
--
-- Pruning a folder out of this view makes the reconciler quarantine it locally and queue a cloud
-- delete -- that is what took sync down for three weeks in 0045. Verified before applying: zero
-- files sit under any dropped client or pursuit. The one-time reconcile still needs a raised
-- CRMSYNC_MAX_DELETE because ~200 .crm-id/.keep marker objects go with them.
--
-- v_fs_entity_all is the UNPRUNED placement of every entity; v_fs_entity is the pruned tree the
-- reconciler builds plus the links. fs_entity_path() reads _all so an upload against a passed
-- pursuit still resolves a path -- the file then makes the folder reappear, no chicken-and-egg.

-- ---------------------------------------------------------------------------
-- 1) Every placement, unpruned, with a keep flag.
-- ---------------------------------------------------------------------------
create or replace view public.v_fs_entity_all
with (security_invoker = true) as
with active_listing_on_property as (
  select property_id, id as listing_id
    from listings
   where status = 'active'::engagement_status
),
kept_pursuit as (
  select pu.id
    from pursuits pu
   where pu.stage <> 'passed'::pursuit_stage
      or exists (select 1 from files f where f.pursuit_id = pu.id)
),
kept_client as (
  select cl.id
    from clients cl
   where cl.is_rep
     and cl.status <> 'lost'::client_status
     and ( exists (select 1 from pursuits p join kept_pursuit kp on kp.id = p.id where p.client_id = cl.id)
        or exists (select 1 from files f where f.client_id = cl.id)
        or cl.status not in ('prospect'::client_status, 'archived'::client_status) )
),
-- listings -------------------------------------------------------------------
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
-- clients --------------------------------------------------------------------
c_raw as (
  select cl.id, cl.created_at,
         -- a client shopping to buy (or doing both) is a buyer; investment purpose settles the
         -- lease-labelled 1031/portfolio cases. buyer_kind is NOT a test: it is set on tenants too.
         case when cl.deal_type in ('sale'::deal_type, 'both'::deal_type)
                or cl.purpose = 'investment'::client_purpose
              then 'Buyers' else 'Tenants' end as section,
         fs_safe_name(coalesce(nullif(co.name, ''), nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''))) as nm
    from clients cl
    left join companies co on co.id = cl.company_id
    left join contacts  ct on ct.id = cl.contact_id
   where cl.is_rep
     and cl.status <> 'lost'::client_status  -- closed (executed) deals stay; only lost is pruned
),
c_rn as (
  select id, created_at, section, nm,
         row_number() over (partition by section, nm order by created_at, id) as rn
    from c_raw
),
client_folder as (
  select id,
         section || '/' || nm || case when rn > 1 then ' (' || rn || ')' else '' end as prefix
    from c_rn
),
client_name as (
  select cl.id,
         fs_safe_name(coalesce(nullif(co.name, ''), nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''))) as nm
    from clients cl
    left join companies co on co.id = cl.company_id
    left join contacts  ct on ct.id = cl.contact_id
),
-- pursuits: canonical side ---------------------------------------------------
pu_place as (
  select pu.id, pu.created_at, pu.client_id, pu.property_id, al.listing_id
    from pursuits pu
    left join active_listing_on_property al on al.property_id = pu.property_id
),
ll_raw as (
  select p.id, p.created_at, p.client_id, lf.prefix as parent_prefix, cn.nm as pname
    from pu_place p
    join listing_folder lf on lf.id = p.listing_id
    join client_name   cn on cn.id = p.client_id
),
ll_rn as (
  select id, created_at, client_id, parent_prefix, pname,
         row_number() over (partition by parent_prefix, pname order by created_at, id) as rn
    from ll_raw
),
ll_folder as (
  select id, client_id,
         parent_prefix || '/Prospects/' || pname || case when rn > 1 then ' (' || rn || ')' else '' end as prefix
    from ll_rn
),
-- The client's Prospects namespace holds tenant-side canonical folders AND landlord-side links,
-- both named by address, so they must be de-duplicated against each other in one pass.
cs_raw as (
  select p.id, p.created_at, cf.prefix as parent_prefix, fs_safe_name(pr.address) as pname,
         'folder'::text as kind, null::text as link_target
    from pu_place p
    join client_folder cf on cf.id = p.client_id
    join properties    pr on pr.id = p.property_id
   -- no landlord-side folder claimed it (no listing, or the listing's address is unusable)
   where not exists (select 1 from ll_folder x where x.id = p.id)
  union all
  select p.id, p.created_at, cf.prefix, fs_safe_name(pr.address),
         'link'::text, llf.prefix
    from pu_place p
    join ll_folder     llf on llf.id = p.id
    join client_folder cf  on cf.id = p.client_id
    join properties    pr  on pr.id = p.property_id
),
cs_rn as (
  select id, created_at, parent_prefix, pname, kind, link_target,
         row_number() over (partition by parent_prefix, pname order by created_at, id) as rn
    from cs_raw
),
cs_entry as (
  select id, kind, link_target,
         parent_prefix || '/Prospects/' || pname || case when rn > 1 then ' (' || rn || ')' else '' end as prefix
    from cs_rn
)
select 'listing'::text as entity_type, lf.id as entity_id, lf.prefix,
       jsonb_build_object('type', 'listing', 'id', lf.id) as crm_id,
       null::text as target, true as keep
  from listing_folder lf
union all
select 'client', cf.id, cf.prefix,
       jsonb_build_object('type', 'client', 'id', cf.id),
       null, (kc.id is not null)
  from client_folder cf
  left join kept_client kc on kc.id = cf.id
union all
-- canonical pursuit folder: the landlord side when a listing claimed it, else the client side
select 'pursuit', f.id, f.prefix,
       jsonb_build_object('type', 'pursuit', 'id', f.id),
       null,
       (kp.id is not null)
  from ( select id, prefix from ll_folder
         union all
         select id, prefix from cs_entry where kind = 'folder' ) f
  left join kept_pursuit kp on kp.id = f.id
union all
-- the cross-reference: client-side symlink to a landlord-side canonical folder
select 'link', e.id, e.prefix,
       null::jsonb,
       e.link_target,
       (kp.id is not null and kc.id is not null)
  from cs_entry e
  join ll_folder llf on llf.id = e.id
  left join kept_pursuit kp on kp.id = e.id
  left join kept_client  kc on kc.id = llf.client_id
 where e.kind = 'link';

comment on view public.v_fs_entity_all is
  'Every Finder-mirror placement, including the ones pruned out of v_fs_entity. keep=false means the '
  'entity has earned no folder yet (passed pursuit / dormant client). Upload paths resolve here so a '
  'file can always be filed; the file then flips keep to true.';

-- ---------------------------------------------------------------------------
-- 2) The tree the reconciler actually builds.
-- ---------------------------------------------------------------------------
create or replace view public.v_fs_entity
with (security_invoker = true) as
select entity_type, entity_id, prefix, crm_id, target
  from public.v_fs_entity_all
 where keep;

comment on view public.v_fs_entity is
  'Folder tree for the Finder mirror. entity_type link = a symlink at prefix pointing at target '
  '(same pursuit shown under both its listing and its client); links carry no crm_id and are keyed '
  'by a pursuit id that also appears on its canonical folder row, so consumers must handle them '
  'separately from the folder rows.';

-- ---------------------------------------------------------------------------
-- 3) Upload paths resolve against the unpruned view.
-- ---------------------------------------------------------------------------
create or replace function public.fs_entity_path(p_type text, p_id uuid)
returns text language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v text;
begin
  if p_type in ('listing','client') then
    select prefix || '/About' into v
      from public.v_fs_entity_all
     where entity_type = p_type and entity_id = p_id;
    return v;
  elsif p_type = 'pursuit' then
    -- canonical folder only: never the link row, or the file would be written through a symlink
    select prefix into v
      from public.v_fs_entity_all
     where entity_type = 'pursuit' and entity_id = p_id;
    return v;
  elsif p_type = 'property' then
    select e.prefix || '/About' into v
      from public.listings l
      join public.v_fs_entity_all e on e.entity_type = 'listing' and e.entity_id = l.id
     where l.property_id = p_id and l.status = 'active'
     limit 1;
    if v is null then
      select 'Properties/' || public.fs_safe_name(address) into v from public.properties where id = p_id;
    end if;
    return v;
  end if;
  return null;
end $$;

revoke all on function public.fs_entity_path(text, uuid) from public;
grant execute on function public.fs_entity_path(text, uuid) to authenticated;

grant select on public.v_fs_entity     to authenticated;
grant select on public.v_fs_entity_all to authenticated;
revoke all on public.v_fs_entity_all from anon;  -- folder names leak deal/client identity
