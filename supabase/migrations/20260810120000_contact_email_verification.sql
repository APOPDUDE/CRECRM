-- Verification for the EMAIL, separate from everything else.
--
-- Owner verification says "this phone number reaches this owner" and lives on
-- owner_contacts. This column says one thing only: mail sent to this address reached
-- this person -- proven by a reply (interested, not interested) or an out-of-office.
-- It deliberately verifies nothing else: not the phone, not that they own anything,
-- not that they decide anything. A "Not Interested" reply is still a verified email;
-- the outcome and the deliverability are different facts.

alter table contacts
  add column if not exists email_verified_at timestamptz;

comment on column contacts.email_verified_at is
  'When this email address was proven to reach the person (a reply or an out-of-office '
  'came back). Verifies the address only -- not the phone, not identity claims.';
