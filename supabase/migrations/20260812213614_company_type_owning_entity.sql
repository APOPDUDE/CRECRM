-- The LLC on the deed is a legitimate company to hold -- it owns the building -- but it is
-- not a landlord we rep, a tenant, or a vendor. It gets its own type so the book can say
-- what a company IS rather than defaulting everything to 'tenant' (2,308 companies typed
-- 'tenant' today have no client record behind them).
--
-- Note: `owners` remains the system of record for title-holding entities scraped from the
-- appraiser (11k rows, own verification_status). company_type='owning_entity' is for the
-- ones that graduate into companies you actually deal with.
alter type company_type add value if not exists 'owning_entity';
