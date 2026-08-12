-- Mark a buyer from the contact you are already looking at (Alex 2026-08-12).
--
-- The buyer review queue existed but had exactly one way in: a "buyer" tag in GHL. Reading a
-- contact in the CRM and realising they are a buyer meant switching to GHL to tag them and
-- waiting for the sweep. Same intent, same queue -- it just needs a door on this side.
--
-- It goes to the queue, NOT straight to a client, for the reason 20260811000006 gives: marking is
-- one tap and a client needs criteria. The strip on the Buyers page is where the criteria get
-- filled in, and that is unchanged.
--
-- ghl_contact_id therefore stops being mandatory: an intake raised here has no GHL id. The UNIQUE
-- on it still holds for the rows that have one (Postgres allows many NULLs), so the GHL sweep
-- stays idempotent.

alter table buyer_intakes alter column ghl_contact_id drop not null;

comment on column buyer_intakes.ghl_contact_id is
  'The GHL contact whose "buyer" tag raised this. NULL when the intake was raised in the CRM '
  'instead (contact_id is set in that case).';

-- One pending question per person. Two GHL contacts can resolve to the same CRM contact, and a
-- contact can be marked here after being tagged there -- either way it is the same question and
-- must appear on the strip once.
create unique index buyer_intakes_pending_contact_idx
  on buyer_intakes (contact_id)
  where status = 'pending' and contact_id is not null;

-- Mark a contact as a buyer. Returns what happened rather than raising, so the UI can say it:
--   already_a_client -- they are already a buyer; nothing queued, here is the client
--   pending          -- on the strip now (already=true if they were already on it)
create or replace function mark_contact_as_buyer(p_contact_id uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_c        contacts;
  v_client   uuid;
  v_existing buyer_intakes;
  v_company  text;
  v_id       uuid;
begin
  select * into v_c from contacts where id = p_contact_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'error', 'contact not found');
  end if;

  -- Same guard as intake_buyer_tag: an active client means they are already a buyer, and
  -- queueing them would only lead to an insert that the one-active-client-per-contact index
  -- rejects at the end of the form.
  select id into v_client from clients
  where contact_id = v_c.id
    and status in ('prospect', 'searching', 'negotiating')
  order by created_at asc limit 1;
  if v_client is not null then
    return jsonb_build_object('ok', true, 'status', 'already_a_client', 'client_id', v_client);
  end if;

  select * into v_existing from buyer_intakes
  where contact_id = v_c.id and status = 'pending' limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'status', 'pending',
                              'intake_id', v_existing.id, 'already', true);
  end if;

  select name into v_company from companies where id = v_c.company_id;

  insert into buyer_intakes (ghl_contact_id, contact_id, first_name, last_name, phone, email,
                             company_name, raw)
  values (null, v_c.id, v_c.first_name, v_c.last_name, v_c.phone, v_c.email, v_company,
          jsonb_build_object('marked_in_crm', true, 'contact_id', v_c.id))
  returning id into v_id;

  -- Archiving means "no evidence this is a real relationship". Calling someone a buyer is that
  -- evidence, so they rejoin the live book -- otherwise they'd sit on the Buyers strip while
  -- being invisible in Contacts.
  update contacts set archived = false where id = v_c.id and archived;

  return jsonb_build_object('ok', true, 'status', 'pending', 'intake_id', v_id, 'already', false);
end $function$;

comment on function mark_contact_as_buyer(uuid) is
  'Raise a pending buyer intake for a CRM contact -- the same queue the GHL "buyer" tag feeds. '
  'Creates NO client; filling in the criteria on the Buyers page does that. A contact who '
  'already has an active client is reported back as already_a_client and nothing is queued.';

revoke execute on function mark_contact_as_buyer(uuid) from public, anon;
grant execute on function mark_contact_as_buyer(uuid) to authenticated;

-- The GHL path now has to respect the one-pending-question-per-contact index: a second tag for
-- someone already on the strip is that same question arriving twice, not a new one.
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

    -- Already on the strip (tagged under another GHL id, or marked in the CRM): adopt that
    -- entry rather than raising a second one. Records the GHL id against it so re-running the
    -- sweep still short-circuits above.
    if v_client is null then
      select * into v_existing from buyer_intakes
      where contact_id = v_contact and status = 'pending' limit 1;
      if v_existing.id is not null then
        update buyer_intakes
        set ghl_contact_id = coalesce(ghl_contact_id, v_ghl),
            first_name     = coalesce(first_name, v_first),
            last_name      = coalesce(last_name, v_last),
            phone          = coalesce(phone, v_phone),
            email          = coalesce(email, v_email),
            company_name   = coalesce(company_name, v_company),
            raw            = coalesce(raw, p)
        where id = v_existing.id;
        return jsonb_build_object('ok', true, 'intake_id', v_existing.id, 'status', 'pending',
                                  'contact_id', v_contact, 'already', true);
      end if;
    end if;
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

revoke execute on function intake_buyer_tag(jsonb) from public, anon;
