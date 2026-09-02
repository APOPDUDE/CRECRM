-- prospects.sourced_by: allow 'website' alongside 'alex' / 'va'.
-- Seller inquiries from alexpoplawski.com go through intake_prospect with sourced_by = 'website'
-- (n8n "Website lead" workflow mj3kCPCgScjYx91f); the old check rejected the row (23514).
alter table public.prospects drop constraint if exists prospects_sourced_by_chk;
alter table public.prospects add constraint prospects_sourced_by_chk
  check (sourced_by = any (array['alex'::text, 'va'::text, 'website'::text]));
