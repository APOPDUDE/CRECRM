-- New first match stage: search-/scrape-sourced properties land in "Inquiring"
-- (the tenant-board column before Touring). Must be its own migration —
-- a new enum value can't be used in the same transaction it's added in.
alter type match_stage add value if not exists 'inquiring' before 'lead';
