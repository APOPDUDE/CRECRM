-- Persist the brokerage fee on the match itself. Fees stored only on the parent
-- listing/tenant_rep double-count when one parent has multiple executed matches.
alter table matches add column if not exists actual_fee numeric(14,2);
