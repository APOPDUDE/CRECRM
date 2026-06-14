-- Listing-level lease terms used by the commission calculator and the About panel.
-- lease_structure enum (NNN | NN | MG) already exists from an earlier migration.
alter table listings
  add column if not exists opex_psf numeric(10,2),
  add column if not exists lease_structure lease_structure;
