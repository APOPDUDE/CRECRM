-- The outreach spine: one row per PERSON, one child row per CHANNEL IDENTIFIER.
--
-- WHY (plan-outreach-spine.md, Alex 2026-08-17): a skiptraced list imports ONCE, into the CRM.
-- The import creates one spine row per person plus a row in each channel table the person has
-- data for -- phone -> outreach_calls, email -> outreach_email, mailing address -> outreach_mail --
-- all tagged with the list's name. From then on the list lives in Supabase and building an
-- audience is a query. GHL stops being the source of truth for lists and becomes a push
-- destination for the phone channel. This replaces email_leads (email-only, keyed per address)
-- with a person-keyed spine that is pre-loaded on all three channels at import.
--
-- RULES THAT MUST SURVIVE:
--   1. A target is NOT a contact. `contacts` stays the verified book ("every contact verified or
--      it isn't a contact"). contact_id is set only by a real reply/conversation.
--   2. Invisible to the property card BY CONSTRUCTION. A property reaches people via
--      properties.owner_company_id -> companies <- contacts.company_id; nothing in that chain
--      reads these tables. property_id is recorded so lists can be segmented, never for display.
--   3. Per-channel natural keys: outreach_calls is unique on normalize_phone(phone),
--      outreach_email on lower(btrim(email)), outreach_mail on the normalized address + zip.
--      Re-skiptracing the same human with the same phone but a new email hits the existing calls
--      row and creates a new email row, both pointing at one target.
--   4. Wrong number != wrong person. A bad phone says nothing about the human: it suppresses the
--      CALLS row only (disposition). Only wrong_person_at on the TARGET suppresses a person
--      across channels.
--
-- ANCHORS (identity layer 1): owner side anchors on property_id (parcel is a resolver, never a
-- key -- 105 duplicate (county,parcel) groups exist). Tenant side anchors on company_id, which
-- became a real key in 20260817190000 (normalized_name unique). A target with neither anchor is
-- still valid, it just cannot be segmented by geography.

begin;

-- Same normalizer email_lead_normalize_address proved out: strip unit/suite, non-alphanumerics,
-- collapse whitespace. Deliberately conservative about directionals -- "1025 N Chestnut Rd" and
-- "1025 CHESTNUT" must NOT conflate.
create or replace function normalize_mail_address(p text) returns text
language sql immutable as $$
  select nullif(regexp_replace(
           regexp_replace(
             regexp_replace(upper(coalesce(p,'')),
               '\m(UNIT|STE|SUITE|APT|BLDG|BUILDING|#)\M.*$', '', 'g'),
             '[^A-Z0-9 ]', ' ', 'g'),
           '\s+', ' ', 'g'), '')
$$;

comment on function normalize_mail_address(text) is
  'Mailing-address natural key for outreach_mail: uppercase, unit/suite stripped, punctuation '
  'out, whitespace collapsed. Conservative about directionals on purpose.';

create table outreach_targets (
  id              uuid primary key default gen_random_uuid(),
  first_name      text,
  last_name       text,
  name_source     text,
  company_name    text,
  phone           text,
  email           text,
  mailing_address text,
  mailing_city    text,
  mailing_state   text,
  mailing_zip     text,
  property_id     uuid references properties(id) on delete set null,
  parcel_id       text,
  company_id      uuid references companies(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  lists           text[] not null default '{}',
  source          text not null,
  wrong_person_at timestamptz,
  hold_reason     text,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint outreach_targets_source_check
    check (source in ('terrakotta','ghl','smartlead','manual'))
);

create index outreach_targets_lists_idx    on outreach_targets using gin (lists);
create index outreach_targets_property_idx on outreach_targets (property_id) where property_id is not null;
create index outreach_targets_company_idx  on outreach_targets (company_id)  where company_id  is not null;
create index outreach_targets_contact_idx  on outreach_targets (contact_id)  where contact_id  is not null;
create index outreach_targets_phone_idx    on outreach_targets (normalize_phone(phone)) where phone is not null;
create index outreach_targets_email_idx    on outreach_targets (lower(btrim(email)))    where email is not null;
create index outreach_targets_name_idx     on outreach_targets (upper(btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))));

comment on table outreach_targets is
  'One row per PERSON in the outreach universe. NOT a contact: contacts stays the verified book, '
  'and contact_id is set only by a real reply/conversation. Deliberately unreachable from the '
  'property card -- a property reaches people via owner_company_id -> companies <- contacts, and '
  'nothing in that chain reads this table.';
comment on column outreach_targets.lists is
  'Every import list this person sits on (list-nicole, list-2810, ...). One person, one row, '
  'many lists -- the list IS the audience query.';
comment on column outreach_targets.property_id is
  'Owner-side anchor: the CRM property uuid, resolved from parcel (unambiguous only) or '
  'normalized address+city (unambiguous only). Never guessed. For segmentation, not display.';
comment on column outreach_targets.company_id is
  'Tenant-side anchor, resolved by companies.normalized_name (unique since 20260817190000).';
comment on column outreach_targets.contact_id is
  'The ONLY bridge to the verified book. Set when a human is actually reached, never at import.';
comment on column outreach_targets.wrong_person_at is
  'Cross-channel suppression: we confirmed this record points at the wrong HUMAN. A wrong '
  'NUMBER, by contrast, lives on outreach_calls.disposition and suppresses the phone only.';
comment on column outreach_targets.hold_reason is
  'Import-time flag (no_anchor, ambiguous_property, shared_phone_conflicting_email, ...). '
  'Informational -- held targets are still imported, they just need a human eye.';
comment on column outreach_targets.name_source is
  'Where the name came from. Smartlead stamps one name across a whole domain, so a '
  'smartlead-sourced name must never be written into contacts.';

create table outreach_calls (
  id             uuid primary key default gen_random_uuid(),
  target_id      uuid not null references outreach_targets(id) on delete cascade,
  phone          text not null,
  attempts       integer not null default 0,
  last_call_at   timestamptz,
  disposition    text,
  line_type      text,
  phone_grade    text,
  dnc            boolean not null default false,
  ghl_contact_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint outreach_calls_phone_valid check (normalize_phone(phone) is not null)
);

create unique index outreach_calls_phone_uniq on outreach_calls (normalize_phone(phone));
create index outreach_calls_target_idx on outreach_calls (target_id);

comment on table outreach_calls is
  'The phone channel. One row per phone NUMBER (unique on normalize_phone), pointing at the '
  'target that owns it. GHL is a push destination for this channel, never the source of truth.';
comment on column outreach_calls.disposition is
  'Call outcome. Terrakotta''s "wrong person" maps to "wrong number" on the way in -- the phone '
  'was bad, which says nothing about the human. Only outreach_targets.wrong_person_at suppresses '
  'across channels.';
comment on column outreach_calls.dnc is
  'Do-not-call THIS NUMBER.';

create table outreach_email (
  id                 uuid primary key default gen_random_uuid(),
  target_id          uuid not null references outreach_targets(id) on delete cascade,
  email              text not null,
  email_status       email_deliverability,
  email_status_at    timestamptz,
  email_verified_at  timestamptz,
  sent_count         integer not null default 0,
  last_sent_at       timestamptz,
  last_campaigned_at timestamptz,
  last_reply_at      timestamptz,
  reply_category     text,
  bounced_at         timestamptz,
  opted_out_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint outreach_email_shape
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$')
);

create unique index outreach_email_addr_uniq on outreach_email (lower(btrim(email)));
create index outreach_email_target_idx on outreach_email (target_id);

comment on table outreach_email is
  'The email channel. One row per ADDRESS (unique on lower(btrim(email))), pointing at the '
  'target that owns it. Replaces email_leads as the mailable universe.';

create table outreach_mail (
  id          uuid primary key default gen_random_uuid(),
  target_id   uuid not null references outreach_targets(id) on delete cascade,
  mail_address text not null,
  mail_city   text,
  mail_state  text,
  mail_zip    text,
  qr_code     text,
  mail_status text,
  sent_at     timestamptz,
  scanned_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint outreach_mail_addr_valid check (normalize_mail_address(mail_address) is not null)
);

create unique index outreach_mail_addr_uniq
  on outreach_mail (normalize_mail_address(mail_address), coalesce(upper(btrim(mail_zip)), ''));
create index outreach_mail_target_idx on outreach_mail (target_id);

comment on table outreach_mail is
  'The postcard channel. One row per MAILING ADDRESS (unique on normalize_mail_address + zip). '
  'Mail goes to the OWNER''s mailing address, never the property.';

do $$
declare t text;
begin
  foreach t in array array['outreach_targets','outreach_calls','outreach_email','outreach_mail']
  loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()',
                   t || '_updated_at', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)',
                   t || '_auth_all', t);
  end loop;
end $$;

-- Drives the list picker: one row per list with per-channel reach.
create or replace view v_outreach_lists as
select
  l.list,
  count(*) as targets,
  count(*) filter (where exists (select 1 from outreach_email  e where e.target_id = t.id)) as with_email,
  count(*) filter (where exists (select 1 from outreach_calls  c where c.target_id = t.id)) as with_phone,
  count(*) filter (where exists (select 1 from outreach_mail   m where m.target_id = t.id)) as with_mail,
  count(*) filter (where t.property_id is not null) as with_property,
  count(*) filter (where t.contact_id  is not null) as reached,
  count(*) filter (where t.contact_id is null and t.wrong_person_at is null
                   and exists (select 1 from outreach_email e where e.target_id = t.id
                               and e.last_reply_at is null and e.bounced_at is null
                               and e.opted_out_at is null)) as never_answered,
  count(*) filter (where t.hold_reason is not null) as held,
  max(t.created_at) as last_import_at
from outreach_targets t
cross join lateral unnest(t.lists) as l(list)
group by l.list
order by targets desc;

comment on view v_outreach_lists is
  'One row per outreach list with per-channel reach. never_answered = email-channel re-mail pool.';

commit;
