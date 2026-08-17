-- Communications that arrive BEFORE their contact exists stay orphaned forever.
--
-- resolve_communication_identity links contact_id at INSERT time only, so a GHL call/text/
-- note that lands while the person is still unknown (exactly the buyer-tag case: the VA
-- talks to someone new, the conversation syncs immediately, the contact is minted moments
-- or days later) never shows on the contact page. Austin Taylor Jones's call + 4 texts sat
-- unlinked this way on 2026-08-17.
--
-- Fix: when a contact appears (or its phone changes), adopt the orphans that match its
-- number. Same digit normalization and company-resolution rules as the insert-time resolver.
-- Safe against webhook storms: communications_push_manual_note early-returns for anything
-- that is not a manual note, and a manual note with an unchanged body also returns.

-- Orphans are a couple hundred rows; the partial index keeps per-contact adoption a lookup
-- rather than a scan even during bulk contact imports. normalize_phone is IMMUTABLE.
create index if not exists communications_orphan_phone_idx
  on communications (normalize_phone(phone))
  where contact_id is null;

create or replace function adopt_orphan_communications()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  digits text := normalize_phone(new.phone);
begin
  if digits is null or length(digits) <> 10 then
    return new;
  end if;

  update communications m
  set contact_id = new.id,
      owner_company_id = coalesce(
        m.owner_company_id,
        case when new.company_id is not null and exists (
               select 1 from properties p where p.owner_company_id = new.company_id)
             then new.company_id end)
  where m.contact_id is null
    and normalize_phone(m.phone) = digits;

  return new;
end $$;

drop trigger if exists contacts_adopt_orphan_comms on contacts;
create trigger contacts_adopt_orphan_comms
  after insert or update of phone on contacts
  for each row execute function adopt_orphan_communications();

-- Backfill the existing orphans whose person exists today. Same tie-break as the
-- insert-time resolver: prefer the company-seated twin, then the oldest.
update communications m
set contact_id = pick.id,
    owner_company_id = coalesce(m.owner_company_id, pick.owner_company)
from (
  select distinct on (normalize_phone(c.phone))
         normalize_phone(c.phone) as digits,
         c.id,
         case when c.company_id is not null and exists (
                select 1 from properties p where p.owner_company_id = c.company_id)
              then c.company_id end as owner_company
  from contacts c
  where normalize_phone(c.phone) is not null
  order by normalize_phone(c.phone), (c.company_id is not null) desc, c.created_at asc
) pick
where m.contact_id is null
  and normalize_phone(m.phone) = pick.digits;
