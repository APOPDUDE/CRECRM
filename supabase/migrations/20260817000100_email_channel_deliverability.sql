-- Email channel, part 1 of 4: deliverability state + the email identity key.
--
-- WHY THIS EXISTS
-- The email channel needs to answer two completely different questions and the whole
-- design collapses if they share a column:
--   1. "Will mail to this address arrive?"  -- a deliverability fact about an ADDRESS,
--      inferred by an SMTP probe (ZeroBounce/MillionVerifier) or proven by a bounce.
--   2. "Was this PERSON reached?"           -- contacts.verified_at / verified_by.
-- Alex's doctrine is "verified means REACHED" (feedback-verified-means-reached). A vendor
-- saying "valid" means a mail server did not reject the address; nobody was reached. Writing
-- that into verified_at would corrupt the war-room number exactly the way decision_maker went
-- wrong. So deliverability gets its own enum and its own columns, and the column comments say
-- so in plain words for whoever reads this next.
--
-- contacts.email_verified_at already exists and already means the right thing -- its committed
-- comment from 20260810120000 says "proven to reach the person (a reply or an out-of-office
-- came back)". We do NOT redefine it. An out-of-office keeps setting email_verified_at and
-- keeps NOT setting verified_at: an OOO is the email channel's voicemail greeting.
--
-- THE UNIQUE INDEX IS THE POINT OF THIS FILE
-- Every write-back in part 4 resolves a Smartlead reply to a contact by lower(email). That is
-- only safe if an address identifies at most one contact -- and today it does not: contacts has
-- unique indexes on normalize_phone(phone), hubspot_id and ghl_contact_id, but NOTHING on email,
-- and jjmumm@gmail.com already sits on two rows (307 rows with an email, 306 distinct).
-- Without the index a reply would verify an arbitrary one of them.
--
-- The dedupe below is deliberately NON-DESTRUCTIVE. It does not delete a contact or repoint
-- foreign keys -- both are judgement calls that belong to Alex, not to a migration. It keeps the
-- address on the best-evidenced row and clears it from the others, leaving a note saying where
-- it went, so the person record and all their communications survive intact and the merge can be
-- done properly later. Ordering: a human-verified row beats an unverified one, an
-- email-verified row beats a never-mailed one, then oldest wins.

begin;

-- ---------------------------------------------------------------------------
-- 1. Make lower(btrim(email)) unique, non-destructively.
-- ---------------------------------------------------------------------------
with ranked as (
  select
    id,
    email,
    row_number() over (
      partition by lower(btrim(email))
      order by
        (verified_at is not null) desc,
        (email_verified_at is not null) desc,
        (hubspot_id is not null) desc,
        created_at asc,
        id asc
    ) as rn,
    first_value(id) over (
      partition by lower(btrim(email))
      order by
        (verified_at is not null) desc,
        (email_verified_at is not null) desc,
        (hubspot_id is not null) desc,
        created_at asc,
        id asc
    ) as keeper_id
  from contacts
  where email is not null and btrim(email) <> ''
)
update contacts c
set
  email = null,
  notes = concat_ws(
    E'\n',
    nullif(c.notes, ''),
    '[' || to_char(now(), 'YYYY-MM-DD') || '] email ' || r.email ||
    ' cleared here so lower(email) could be made unique for the Smartlead channel; it is kept on contact ' ||
    r.keeper_id || '. These two rows are probably the same person -- merge them properly when convenient.'
  )
from ranked r
where c.id = r.id and r.rn > 1;

-- Case-insensitive, whitespace-insensitive. Partial, because a contact without an email is
-- perfectly normal here (58 rows have no phone either -- neither field is mandatory).
create unique index if not exists contacts_email_lower_uniq
  on contacts (lower(btrim(email)))
  where email is not null;

comment on index contacts_email_lower_uniq is
  'An email address identifies at most one contact. The Smartlead reply write-back '
  '(apply_smartlead_event) resolves a reply to a person by lower(email); without this index '
  'a duplicate address would silently verify the wrong one of them.';

-- ---------------------------------------------------------------------------
-- 2. Deliverability -- an address fact, never a person fact.
-- ---------------------------------------------------------------------------
-- The vocabulary is ZeroBounce's, which is the de-facto industry standard and is what
-- MillionVerifier / Bouncer / Smartlead's own add-on all map onto. Keeping their exact words
-- means a verdict can be stored verbatim without a translation table that would rot.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_deliverability') then
    create type email_deliverability as enum (
      'valid',        -- send
      'catch_all',    -- domain accepts everything; unproven. HOLD unless separately scored.
      'unknown',      -- greylisted / timeout. Retry once, ~48h. Vendors do not charge for these.
      'invalid',      -- hard bounce. Never send.
      'spamtrap',     -- never send. Sending here blacklists the sending domain.
      'abuse',        -- known complainer. Never send.
      'do_not_mail'   -- global suppression / disposable / role-based. Never send.
    );
  end if;
end $$;

alter table contacts
  add column if not exists email_status            email_deliverability,
  add column if not exists email_status_at         timestamptz,
  add column if not exists email_status_source     text,
  add column if not exists email_last_campaigned_at timestamptz,
  add column if not exists email_campaign_id       text,
  add column if not exists email_bounced_at        timestamptz,
  add column if not exists email_opt_out_at        timestamptz,
  add column if not exists email_identity_suspect_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contacts_email_status_source_check'
  ) then
    alter table contacts add constraint contacts_email_status_source_check
      check (email_status_source is null or email_status_source in
             ('zerobounce','millionverifier','smartlead','ghl','bounce','manual'));
  end if;
  -- status and its timestamp travel together, the same pairing rule verified_at/verified_by uses
  if not exists (
    select 1 from pg_constraint where conname = 'contacts_email_status_pair_check'
  ) then
    alter table contacts add constraint contacts_email_status_pair_check
      check ((email_status is null) = (email_status_at is null));
  end if;
end $$;

comment on column contacts.email_status is
  'Deliverability verdict for this address (ZeroBounce vocabulary). THIS IS NOT VERIFICATION. '
  '"valid" means a mail server did not reject the address -- nobody was reached and no human '
  'confirmed anything. Verification lives in email_verified_at (the address reached the person) '
  'and verified_at (the person was reached). Never map one onto the other.';
comment on column contacts.email_status_at is 'When email_status was last determined.';
comment on column contacts.email_status_source is
  'Who produced email_status: a verification vendor, Smartlead, GHL, or a real bounce.';
comment on column contacts.email_last_campaigned_at is
  'When this address was last enrolled in an email campaign. THE double-send guard -- it lives '
  'here rather than on a GHL tag on purpose: Terrakotta mints a NEW GHL contact row every time it '
  'skip-traces another phone for the same owner, and that new row carries the same address with no '
  'tag on it, so a tag-based guard silently re-opens an already-mailed person.';
comment on column contacts.email_campaign_id is
  'Smartlead campaign id of the last enrolment. Text, because Smartlead returns ids as strings in '
  'some endpoints and numbers in others.';
comment on column contacts.email_bounced_at is
  'A real hard bounce came back. Set from EMAIL_BOUNCE / is_bounced, which are authoritative -- '
  'the Smartlead category "Sender Originated Bounce" catches only ~15% of actual bounces.';
comment on column contacts.email_opt_out_at is
  'They asked to stop being emailed (unsubscribe, or a Do Not Contact classification). Keyed to '
  'the ADDRESS, not the person: this must survive a contact merge and a re-import from GHL.';
comment on column contacts.email_identity_suspect_at is
  'This address probably does not belong to this person -- a "Wrong Person" reply, a relayed '
  'answer, or a phone-collision bind. Blocks verified_at until a human resolves it.';

-- Partial: the campaign audience only ever asks "is this address burned or spoken for?", which
-- is a small minority of rows.
create index if not exists contacts_email_channel_idx
  on contacts (email_last_campaigned_at)
  where email is not null;

commit;
