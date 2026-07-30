-- Owner data room: a verified-owner list on the map, with conversation context.
--
-- Three new entities:
--   owners           — the normalized owner behind one or more properties (county records give
--                      us an LLC/person name per parcel; this is that name, deduped).
--   owner_contacts   — the bridge from an owner (often an LLC) to the humans we can actually
--                      reach. "Verified owner contact" = a row here with confidence='confirmed'.
--   communications   — every past conversation, phone-keyed, mirrored in from HubSpot /
--                      Terrakotta / SmarterContact / GHL so the map pin can show context.
--
-- Design notes:
--  * Phone is the identity spine everywhere (contacts.phone is NOT NULL with a unique index on
--    normalize_phone(phone)); communications carries a normalized phone so a conversation can
--    land before we know which contact it belongs to.
--  * Owner-name normalization deliberately KEEPS the entity suffix and only canonicalizes its
--    spelling. Dropping "LLC"/"INC" would merge "Smith Properties LLC" with "Smith Properties
--    Inc" — usually the same principal, but not always, and a wrong merge is unrecoverable.
--    Same-principal grouping across different entities is done via mailing address instead,
--    which is evidence rather than a guess.

-- ---------------------------------------------------------------- enums

create type owner_kind as enum ('individual', 'entity', 'government', 'unknown');
create type owner_contact_confidence as enum ('confirmed', 'likely', 'unconfirmed');
create type comm_channel as enum ('call', 'sms', 'email', 'note', 'meeting', 'other');
create type comm_direction as enum ('inbound', 'outbound', 'unknown');
create type comm_source as enum ('hubspot', 'terrakotta', 'smartercontact', 'ghl', 'manual');

-- ---------------------------------------------------------------- name normalization

-- Canonical form of an owner name for dedupe: upper-cased, punctuation stripped, whitespace
-- collapsed, and common entity-suffix spellings folded to one token. Immutable so it can back
-- a unique index / generated column.
create or replace function normalize_owner_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            -- fold suffix spelling variants to a canonical token
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(upper(coalesce(p_name, '')),
                      '\mL\.?\s?L\.?\s?C\.?\M', 'LLC'),
                    '\mINCORPORATED\M', 'INC'),
                  '\mLIMITED\s+PARTNERSHIP\M', 'LP'),
                '\mLIMITED\s+LIABILITY\s+(COMPANY|CO)\M', 'LLC'),
              '\mCOMPANY\M', 'CO'),
            -- drop punctuation entirely (periods, commas, ampersands, quotes, slashes)
            '[.,&''"/\\]', '', 'g'),
          -- collapse any run of whitespace
          '\s+', ' ', 'g'),
        '^\s+|\s+$', '', 'g')
    ),
    ''
  );
$$;

comment on function normalize_owner_name(text) is
  'Dedupe key for owner names: upper, de-punctuated, whitespace-collapsed, entity suffix '
  'spelling canonicalized. Suffix is KEPT (never dropped) to avoid merging distinct entities.';

-- ---------------------------------------------------------------- owners

create table owners (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text generated always as (normalize_owner_name(display_name)) stored,
  kind owner_kind not null default 'unknown',
  -- where the tax bill goes; the best available evidence that two entities share a principal
  mailing_address text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owners_display_name_not_blank check (btrim(display_name) <> '')
);

create unique index owners_normalized_name_uniq on owners (normalized_name);
create index owners_mailing_address_idx on owners (upper(btrim(mailing_address)))
  where mailing_address is not null;

comment on table owners is
  'The normalized owner behind one or more properties, deduped from county-appraiser owner names.';

alter table properties add column owner_id uuid references owners(id) on delete set null;
create index properties_owner_idx on properties (owner_id);

-- ---------------------------------------------------------------- owner_contacts

create table owner_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  role text,
  confidence owner_contact_confidence not null default 'unconfirmed',
  -- how the link was made: 'property_address' | 'mailing_address' | 'name' | 'manual' | 'call'
  match_basis text,
  verified_at timestamptz,
  verified_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_contacts_unique_pair unique (owner_id, contact_id),
  -- 'confirmed' is the thing the map filter keys on, so it must carry its provenance
  constraint owner_contacts_confirmed_needs_stamp
    check (confidence <> 'confirmed' or verified_at is not null)
);

create index owner_contacts_owner_idx on owner_contacts (owner_id);
create index owner_contacts_contact_idx on owner_contacts (contact_id);

comment on table owner_contacts is
  'Bridge from an owner entity to reachable humans. confidence=confirmed means we have spoken '
  'to them / otherwise verified they speak for the owner — this is what "verified owner" means.';

-- ---------------------------------------------------------------- communications

create table communications (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete set null,
  -- normalized 10-digit phone; lets a conversation land before the contact exists
  phone text,
  owner_id uuid references owners(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  channel comm_channel not null,
  direction comm_direction not null default 'unknown',
  occurred_at timestamptz not null,
  subject text,
  body text,
  transcript text,
  disposition text,
  tags text[],
  source comm_source not null,
  -- the source system's own id, so re-running an import is idempotent
  external_id text,
  raw jsonb,
  created_at timestamptz not null default now(),
  constraint communications_needs_identity
    check (contact_id is not null or phone is not null),
  constraint communications_source_external_uniq unique (source, external_id)
);

create index communications_contact_idx on communications (contact_id, occurred_at desc);
create index communications_phone_idx on communications (phone, occurred_at desc);
create index communications_property_idx on communications (property_id);
create index communications_owner_idx on communications (owner_id);
create index communications_occurred_idx on communications (occurred_at desc);

comment on table communications is
  'Phone-keyed mirror of every past conversation across HubSpot / Terrakotta / SmarterContact / '
  'GHL. Append-only in practice; (source, external_id) makes re-imports idempotent.';

-- ---------------------------------------------------------------- contact provenance

alter table contacts
  add column hubspot_id text,
  add column terrakotta_id text,
  add column source_system text,
  -- Terrakotta skip-trace quality signals: grade A+/B+/..., type Mobile/NonFixedVOIP/Landline
  add column phone_grade text,
  add column phone_type text,
  -- which outreach lists this number came off (Terrakotta list names)
  add column campaign_lists text[],
  add column last_contacted_at timestamptz,
  add column do_not_call boolean not null default false;

create unique index contacts_hubspot_id_uniq on contacts (hubspot_id)
  where hubspot_id is not null;
create index contacts_terrakotta_id_idx on contacts (terrakotta_id)
  where terrakotta_id is not null;

comment on column contacts.do_not_call is
  'Set from a Terrakotta "Do Not Call" disposition / [Do not call] tag or a GHL dnc tag. '
  'Outreach selection MUST exclude these.';

-- ---------------------------------------------------------------- updated_at triggers

create trigger owners_updated_at before update on owners
  for each row execute function set_updated_at();
create trigger owner_contacts_updated_at before update on owner_contacts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- map view

-- One row per property carrying the owner context the map needs, so the client can filter on
-- "do we have a verified owner contact" without a second round trip. security_invoker keeps
-- the caller's RLS in force.
create view v_property_owner_context
with (security_invoker = true) as
select
  p.id                                            as property_id,
  p.owner_id,
  o.display_name                                  as owner_name,
  o.kind                                          as owner_kind,
  o.mailing_address                               as owner_mailing_address,
  coalesce(port.property_count, 0)                as owner_property_count,
  port.portfolio_sf                               as owner_portfolio_sf,
  port.portfolio_acres                            as owner_portfolio_acres,
  coalesce(oc.contact_count, 0)                   as owner_contact_count,
  coalesce(oc.confirmed_count, 0)                 as owner_confirmed_contact_count,
  coalesce(oc.confirmed_count, 0) > 0             as owner_contact_verified,
  coalesce(oc.do_not_call_count, 0) > 0           as owner_do_not_call,
  comm.comm_count,
  comm.last_contacted_at
from properties p
left join owners o on o.id = p.owner_id
left join lateral (
  select
    count(*)                as property_count,
    sum(p2.building_sf)     as portfolio_sf,
    sum(p2.land_acres)      as portfolio_acres
  from properties p2
  where p2.owner_id = p.owner_id
) port on p.owner_id is not null
left join lateral (
  select
    count(*)                                                     as contact_count,
    count(*) filter (where ocx.confidence = 'confirmed')         as confirmed_count,
    count(*) filter (where c.do_not_call)                        as do_not_call_count
  from owner_contacts ocx
  join contacts c on c.id = ocx.contact_id
  where ocx.owner_id = p.owner_id
) oc on p.owner_id is not null
left join lateral (
  select count(*) as comm_count, max(cm.occurred_at) as last_contacted_at
  from communications cm
  where cm.property_id = p.id
     or (p.owner_id is not null and cm.owner_id = p.owner_id)
) comm on true;

comment on view v_property_owner_context is
  'Per-property owner context for the map: owner name, portfolio rollup, whether we hold a '
  'verified owner contact, and last-conversation recency.';

-- ---------------------------------------------------------------- RLS

alter table owners enable row level security;
alter table owner_contacts enable row level security;
alter table communications enable row level security;

create policy owners_auth_all on owners
  for all to authenticated using (true) with check (true);
create policy owner_contacts_auth_all on owner_contacts
  for all to authenticated using (true) with check (true);
create policy communications_auth_all on communications
  for all to authenticated using (true) with check (true);

-- anon holds no business data (matches the anon-lockdown pass on the other tables/views)
revoke all on owners from anon;
revoke all on owner_contacts from anon;
revoke all on communications from anon;
revoke all on v_property_owner_context from anon;
grant select on v_property_owner_context to authenticated;
