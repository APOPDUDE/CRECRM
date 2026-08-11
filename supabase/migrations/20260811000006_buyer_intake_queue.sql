-- Tag someone "buyer" in GHL, review them in the CRM (Alex 2026-08-11).
--
-- HOLD FOR REVIEW, explicitly (Alex's call): a GHL tag does NOT create a client. Tagging is a
-- one-tap action on a phone and a mistag would otherwise mint a real client row that then trips
-- the one-active-client-per-contact rule and pollutes the buyer roster. So the tag lands here,
-- in a queue, and only Alex approving it creates the client.
--
-- The queue is deliberately its OWN table rather than a `clients.status='prospect'` row:
-- a pending intake is not a client yet, has no criteria, and must not appear in the roster,
-- the blast lists, or the matching engine.

create type buyer_intake_status as enum ('pending', 'approved', 'dismissed');

create table buyer_intakes (
  id uuid primary key default gen_random_uuid(),
  -- one queue entry per GHL contact, so re-running the sweep is a no-op
  ghl_contact_id text not null unique,
  contact_id uuid references contacts(id) on delete set null,
  first_name text,
  last_name text,
  phone text,
  email text,
  company_name text,
  source lead_source,
  status buyer_intake_status not null default 'pending',
  client_id uuid references clients(id) on delete set null,
  dismissed_reason text,
  tagged_at timestamptz not null default now(),
  reviewed_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buyer_intakes_approved_has_client
    check (status <> 'approved' or client_id is not null),
  constraint buyer_intakes_reviewed_has_timestamp
    check (status = 'pending' or reviewed_at is not null)
);

comment on table buyer_intakes is
  'Review queue for GHL contacts tagged "buyer". A row here is NOT a client -- approving one '
  'creates the clients row and links it back via client_id.';

create index buyer_intakes_pending_idx on buyer_intakes (tagged_at desc) where status = 'pending';
create index buyer_intakes_contact_idx on buyer_intakes (contact_id);

create trigger buyer_intakes_updated_at
  before update on buyer_intakes
  for each row execute function set_updated_at();

alter table buyer_intakes enable row level security;
create policy buyer_intakes_auth_all on buyer_intakes
  for all to authenticated using (true) with check (true);

-- Queue a GHL buyer tag. Idempotent on ghl_contact_id, and deliberately does NOT resurrect a
-- row Alex already approved or dismissed -- re-tagging someone he has dealt with must not put
-- them back in his face.
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

  insert into buyer_intakes (ghl_contact_id, contact_id, first_name, last_name, phone, email,
                             company_name, source, raw)
  values (v_ghl, v_contact, v_first, v_last, v_phone, v_email, v_company,
          case when v_source is not null and exists (
                 select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'lead_source' and e.enumlabel = v_source)
               then v_source::lead_source else null end,
          p)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'intake_id', v_id, 'status', 'pending',
                            'contact_id', v_contact, 'already', false);
end $function$;

comment on function intake_buyer_tag(jsonb) is
  'Queue a GHL contact tagged "buyer" for review. Idempotent per ghl_contact_id; never '
  'resurrects an already-reviewed entry. Creates NO client -- approval does that.';

-- Approval happens in the app: Alex fills in the existing buyer form, that creates the client,
-- and this records which client the queue entry became.
create or replace function approve_buyer_intake(p_intake_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
as $function$
declare v_row buyer_intakes;
begin
  update buyer_intakes
  set status = 'approved', client_id = p_client_id, reviewed_at = now(), dismissed_reason = null
  where id = p_intake_id and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'no pending intake with that id');
  end if;
  return jsonb_build_object('ok', true, 'intake_id', v_row.id, 'client_id', v_row.client_id);
end $function$;

create or replace function dismiss_buyer_intake(p_intake_id uuid, p_reason text default null)
returns jsonb
language plpgsql
as $function$
declare v_row buyer_intakes;
begin
  update buyer_intakes
  set status = 'dismissed', reviewed_at = now(),
      dismissed_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_intake_id and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'no pending intake with that id');
  end if;
  return jsonb_build_object('ok', true, 'intake_id', v_row.id);
end $function$;

-- SECURITY DEFINER RPCs are not anon-callable here (standing rule since 2026-07-06); the
-- edge function calls this one with the service role.
revoke execute on function intake_buyer_tag(jsonb) from public, anon;
