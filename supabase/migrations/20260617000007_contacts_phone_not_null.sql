-- Every remaining contact has a phone, so phone is now required at the DB level
-- (completes the phone-as-identity foundation: required + unique + auto-formatted).
alter table public.contacts alter column phone set not null;
