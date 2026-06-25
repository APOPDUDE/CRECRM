-- Finder sync (Layer A): human-readable folder naming for the deal-files bucket, derived live from the CRM.
-- Read-only naming (one view + one helper fn) + a unique(storage_path) for dedupe + Realtime on files so the
-- Mac listener gets instant cloud->local change events. This migration NEVER writes to storage.objects:
-- Storage is mutated only through the Storage API (rclone). Fully reversible (see context/plan-finder-storage-sync.md).

-- 1) Sanitize a string into a clean, valid object-key path segment. The hidden .crm-id marker (not the folder
--    name) is the durable link, so the name is purely cosmetic.
create or replace function public.fs_safe_name(p text)
returns text language sql immutable
set search_path = public, pg_temp as $$
  -- NOTE: keys must be ASCII. Supabase's S3-compatible endpoint returns HTTP 400 on HeadObject for keys
  -- containing multibyte UTF-8 (e.g. an em-dash or accented char), which would break rclone. So fold any
  -- non-printable-ASCII char to '-'. Spaces, parens, and hyphens are fine.
  select coalesce(
    nullif(
      btrim(
        left(
          regexp_replace(                                   -- collapse runs of hyphens
            regexp_replace(                                 -- collapse whitespace
              regexp_replace(                               -- non-printable-ASCII (em-dash, accents, ...) -> '-'
                regexp_replace(coalesce(p,''), '[/\\]', '-', 'g'),  -- path separators -> '-'
                '[^\x20-\x7E]', '-', 'g'),
              '\s+', ' ', 'g'),
            '-{2,}', '-', 'g'),
          80),                                              -- cap length
        ' .-'),                                             -- trim trailing space/dot/hyphen
      ''),
    '(unnamed)');                                           -- never empty
$$;

-- 2) Every CRM entity that should own a folder, with its full human path + .crm-id payload. The tree mirrors the
--    kanban boards: Landlord rep/<addr - landlord>/Prospects/<tenant - stage> and
--    Tenant rep/<client>/Prospects/<property - stage>. A pursuit's canonical side = Landlord rep when its property
--    has an active listing, else Tenant rep when its client is a repped open client (double-ended -> Landlord rep).
--    security_invoker so RLS is evaluated as the (authenticated) caller -- no SECURITY DEFINER view advisor.
create or replace view public.v_fs_entity
with (security_invoker = true) as
with
active_listing_on_property as (
  select property_id, id as listing_id from public.listings where status = 'active'
),
l_raw as (
  select l.id, l.created_at,
    public.fs_safe_name(concat_ws(' - ', pr.address,
      coalesce(nullif(co.name,''),
               nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)),'')))) as nm
  from public.listings l
  join public.properties pr on pr.id = l.property_id
  left join public.companies co on co.id = l.landlord_company_id
  left join public.contacts  ct on ct.id = l.landlord_contact_id
  where l.status = 'active'
    and pr.address is not null
    and pr.address not ilike '%unavailable%'
    and pr.address not ilike 'Portfolio of %'
),
l_rn as (
  select id, created_at, nm,
    row_number() over (partition by nm order by created_at, id) as rn from l_raw
),
listing_folder as (
  select id, 'Landlord rep/' || nm || case when rn > 1 then ' (' || rn || ')' else '' end as prefix from l_rn
),
c_raw as (
  select cl.id, cl.created_at,
    public.fs_safe_name(coalesce(nullif(co.name,''),
      nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)),''))) as nm
  from public.clients cl
  left join public.companies co on co.id = cl.company_id
  left join public.contacts  ct on ct.id = cl.contact_id
  where cl.is_rep and cl.status in ('prospect','searching','negotiating')
),
c_rn as (
  select id, created_at, nm,
    row_number() over (partition by nm order by created_at, id) as rn from c_raw
),
client_folder as (
  select id, 'Tenant rep/' || nm || case when rn > 1 then ' (' || rn || ')' else '' end as prefix from c_rn
),
client_name as (
  select cl.id,
    public.fs_safe_name(coalesce(nullif(co.name,''),
      nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)),''))) as nm
  from public.clients cl
  left join public.companies co on co.id = cl.company_id
  left join public.contacts  ct on ct.id = cl.contact_id
),
p_raw as (
  -- landlord-canonical: the property has an active listing
  select pu.id, pu.created_at, lf.prefix as parent_prefix,
    cn.nm || ' - ' || initcap(pu.stage::text) as pname
  from public.pursuits pu
  join active_listing_on_property al on al.property_id = pu.property_id
  join listing_folder lf on lf.id = al.listing_id
  join client_name cn on cn.id = pu.client_id
  union all
  -- tenant-canonical: no active listing on the property, and the client is a repped open client
  select pu.id, pu.created_at, cf.prefix as parent_prefix,
    public.fs_safe_name(pr.address) || ' - ' || initcap(pu.stage::text) as pname
  from public.pursuits pu
  join client_folder cf on cf.id = pu.client_id
  join public.properties pr on pr.id = pu.property_id
  where not exists (select 1 from active_listing_on_property al where al.property_id = pu.property_id)
),
p_rn as (
  select id, parent_prefix, pname,
    row_number() over (partition by parent_prefix, pname order by created_at, id) as rn from p_raw
),
pursuit_folder as (
  select id, parent_prefix || '/Prospects/' || pname || case when rn > 1 then ' (' || rn || ')' else '' end as prefix
  from p_rn
)
select 'listing'::text as entity_type, id as entity_id, prefix,
       jsonb_build_object('type','listing','id',id) as crm_id from listing_folder
union all
select 'client', id, prefix, jsonb_build_object('type','client','id',id) from client_folder
union all
select 'pursuit', id, prefix, jsonb_build_object('type','pursuit','id',id) from pursuit_folder;

grant select on public.v_fs_entity to authenticated;

-- 3) The upload folder for a given entity (used by the app's use-files.ts). listing/client files land in About/;
--    pursuit files in the pursuit folder; property files in the active listing's About (fallback Properties/<addr>).
create or replace function public.fs_entity_path(p_type text, p_id uuid)
returns text language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v text;
begin
  if p_type in ('listing','client') then
    select prefix || '/About' into v
      from public.v_fs_entity where entity_type = p_type and entity_id = p_id;
    return v;
  elsif p_type = 'pursuit' then
    select prefix into v
      from public.v_fs_entity where entity_type = 'pursuit' and entity_id = p_id;
    return v;
  elsif p_type = 'property' then
    select e.prefix || '/About' into v
      from public.listings l
      join public.v_fs_entity e on e.entity_type = 'listing' and e.entity_id = l.id
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

-- 4) Dedupe key: lets the app upsert its files row and the reconciler insert-if-absent without colliding.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'files_storage_path_key') then
    alter table public.files add constraint files_storage_path_key unique (storage_path);
  end if;
end $$;

-- 5) Realtime so the Mac listener reacts instantly: files (cloud->local file changes) + the deal tables
--    (a new/renamed/closed deal or stage change updates the folder tree). Idempotent.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['files','listings','clients','pursuits'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
