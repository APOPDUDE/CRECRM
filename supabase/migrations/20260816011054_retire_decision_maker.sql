-- Verification consolidation, final act (audit item 2): contacts.decision_maker (2 verified rows
-- in a 9.6k book at audit time) dies; v_lease_comps derives dm_* from the ONE concept
-- (contacts.verified_at). dm_status becomes text ('verified'|'suspected'), dm_verified means a
-- human confirmed the person. verified_by gets its vocabulary CHECK. After this the five
-- verification vocabularies are ONE (+ email_verified_at as a channel fact, comps.verified as
-- Alex's per-rate trust flag).

drop view v_lease_comps;
create view v_lease_comps as
 SELECT c.id AS comp_id,
    c.property_id,
    c.tenant_name,
    c.tenant_company_id,
    co.name AS tenant_company_name,
    c.sf,
    c.executed_lease_rate_psf,
    c.lease_structure,
    c.term_months,
    c.commencement_date,
    c.expiration_date,
    c.executed_at AS signed_date,
    c.expiration_date - CURRENT_DATE AS days_to_expiry,
        CASE
            WHEN c.expiration_date IS NULL THEN NULL::integer
            WHEN c.expiration_date < CURRENT_DATE THEN LEAST('-1'::integer, (date_part('year'::text, age(c.expiration_date::timestamp with time zone, CURRENT_DATE::timestamp with time zone)) * 12::double precision + date_part('month'::text, age(c.expiration_date::timestamp with time zone, CURRENT_DATE::timestamp with time zone)))::integer)
            ELSE (date_part('year'::text, age(c.expiration_date::timestamp with time zone, CURRENT_DATE::timestamp with time zone)) * 12::double precision + date_part('month'::text, age(c.expiration_date::timestamp with time zone, CURRENT_DATE::timestamp with time zone)))::integer
        END AS months_to_expiry,
        CASE
            WHEN c.executed_at IS NULL THEN NULL::integer
            ELSE (date_part('year'::text, age(CURRENT_DATE::timestamp with time zone, c.executed_at::timestamp with time zone)) * 12::double precision + date_part('month'::text, age(CURRENT_DATE::timestamp with time zone, c.executed_at::timestamp with time zone)))::integer
        END AS months_since_signed,
    dm.dm_status,
    dm.dm_name,
    dm.dm_title,
    dm.dm_phone,
    dm.dm_email,
    dm.dm_status = 'verified' AS dm_verified,
    p.address,
    p.city,
    p.state,
    p.county,
    p.lat,
    p.lng,
    p.gross_sf,
    p.heated_sf,
    p.land_acres,
    p.property_type
   FROM comps c
     JOIN properties p ON p.id = c.property_id
     LEFT JOIN companies co ON co.id = c.tenant_company_id
     LEFT JOIN LATERAL ( SELECT
            CASE WHEN ct.verified_at IS NOT NULL THEN 'verified' ELSE 'suspected' END AS dm_status,
            btrim((ct.first_name || ' '::text) || COALESCE(ct.last_name, ''::text)) AS dm_name,
            ct.title AS dm_title,
            ct.phone AS dm_phone,
            ct.email AS dm_email
           FROM contacts ct
          WHERE ct.company_id = c.tenant_company_id AND ct.archived IS NOT TRUE
          ORDER BY (ct.verified_at IS NOT NULL) DESC, ct.updated_at DESC
         LIMIT 1) dm ON true
  WHERE c.deal_type = 'lease'::deal_type AND c.kind = 'executed'::comp_kind;
grant select on v_lease_comps to authenticated;
grant select on v_lease_comps to anon;
grant select on v_lease_comps to service_role;

alter table _rollback_contacts_verified_20260812 alter column decision_maker type text;
alter table _rollback_contact_merge_20260814 alter column decision_maker type text;
alter table _rollback_contact_purge_20260815 alter column decision_maker type text;

alter table contacts drop column decision_maker;
drop type decision_maker_status;

alter table contacts add constraint contacts_verified_by_vocab
  check (verified_by is null or verified_by in ('client','response','verified_owner','ghl_va','alex','manual'));
alter table contacts add constraint contacts_verified_pair
  check ((verified_at is null) = (verified_by is null));
