-- The email lead pool: every address we can mail that is NOT (yet) a contact.
-- Applied live 2026-08-17; this file is the committed record of it.
--
-- WHY (Alex, 2026-08-17): "I would like a table dedicated in supabase for all the unverified email
-- contacts, cause I want to re-email all the people we have from smartlead that never answered from
-- the off-market lists... and for the lists like nicole there are tags for those contacts, so they
-- can be associated to properties but not really show up on the property card until it's verified...
-- I want to delete all the contacts on smartlead to start with a fresh start there so we should have
-- all those emails in one place."
--
-- Three requirements, and the design falls straight out of them:
--
-- 1. UNVERIFIED ADDRESSES MUST NOT BE CONTACTS. The doctrine is "every contact verified or it isn't
--    a contact". 10,174 Smartlead leads collapse to 6,876 distinct addresses; dropping those into
--    `contacts` would bury a 745-row human-verified book under ten thousand strangers and destroy
--    the war-room number. So they live here, and `contacts` stays the verified book.
--
-- 2. ASSOCIATED TO PROPERTIES, INVISIBLE ON THE PROPERTY CARD. property_id is recorded so the pool
--    can be segmented by property and geography. It is invisible by construction rather than by
--    convention: a property reaches people via properties.owner_company_id -> companies <-
--    contacts.company_id, and NOTHING in that chain reads this table. The only way a pooled address
--    becomes visible is contact_id, and the only thing that sets contact_id is a genuine human reply
--    arriving through apply_smartlead_event.
--
-- 3. SMARTLEAD IS ABOUT TO BE WIPED. Everything Smartlead knows -- names, company, phone, the
--    property custom fields, campaign membership, send/reply/bounce/unsubscribe history -- is
--    harvested into `raw` and the typed columns first. After that the pool, not Smartlead, is the
--    system of record for the mailable universe.
--
-- NAMES IN HERE ARE NOT TRUSTWORTHY, and that is recorded rather than hidden. Smartlead's enrichment
-- stamps ONE contact name across every address it finds at a domain: nine @detwilermarket.com staff
-- all arrive as "Henry Detwiler", and bernadette@lakeshoreathleticservices.com arrives labelled
-- "Thomas Cooney". name_source says where the name came from, and nothing here may ever write
-- contacts.first_name / last_name / normalized_name.
--
-- HARVEST RESULT (2026-08-17): 7,152 addresses -- 6,876 from Smartlead across 15 campaigns, 276
-- GHL-only from the Owner Email custom field, 16 present in both. 2,543 linked to a property.
-- 262 already promoted to contacts. 6,722 never answered -- of which ~4,250 sit on the off-market
-- lists, which is the re-mail target.

begin;

create table if not exists email_leads (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null,
  first_name            text,
  last_name             text,
  name_source           text,
  company_name          text,
  phone                 text,
  property_id           uuid references properties(id) on delete set null,
  parcel_id             text,
  property_address      text,
  property_city         text,
  property_county       text,
  property_state        text,
  property_zip          text,
  lists                 text[] not null default '{}',
  source                text not null default 'smartlead',
  smartlead_lead_id     text,
  smartlead_campaign_ids text[] not null default '{}',
  contact_id            uuid references contacts(id) on delete set null,
  email_status          email_deliverability,
  email_status_at       timestamptz,
  sent_count            integer not null default 0,
  last_sent_at          timestamptz,
  last_reply_at         timestamptz,
  reply_category        text,
  bounced_at            timestamptz,
  opted_out_at          timestamptz,
  last_campaigned_at    timestamptz,
  raw                   jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint email_leads_source_check
    check (source in ('smartlead','ghl','terrakotta','hubspot','manual')),
  constraint email_leads_name_source_check
    check (name_source is null or name_source in
           ('smartlead','address_local_part','ghl','terrakotta','manual')),
  constraint email_leads_email_shape
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$')
);

create unique index if not exists email_leads_email_uniq on email_leads (lower(btrim(email)));
create index if not exists email_leads_property_idx on email_leads (property_id) where property_id is not null;
create index if not exists email_leads_contact_idx  on email_leads (contact_id)  where contact_id is not null;
create index if not exists email_leads_lists_idx    on email_leads using gin (lists);
create index if not exists email_leads_unanswered_idx on email_leads (last_campaigned_at)
  where last_reply_at is null and bounced_at is null and opted_out_at is null and contact_id is null;

comment on table email_leads is
  'Mailable addresses that are NOT contacts. Deliberately unreachable from the property card: a '
  'property reaches people via owner_company_id -> companies <- contacts, and nothing in that chain '
  'reads this table. contact_id is set ONLY when a human reply promotes the address into the book.';
comment on column email_leads.name_source is
  'Where first_name/last_name came from. Smartlead stamps ONE name across every address at a domain, '
  'so a smartlead-sourced name must never be written into contacts.';
comment on column email_leads.lists is
  'Smartlead campaign names and GHL tags this address belongs to. One address can be on several.';
comment on column email_leads.contact_id is
  'The real contact, once a human reply promoted this address. NULL = unverified and invisible to '
  'the property card.';
comment on column email_leads.property_id is
  'The property this address was sourced against. Recorded so the pool can be segmented -- NOT so '
  'the property card can display an unverified person.';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'email_leads_updated_at') then
    create trigger email_leads_updated_at before update on email_leads
      for each row execute function set_updated_at();
  end if;
end $$;

alter table email_leads enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename='email_leads' and policyname='email_leads_auth_all') then
    create policy email_leads_auth_all on email_leads
      for all to authenticated using (true) with check (true);
  end if;
end $$;

create or replace view v_email_leads_unanswered as
select l.*, (select count(*) from unnest(l.lists)) as list_count
from email_leads l
where l.contact_id    is null
  and l.last_reply_at is null
  and l.bounced_at    is null
  and l.opted_out_at  is null
  and (l.email_status is null or l.email_status in ('valid','catch_all','unknown'));

comment on view v_email_leads_unanswered is
  'The re-mail pool: mailed, never answered, never bounced, never opted out, never became a contact.';

-- Drives the list picker on /email, so Alex never has to remember a campaign name.
create or replace view v_email_lead_lists as
select
  unnest(lists) as list,
  count(*) as addresses,
  count(*) filter (where last_reply_at is null and bounced_at is null
                     and opted_out_at is null and contact_id is null) as never_answered,
  count(*) filter (where last_reply_at is not null) as replied,
  count(*) filter (where bounced_at    is not null) as bounced,
  count(*) filter (where opted_out_at  is not null) as opted_out,
  count(*) filter (where property_id   is not null) as with_property,
  max(last_sent_at) as last_sent_at
from email_leads
group by 1
order by never_answered desc;

comment on view v_email_lead_lists is
  'One row per list (Smartlead campaign name or GHL tag) with how many addresses never answered.';

commit;

-- NOTE: the four functions that go with this table -- import_email_leads(jsonb),
-- email_lead_audience(jsonb), resolve_email_lead_properties(jsonb) and
-- email_lead_normalize_address(text) -- were applied live as migrations
-- `email_leads_import_and_audience` and `resolve_email_lead_properties`, and
-- apply_smartlead_event gained an `update email_leads` block so a reply keeps the pool in step
-- (last_reply_at / reply_category / bounced_at / opted_out_at / contact_id / email_status). That
-- pool-sync block is what stops a promoted address from reappearing in the re-mail audience, and it
-- is the single place where the pool and the verified book are reconciled.
--
-- Two data-quality passes were run once against the harvested rows and are recorded here rather
-- than re-run automatically:
--   * property_address was backfilled from raw->>'location' wherever the stored value lacked a house
--     number -- Smartlead's custom_fields use "Street" for the road on some campaigns and the whole
--     address on others, so ~2k rows held "59th Way N" where they should hold "5215 59th Way N".
--   * literal junk from unresolved merge tags ("$$", bare "Tampa FL", anything with no digit at all)
--     was nulled, so nothing downstream tries to personalise "your property at $$".
