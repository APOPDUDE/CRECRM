-- Contacts: phone becomes the unique identity.
-- We keep the uuid PK (so correcting a phone never cascades across linked deals)
-- and enforce uniqueness on the NORMALIZED phone. The stored phone is always
-- canonicalized to XXX-XXX-XXXX so humans, the UI, and n8n/Slack intake all read
-- and dedupe by phone.

-- Digits-only 10-digit US number (drops a leading country-code 1), else NULL.
create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when length(d) = 11 and left(d, 1) = '1' then right(d, 10)
    when length(d) = 10 then d
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

-- Canonical display form: 941-806-8432 for a valid 10-digit US number,
-- otherwise the input is passed through unchanged (e.g. extensions, partials).
create or replace function public.format_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when public.normalize_phone(p) is not null
      then regexp_replace(public.normalize_phone(p), '(\d{3})(\d{3})(\d{4})', '\1-\2-\3')
    else p
  end
$$;

-- Canonicalize phone on every write (covers UI + n8n + Slack intake).
create or replace function public.set_contact_phone()
returns trigger
language plpgsql
as $$
begin
  new.phone := nullif(public.format_phone(new.phone), '');
  return new;
end $$;

drop trigger if exists contacts_set_phone on public.contacts;
create trigger contacts_set_phone
  before insert or update of phone on public.contacts
  for each row execute function public.set_contact_phone();

-- Backfill existing rows to the canonical format (no normalized collisions exist).
update public.contacts set phone = public.format_phone(phone) where phone is not null;

-- Enforce phone uniqueness on the normalized number. Partial so existing rows
-- without a (valid) phone are tolerated until the NOT NULL follow-up migration.
drop index if exists public.contacts_phone_norm_uniq;
create unique index contacts_phone_norm_uniq
  on public.contacts (public.normalize_phone(phone))
  where public.normalize_phone(phone) is not null;
