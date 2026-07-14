-- Deal flags: after each sweep/search, scraped on-market properties whose asking is a
-- "good deal" by the EXISTING system definition (v_property_market_position: asking
-- <= 85% of the county-wide median with n >= 4 behind it — lease $/SF, sale $/SF, or
-- land $/AC) are flagged for the broker's review on the dashboard. One row per
-- property; dismissing is remembered forever (a dismissed property is never re-flagged,
-- mirroring suggestions). The captured *_vs_market_pct are a snapshot at flag time;
-- only the metric(s) that actually qualified are stored.

create type deal_flag_status as enum ('pending','dismissed');

create table public.deal_flags (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  lease_vs_market_pct numeric,
  sale_vs_market_pct numeric,
  land_vs_market_pct numeric,
  status deal_flag_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deal_flags_status_idx on public.deal_flags(status);

create trigger deal_flags_updated_at before update on public.deal_flags
  for each row execute function set_updated_at();

alter table public.deal_flags enable row level security;
create policy deal_flags_auth_all on public.deal_flags
  for all to authenticated using (true) with check (true);

-- Flag deal candidates among specific properties (the sweep passes each import batch's
-- ids, right next to cross_reference) or, with no ids, among recent imports (the app's
-- on-demand scan; created_at window for the same reason as refresh_suggestions).
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
      and case when p_property_ids is not null
            then p.id = any(p_property_ids)
            else p.created_at > now() - make_interval(days => greatest(p_days, 1))
          end
  ), ins as (
    insert into deal_flags (property_id, lease_vs_market_pct, sale_vs_market_pct, land_vs_market_pct)
    select id, lease_pct, sale_pct, land_pct from candidates
    on conflict (property_id) do nothing
    returning 1
  )
  select count(*) into v_created from ins;
  return jsonb_build_object('deals_flagged', v_created);
end $$;

grant execute on function public.flag_deal_candidates(uuid[], integer) to authenticated, service_role;
revoke execute on function public.flag_deal_candidates(uuid[], integer) from anon, public;
