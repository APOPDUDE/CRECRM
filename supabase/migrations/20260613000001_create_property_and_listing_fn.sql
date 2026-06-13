-- Atomic creation of a property + its listing for the Landlord Rep quick-add.
-- Runs in a single transaction so a failed listing insert rolls back the
-- property (no orphan property rows). SECURITY INVOKER keeps RLS in force.

create or replace function create_property_and_listing(
  p_owner uuid,
  p_address text,
  p_deal_type deal_type,
  p_city text default null,
  p_state text default null,
  p_property_type property_kind default null,
  p_landlord_company_id uuid default null,
  p_source lead_source default null,
  p_asking_rate_psf numeric default null,
  p_asking_price numeric default null
) returns listings
language plpgsql
security invoker
as $$
declare
  new_property properties;
  new_listing listings;
begin
  insert into properties (address, city, state, property_type)
    values (p_address, p_city, p_state, p_property_type)
    returning * into new_property;

  insert into listings (owner_id, property_id, landlord_company_id, deal_type, source,
                        asking_rate_psf, asking_price)
    values (p_owner, new_property.id, p_landlord_company_id, p_deal_type, p_source,
            p_asking_rate_psf, p_asking_price)
    returning * into new_listing;

  return new_listing;
end $$;
