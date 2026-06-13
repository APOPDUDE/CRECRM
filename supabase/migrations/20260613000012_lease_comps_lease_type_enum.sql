-- lease_comps.lease_type becomes a constrained choice (real Postgres enum per
-- CLAUDE.md rule) instead of free text: NNN (triple net), NN (double net), or
-- MG (modified gross). Null = unspecified. Table is empty so the cast is a no-op.
create type lease_structure as enum ('NNN', 'NN', 'MG');

alter table lease_comps
  alter column lease_type type lease_structure using nullif(lease_type, '')::lease_structure;

comment on column lease_comps.lease_type is
  'Lease structure: NNN (triple net), NN (double net), or MG (modified gross). Null = unspecified.';
