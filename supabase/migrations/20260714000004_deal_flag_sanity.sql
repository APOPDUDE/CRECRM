-- Sanity band for deal flags. First backfill surfaced the problem: the most
-- "discounted" rows were parse artifacts, not deals — $0.08-$2.00 PSF lease askings
-- (monthly rates scraped as annual), a $13/SF sale on a 264k SF building, and a
-- placeholder '*' address. A real deal is 15-50% below median; beyond 70% below is
-- essentially always bad data, so those are excluded (scale-free — no hardcoded rate
-- floors). Junk pending rows are DELETED (not dismissed) so they may re-flag if the
-- underlying data is ever fixed.

create or replace function public.flag_deal_candidates(
  p_property_ids uuid[] default null, p_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_created int := 0;
begin
  with candidates as (
    select m.id,
           case when m.good_lease_deal then m.lease_vs_market_pct end as lease_pct,
           case when m.good_sale_deal  then m.sale_vs_market_pct  end as sale_pct,
           case when m.good_land_deal  then m.land_vs_market_pct  end as land_pct
    from v_property_market_position m
    join properties p on p.id = m.id
    where (m.good_lease_deal or m.good_sale_deal or m.good_land_deal)
      and p.source = 'scrape'
      and p.listing_status = 'on_market'
      -- placeholder rows ('*', 'Parcel ...') aren't reviewable
      and length(p.address) > 2
      and p.address not ilike 'parcel %'
      and case when p_property_ids is not null
            then p.id = any(p_property_ids)
            else p.created_at > now() - make_interval(days => greatest(p_days, 1))
          end
  ), sane as (
    select * from candidates
    where greatest(coalesce(lease_pct, -100), coalesce(sale_pct, -100), coalesce(land_pct, -100)) >= -70
  ), ins as (
    insert into deal_flags (property_id, lease_vs_market_pct, sale_vs_market_pct, land_vs_market_pct)
    select id,
           case when lease_pct >= -70 then lease_pct end,
           case when sale_pct  >= -70 then sale_pct  end,
           case when land_pct  >= -70 then land_pct  end
    from sane
    on conflict (property_id) do nothing
    returning 1
  )
  select count(*) into v_created from ins;
  return jsonb_build_object('deals_flagged', v_created);
end $$;

-- Purge the junk the first backfill let through (pending only — never touch dismissed).
delete from deal_flags f
using properties p
where p.id = f.property_id
  and f.status = 'pending'
  and (
    greatest(coalesce(f.lease_vs_market_pct, -100),
             coalesce(f.sale_vs_market_pct, -100),
             coalesce(f.land_vs_market_pct, -100)) < -70
    or length(p.address) <= 2
    or p.address ilike 'parcel %'
  );
