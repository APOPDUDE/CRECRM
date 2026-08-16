-- R7 backfill: seed the LATEST asking comp (per property x deal_type) with the
-- property's current listing-event values, so the eventual properties column
-- drop loses nothing. Fill-only (comp fields that are already set win);
-- properties.sale_status is integer -> cast to text on the comp.
--
-- Applied 2026-08-16: 2,858 comps across 2,746 properties on the first pass,
-- plus 13 tie-twin rows on convergence passes (2,871 comps touched total;
-- 2,872 asking comps carry listing_url — one had it from a same-day scrape).
--
-- Why a loop: DISTINCT ON's ordering (as_of_date desc, created_at desc) TIES
-- when one import call inserted 2+ same-deal_type asking comps for a property
-- (created_at is transaction time, identical to the microsecond), so the
-- "latest" winner is arbitrary between statements. Each pass fills whichever
-- twin wins that round; the loop runs until a pass fills nothing. Idempotent:
-- a re-run's first pass updates 0 rows and exits.

do $$
declare n int; total int := 0; pass int := 0;
begin
  loop
    pass := pass + 1;
    with latest as (
      select distinct on (c.property_id, c.deal_type) c.id, c.property_id
      from comps c
      where c.kind = 'asking'
      order by c.property_id, c.deal_type, c.as_of_date desc nulls last, c.created_at desc
    )
    update comps c set
      listing_url         = coalesce(c.listing_url, p.listing_url),
      broker_name         = coalesce(c.broker_name, p.broker_name),
      broker_company      = coalesce(c.broker_company, p.broker_company),
      broker_phone        = coalesce(c.broker_phone, p.broker_phone),
      broker_email        = coalesce(c.broker_email, p.broker_email),
      days_on_market      = coalesce(c.days_on_market, p.days_on_market),
      listed_at           = coalesce(c.listed_at, p.listed_at),
      listing_title       = coalesce(c.listing_title, p.title),
      listing_description = coalesce(c.listing_description, p.description),
      sale_conditions     = coalesce(c.sale_conditions, p.sale_conditions),
      sale_status         = coalesce(c.sale_status, p.sale_status::text),
      sale_type           = coalesce(c.sale_type, p.sale_type),
      is_auction          = coalesce(c.is_auction, p.is_auction),
      occupancy           = coalesce(c.occupancy, p.occupancy),
      source_last_updated = coalesce(c.source_last_updated, p.source_last_updated),
      updated_at          = now()
    from latest l
    join properties p on p.id = l.property_id
    where c.id = l.id
      and ((c.listing_url is null and p.listing_url is not null)
        or (c.broker_name is null and p.broker_name is not null)
        or (c.broker_company is null and p.broker_company is not null)
        or (c.broker_phone is null and p.broker_phone is not null)
        or (c.broker_email is null and p.broker_email is not null)
        or (c.days_on_market is null and p.days_on_market is not null)
        or (c.listed_at is null and p.listed_at is not null)
        or (c.listing_title is null and p.title is not null)
        or (c.listing_description is null and p.description is not null)
        or (c.sale_conditions is null and p.sale_conditions is not null)
        or (c.sale_status is null and p.sale_status is not null)
        or (c.sale_type is null and p.sale_type is not null)
        or (c.is_auction is null and p.is_auction is not null)
        or (c.occupancy is null and p.occupancy is not null)
        or (c.source_last_updated is null and p.source_last_updated is not null));
    get diagnostics n = row_count;
    total := total + n;
    exit when n = 0 or pass >= 10;
  end loop;
  raise notice 'r7 backfill: passes=% rows_filled=%', pass, total;
end $$;
