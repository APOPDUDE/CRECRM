create extension if not exists "pgcrypto";

create type company_type as enum ('landlord','tenant','broker','other');
create type property_kind as enum ('industrial','office','retail','flex','land','other');
create type deal_type as enum ('lease','sale');
create type listing_stage as enum ('proposal','listed','closed');
create type tenant_rep_stage as enum ('lead','touring','loi','lease_negotiation','executed');
create type match_stage as enum ('lead','toured','loi','lease_negotiation','executed','dead');
create type engagement_status as enum ('active','lost');
create type lead_source as enum ('loopnet','sign_call','cold_call','email','text','website','referral','broker');
create type note_entity as enum ('listing','tenant_rep','match');
create type file_category as enum ('listing_agreement','rep_agreement','marketing','loi','lease','psa','coi_insurance','guarantee','financials','other');

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type company_type not null default 'other',
  phone text,
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  first_name text not null,
  last_name text,
  title text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  city text,
  state text,
  zip text,
  property_type property_kind,
  building_sf integer,
  land_acres numeric(10,2),
  specs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  property_id uuid not null references properties(id),
  landlord_company_id uuid references companies(id),
  landlord_contact_id uuid references contacts(id),
  deal_type deal_type not null,
  stage listing_stage not null default 'proposal',
  status engagement_status not null default 'active',
  lost_reason text,
  source lead_source,
  broker_contact_id uuid references contacts(id),
  asking_rate_psf numeric(10,2),
  asking_price numeric(14,2),
  commission_pct numeric(5,2),
  co_broke_split_pct numeric(5,2),
  estimated_fee numeric(14,2),
  actual_fee numeric(14,2),
  probability_pct integer check (probability_pct between 0 and 100),
  listing_expiration date,
  landlord_requirements text,
  next_action_description text,
  next_action_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listings_broker_needs_contact
    check (source is distinct from 'broker' or broker_contact_id is not null)
);

create table tenant_reps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  tenant_company_id uuid references companies(id),
  tenant_contact_id uuid references contacts(id),
  stage tenant_rep_stage not null default 'lead',
  status engagement_status not null default 'active',
  lost_reason text,
  source lead_source,
  broker_contact_id uuid references contacts(id),
  size_min_sf integer,
  size_max_sf integer,
  property_type property_kind,
  target_area text,
  budget text,
  must_haves text,
  commission_pct numeric(5,2),
  estimated_fee numeric(14,2),
  actual_fee numeric(14,2),
  probability_pct integer check (probability_pct between 0 and 100),
  next_action_description text,
  next_action_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_reps_broker_needs_contact
    check (source is distinct from 'broker' or broker_contact_id is not null)
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  tenant_company_id uuid references companies(id),
  tenant_contact_id uuid references contacts(id),
  listing_id uuid references listings(id) on delete cascade,
  tenant_rep_id uuid references tenant_reps(id) on delete cascade,
  stage match_stage not null default 'lead',
  source lead_source,
  broker_contact_id uuid references contacts(id),
  inquiry_date date not null default current_date,
  tour_date date,
  execution_date date,
  commencement_date date,
  lease_expiration date,
  psa_execution_date date,
  dd_expiration_date date,
  closing_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_must_have_side
    check (listing_id is not null or tenant_rep_id is not null),
  constraint matches_tenant_identity
    check (tenant_rep_id is not null or tenant_contact_id is not null),
  constraint matches_broker_needs_contact
    check (source is distinct from 'broker' or broker_contact_id is not null)
);

create index matches_listing_idx on matches(listing_id);
create index matches_tenant_rep_idx on matches(tenant_rep_id);
create index matches_property_idx on matches(property_id);
create index matches_tenant_company_idx on matches(tenant_company_id);

create table notes (
  id uuid primary key default gen_random_uuid(),
  entity_type note_entity not null,
  entity_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index notes_entity_idx on notes(entity_type, entity_id);

create table files (
  id uuid primary key default gen_random_uuid(),
  entity_type note_entity not null,
  entity_id uuid not null,
  category file_category not null default 'other',
  file_name text not null,
  storage_path text not null,
  file_size bigint,
  mime_type text,
  uploaded_at timestamptz not null default now()
);
create index files_entity_idx on files(entity_type, entity_id);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','properties','listings','tenant_reps','matches']
  loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

alter table companies enable row level security;
alter table contacts enable row level security;
alter table properties enable row level security;
alter table listings enable row level security;
alter table tenant_reps enable row level security;
alter table matches enable row level security;
alter table notes enable row level security;
alter table files enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','properties','listings','tenant_reps','matches','notes','files']
  loop
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_auth_all', t);
  end loop;
end $$;

insert into storage.buckets (id, name, public) values ('deal-files','deal-files', false);

create policy "deal_files_auth_read" on storage.objects for select to authenticated using (bucket_id = 'deal-files');
create policy "deal_files_auth_write" on storage.objects for insert to authenticated with check (bucket_id = 'deal-files');
create policy "deal_files_auth_update" on storage.objects for update to authenticated using (bucket_id = 'deal-files');
create policy "deal_files_auth_delete" on storage.objects for delete to authenticated using (bucket_id = 'deal-files');
