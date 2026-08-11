-- A buyer tag on someone who is ALREADY a buyer is not new work (Alex 2026-08-11, same day).
--
-- v1 of intake_buyer_tag resolved the contact but never asked whether that contact already had a
-- client, so the first sweep queued 8 people who were already fully-formed buyers -- deal_type
-- 'sale', is_rep, buyer_kind, drawn target areas and all. Only 1 of the 9 was genuinely new.
--
-- That is not just noise. `clients` has a partial unique index allowing ONE active client per
-- contact, so filling in the form for any of those 8 would have failed the insert at the end of
-- the flow, after the typing. Better to never put them on the strip.
--
-- So: an active client (prospect / searching / negotiating -- the same set that index guards)
-- means the tag resolved to someone we already have. Record the intake as already-approved and
-- linked to that client, which keeps the audit trail without asking Alex for anything. Only a
-- contact with no active client is a real question.

create or replace function intake_buyer_tag(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ghl     text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone   text := normalize_phone(p->>'phone');
  v_email   text := nullif(btrim(coalesce(p->>'email', '')), '');
  v_first   text := nullif(btrim(coalesce(p->>'first', '')), '');
  v_last    text := nullif(btrim(coalesce(p->>'last', '')), '');
  v_company text := nullif(btrim(coalesce(p->>'company_name', '')), '');
  v_source  text := nullif(btrim(coalesce(p->>'source', '')), '');
  v_contact uuid;
  v_client  uuid;
  v_existing buyer_intakes;
  v_id      uuid;
begin
  if v_ghl is null then
    return jsonb_build_object('ok', false, 'error', 'ghl_contact_id required');
  end if;

  select * into v_existing from buyer_intakes where ghl_contact_id = v_ghl;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'intake_id', v_existing.id,
                              'status', v_existing.status, 'already', true);
  end if;

  if v_phone is not null then
    select id into v_contact from contacts
    where normalize_phone(phone) = v_phone
    order by created_at asc limit 1;
  end if;
  if v_contact is null and v_email is not null then
    select id into v_contact from contacts
    where lower(email) = lower(v_email)
    order by created_at asc limit 1;
  end if;

  -- Already a client? Then there is nothing to ask. Matches the statuses the one-active-client
  -- -per-contact index covers, so we never queue someone whose approval would fail anyway.
  if v_contact is not null then
    select id into v_client from clients
    where contact_id = v_contact
      and status in ('prospect', 'searching', 'negotiating')
    order by created_at asc limit 1;
  end if;

  insert into buyer_intakes (ghl_contact_id, contact_id, first_name, last_name, phone, email,
                             company_name, source, raw,
                             status, client_id, reviewed_at)
  values (v_ghl, v_contact, v_first, v_last, v_phone, v_email, v_company,
          case when v_source is not null and exists (
                 select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'lead_source' and e.enumlabel = v_source)
               then v_source::lead_source else null end,
          p,
          case when v_client is null then 'pending' else 'approved' end::buyer_intake_status,
          v_client,
          case when v_client is null then null else now() end)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'intake_id', v_id,
                            'status', case when v_client is null then 'pending' else 'approved' end,
                            'contact_id', v_contact, 'client_id', v_client,
                            'already_a_client', v_client is not null, 'already', false);
end $function$;

comment on function intake_buyer_tag(jsonb) is
  'Queue a GHL contact tagged "buyer" for review. Idempotent per ghl_contact_id; never '
  'resurrects an already-reviewed entry. A contact who already has an ACTIVE client is recorded '
  'as approved against that client instead of being queued -- they are already a buyer, and '
  'approving them would violate the one-active-client-per-contact index. Creates NO client.';

-- Retire the 8 that v1 wrongly queued: they each already had exactly one active client.
update buyer_intakes bi
set status = 'approved',
    client_id = cl.id,
    reviewed_at = now()
from clients cl
where cl.contact_id = bi.contact_id
  and cl.status in ('prospect', 'searching', 'negotiating')
  and bi.status = 'pending'
  and bi.client_id is null;
