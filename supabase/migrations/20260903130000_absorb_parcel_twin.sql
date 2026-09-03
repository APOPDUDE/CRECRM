-- Parcel-first identity, phase 2 (SQL half): once a scraped row gets its parcel stamped from
-- a county point lookup (enrich-appraiser, point lane), fold it into the property that
-- already holds that parcel -- when the house number agrees. Different house numbers on one
-- parcel stay separate (multi-building parcel, Alex 2026-09-03); the row keeps the parcel
-- number so it is at least ASSOCIATED with the parcel, and appraiser_data records the twin.
--
-- property_merge_log is the permanent home for merge pre-images (the dated
-- _rollback_property_merge_20260902 scratch table is copied in and can be dropped 2026-10-01).

create table if not exists property_merge_log (
  id bigserial primary key,
  batch text not null,
  survivor_id uuid not null,
  duplicate_id uuid not null,
  pre_image jsonb not null,
  moved jsonb,
  merged_at timestamptz not null default now()
);
alter table property_merge_log enable row level security;
create policy property_merge_log_auth_read on property_merge_log for select to authenticated using (true);
revoke all on property_merge_log from anon;

insert into property_merge_log (batch, survivor_id, duplicate_id, pre_image, moved, merged_at)
select batch, survivor_id, duplicate_id, pre_image, moved, merged_at
from _rollback_property_merge_20260902
where not exists (select 1 from property_merge_log l where l.duplicate_id = _rollback_property_merge_20260902.duplicate_id);

create or replace function absorb_parcel_twin(p_property uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me   record;
  twin record;
  r    jsonb;
begin
  select id, county, address, split_part(parcel_key, '|', 1) pk,
         substring(address from '^\s*(\d+)') hn,
         (address is null or address ~* '^parcel\M' or lower(btrim(address)) = 'address unavailable') placeholder
    into me
  from properties where id = p_property;
  if me.id is null then return jsonb_build_object('action', 'missing'); end if;
  if coalesce(me.pk, '') = '' then return jsonb_build_object('action', 'no_parcel'); end if;

  -- the property that already holds this parcel: county-synced, then oldest
  select p.id, p.address, substring(p.address from '^\s*(\d+)') hn
    into twin
  from properties p
  where p.id <> me.id
    and p.county = me.county
    and split_part(p.parcel_key, '|', 1) = me.pk
    and not coalesce(p.is_condo_unit, false)
  order by (p.county_synced_at is not null) desc, p.created_at
  limit 1;
  if twin.id is null then return jsonb_build_object('action', 'alone'); end if;

  -- a house number of 0 is the county's "no situs" placeholder, not a different building
  if me.placeholder or me.hn is null or twin.hn is null or me.hn = '0' or twin.hn = '0' or me.hn = twin.hn then
    begin
      r := merge_properties(twin.id, array[me.id]);
      insert into property_merge_log (batch, survivor_id, duplicate_id, pre_image, moved)
      select 'absorb_parcel_twin', twin.id, (d->>'id')::uuid, d, r->'moved'
      from jsonb_array_elements(r->'pre_image') d;
      return jsonb_build_object('action', 'merged', 'survivor', twin.id, 'moved', r->'moved');
    exception when others then
      update properties
         set appraiser_data = coalesce(appraiser_data, '{}'::jsonb)
                              || jsonb_build_object('shared_parcel', twin.id, 'merge_blocked', sqlerrm)
       where id = me.id;
      return jsonb_build_object('action', 'blocked', 'twin', twin.id, 'error', sqlerrm);
    end;
  end if;

  -- same parcel, different house number: associated, not merged
  update properties
     set appraiser_data = coalesce(appraiser_data, '{}'::jsonb) || jsonb_build_object('shared_parcel', twin.id)
   where id = me.id;
  return jsonb_build_object('action', 'shared_parcel', 'twin', twin.id, 'twin_address', twin.address);
end $$;

revoke all on function absorb_parcel_twin(uuid) from public, anon;
