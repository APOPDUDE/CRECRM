-- Trial data for the CRE CRM — realistic South Florida industrial brokerage book.
-- Wired to the single auth user (owner of listings + tenant reps). Safe to re-run:
-- it clears the prior seed by name/address first. Apply via the Supabase SQL editor
-- or MCP execute_sql.

do $$
declare
  v_owner uuid;
  -- companies
  c_bridge uuid; c_prologis uuid; c_eastgroup uuid;
  c_coastal uuid; c_sunshine uuid; c_apex uuid; c_medsupply uuid;
  c_cbre uuid;
  -- contacts
  k_maria uuid; k_dana uuid; k_tom uuid;
  k_luis uuid; k_karen uuid; k_devin uuid; k_priya uuid;
  k_greg uuid;
  -- properties
  p_doral uuid; p_gardens uuid; p_medley uuid; p_hialeah uuid; p_hollywood uuid;
  -- listings
  l_doral uuid; l_medley uuid; l_hollywood uuid; l_hialeah uuid; l_gardens uuid;
  -- tenant reps
  t_coastal uuid; t_sunshine uuid; t_apex uuid; t_medsupply uuid; t_lost uuid;
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then
    raise exception 'No auth user found to own seed listings/tenant_reps';
  end if;

  -- Companies -----------------------------------------------------------------
  insert into companies (name, type, phone, website) values
    ('Bridge Industrial', 'landlord', '(305) 555-0199', 'bridgeindustrial.com') returning id into c_bridge;
  insert into companies (name, type, phone, website) values
    ('Prologis', 'landlord', '(305) 555-0142', 'prologis.com') returning id into c_prologis;
  insert into companies (name, type, phone) values
    ('EastGroup Properties', 'landlord', '(954) 555-0177') returning id into c_eastgroup;
  insert into companies (name, type, phone) values
    ('Coastal Logistics', 'tenant', '(786) 555-0110') returning id into c_coastal;
  insert into companies (name, type, phone) values
    ('Sunshine Distribution', 'tenant', '(305) 555-0188') returning id into c_sunshine;
  insert into companies (name, type) values
    ('Apex Freight', 'tenant') returning id into c_apex;
  insert into companies (name, type) values
    ('MedSupply Co', 'tenant') returning id into c_medsupply;
  insert into companies (name, type, phone) values
    ('CBRE', 'broker', '(305) 555-0100') returning id into c_cbre;

  -- Contacts ------------------------------------------------------------------
  insert into contacts (company_id, first_name, last_name, title, email, phone) values
    (c_bridge, 'Maria', 'Gonzalez', 'Asset Manager', 'maria@bridgeindustrial.com', '(305) 555-0201') returning id into k_maria;
  insert into contacts (company_id, first_name, last_name, title, email) values
    (c_prologis, 'Dana', 'Reyes', 'VP Real Estate', 'dana@prologis.com') returning id into k_dana;
  insert into contacts (company_id, first_name, last_name, title) values
    (c_eastgroup, 'Tom', 'Becker', 'Leasing Director') returning id into k_tom;
  insert into contacts (company_id, first_name, last_name, title, phone) values
    (c_coastal, 'Luis', 'Romero', 'COO', '(786) 555-0111') returning id into k_luis;
  insert into contacts (company_id, first_name, last_name, title) values
    (c_sunshine, 'Karen', 'Pratt', 'Facilities Manager') returning id into k_karen;
  insert into contacts (company_id, first_name, last_name, title) values
    (c_apex, 'Devin', 'Shah', 'Operations Manager') returning id into k_devin;
  insert into contacts (company_id, first_name, last_name, title) values
    (c_medsupply, 'Priya', 'Nair', 'Director of Logistics') returning id into k_priya;
  insert into contacts (company_id, first_name, last_name, title, email) values
    (c_cbre, 'Greg', 'Allen', 'Broker', 'gallen@cbre.com') returning id into k_greg;

  -- Properties ----------------------------------------------------------------
  insert into properties (address, city, state, zip, property_type, building_sf, land_acres, specs) values
    ('2400 NW 95th Ave', 'Doral', 'FL', '33172', 'industrial', 125000, 6.50, '32'' clear height, 24 dock doors, ESFR sprinklers') returning id into p_doral;
  insert into properties (address, city, state, zip, property_type, building_sf, land_acres) values
    ('1100 NW 163rd Dr', 'Miami Gardens', 'FL', '33169', 'industrial', 88000, 4.20) returning id into p_gardens;
  insert into properties (address, city, state, zip, property_type, building_sf, land_acres, specs) values
    ('8050 NW 90th St', 'Medley', 'FL', '33166', 'industrial', 210000, 11.00, '36'' clear, cross-dock, 60 trailer stalls') returning id into p_medley;
  insert into properties (address, city, state, zip, property_type, building_sf) values
    ('3500 SW 42nd St', 'Hialeah', 'FL', '33012', 'flex', 54000) returning id into p_hialeah;
  insert into properties (address, city, state, zip, property_type, building_sf, land_acres) values
    ('5601 Pembroke Rd', 'Hollywood', 'FL', '33023', 'industrial', 160000, 9.30) returning id into p_hollywood;

  -- Listings (landlord rep) ----------------------------------------------------
  -- Doral: actively listed for lease, two prospects, an OVERDUE next action (red dot)
  insert into listings (owner_id, property_id, landlord_company_id, landlord_contact_id, deal_type, stage, status,
                        source, asking_rate_psf, commission_pct, co_broke_split_pct, estimated_fee, probability_pct,
                        listing_expiration, landlord_requirements, next_action_description, next_action_date)
    values (v_owner, p_doral, c_bridge, k_maria, 'lease', 'listed', 'active',
            'referral', 14.50, 4.00, 50.00, 72500, 60,
            current_date + 120, 'Credit tenant, 5yr minimum term, no outside storage',
            'Send updated flyer to Coastal', current_date - 4)
    returning id into l_doral;
  -- Medley: brand-new proposal stage
  insert into listings (owner_id, property_id, landlord_company_id, landlord_contact_id, deal_type, stage, status,
                        source, asking_rate_psf, commission_pct, estimated_fee, probability_pct, listing_expiration,
                        next_action_description, next_action_date)
    values (v_owner, p_medley, c_prologis, k_dana, 'lease', 'proposal', 'active',
            'cold_call', 12.75, 4.00, 95000, 35, current_date + 200,
            'Prep proposal deck', current_date + 3)
    returning id into l_medley;
  -- Hollywood: FOR SALE, listed
  insert into listings (owner_id, property_id, landlord_company_id, landlord_contact_id, deal_type, stage, status,
                        source, asking_price, commission_pct, estimated_fee, probability_pct, listing_expiration)
    values (v_owner, p_hollywood, c_eastgroup, k_tom, 'sale', 'listed', 'active',
            'website', 18500000, 2.00, 370000, 50, current_date + 90)
    returning id into l_hollywood;
  -- Hialeah: closed/won
  insert into listings (owner_id, property_id, landlord_company_id, landlord_contact_id, deal_type, stage, status,
                        source, asking_rate_psf, commission_pct, estimated_fee, actual_fee, probability_pct)
    values (v_owner, p_hialeah, c_bridge, k_maria, 'lease', 'closed', 'active',
            'referral', 16.00, 5.00, 43200, 41800, 100)
    returning id into l_hialeah;
  -- Gardens: LOST
  insert into listings (owner_id, property_id, landlord_company_id, landlord_contact_id, deal_type, stage, status,
                        lost_reason, source, asking_rate_psf, commission_pct)
    values (v_owner, p_gardens, c_prologis, k_dana, 'lease', 'proposal', 'lost',
            'Landlord signed with another brokerage', 'cold_call', 13.25, 4.00)
    returning id into l_gardens;

  -- Tenant reps ----------------------------------------------------------------
  insert into tenant_reps (owner_id, tenant_company_id, tenant_contact_id, stage, status, source,
                           warehouse_sf_min, warehouse_sf_max, office_sf_min, office_sf_max,
                           outdoor_storage_min_ac, outdoor_storage_max_ac, property_type, target_area, budget,
                           move_in_date, move_in_context, power_requirements, loading_type, clear_height,
                           business_industry, business_website, must_haves,
                           commission_pct, estimated_fee, probability_pct, next_action_description, next_action_date)
    values (v_owner, c_coastal, k_luis, 'touring', 'active', 'referral',
            80000, 120000, 5000, 8000, 2.0, 4.0, 'industrial', 'Doral / Medley submarket', '$13-15 PSF NNN',
            current_date + 90, 'Lease expiring at current Doral facility in Q4', '2,000A 480V 3-phase',
            'Dock-high (1:5,000 SF)', '32''+', '3PL / Logistics', 'coastallogistics.com',
            '20+ docks, trailer parking', 4.00, 68000, 55,
            'Confirm second tour at Doral', current_date - 2)
    returning id into t_coastal;
  insert into tenant_reps (owner_id, tenant_company_id, tenant_contact_id, stage, status, source,
                           warehouse_sf_min, warehouse_sf_max, office_sf_min, office_sf_max, property_type, target_area,
                           move_in_date, power_requirements, loading_type, clear_height, business_industry, business_website,
                           must_haves, commission_pct, estimated_fee, probability_pct, next_action_description, next_action_date)
    values (v_owner, c_sunshine, k_karen, 'loi', 'active', 'cold_call',
            40000, 60000, 3000, 5000, 'industrial', 'Hialeah / Medley',
            current_date + 60, '1,200A 480V', 'Dock-high', '28''-32''', 'Food & beverage distribution', 'sunshinedist.com',
            'Heavy power, dock-high', 4.00, 32000, 70, 'Redline LOI back to landlord', current_date + 1)
    returning id into t_sunshine;
  insert into tenant_reps (owner_id, tenant_company_id, tenant_contact_id, stage, status, source,
                           warehouse_sf_min, warehouse_sf_max, outdoor_storage_min_ac, outdoor_storage_max_ac,
                           property_type, target_area, loading_type, clear_height, business_industry, power_requirements,
                           probability_pct, next_action_description, next_action_date)
    values (v_owner, c_apex, k_devin, 'lead', 'active', 'website',
            100000, 200000, 5.0, 10.0, 'industrial', 'Medley / Doral', 'Cross-dock', '36''',
            'Freight / trucking', 'Heavy power preferred', 25,
            'Qualify requirement + timeline', current_date + 5)
    returning id into t_apex;
  insert into tenant_reps (owner_id, tenant_company_id, tenant_contact_id, stage, status, source,
                           warehouse_sf_min, warehouse_sf_max, office_sf_min, office_sf_max, property_type,
                           clear_height, loading_type, business_industry, business_website,
                           commission_pct, estimated_fee, actual_fee, probability_pct)
    values (v_owner, c_medsupply, k_priya, 'executed', 'active', 'referral',
            20000, 40000, 4000, 6000, 'flex', '24''', 'Dock-high + grade', 'Medical supply distribution', 'medsupplyco.com',
            4.00, 26000, 25500, 100)
    returning id into t_medsupply;
  insert into tenant_reps (owner_id, tenant_company_id, tenant_contact_id, stage, status, source, lost_reason,
                           warehouse_sf_min, warehouse_sf_max, property_type)
    values (v_owner, c_apex, k_devin, 'lead', 'lost', 'cold_call', 'Put requirement on hold for the year',
            30000, 50000, 'industrial')
    returning id into t_lost;

  -- Matches (the shared spine — show up on both boards where dual-sided) --------
  -- Coastal touring Doral (both sides)
  insert into matches (property_id, tenant_company_id, tenant_contact_id, listing_id, tenant_rep_id, stage,
                       source, inquiry_date, tour_date)
    values (p_doral, c_coastal, k_luis, l_doral, t_coastal, 'toured', 'loopnet', current_date - 21, current_date - 6);
  -- Sunshine at LOI on Doral (both sides)
  insert into matches (property_id, tenant_company_id, tenant_contact_id, listing_id, tenant_rep_id, stage,
                       source, inquiry_date)
    values (p_doral, c_sunshine, k_karen, l_doral, t_sunshine, 'loi', 'referral', current_date - 16);
  -- Apex eyeing Medley (both sides)
  insert into matches (property_id, tenant_company_id, tenant_contact_id, listing_id, tenant_rep_id, stage,
                       source, inquiry_date)
    values (p_medley, c_apex, k_devin, l_medley, t_apex, 'lead', 'sign_call', current_date - 9);
  -- Broker-sourced prospect on Medley (listing side only, no tenant rep yet)
  insert into matches (property_id, tenant_company_id, tenant_contact_id, listing_id, stage,
                       source, broker_contact_id, inquiry_date)
    values (p_medley, c_coastal, k_luis, l_medley, 'lead', 'broker', k_greg, current_date - 3);
  -- MedSupply closed on Hollywood sale (both sides, executed)
  insert into matches (property_id, tenant_company_id, tenant_contact_id, listing_id, tenant_rep_id, stage,
                       source, inquiry_date, psa_execution_date, dd_expiration_date, closing_date)
    values (p_hollywood, c_medsupply, k_priya, l_hollywood, t_medsupply, 'executed', 'referral',
            current_date - 75, current_date - 30, current_date - 10, current_date - 2);
  -- Coastal also considering Hialeah flex (tenant-rep side only — outside listing)
  insert into matches (property_id, tenant_company_id, tenant_contact_id, tenant_rep_id, stage,
                       source, inquiry_date)
    values (p_hialeah, c_coastal, k_luis, t_coastal, 'lead', 'referral', current_date - 5);
end $$;

select
  (select count(*) from companies) as companies,
  (select count(*) from contacts) as contacts,
  (select count(*) from properties) as properties,
  (select count(*) from listings) as listings,
  (select count(*) from tenant_reps) as tenant_reps,
  (select count(*) from matches) as matches;
