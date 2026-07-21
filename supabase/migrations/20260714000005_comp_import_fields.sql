-- Executed-comp import fields: tenant/buyer name as text (market comps don't get
-- company records), a verified flag for the appraiser-verification sweep, and a
-- unit/suite designation so a unit lease isn't mistaken for a whole-building lease.
-- Also extend lease_structure with FS (full service) and IG (industrial gross),
-- which appear throughout CoStar lease comp exports.

alter type lease_structure add value if not exists 'FS';
alter type lease_structure add value if not exists 'IG';

alter table comps add column if not exists tenant_name text;
alter table comps add column if not exists verified boolean not null default false;
alter table comps add column if not exists unit text;

comment on column comps.tenant_name is 'Tenant (lease) or buyer (sale) name as text; market comps do not create company rows';
comment on column comps.verified is 'True once confirmed against county appraiser / public records (or hand-verified)';
comment on column comps.unit is 'Unit/suite/floor designation when the comp covers part of a building; sf stays the leased SF';
