-- Verified contacts on an outreach list (Alex, 2026-09-09).
--
-- Since v_outreach_verified_property went live, the GHL push has skipped EVERY number on a
-- property that already has a verified contact ("every channel suppresses these" -- you have
-- the person, so nobody cold-calls their skiptrace). Two problems:
--
--   1. The view and the push's verified-parcel clause were applied by hand; the repo still
--      carried the older push without it. Captured here, verbatim from the live database.
--   2. The import page reported "N already verified" as a bare per-row counter and named
--      nobody. Alex: "those verified contacts should show on the import page so I can click
--      their number and call them from GHL before cold calling the list."
--
-- outreach_list_verified(p_list) is that list: one row per verified contact on the list's
-- properties, with the GHL contact id (the phone deep-links to GHL, never tel:) and what the
-- push skipped on their behalf. Security invoker -- contacts / outreach tables keep their RLS
-- (the VA silo denies them); the definer view is read the same way the push reads it.

begin;

-- ---------------------------------------------------------------- live view, captured
create or replace view v_outreach_verified_property as
  with owner_size as (
    select properties.owner_company_id, count(*) as n
    from properties
    where properties.owner_company_id is not null
    group by properties.owner_company_id
  ), verified_co as (
    select distinct contacts.company_id
    from contacts
    where contacts.verified_at is not null and contacts.company_id is not null
  )
  select distinct t.property_id
  from outreach_targets t
  join contacts ct on ct.id = t.contact_id
  where ct.verified_at is not null and t.property_id is not null
  union
  select p.id as property_id
  from properties p
  join verified_co vc on vc.company_id = p.owner_company_id
  join owner_size os on os.owner_company_id = p.owner_company_id and os.n < 5;

comment on view v_outreach_verified_property is
  'Properties whose owner is already verified — every channel suppresses these. Parcel-level, not phone-level.';

-- ---------------------------------------------------------------- live push RPC, captured
create or replace function outreach_ghl_push_rows(p_list text) returns jsonb
language sql security definer
set search_path to public
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'phone',            c.phone,
           'first_name',       t.first_name,
           'last_name',        t.last_name,
           'email',            t.email,
           'company_name',     t.company_name,
           'ghl_contact_id',   c.ghl_contact_id,
           'phone_grade',      c.phone_grade,
           'line_type',        c.line_type,
           'property_address', pr.address,
           'property_city',    pr.city,
           'property_county',  pr.county,
           'property_state',   pr.state,
           'property_zip',     pr.zip,
           'building_sf',      pr.gross_sf,
           'land_acres',       pr.land_acres,
           'parcel_id',        coalesce(t.parcel_id, pr.parcel_number),
           'crm_property_id',  t.property_id
         )) order by c.created_at), '[]'::jsonb)
  from outreach_calls c
  join outreach_targets t on t.id = c.target_id
  left join properties pr on pr.id = t.property_id
  where btrim(coalesce(p_list,'')) <> ''
    and p_list = any(t.lists)
    and not c.dnc
    and t.wrong_person_at is null
    and lower(coalesce(c.disposition,'')) not in ('wrong number','disconnected','bad number')
    and not exists (select 1 from v_outreach_verified_property v
                     where v.property_id = t.property_id)
$$;

comment on function outreach_ghl_push_rows(text) is
  'The phone channel of one outreach list, ready to push to GHL: one row per number with the '
  'full property envelope (county-sourced facts win). Excluded: dnc, wrong person, numbers '
  'already known bad (wrong number / disconnected), and EVERY number on a property that already '
  'has a verified contact (v_outreach_verified_property) -- call that person instead; '
  'outreach_list_verified(list) names them.';

-- ---------------------------------------------------------------- the call-these-first list
create or replace function outreach_list_verified(p_list text) returns jsonb
language sql stable security invoker
set search_path to public
as $$
  with lp as (
    select distinct t.property_id
    from outreach_targets t
    where btrim(coalesce(p_list,'')) <> ''
      and p_list = any(t.lists)
      and t.property_id is not null
      and exists (select 1 from v_outreach_verified_property v where v.property_id = t.property_id)
  ), vc as (
    -- a verified person reached through a target on the property ...
    select lp.property_id, ct.id as contact_id
    from lp
    join outreach_targets t on t.property_id = lp.property_id
    join contacts ct on ct.id = t.contact_id and ct.verified_at is not null
    union
    -- ... or through the owning company (union dedupes the person who is both)
    select lp.property_id, ct.id
    from lp
    join properties p on p.id = lp.property_id
    join contacts ct on ct.company_id = p.owner_company_id and ct.verified_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'contact_id',     ct.id,
           'name',           btrim(concat_ws(' ', ct.first_name, ct.last_name)),
           'company',        co.name,
           'phone',          ct.phone,
           'ghl_contact_id', ct.ghl_contact_id,
           'verified_at',    ct.verified_at,
           'property_id',    vc.property_id,
           'address',        p.address,
           'city',           p.city,
           'skipped_people', (select coalesce(jsonb_agg(distinct btrim(concat_ws(' ', t.first_name, t.last_name))), '[]'::jsonb)
                                from outreach_targets t
                               where t.property_id = vc.property_id and p_list = any(t.lists)),
           'skipped_phones', (select count(*)
                                from outreach_calls c
                                join outreach_targets t on t.id = c.target_id
                               where t.property_id = vc.property_id and p_list = any(t.lists))
         ) order by p.address, ct.last_name, ct.first_name), '[]'::jsonb)
  from vc
  join contacts ct on ct.id = vc.contact_id
  join properties p on p.id = vc.property_id
  left join companies co on co.id = ct.company_id
$$;

comment on function outreach_list_verified(text) is
  'Verified contacts on one outreach list''s properties -- the people to call from GHL before '
  'cold-calling the list. One row per (contact, property) with the GHL contact id and what the '
  'push skipped on that property (names + number count). jsonb so the 1000-row cap cannot bite.';

revoke all on function outreach_list_verified(text) from public, anon;
grant execute on function outreach_list_verified(text) to authenticated, service_role;

commit;
