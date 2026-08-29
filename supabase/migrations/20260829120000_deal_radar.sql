-- Deal Radar: Facebook Marketplace industrial/land listings surfaced for
-- human-in-the-loop outreach. Rows are written by scripts/deal-radar/worker.mjs
-- (runs on the Mac, service role) and read/updated from the app UI.
--
-- external_id is the FB Marketplace listing id — the dedupe key across polls.
-- Nothing here auto-sends anything; status moves by hand from the UI.

create type deal_radar_type as enum ('industrial','land');
create type deal_radar_status as enum ('new','messaged','replied','negotiating','dead','converted');

create table deal_radar (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  title text not null,
  price numeric(14,2),
  location_text text,
  lat double precision,
  lng double precision,
  size_sqft integer,
  size_acres numeric(10,2),
  category text,
  listing_type deal_radar_type not null,
  listing_url text not null,
  thumbnail_url text,
  posted_at timestamptz,
  market text not null,
  keyword text,
  status deal_radar_status not null default 'new',
  found_at timestamptz not null default now(),
  messaged_at timestamptz,
  owner_phone text,
  owner_email text,
  notes text,
  property_id uuid references properties(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deal_radar_status_idx on deal_radar(status);
create index deal_radar_found_at_idx on deal_radar(found_at desc);
create index deal_radar_market_idx on deal_radar(market);

create trigger deal_radar_updated_at before update on deal_radar
  for each row execute function set_updated_at();

-- One row per worker cycle so the UI can surface "last poll / errors" without
-- reading a log file on the Mac.
create table deal_radar_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  searches integer not null default 0,
  hits integer not null default 0,
  inserted integer not null default 0,
  errors integer not null default 0,
  ok boolean,
  error_detail jsonb not null default '[]'::jsonb
);
create index deal_radar_runs_started_idx on deal_radar_runs(started_at desc);

alter table deal_radar enable row level security;
alter table deal_radar_runs enable row level security;

create policy deal_radar_auth_all on deal_radar
  for all to authenticated using (true) with check (true);
create policy deal_radar_runs_auth_all on deal_radar_runs
  for all to authenticated using (true) with check (true);

-- VA silo: prospecting radar is not the VA's surface. Initplan-wrapped form.
create policy deal_radar_va_deny on deal_radar
  as restrictive for all to authenticated
  using ((select not public.is_va())) with check ((select not public.is_va()));
create policy deal_radar_runs_va_deny on deal_radar_runs
  as restrictive for all to authenticated
  using ((select not public.is_va())) with check ((select not public.is_va()));
