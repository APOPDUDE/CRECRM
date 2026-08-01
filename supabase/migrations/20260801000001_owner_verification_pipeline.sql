-- Owner verification pipeline: make "where is this owner in the VA workflow" a first-class,
-- filterable fact instead of something inferred from link counts.
--
--   unverified -> exported (on a skip-trace list) -> calling (VA working it)
--     -> verified | unreachable | do_not_call
--
-- The loop this serves:
--   radius export (CSV, parcel-keyed) -> Terrakotta skip-trace -> VA calls
--   -> VA tags the contact in GHL (owner-verified / owner-unreachable)
--   -> GHL workflow POSTs to the ghl-verify edge function -> ghl_verify_owner() below.
--
-- 'verified' stays consistent with owner_contacts: the backfill and the GHL intake fn both
-- set it exactly when a confirmed link exists.

create type owner_verification_status as enum
  ('unverified', 'exported', 'calling', 'verified', 'unreachable', 'do_not_call');

alter table owners
  add column verification_status owner_verification_status not null default 'unverified',
  add column verification_note text,
  add column verification_updated_at timestamptz;

create index owners_verification_status_idx on owners (verification_status);

comment on column owners.verification_status is
  'VA pipeline state. verified is kept in lockstep with owner_contacts.confidence=confirmed; '
  'exported/calling are workflow markers set when a list goes out to skip-trace.';

-- backfill: anything already holding a confirmed contact is verified
update owners o
set verification_status = 'verified', verification_updated_at = now()
where exists (select 1 from owner_contacts oc
              where oc.owner_id = o.id and oc.confidence = 'confirmed');

-- ---------------------------------------------------------------- GHL -> CRM intake
--
-- Called by the ghl-verify edge function when the VA marks a contact in GHL.
-- p = {
--   status: 'verified' | 'unreachable' | 'do_not_call',   (default 'verified')
--   parcel: '<parcel id>',            -- THE join key (rides the CSV -> Terrakotta -> GHL trip)
--   address: '...', city: '...',      -- fallback match when the parcel didn't survive
--   phone, first, last, email, ghl_contact_id, role,
--   notes: 'call summary from the VA'  -- filed into communications
-- }
create or replace function ghl_verify_owner(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text := coalesce(nullif(p->>'status', ''), 'verified');
  v_parcel   text := nullif(btrim(coalesce(p->>'parcel', '')), '');
  v_addr     text := nullif(btrim(coalesce(p->>'address', '')), '');
  v_city     text := nullif(btrim(coalesce(p->>'city', '')), '');
  v_phone    text := normalize_phone(p->>'phone');
  v_first    text := nullif(btrim(coalesce(p->>'first', '')), '');
  v_last     text := nullif(btrim(coalesce(p->>'last', '')), '');
  v_email    text := nullif(btrim(coalesce(p->>'email', '')), '');
  v_ghl      text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_notes    text := nullif(btrim(coalesce(p->>'notes', '')), '');
  v_prop     properties;
  v_owner    uuid;
  v_contact  uuid;
begin
  if v_status not in ('verified', 'unreachable', 'do_not_call') then
    return jsonb_build_object('ok', false, 'error', 'bad status: ' || v_status);
  end if;

  if v_parcel is not null then
    select * into v_prop from properties where parcel_number = v_parcel limit 1;
  end if;
  if v_prop.id is null and v_addr is not null then
    select * into v_prop from properties
    where normalize_street(address) = normalize_street(v_addr)
      and (v_city is null or city is null or upper(btrim(city)) = upper(v_city))
    limit 1;
  end if;
  if v_prop.id is null then
    return jsonb_build_object('ok', false, 'error', 'property not found',
                              'tried_parcel', v_parcel, 'tried_address', v_addr);
  end if;

  v_owner := v_prop.owner_id;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'property has no owner entity',
                              'property_id', v_prop.id);
  end if;

  -- owner-level outcomes that don't need a contact
  if v_status in ('unreachable', 'do_not_call') then
    update owners
    set verification_status = v_status::owner_verification_status,
        verification_note = coalesce(v_notes, verification_note),
        verification_updated_at = now()
    where id = v_owner;
    if v_status = 'do_not_call' and v_phone is not null then
      update contacts set do_not_call = true where normalize_phone(phone) = v_phone;
    end if;
    return jsonb_build_object('ok', true, 'owner_id', v_owner, 'status', v_status);
  end if;

  -- verified: need a human, phone identity first
  if v_phone is null and v_ghl is null then
    return jsonb_build_object('ok', false, 'error', 'verified needs a phone or ghl_contact_id');
  end if;

  select id into v_contact from contacts
  where (v_phone is not null and normalize_phone(phone) = v_phone) limit 1;

  if v_contact is null then
    insert into contacts (first_name, last_name, phone, email, source_system)
    values (coalesce(v_first, 'Unknown'), v_last, v_phone, v_email, 'ghl')
    returning id into v_contact;
  else
    update contacts c
    set first_name = case when c.first_name in ('Unknown','') or c.first_name is null
                          then coalesce(v_first, c.first_name) else c.first_name end,
        last_name  = coalesce(c.last_name, v_last),
        email      = coalesce(c.email, v_email)
    where c.id = v_contact;
  end if;

  insert into owner_contacts (owner_id, contact_id, role, confidence, match_basis,
                              verified_at, verified_by, notes)
  values (v_owner, v_contact, coalesce(nullif(p->>'role',''), 'owner'), 'confirmed',
          'ghl_va_call', now(), 'ghl_va', v_notes)
  on conflict (owner_id, contact_id) do update
    set confidence = 'confirmed',
        verified_at = coalesce(owner_contacts.verified_at, now()),
        verified_by = coalesce(owner_contacts.verified_by, 'ghl_va'),
        match_basis = 'ghl_va_call',
        notes = coalesce(excluded.notes, owner_contacts.notes);

  update owners
  set verification_status = 'verified',
      verification_note = coalesce(v_notes, verification_note),
      verification_updated_at = now()
  where id = v_owner;

  -- the VA's call notes become part of the conversation history
  if v_notes is not null then
    insert into communications (contact_id, phone, owner_id, property_id, channel, direction,
                                occurred_at, body, source, external_id)
    values (v_contact, v_phone, v_owner, v_prop.id, 'call', 'outbound', now(),
            v_notes, 'ghl',
            'verify:' || coalesce(v_ghl, v_phone, v_contact::text) || ':' ||
            substr(md5(v_notes), 1, 12))
    on conflict (source, external_id) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'owner_id', v_owner, 'contact_id', v_contact,
                            'property_id', v_prop.id, 'status', 'verified');
end $$;

revoke all on function ghl_verify_owner(jsonb) from public, anon;
grant execute on function ghl_verify_owner(jsonb) to service_role;

-- ---------------------------------------------------------------- export stamping
-- Called from the app when a skip-trace CSV is generated, so the pipeline shows what's out.
create or replace function mark_owners_exported(p_property_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  with upd as (
    update owners o
    set verification_status = 'exported', verification_updated_at = now()
    where o.id in (select distinct owner_id from properties
                   where id = any(p_property_ids) and owner_id is not null)
      and o.verification_status = 'unverified'
    returning 1
  )
  select jsonb_build_object('owners_marked', count(*)) from upd;
$$;

revoke all on function mark_owners_exported(uuid[]) from public, anon;
grant execute on function mark_owners_exported(uuid[]) to authenticated, service_role;

-- recreate (not replace) the view: the new column lands mid-list
drop view if exists v_property_owner_context;
create view v_property_owner_context
with (security_invoker = true) as
select
  p.id                                            as property_id,
  p.owner_id,
  o.display_name                                  as owner_name,
  o.kind                                          as owner_kind,
  o.mailing_address                               as owner_mailing_address,
  o.verification_status                           as owner_verification_status,
  coalesce(port.property_count, 0)                as owner_property_count,
  port.portfolio_sf                               as owner_portfolio_sf,
  port.portfolio_acres                            as owner_portfolio_acres,
  coalesce(oc.contact_count, 0)                   as owner_contact_count,
  coalesce(oc.confirmed_count, 0)                 as owner_confirmed_contact_count,
  coalesce(oc.confirmed_count, 0) > 0             as owner_contact_verified,
  coalesce(oc.do_not_call_count, 0) > 0           as owner_do_not_call,
  comm.comm_count,
  comm.last_contacted_at
from properties p
left join owners o on o.id = p.owner_id
left join lateral (
  select count(*) as property_count, sum(p2.building_sf) as portfolio_sf,
         sum(p2.land_acres) as portfolio_acres
  from properties p2 where p2.owner_id = p.owner_id
) port on p.owner_id is not null
left join lateral (
  select count(*) as contact_count,
         count(*) filter (where ocx.confidence = 'confirmed') as confirmed_count,
         count(*) filter (where c.do_not_call) as do_not_call_count
  from owner_contacts ocx join contacts c on c.id = ocx.contact_id
  where ocx.owner_id = p.owner_id
) oc on p.owner_id is not null
left join lateral (
  select count(*) as comm_count, max(cm.occurred_at) as last_contacted_at
  from communications cm
  where cm.property_id = p.id
     or (p.owner_id is not null and cm.owner_id = p.owner_id)
) comm on true;

revoke all on v_property_owner_context from anon;
grant select on v_property_owner_context to authenticated;
