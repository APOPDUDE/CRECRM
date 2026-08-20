-- A verified contact bridges the spine, whichever door verified them.
--
-- The spine's contact_id ("the ONLY bridge to the verified book") was set by
-- apply_smartlead_event for EMAIL verifications -- but a PHONE verification through ghl-verify
-- (the GHL interested/not-interested tag flow) never told the spine, so a person Alex just
-- spoke to still looked un-reached on every outreach list. The rule lives in Postgres, not in
-- any one flow: whenever a contact is verified, every spine target holding one of their
-- channels (phone or email) and no contact yet gets bridged.
--
-- Backfill included: 2,090 targets checked against the whole verified book once.

begin;

create or replace function outreach_bridge_verified_contact() returns trigger
language plpgsql security definer
set search_path to public
as $$
begin
  if new.verified_at is null then
    return new;
  end if;

  if normalize_phone(new.phone) is not null then
    update outreach_targets t
       set contact_id = new.id
      from outreach_calls oc
     where oc.target_id = t.id
       and t.contact_id is null
       and normalize_phone(oc.phone) = normalize_phone(new.phone);
  end if;

  if new.email is not null and btrim(new.email) <> '' then
    update outreach_targets t
       set contact_id = new.id
      from outreach_email oe
     where oe.target_id = t.id
       and t.contact_id is null
       and lower(btrim(oe.email)) = lower(btrim(new.email));
  end if;

  return new;
end;
$$;

drop trigger if exists contacts_bridge_outreach on contacts;
create trigger contacts_bridge_outreach
  after insert or update of verified_at, phone, email on contacts
  for each row
  when (new.verified_at is not null)
  execute function outreach_bridge_verified_contact();

comment on function outreach_bridge_verified_contact() is
  'Whenever a contact is verified (any door: ghl-verify phone flow, Smartlead reply, manual), '
  'spine targets holding that phone or email get contact_id set -- the person reads as '
  'REACHED on every outreach list.';

-- One-time backfill against the whole verified book.
update outreach_targets t
   set contact_id = c.id
  from outreach_calls oc, contacts c
 where oc.target_id = t.id
   and t.contact_id is null
   and c.verified_at is not null
   and normalize_phone(c.phone) is not null
   and normalize_phone(oc.phone) = normalize_phone(c.phone);

update outreach_targets t
   set contact_id = c.id
  from outreach_email oe, contacts c
 where oe.target_id = t.id
   and t.contact_id is null
   and c.verified_at is not null
   and c.email is not null
   and lower(btrim(oe.email)) = lower(btrim(c.email));

commit;
