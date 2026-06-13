-- Foundation for the Apify/n8n automation layer + lease-comp database.

-- new-listing flag → red tag on the tenant board card
alter table matches add column flagged_new boolean not null default false;

-- property provenance + scraped listing data (feeds the comp database; scraped
-- properties are stored even when they aren't our landlord-rep listings)
alter table properties
  add column source text,                 -- 'manual' | 'scrape' | 'landlord_rep'
  add column source_listing_id text,
  add column source_url text,
  add column listing_url text,
  add column asking_price numeric(14,2),
  add column asking_rate_psf numeric(10,2),
  add column cap_rate_pct numeric(6,3),
  add column broker_name text,
  add column broker_company text,
  add column broker_phone text,
  add column broker_email text,
  add column days_on_market integer,
  add column listed_at date,
  add column photo_urls text[],
  add column scraped_at timestamptz;
create index properties_source_listing_idx on properties(source_listing_id);

-- executed lease comps (rate, term, escalations, free rent, TI) — accumulates
-- from executed deals and, over time, scraped/asking data
create table lease_comps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  property_id uuid not null references properties(id) on delete cascade,
  match_id uuid references matches(id) on delete set null,
  tenant_company_id uuid references companies(id) on delete set null,
  sf integer,
  lease_rate_psf numeric(10,2),
  lease_type text,                         -- NNN | gross | modified gross
  term_months integer,
  escalations text,
  free_rent_months numeric(5,1),
  ti_psf numeric(10,2),
  commencement_date date,
  expiration_date date,
  executed_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lease_comps_property_idx on lease_comps(property_id);
create trigger lease_comps_updated_at before update on lease_comps
  for each row execute function set_updated_at();
alter table lease_comps enable row level security;
create policy lease_comps_auth_all on lease_comps for all to authenticated using (true) with check (true);

-- files can be tagged to a contact for queryability
alter table files add column contact_id uuid references contacts(id) on delete set null;
