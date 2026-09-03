-- Owner portfolios: one principal behind several deed entities (2026-09-02).
--
-- Alex, 2026-09-02: "if we have a verified contact for one owner then it should be a
-- verified contact for the rest of the portfolio" -- 5849 Dean Dairy (Bartholomew Real
-- Estate LLC) and 9501 Palm River Rd (Bre II LLC) are the same person, but a contact is
-- seated at ONE companies row, so Brad Bartholomew verified Bre II and nothing else.
-- Worse, "Add verified owner" on Dean Dairy returned ok and changed nothing: the routine
-- seats fill-only, and Brad already had a home company.
--
-- Model: `companies.portfolio_id` groups the deed entities one principal holds. The
-- entities stay distinct (the LLC on the deed is a fact from the county roll); the
-- PEOPLE are shared. Every read that asks "who do we know at this owner" now looks
-- across the portfolio: the owner-context view, the precomputed rollup, the property
-- page. A contact still has one home company_id -- nothing about verification moved.
--
-- Two ways a portfolio forms:
--   1. A human puts a known person on a property whose owner is a different entity
--      (`ghl_verify_owner` links the two companies instead of no-op'ing).
--   2. Seed below: owning entities sharing a street mailing address with an entity that
--      already holds a verified person (small groups, no c/o / PO box / tax-agent
--      addresses -- those are shared by unrelated owners).
-- `unlink_owner_portfolio(company)` undoes either from the property page.

alter table public.companies add column if not exists portfolio_id uuid;
create index if not exists companies_portfolio_idx
  on public.companies (portfolio_id) where portfolio_id is not null;

comment on column public.companies.portfolio_id is
  'Groups the deed entities one principal holds; contacts seated at any member count for all. NULL = stands alone.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The company itself plus every sibling in its portfolio. Invoker: returns what the
-- caller can see.
create or replace function public.portfolio_company_ids(p_company uuid)
returns uuid[]
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(c2.id), array[p_company])
  from public.companies c1
  join public.companies c2
    on c2.id = c1.id
    or (c1.portfolio_id is not null and c2.portfolio_id = c1.portfolio_id)
  where c1.id = p_company;
$$;

-- Put two companies in the same portfolio (merging two existing groups if both have
-- one). Returns the portfolio id. Idempotent.
create or replace function public.link_owner_portfolio(p_company_a uuid, p_company_b uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_a uuid; v_b uuid; v_pid uuid;
begin
  if p_company_a is null or p_company_b is null or p_company_a = p_company_b then
    return (select portfolio_id from public.companies where id = coalesce(p_company_a, p_company_b));
  end if;
  select portfolio_id into v_a from public.companies where id = p_company_a;
  select portfolio_id into v_b from public.companies where id = p_company_b;
  v_pid := coalesce(v_a, v_b, gen_random_uuid());
  if v_a is not null and v_b is not null and v_a <> v_b then
    update public.companies set portfolio_id = v_pid where portfolio_id = v_b;
  end if;
  update public.companies set portfolio_id = v_pid
  where id in (p_company_a, p_company_b) and portfolio_id is distinct from v_pid;
  return v_pid;
end $$;

-- Take one company out of its portfolio. A group left with a single member is
-- dissolved (portfolio_id back to NULL) so "stands alone" has one representation.
create or replace function public.unlink_owner_portfolio(p_company uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_pid uuid;
begin
  select portfolio_id into v_pid from public.companies where id = p_company;
  if v_pid is null then return; end if;
  update public.companies set portfolio_id = null where id = p_company;
  if (select count(*) from public.companies where portfolio_id = v_pid) < 2 then
    update public.companies set portfolio_id = null where portfolio_id = v_pid;
  end if;
end $$;

revoke execute on function public.portfolio_company_ids(uuid) from public, anon;
revoke execute on function public.link_owner_portfolio(uuid, uuid) from public, anon;
revoke execute on function public.unlink_owner_portfolio(uuid) from public, anon;
grant execute on function public.portfolio_company_ids(uuid) to authenticated, service_role;
grant execute on function public.link_owner_portfolio(uuid, uuid) to authenticated, service_role;
grant execute on function public.unlink_owner_portfolio(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- v_property_owner_context: people, counts and best contact across the portfolio.
-- Same columns in the same order (map_properties() serialises the row to jsonb; the
-- app reads it by name), plus `owner_portfolio_id` appended at the end.
-- ---------------------------------------------------------------------------
create or replace view public.v_property_owner_context as
 SELECT p.id AS property_id,
    NULL::uuid AS owner_id,
    c.name AS owner_name,
    c.entity_kind AS owner_kind,
    c.mailing_address AS owner_mailing_address,
        CASE
            WHEN c.id IS NULL THEN NULL::text
            WHEN COALESCE(oc.confirmed_count, 0::bigint) > 0 THEN 'verified'::text
            WHEN c.exported_at IS NOT NULL THEN 'exported'::text
            ELSE 'unverified'::text
        END AS owner_verification_status,
    COALESCE(port.property_count, 0::bigint) AS owner_property_count,
    port.portfolio_sf AS owner_portfolio_sf,
    port.portfolio_acres AS owner_portfolio_acres,
    COALESCE(oc.contact_count, 0::bigint) AS owner_contact_count,
    COALESCE(oc.confirmed_count, 0::bigint) AS owner_confirmed_contact_count,
    COALESCE(oc.confirmed_count, 0::bigint) > 0 AS owner_contact_verified,
    COALESCE(oc.email_verified_count, 0::bigint) > 0 AS owner_email_verified,
    COALESCE(oc.confirmed_count, 0::bigint) > 0 OR COALESCE(oc.email_verified_count, 0::bigint) > 0 AS owner_reachable,
    COALESCE(oc.do_not_call_count, 0::bigint) > 0 AS owner_do_not_call,
    comm.comm_count,
    comm.last_contacted_at,
    mkt.was_on_market,
    mkt.off_market_since,
        CASE
            WHEN p.listing_status = 'off_market'::listing_market_status AND mkt.was_on_market THEN CURRENT_DATE - mkt.off_market_since
            ELSE NULL::integer
        END AS off_market_days,
    best.contact_name AS best_contact_name,
    best.phone AS best_contact_phone,
    best.email AS best_contact_email,
    best.confidence AS best_contact_confidence,
    best.email_verified_at AS best_contact_email_verified_at,
    c.tags AS owner_tags,
    p.owner_company_id,
    c.portfolio_id AS owner_portfolio_id
   FROM properties p
     LEFT JOIN companies c ON c.id = p.owner_company_id
     -- the owning entity and its portfolio siblings; a lone company is a 1-element array
     LEFT JOIN LATERAL ( SELECT array_agg(c2.id) AS ids
           FROM companies c2
          WHERE c2.id = p.owner_company_id
             OR (c.portfolio_id IS NOT NULL AND c2.portfolio_id = c.portfolio_id)) sib ON p.owner_company_id IS NOT NULL
     LEFT JOIN LATERAL ( SELECT count(*) AS property_count,
            sum(p2.gross_sf) AS portfolio_sf,
            sum(p2.land_acres) AS portfolio_acres
           FROM properties p2
          WHERE p2.owner_company_id = ANY (sib.ids)) port ON p.owner_company_id IS NOT NULL
     LEFT JOIN LATERAL ( SELECT count(*) AS contact_count,
            count(*) FILTER (WHERE ct.verified_at IS NOT NULL) AS confirmed_count,
            count(*) FILTER (WHERE ct.email_verified_at IS NOT NULL) AS email_verified_count,
            count(*) FILTER (WHERE ct.do_not_call) AS do_not_call_count
           FROM contacts ct
          WHERE ct.company_id = ANY (sib.ids)) oc ON p.owner_company_id IS NOT NULL
     LEFT JOIN LATERAL ( SELECT count(*) AS comm_count,
            max(cm.occurred_at) AS last_contacted_at
           FROM communications cm
          WHERE cm.property_id = p.id OR p.owner_company_id IS NOT NULL AND cm.owner_company_id = p.owner_company_id) comm ON true
     LEFT JOIN LATERAL ( SELECT p.last_seen_in_sweep IS NOT NULL OR ask.latest IS NOT NULL OR ask.listed IS NOT NULL AS was_on_market,
            GREATEST(p.last_seen_in_sweep::date, ask.latest, ask.listed) AS off_market_since
           FROM ( SELECT max(cx.as_of_date) AS latest,
                    max(cx.listed_at) AS listed
                   FROM comps cx
                  WHERE cx.property_id = p.id AND cx.kind = 'asking'::comp_kind) ask) mkt ON true
     LEFT JOIN LATERAL ( SELECT NULLIF(btrim((ct.first_name || ' '::text) || COALESCE(ct.last_name, ''::text)), ''::text) AS contact_name,
            ct.phone,
            ct.email,
            ct.email_verified_at,
                CASE
                    WHEN ct.verified_at IS NOT NULL THEN 'confirmed'::text
                    ELSE 'likely'::text
                END AS confidence
           FROM contacts ct
          WHERE ct.company_id = ANY (sib.ids) AND NOT ct.do_not_call
          -- the entity's own people before a sibling's, then the usual reachability order
          ORDER BY (ct.company_id <> p.owner_company_id), (ct.verified_at IS NULL), (ct.email_verified_at IS NULL), (ct.phone IS NULL), (ct.email IS NULL)
         LIMIT 1) best ON p.owner_company_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- property_owner_rollup: same aggregation, keyed by portfolio instead of company.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_property_owner_rollup()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_n integer; v_changed integer; v_removed integer;
begin
  create temp table _por on commit drop as
  with
  -- every company keyed by its portfolio (a lone company is its own key)
  pk as (
    select c.id as cid, coalesce(c.portfolio_id, c.id) as pkey from public.companies c
  ),
  port as (
    select pk.pkey, count(*) as property_count
    from public.properties p2 join pk on pk.cid = p2.owner_company_id
    group by 1
  ),
  oc as (
    select pk.pkey,
           count(*) filter (where ct.verified_at is not null)       as confirmed_count,
           count(*) filter (where ct.email_verified_at is not null) as email_verified_count,
           count(*) filter (where ct.do_not_call)                   as do_not_call_count
    from public.contacts ct join pk on pk.cid = ct.company_id
    group by 1
  ),
  best as (
    select distinct on (pk.pkey)
           pk.pkey,
           nullif(btrim((ct.first_name || ' ') || coalesce(ct.last_name, '')), '') as contact_name,
           ct.phone, ct.email, ct.email_verified_at,
           case when ct.verified_at is not null then 'confirmed' else 'likely' end as confidence
    from public.contacts ct join pk on pk.cid = ct.company_id
    where not ct.do_not_call
    order by pk.pkey,
             (ct.verified_at is null), (ct.email_verified_at is null),
             (ct.phone is null), (ct.email is null)
  ),
  comm_p as (
    select cm.property_id as pid, count(*) as c, max(cm.occurred_at) as last_at
    from public.communications cm where cm.property_id is not null group by 1
  ),
  comm_c as (
    select cm.owner_company_id as cid, count(*) as c, max(cm.occurred_at) as last_at
    from public.communications cm where cm.owner_company_id is not null group by 1
  ),
  ovl as (
    select cm.property_id as pid, cm.owner_company_id as cid, count(*) as c
    from public.communications cm
    where cm.property_id is not null and cm.owner_company_id is not null group by 1, 2
  )
  select p.id as property_id,
         p.owner_company_id,
         c.name as owner_name,
         case
           when c.id is null then null::text
           when coalesce(oc.confirmed_count, 0) > 0 then 'verified'
           when c.exported_at is not null then 'exported'
           else 'unverified'
         end as owner_verification_status,
         coalesce(port.property_count, 0) as owner_property_count,
         coalesce(oc.confirmed_count, 0) > 0 as owner_contact_verified,
         coalesce(oc.email_verified_count, 0) > 0 as owner_email_verified,
         (coalesce(oc.confirmed_count, 0) > 0 or coalesce(oc.email_verified_count, 0) > 0) as owner_reachable,
         coalesce(oc.do_not_call_count, 0) > 0 as owner_do_not_call,
         (coalesce(comm_p.c, 0) + coalesce(comm_c.c, 0) - coalesce(ovl.c, 0)) as comm_count,
         greatest(comm_p.last_at, comm_c.last_at) as last_contacted_at,
         best.contact_name, best.phone, best.email, best.confidence, best.email_verified_at,
         nullif(right(regexp_replace(coalesce(best.phone, ''), '\D', '', 'g'), 10), '') as best_contact_phone_key
  from public.properties p
  left join public.companies c on c.id = p.owner_company_id
  left join port    on port.pkey = coalesce(c.portfolio_id, c.id)
  left join oc      on oc.pkey   = coalesce(c.portfolio_id, c.id)
  left join best    on best.pkey = coalesce(c.portfolio_id, c.id)
  left join comm_p  on comm_p.pid = p.id
  left join comm_c  on comm_c.cid = p.owner_company_id
  left join ovl     on ovl.pid = p.id and ovl.cid = p.owner_company_id;

  select count(*) into v_n from _por;
  if v_n = 0 then
    raise exception 'refresh_property_owner_rollup: 0 rows -- refusing to blank the rollup';
  end if;

  insert into public.property_owner_rollup as r (
    property_id, owner_company_id, owner_name, owner_verification_status,
    owner_property_count, owner_contact_verified, owner_email_verified, owner_reachable,
    owner_do_not_call, comm_count, last_contacted_at, best_contact_name, best_contact_phone,
    best_contact_email, best_contact_confidence, best_contact_email_verified_at,
    best_contact_phone_key, refreshed_at)
  select t.*, now() from _por t
  on conflict (property_id) do update set
    owner_company_id = excluded.owner_company_id,
    owner_name = excluded.owner_name,
    owner_verification_status = excluded.owner_verification_status,
    owner_property_count = excluded.owner_property_count,
    owner_contact_verified = excluded.owner_contact_verified,
    owner_email_verified = excluded.owner_email_verified,
    owner_reachable = excluded.owner_reachable,
    owner_do_not_call = excluded.owner_do_not_call,
    comm_count = excluded.comm_count,
    last_contacted_at = excluded.last_contacted_at,
    best_contact_name = excluded.best_contact_name,
    best_contact_phone = excluded.best_contact_phone,
    best_contact_email = excluded.best_contact_email,
    best_contact_confidence = excluded.best_contact_confidence,
    best_contact_email_verified_at = excluded.best_contact_email_verified_at,
    best_contact_phone_key = excluded.best_contact_phone_key,
    refreshed_at = now()
  -- Only rewrite rows that actually moved. Without this every cycle churns 127k tuples.
  where (r.owner_company_id, r.owner_name, r.owner_verification_status,
         r.owner_property_count, r.owner_contact_verified, r.owner_email_verified,
         r.owner_reachable, r.owner_do_not_call, r.comm_count, r.last_contacted_at,
         r.best_contact_name, r.best_contact_phone, r.best_contact_email,
         r.best_contact_confidence, r.best_contact_email_verified_at, r.best_contact_phone_key)
        is distinct from
        (excluded.owner_company_id, excluded.owner_name, excluded.owner_verification_status,
         excluded.owner_property_count, excluded.owner_contact_verified, excluded.owner_email_verified,
         excluded.owner_reachable, excluded.owner_do_not_call, excluded.comm_count, excluded.last_contacted_at,
         excluded.best_contact_name, excluded.best_contact_phone, excluded.best_contact_email,
         excluded.best_contact_confidence, excluded.best_contact_email_verified_at, excluded.best_contact_phone_key);
  get diagnostics v_changed = row_count;

  delete from public.property_owner_rollup r
  where not exists (select 1 from _por t where t.property_id = r.property_id);
  get diagnostics v_removed = row_count;

  raise notice 'property_owner_rollup: % source rows, % written, % removed', v_n, v_changed, v_removed;
  return v_n;
end $function$;

-- ---------------------------------------------------------------------------
-- ghl_verify_owner v6: a known person put on another entity's property links the two
-- entities into one portfolio (was: fill-only seat, i.e. a silent no-op). Everything
-- else is v5 verbatim. The response gains `portfolio_id` and, when a link happened,
-- `linked_company_id` / `linked_company_name` so the caller can say what it did.
-- ---------------------------------------------------------------------------
create or replace function public.ghl_verify_owner(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status   text := replace(coalesce(nullif(p->>'status', ''), 'verified'), ' ', '_');
  v_parcel   text := nullif(btrim(coalesce(p->>'parcel', '')), '');
  v_addr     text := nullif(btrim(coalesce(p->>'address', '')), '');
  v_city     text := nullif(btrim(coalesce(p->>'city', '')), '');
  v_phone    text := normalize_phone(p->>'phone');
  v_first    text := nullif(btrim(coalesce(p->>'first', '')), '');
  v_last     text := nullif(btrim(coalesce(p->>'last', '')), '');
  v_email    text := nullif(btrim(coalesce(p->>'email', '')), '');
  v_ghl      text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_notes    text := nullif(btrim(coalesce(p->>'notes', '')), '');
  v_oname    text := nullif(btrim(coalesce(p->>'owner_name', '')), '');
  v_tag      text := lower(nullif(btrim(coalesce(p->>'tag', '')), ''));
  v_prop     properties;
  v_company  uuid;
  v_contact  uuid;
  v_mint     text;
  v_home     uuid;
  v_pid      uuid;
  v_linked   uuid;
begin
  if v_status not in ('verified', 'unreachable', 'do_not_call', 'wrong_person') then
    return jsonb_build_object('ok', false, 'error', 'bad status: ' || v_status);
  end if;

  select * into v_prop from properties where id = find_property(v_parcel, v_addr, v_city);
  if v_prop.id is null then
    return jsonb_build_object('ok', false, 'error', 'property not found',
                              'tried_parcel', v_parcel, 'tried_address', v_addr,
                              'tried_city', v_city);
  end if;

  v_company := v_prop.owner_company_id;

  if v_status = 'wrong_person' then
    if v_phone is null then
      return jsonb_build_object('ok', false, 'error', 'wrong_person needs a phone');
    end if;
    select id into v_contact from contacts where normalize_phone(phone) = v_phone limit 1;
    if v_contact is not null then
      if v_company is not null then
        -- the owner_contacts-link delete, translated: un-seat from THIS owning company only
        update contacts set company_id = null
        where id = v_contact and company_id = v_company;
      end if;
      insert into communications (contact_id, phone, owner_company_id, property_id, channel, direction,
                                  occurred_at, body, source, external_id)
      values (v_contact, v_phone, v_company, v_prop.id, 'note', 'unknown', now(),
              '[GHL tag: wrong person]' || coalesce(E'\n' || v_notes, ''), 'ghl',
              'wrong:' || coalesce(v_ghl, v_phone) || ':' || substr(md5(now()::text), 1, 8))
      on conflict (source, external_id) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'owner_id', v_company, 'contact_id', v_contact,
                              'status', 'wrong_person');
  end if;

  if v_company is null then
    v_mint := coalesce(v_oname,
                       nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), ''));
    if v_mint is null or v_mint = 'Unknown' then
      return jsonb_build_object('ok', false, 'error', 'property has no owner entity and no name to mint one',
                                'property_id', v_prop.id);
    end if;
    select id into v_company from companies
    where normalized_name = normalize_owner_name(v_mint)
    order by created_at limit 1;
    if v_company is null then
      insert into companies (name, type, source, entity_kind, mailing_address)
      values (v_mint, 'owning_entity', 'county_appraiser', 'unknown', v_prop.owner_mailing_address)
      returning id into v_company;
    end if;
    update properties set owner_company_id = v_company, owner_name = coalesce(owner_name, v_mint)
    where id = v_prop.id;
  end if;

  if v_status in ('unreachable', 'do_not_call') then
    if v_status = 'do_not_call' and v_phone is not null then
      update contacts set do_not_call = true where normalize_phone(phone) = v_phone;
    end if;
    return jsonb_build_object('ok', true, 'owner_id', v_company, 'status', v_status);
  end if;

  if v_phone is null and v_ghl is null then
    return jsonb_build_object('ok', false, 'error', 'verified needs a phone or ghl_contact_id');
  end if;

  select id into v_contact from contacts
  where (v_phone is not null and normalize_phone(phone) = v_phone) limit 1;

  if v_contact is null then
    insert into contacts (first_name, last_name, phone, email, source, ghl_contact_id, verified_at, verified_by)
    values (coalesce(v_first, 'Unknown'), v_last, v_phone, v_email, 'ghl', v_ghl, now(), 'ghl_va')
    returning id into v_contact;
  else
    update contacts c
    set first_name = case when c.first_name in ('Unknown','') or c.first_name is null
                          then coalesce(v_first, c.first_name) else c.first_name end,
        last_name  = coalesce(c.last_name, v_last),
        email      = coalesce(c.email, v_email),
        ghl_contact_id = coalesce(c.ghl_contact_id, v_ghl),
        verified_at = coalesce(c.verified_at, now()),
        verified_by = coalesce(c.verified_by, 'ghl_va'),
        archived   = false
    where c.id = v_contact;
  end if;

  -- Seat the person. No home yet: this entity is it. Already seated elsewhere: the
  -- person answers for BOTH entities, so they are one portfolio -- never clobber the
  -- existing affiliation, never silently do nothing.
  select company_id into v_home from contacts where id = v_contact;
  if v_home is null then
    update contacts set company_id = v_company where id = v_contact;
  elsif v_home <> v_company then
    v_pid := link_owner_portfolio(v_home, v_company);
    v_linked := v_home;
  end if;
  if v_pid is null then
    select portfolio_id into v_pid from companies where id = v_company;
  end if;

  -- outcome tag: the owners.tags analog lives on the company now
  if v_tag is not null then
    update companies
    set tags = (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || v_tag) t)
    where id = v_company;
  end if;

  if v_notes is not null then
    insert into communications (contact_id, phone, owner_company_id, property_id, channel, direction,
                                occurred_at, body, source, external_id)
    values (v_contact, v_phone, v_company, v_prop.id, 'call', 'outbound', now(),
            v_notes, 'ghl',
            'verify:' || coalesce(v_ghl, v_phone, v_contact::text) || ':' ||
            substr(md5(v_notes), 1, 12))
    on conflict (source, external_id) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'owner_id', v_company, 'contact_id', v_contact,
                            'property_id', v_prop.id, 'status', 'verified',
                            'portfolio_id', v_pid,
                            'linked_company_id', v_linked,
                            'linked_company_name', (select name from companies where id = v_linked));
end $function$;

-- ---------------------------------------------------------------------------
-- Seed: owning entities that share a STREET mailing address with an entity holding a
-- verified person. Small groups only (2-6) and never an agent-style address (c/o, PO
-- box, tax dept, trust, management) -- those are one mailbox serving unrelated owners.
-- Pre-image kept so the whole seed reverses with one statement:
--   update companies set portfolio_id = null
--    where id in (select company_id from _rollback_company_portfolio_seed_20260902);
-- ---------------------------------------------------------------------------
create table if not exists public._rollback_company_portfolio_seed_20260902 (
  company_id   uuid primary key,
  portfolio_id uuid not null,
  mailing_key  text not null,
  seeded_at    timestamptz not null default now()
);
alter table public._rollback_company_portfolio_seed_20260902 enable row level security;

with k as (
  select c.id,
         upper(regexp_replace(c.mailing_address, '[^A-Za-z0-9]', '', 'g')) as mk,
         c.mailing_address ~* '(c/o|\bcare of\b|p\.?\s?o\.?\s?box|\bbox\b|\btax\b|\bdept\b|\battn\b|\bmanagement\b|\bmgmt\b|\bproperties\b|\brealty\b|\btrust)' as agentish,
         exists (select 1 from public.contacts ct
                  where ct.company_id = c.id and ct.verified_at is not null and not ct.archived) as has_v
  from public.companies c
  where c.type = 'owning_entity'
    and c.portfolio_id is null
    and c.mailing_address is not null
    and length(c.mailing_address) > 8
    and c.mailing_address ~ '^\s*\d'          -- starts with a street number
),
g as (
  select mk, gen_random_uuid() as pid
  from k
  group by mk
  having count(*) between 2 and 6
     and bool_or(has_v)
     and not bool_or(agentish)
),
ins as (
  insert into public._rollback_company_portfolio_seed_20260902 (company_id, portfolio_id, mailing_key)
  select k.id, g.pid, g.mk from k join g on g.mk = k.mk
  returning company_id, portfolio_id
)
update public.companies c set portfolio_id = ins.portfolio_id
from ins where c.id = ins.company_id;
