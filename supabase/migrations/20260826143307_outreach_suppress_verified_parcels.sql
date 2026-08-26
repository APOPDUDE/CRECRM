-- Suppression keys on the PARCEL, not the phone number.
--
-- Alex, 2026-08-26: "if that parcel ID has a verified contact, then even if we have additional
-- phone numbers that are different than the verified phone number, we should not be reaching out
-- to those people, because we already have the verified owner for that property."
--
-- Measured on list-tampa-ios-alex-p: keying on the phone caught 21 rows; keying on the parcel
-- catches 48 across 23 properties. The extra 27 are OTHER people at buildings where the verified
-- owner is already known.
--
-- Two paths to "this parcel has a verified contact":
--   (a) an outreach target anchored to the property links to a verified contact
--   (b) the property's OWNING COMPANY has a verified contact
-- Path (b) is capped at owners holding fewer than 5 properties. Book-wide, 329 owner companies
-- have a verified contact and they average 1.69 properties, so the cap changes nothing for 317 of
-- them -- but without it, one verified contact at Waste Management (13 properties), Paul F Savich
-- (19) or the City of Plant City (14) would silence every building they own.
create or replace view v_outreach_verified_property as
with owner_size as (
  select owner_company_id, count(*) as n
  from properties where owner_company_id is not null group by 1
),
verified_co as (
  select distinct company_id from contacts
  where verified_at is not null and company_id is not null
)
select distinct t.property_id
from outreach_targets t
join contacts ct on ct.id = t.contact_id
where ct.verified_at is not null and t.property_id is not null
union
select p.id
from properties p
join verified_co vc on vc.company_id = p.owner_company_id
join owner_size os on os.owner_company_id = p.owner_company_id and os.n < 5;

comment on view v_outreach_verified_property is
  'Properties whose owner is already verified — every channel suppresses these. Parcel-level, not phone-level.';

grant select on v_outreach_verified_property to authenticated;

create or replace function public.outreach_ghl_push_rows(p_list text)
 returns jsonb language sql security definer set search_path to 'public'
as $function$
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
$function$;

create or replace function public.outreach_list_suppressed(p_list text)
 returns jsonb language sql security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'list', p_list,
    'suppressed_phones', count(*),
    'suppressed_properties', count(distinct t.property_id),
    'detail', coalesce(jsonb_agg(jsonb_build_object(
        'phone', c.phone,
        'name', btrim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,'')),
        'company', t.company_name,
        'property_address', pr.address,
        'parcel_id', coalesce(t.parcel_id, pr.parcel_number)
      ) order by pr.address, c.phone), '[]'::jsonb))
  from outreach_calls c
  join outreach_targets t on t.id = c.target_id
  left join properties pr on pr.id = t.property_id
  where btrim(coalesce(p_list,'')) <> ''
    and p_list = any(t.lists)
    and not c.dnc
    and t.wrong_person_at is null
    and lower(coalesce(c.disposition,'')) not in ('wrong number','disconnected','bad number')
    and exists (select 1 from v_outreach_verified_property v
                 where v.property_id = t.property_id)
$function$;

grant execute on function public.outreach_list_suppressed(text) to authenticated;
