-- Coordinates for the Dashboard Deal Map (Leaflet). Populated from the Apify
-- scrape (address.lat/lng) and geocoded from the address (OpenStreetMap/Nominatim)
-- for manually-entered properties.
alter table properties
  add column lat numeric(9,6),
  add column lng numeric(9,6);
