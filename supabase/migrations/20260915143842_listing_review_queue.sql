-- The scraped-listing triage queue. Replaces the dashboard widget's ephemeral state:
-- that was ONE localStorage timestamp per browser, so "Clear" wiped every listing at
-- once and anything older than 7 days was unreachable. 3,424 on-market scraped listings
-- existed while only 20 sat inside the widget's window.
create type listing_review_status as enum ('new','attached','dismissed');

create table listing_reviews (
  property_id uuid primary key references properties(id) on delete cascade,
  status listing_review_status not null default 'new',
  -- when a ghost listing (no parcel) is bound onto a real property in the book
  attached_property_id uuid references properties(id) on delete set null,
  note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_reviews_attach_needs_target
    check (status <> 'attached' or attached_property_id is not null),
  constraint listing_reviews_no_self_attach
    check (attached_property_id is null or attached_property_id <> property_id)
);
create index listing_reviews_status_idx on listing_reviews(status);

create trigger listing_reviews_updated_at before update on listing_reviews
  for each row execute function set_updated_at();

alter table listing_reviews enable row level security;
create policy listing_reviews_auth_all on listing_reviews for all to authenticated
  using (true) with check (true);
create policy listing_reviews_va_deny on listing_reviews as restrictive for all to authenticated
  using ((select not is_va())) with check ((select not is_va()));

/**
 * How well a scraped listing landed in the book. A parcel number means the
 * parcel-first identity path resolved it; coordinates alone mean it is mappable but
 * unidentified; neither means a ghost (portfolio listings, "Address unavailable").
 */
create or replace function listing_match_state(p_parcel text, p_lat double precision)
returns text language sql immutable parallel safe as $fn$
  select case
           when nullif(btrim(coalesce(p_parcel,'')),'') is not null then 'matched'
           when p_lat is not null then 'partial'
           else 'unmatched'
         end
$fn$;

revoke all on function listing_match_state(text,double precision) from public, anon;
grant execute on function listing_match_state(text,double precision) to authenticated;
