# CRE Brokerage CRM — Build Spec for Cursor / Claude Code

Use this as the project's `CLAUDE.md` (Claude Code) or `.cursorrules` companion (Cursor). Build **one phase at a time, in order**. Do not start a phase until the previous phase's acceptance criteria pass.

## What this app is

A commercial real estate brokerage CRM built around one core idea: **a deal is a match between a tenant and a property, and the broker works both sides.** Landlord Rep = representing a property, moving many tenant prospects through it. Tenant Rep = representing a tenant, moving many candidate properties through them. Both views are powered by the same underlying `matches` record, so the two pipelines feel seamless.

v1 scope is exactly: two pipelines with nested boards, match records, contacts/companies, a thin properties table, and file attachments. Nothing else.

## Stack (fixed — do not substitute)

- **Frontend**: Vite + React + TypeScript, Tailwind CSS, shadcn/ui components, React Router, TanStack Query, dnd-kit (kanban drag-and-drop), date-fns
- **Backend**: Supabase cloud project (Postgres, Auth email/password, Storage). No local Supabase — the hosted project is the only environment.
- **Hosting**: GitHub repo → Vercel (auto-deploy on push to main). The production URL is how the app is used on phone.
- **PWA**: web manifest + icons so the app installs to a phone home screen. No service-worker complexity beyond basic installability.

## Non-negotiable foundation rules

1. The database will later be written to by external automations (n8n + Slack voice/form intake) **without the UI**. Every rule must live in Postgres: enums as real Postgres enums, FKs, CHECK constraints, RLS. No business rule may exist only in frontend code.
2. Stable snake_case names everywhere. Never rename tables/columns after Phase 1 without a migration.
3. All schema changes go through SQL migration files committed to the repo (`supabase/migrations/`). Apply them via the Supabase MCP or SQL editor — never ad-hoc UI table edits.
4. Single user today, team-ready: `owner_id` on listings and tenant_reps. RLS policies are written per-table now (authenticated full access), tightened per-owner later.
5. Generate TypeScript types from the live schema (`supabase gen types typescript`) and use them — no hand-written DB types.

## Phase 0 — Human setup checklist (Alex does this, not the agent)

1. Create a Supabase project at supabase.com (free tier fine). Save the project URL + anon key.
2. Create a GitHub repo `cre-crm`.
3. Create a Vercel account, import the repo, set env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. In Cursor/Claude Code, connect the Supabase MCP server (scoped to this project) so the agent can run migrations and inspect schema.
5. Create your login user in Supabase Auth (email/password); disable public signups.

## Phase 1 — Database schema

Create one migration containing the full schema below (full SQL at the bottom of this document). Then generate TypeScript types.

**Acceptance:** all tables/enums exist in Supabase; constraints verified (a match with neither listing_id nor tenant_rep_id is rejected; source='broker' without broker_contact_id is rejected); RLS enabled on every table; types generated.

## Phase 2 — App scaffold + auth

Vite + React + TS + Tailwind + shadcn/ui + Router + TanStack Query. Login page (email/password via Supabase Auth), protected routes, app shell: left sidebar (Dashboard, Landlord Rep, Tenant Rep, Contacts, Companies, Properties), top breadcrumb bar, toast system.

**Acceptance:** deployed to Vercel; can log in on desktop and phone; unauthenticated users see only the login page.

## Phase 3 — Contacts, companies, properties (plumbing)

Searchable list pages + create/edit modals for all three. Company type field (landlord | tenant | broker | other). Property form: address (required), city/state/zip, property_type, building_sf, land_acres, specs. Detail pages can be stubs for now (they get association views in Phase 5).

**Acceptance:** full CRUD on all three entities from the UI; search works; phone layout usable.

## Phase 4 — Pipelines (level 1)

- **Landlord Rep page**: tabs For Lease / For Sale. Kanban: Proposal → Listed → Closed. Cards = listings showing property address, landlord company, rate/price, match-count badge ("5 prospects"), hottest match stage chip, red dot when next action overdue. **Add Property button**: one modal creates property + listing together (address, landlord pick/create, property type, rate or price, source) — under 30 seconds.
- **Tenant Rep page**: kanban Lead → Touring → LOI → Lease Negotiation → Executed. Cards = tenant_reps showing company, size requirement summary, source badge, properties-in-play count, overdue dot. **Add Tenant button**: contact/company pick/create, one-line requirements, source.
- Both: drag-and-drop stage changes with undo toast; toggle to sortable/filterable table view; filters status (default Active) + deal type. Marking Lost prompts for lost_reason and offers to mark open matches Dead.
- Stage/status are independent; Lost is a status, not a column.

**Acceptance:** can create listings and tenant reps via quick-add; drag cards between stages; lost deals leave the board but appear in table view filtered.

## Phase 5 — Boards + matches (levels 2 and 3 — the heart)

- **Property board** (click a listing card): breadcrumb `Landlord Rep / 123 Main St`. Kanban Lead → Toured → LOI → Lease Negotiation → Executed; sale listings relabel columns Offer / PSA Negotiation / PSA Executed (same underlying enum). Cards = matches: tenant company/contact, source badge (broker source shows broker name), days since inquiry. Dropping onto Toured prompts for tour_date. Right sidebar: landlord contact card, terms (rate/price, commission, listing expiration), landlord_requirements, listing files, notes log. **Add Tenant button** creates a match: contact/company pick/create + source + date (defaults today).
- **Tenant board** (click a tenant rep card): breadcrumb `Tenant Rep / Acme Logistics`. Kanban Touring → LOI → Lease Negotiation → Executed. Cards = matches (properties): address, "My listing" badge when listing_id set, days in stage. **Add Property button**: search existing properties/my listings or inline-create outside property (address only). Right sidebar: tenant contact, requirements, source, rep agreement file, notes log.
- **Match slide-over** (click any match card): slide-over panel, not a page change. Tabs: Overview (stage, source, inquiry/tour dates, transaction dates), Files, Notes. When both listing_id and tenant_rep_id are set, show links to both parent boards. One record — moving it on either board moves it everywhere.
- **Promote to Tenant Rep**: button on a match/contact creates a tenant_reps row prefilled from the contact/company and sets tenant_rep_id on that tenant's existing matches.
- **Stage sync (prompt, never force)**: match → Executed prompts for actual_fee + transaction dates, then "Mark listing Closed?" and "Move tenant to Executed?" where linked. A tenant's furthest match advancing past the client's stage suggests bumping the client.

**Acceptance:** the dual-sided flow works end to end — create a listing, add a tenant inquiry with source, promote them to tenant rep, see the same match card on both boards, drag it to Executed from either side, and watch the sync prompts fire.

## Phase 6 — Files + executed documentation checklist

Drag-and-drop upload zones on listings, tenant reps, and matches; category select on upload (listing_agreement, rep_agreement, marketing, loi, lease, psa, coi_insurance, guarantee, financials, other). List with name, category chip, size, date. PDF/image preview in modal, rename, delete with confirm, per-file download, download-all zip. Supabase Storage bucket `deal-files` (private), foldered `{entity_type}/{entity_id}/`. **Executed checklist**: when a match reaches Executed, show checklist — Executed lease (or PSA), Insurance COI, Guarantee — each auto-checks when a file of that category exists on the match; unchecked items render amber.

**Acceptance:** upload/preview/rename/delete/download works on all three entity types; checklist auto-checks from uploads.

## Phase 7 — Dashboard

Per-pipeline summary cards (active counts by stage, total estimated fees, weighted = estimated_fee × probability_pct). Overdue next actions in red across listings + tenant reps. Upcoming 30 days: listing expirations, DD expirations, closings, commencements, lease expirations. Recent inquiries feed (latest matches, with source badges). Everything clicks through.

**Acceptance:** dashboard numbers reconcile with table-view counts; date items link to the right records.

## Phase 8 — Polish + PWA

Contact/company/property detail pages get full association views (their listings, tenant reps, matches with property/source/stage/tour date, files). Empty states that teach ("No tenant inquiries yet — Add Tenant"). PWA manifest + icons, responsive pass on boards (horizontal scroll columns on phone), currency formatting $1,234,567 and $X.XX PSF, undo toasts audited.

**Acceptance:** installable on iPhone home screen; boards usable on phone; all association views populated.

## Design rules

Clean, light, professional — Linear/Notion feel. White/light-gray surfaces, one deep-blue accent, Inter, generous whitespace. One card anatomy everywhere: title, subtitle, source badge, count/stage chip, alert dot. Drag-and-drop is the primary stage control. Source badges color-coded consistently app-wide. Sentence case. Desktop-first, phone-usable.

## Explicitly out of scope for v1

No prospecting module, no vendors, no invoicing, no email integration, no reporting beyond dashboard, no multi-user UI, no property marketing pages, no Slack/n8n integration yet (the schema is the API — never block it). Do not scaffold placeholders for any of these.

---

## Phase 1 SQL migration (complete — apply as-is)

```sql
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
```
