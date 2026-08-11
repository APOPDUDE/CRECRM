-- One classifier for owner kind, applied to the whole book.
--
-- kind was set by whatever code happened to create each owner, so the column disagreed
-- with itself: "CSX CORPORATION" and "Exide Environmental Response Corporation Trustee"
-- were filed as individual while obvious LLCs were entity, and Florida counties
-- ("Hillsborough County", "PINELLAS COUNTY") were individuals. A single function makes
-- the rule inspectable and reusable -- link_appraiser_owner_entities uses it too, so the
-- next county load classifies the same way.
--
-- The two name tests are deliberately SEPARATE, because the asymmetry is the whole
-- difficulty:
--
--   corp_form    a hard legal form (LLC, INC, LP, TRUST...). A public body never has one.
--   descriptive  a business-sounding word (PROPERTIES, MANAGEMENT, HOSPITAL...). These
--                appear in public-body names too, so they cannot disqualify on their own.
--
-- Hence:
--   "<X> DISTRICT" is government unless it has a corp_form -- a water management district
--     and a public hospital district legitimately contain MANAGEMENT and HOSPITAL, while
--     "Willow Design District Llc" is caught by the LLC.
--   "<X> COUNTY" needs BOTH guards -- "Hillsborough County" is a county, but
--     "GULF STREAM PROPERTIES OF POLK COUNTY" is a company that happens to end in COUNTY.
--
-- Government is tested before entity throughout, so "CITY OF SARASOTA" is never read as
-- a company; individual is the default for a bare human-looking name.

create or replace function classify_owner_kind(p_name text)
returns owner_kind language sql immutable as $$
  with n as (select normalize_owner_name(p_name) as v),
  f as (
    select v,
      v ~ '\m(LLC|INC|CORP|CORPORATION|LP|LLP|LTD|PLC|PLLC|CO|TRUST|TRUSTEE|TRUSTEES)\M' as corp_form,
      v ~ '\m(PARTNERSHIP|PARTNERS|ASSOCIATES|ASSOCIATION|ASSN|HOLDINGS|HOLDING|PROPERTIES|PROPERTY|ENTERPRISES|INVESTMENTS|INVESTMENT|VENTURES|GROUP|FOUNDATION|CHURCH|MINISTRIES|MINISTRY|TEMPLE|SYNAGOGUE|BANK|CREDIT UNION|REALTY|DEVELOPMENT|DEVELOPERS|BUILDERS|INDUSTRIES|MANUFACTURING|MFG|SERVICES|SOLUTIONS|SYSTEMS|CENTER|CENTRE|INSTITUTE|SOCIETY|CLUB|LODGE|FUND|CAPITAL|EQUITIES|EQUITY|MANAGEMENT|MGMT|LEASING|RENTALS|STORAGE|WAREHOUSE|LOGISTICS|HOSPITAL|HOSP|MEDICAL|CLINIC|HEALTH|UNIVERSITY|COLLEGE|ACADEMY|SCHOOL|SALVATION ARMY|GOODWILL|YMCA|YWCA|HABITAT FOR HUMANITY|RED CROSS)\M' as descriptive
    from n
  )
  select case
    when v is null then 'unknown'::owner_kind
    when v ~ '\m(CITY|COUNTY|STATE|TOWN|VILLAGE|BOROUGH)\s+OF\M' then 'government'::owner_kind
    when v ~ '\m(UNITED STATES|USA|FEDERAL|SCHOOL BOARD|SCHOOL DISTRICT|SCHOOL DIST|MUNICIPAL|MUNICIPALITY|HOUSING AUTH|PORT AUTH|TRANSIT AUTH|AUTHORITY|DEPT|DEPARTMENT|COMMISSION|AGENCY|BUREAU|FDOT|SHERIFF|POLICE DEPT)\M'
      then 'government'::owner_kind
    when not corp_form and v ~ '\m(DISTRICT|DIST)$' then 'government'::owner_kind
    when not corp_form and not descriptive and v ~ '\m(COUNTY|CITY)$' then 'government'::owner_kind
    when corp_form or descriptive then 'entity'::owner_kind
    else 'individual'::owner_kind
  end from f;
$$;

comment on function classify_owner_kind(text) is
  'Owner kind from the owner name. Government is tested before entity so public bodies '
  'with no company suffix are not read as companies; individual is the default.';

update owners set kind = classify_owner_kind(display_name)
where kind is distinct from classify_owner_kind(display_name);
