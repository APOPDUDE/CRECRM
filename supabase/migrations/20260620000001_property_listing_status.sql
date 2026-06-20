-- On-market / off-market status for a property (manual today; off-market detection later).
create type listing_market_status as enum ('on_market','off_market');
alter table public.properties
  add column listing_status listing_market_status not null default 'on_market';
