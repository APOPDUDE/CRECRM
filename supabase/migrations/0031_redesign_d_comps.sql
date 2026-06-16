-- Redesign D: reshape comps (was lease_comps) to hold lease AND sale comps.

-- 1) rename columns to the new vocabulary
alter table public.comps rename column match_id          to pursuit_id;
alter table public.comps rename column lease_type        to lease_structure;
alter table public.comps rename column source_listing_id to source_key;

-- 2) discriminators + sale fields (existing 712 rows are scraped lease asking comps)
alter table public.comps add column deal_type     public.deal_type not null default 'lease';
alter table public.comps add column kind          public.comp_kind not null default 'asking';
alter table public.comps add column sale_price     numeric(14,2);
alter table public.comps add column cap_rate_pct   numeric(5,2);
alter table public.comps add column price_per_sf   numeric(10,2);
alter table public.comps add column price_per_acre numeric(14,2);
alter table public.comps add column land_acres     numeric(10,2);

-- 3) checks: executed comps need an owner; comps are always one concrete deal type
alter table public.comps drop constraint if exists lease_comps_executed_is_manual;
alter table public.comps drop constraint if exists lease_comps_manual_has_owner;
alter table public.comps add constraint comps_executed_has_owner
  check (kind <> 'executed' or owner_id is not null);
alter table public.comps add constraint comps_deal_type_concrete
  check (deal_type in ('lease','sale'));

-- 4) rename fk constraints + unique index to the comps_* vocabulary
alter table public.comps rename constraint lease_comps_match_id_fkey          to comps_pursuit_id_fkey;
alter table public.comps rename constraint lease_comps_property_id_fkey       to comps_property_id_fkey;
alter table public.comps rename constraint lease_comps_tenant_company_id_fkey to comps_tenant_company_id_fkey;
alter table public.comps rename constraint lease_comps_owner_id_fkey          to comps_owner_id_fkey;
alter index public.lease_comps_source_listing_uq rename to comps_source_key_uq;
