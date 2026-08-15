-- The owners retirement re-pointed v_property_owner_context's contact laterals at
-- contacts.company_id, but only properties/communications got their owner_company
-- indexes — contacts didn't. Every view row then seq-scanned contacts twice (the
-- seat counts + the best-contact pick), and deep OFFSET pages of the view started
-- blowing the statement timeout (500s on the whole-book fetch, 2026-08-15 night).
create index if not exists contacts_company_idx
  on contacts (company_id)
  where company_id is not null;
