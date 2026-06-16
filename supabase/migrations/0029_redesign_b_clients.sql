-- Redesign B: reshape clients (was tenant_reps)

-- 1) fold sparse industrial fields into must_haves before dropping them
update public.clients set must_haves = nullif(trim(both E'\n ' from concat_ws(E'\n',
    nullif(must_haves,''),
    case when office_sf_min is not null or office_sf_max is not null
         then 'Office SF: '||coalesce(office_sf_min::text,'?')||'-'||coalesce(office_sf_max::text,'?') end,
    case when clear_height is not null       then 'Clear height: '||clear_height end,
    case when power_requirements is not null then 'Power: '||power_requirements end,
    case when loading_type is not null       then 'Loading: '||loading_type end
  )), '');

-- 2) new lifecycle status combining old engagement_status + tenant_rep_stage
alter table public.clients add column status_new public.client_status;
update public.clients set status_new = case
    when status = 'lost'     then 'lost'
    when stage  = 'executed' then 'closed'
    else 'active' end::public.client_status;
alter table public.clients drop column stage;
alter table public.clients drop column status;
alter table public.clients rename column status_new to status;
alter table public.clients alter column status set default 'prospect';
alter table public.clients alter column status set not null;

-- 3) drop dead / folded columns + the probability check
alter table public.clients drop constraint if exists tenant_reps_probability_pct_check;
alter table public.clients drop column estimated_fee;
alter table public.clients drop column probability_pct;
alter table public.clients drop column office_sf_min;
alter table public.clients drop column office_sf_max;
alter table public.clients drop column clear_height;
alter table public.clients drop column power_requirements;
alter table public.clients drop column loading_type;

-- 4) rename columns to the new vocabulary
alter table public.clients rename column tenant_contact_id       to contact_id;
alter table public.clients rename column tenant_company_id       to company_id;
alter table public.clients rename column warehouse_sf_min        to building_sf_min;
alter table public.clients rename column warehouse_sf_max        to building_sf_max;
alter table public.clients rename column outdoor_storage_min_ac  to land_acres_min;
alter table public.clients rename column outdoor_storage_max_ac  to land_acres_max;
alter table public.clients rename column target_area             to target_markets;
alter table public.clients rename column next_action_description to next_action;
alter table public.clients alter column contact_id set not null;

-- 5) new fields
alter table public.clients add column purpose public.client_purpose;
alter table public.clients add column cap_rate_min numeric(5,2);

-- 6) constraints + dedupe index
alter table public.clients add constraint clients_size_order
  check (building_sf_max is null or building_sf_min is null or building_sf_max >= building_sf_min);
create unique index uq_active_client_per_contact
  on public.clients (owner_id, contact_id) where status in ('prospect','active');

-- 7) rename fk + check constraints to the clients_* vocabulary
alter table public.clients rename constraint tenant_reps_tenant_company_id_fkey to clients_company_id_fkey;
alter table public.clients rename constraint tenant_reps_tenant_contact_id_fkey to clients_contact_id_fkey;
alter table public.clients rename constraint tenant_reps_broker_contact_id_fkey to clients_broker_contact_id_fkey;
alter table public.clients rename constraint tenant_reps_owner_id_fkey          to clients_owner_id_fkey;
alter table public.clients rename constraint tenant_reps_broker_needs_contact   to clients_broker_needs_contact;
