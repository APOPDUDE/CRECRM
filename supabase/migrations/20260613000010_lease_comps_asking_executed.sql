-- Lease comps become an asking-vs-executed comp database:
--   asking_lease_rate_psf   — auto-populated from scraped lease listings (or manual)
--   executed_lease_rate_psf — executed deal rate, MANUAL ONLY (never set by automation)
-- plus the existing executed-deal fields (escalations, ti_psf, term_months,
-- free_rent_months, lease_type, commencement/expiration/executed dates) which are
-- likewise manual-only. Scrape-sourced rows carry only asking data.
-- lease_comps is empty at this point (UI not built) so the rename is safe.

alter table lease_comps rename column lease_rate_psf to executed_lease_rate_psf;

alter table lease_comps
  add column asking_lease_rate_psf numeric(10,2),         -- asking $/SF/yr (scrape or manual)
  add column source text not null default 'manual',       -- 'manual' | 'scrape'
  add column source_listing_id text;                       -- namespaced, e.g. 'crexi:834014' (scrape dedupe)

-- scrape asking-comps have no broker/user context
alter table lease_comps alter column owner_id drop not null;

-- idempotent upsert of scrape-sourced asking comps (one per source listing)
create unique index if not exists lease_comps_source_listing_uq
  on lease_comps (source_listing_id) where source_listing_id is not null;

-- enforce "executed data is manual only": automation writes source='scrape' rows and
-- may set asking_lease_rate_psf + sf, but never any executed-deal field.
alter table lease_comps add constraint lease_comps_executed_is_manual check (
  source <> 'scrape' or (
    executed_lease_rate_psf is null
    and escalations is null
    and ti_psf is null
    and term_months is null
    and free_rent_months is null
    and lease_type is null
    and commencement_date is null
    and expiration_date is null
    and executed_at is null
  )
);

-- scrape rows are context-free (owner_id null); broker-entered manual rows must name an owner
alter table lease_comps add constraint lease_comps_manual_has_owner check (
  source = 'scrape' or owner_id is not null
);

comment on column lease_comps.asking_lease_rate_psf is
  'Asking $/SF/yr. Auto-populated from scraped lease listings (source=scrape) or entered manually.';
comment on column lease_comps.executed_lease_rate_psf is
  'Executed $/SF/yr. Manual entry only — never written by the scrape automation.';
comment on column lease_comps.source is
  '''scrape'' = asking comp created by the Apify/n8n import; ''manual'' = broker-entered (the only way to record executed-deal data).';
