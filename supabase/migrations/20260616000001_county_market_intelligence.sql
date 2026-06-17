-- County market intelligence: derive county from city, build per-county market
-- baselines, and score each property as a potential good deal (lease + sale).
-- Applied to the live DB via MCP as: county_market_intelligence,
-- market_position_exclude_land_from_psf, county_market_stats_hashable_join,
-- market_position_county_baseline. This file is the consolidated final state.

-- 1) City -> county lookup (FL Gulf Coast + Central FL spillover)
create table if not exists county_lookup (
  city_key text primary key,   -- normalized: lower(trim(city)) with leading "in " stripped
  county   text not null
);

insert into county_lookup (city_key, county) values
  ('tampa','Hillsborough'),('plant city','Hillsborough'),('riverview','Hillsborough'),('ruskin','Hillsborough'),
  ('gibsonton','Hillsborough'),('wimauma','Hillsborough'),('brandon','Hillsborough'),('seffner','Hillsborough'),
  ('dover','Hillsborough'),('thonotosassa','Hillsborough'),('valrico','Hillsborough'),('apollo beach','Hillsborough'),
  ('sun city center','Hillsborough'),('temple terrace','Hillsborough'),('lithia','Hillsborough'),('lutz','Hillsborough'),
  ('odessa','Hillsborough'),('balm','Hillsborough'),('mango','Hillsborough'),
  ('saint petersburg','Pinellas'),('st petersburg','Pinellas'),('clearwater','Pinellas'),('largo','Pinellas'),
  ('oldsmar','Pinellas'),('pinellas park','Pinellas'),('tarpon springs','Pinellas'),('palm harbor','Pinellas'),
  ('seminole','Pinellas'),('dunedin','Pinellas'),('safety harbor','Pinellas'),('gulfport','Pinellas'),
  ('saint pete beach','Pinellas'),('st pete beach','Pinellas'),('tierra verde','Pinellas'),('indian rocks beach','Pinellas'),
  ('indian shores','Pinellas'),('madeira beach','Pinellas'),('treasure island','Pinellas'),
  ('hudson','Pasco'),('new port richey','Pasco'),('port richey','Pasco'),('zephyrhills','Pasco'),('dade city','Pasco'),
  ('san antonio','Pasco'),('wesley chapel','Pasco'),('land o'' lakes','Pasco'),('land o lakes','Pasco'),('holiday','Pasco'),
  ('trinity','Pasco'),('elfers','Pasco'),('shady hills','Pasco'),
  ('lakeland','Polk'),('winter haven','Polk'),('davenport','Polk'),('mulberry','Polk'),('lake wales','Polk'),
  ('auburndale','Polk'),('haines city','Polk'),('bartow','Polk'),('frostproof','Polk'),('lake alfred','Polk'),
  ('dundee','Polk'),('polk city','Polk'),('alturas','Polk'),('kathleen','Polk'),('fort meade','Polk'),
  ('babson park','Polk'),('eaton park','Polk'),('waverly','Polk'),('loughman','Polk'),
  ('bradenton','Manatee'),('palmetto','Manatee'),('lakewood ranch','Manatee'),('parrish','Manatee'),('ellenton','Manatee'),
  ('myakka city','Manatee'),('anna maria','Manatee'),('holmes beach','Manatee'),('bradenton beach','Manatee'),('cortez','Manatee'),
  ('sarasota','Sarasota'),('north port','Sarasota'),('venice','Sarasota'),('nokomis','Sarasota'),('osprey','Sarasota'),
  ('north venice','Sarasota'),('englewood','Sarasota'),('laurel','Sarasota'),('longboat key','Sarasota'),('siesta key','Sarasota'),
  ('port charlotte','Charlotte'),('punta gorda','Charlotte'),('lake suzy','Charlotte'),('rotonda west','Charlotte'),
  ('spring hill','Hernando'),('brooksville','Hernando'),('hernando beach','Hernando'),('weeki wachee','Hernando'),
  ('kissimmee','Osceola'),('saint cloud','Osceola'),('st cloud','Osceola'),('champions gate','Osceola'),
  ('celebration','Osceola'),('poinciana','Osceola'),
  ('orlando','Orange'),('winter garden','Orange'),('ocoee','Orange'),('apopka','Orange'),
  ('clermont','Lake'),('groveland','Lake'),('minneola','Lake'),
  ('arcadia','DeSoto')
on conflict (city_key) do update set county = excluded.county;

-- 2) county column on properties, kept in sync from city via trigger
alter table properties add column if not exists county text;

create or replace function set_property_county() returns trigger
language plpgsql as $$
begin
  new.county := (
    select cl.county from county_lookup cl
    where cl.city_key = regexp_replace(lower(trim(coalesce(new.city,''))), '^in ', '')
  );
  return new;
end $$;

drop trigger if exists properties_set_county on properties;
create trigger properties_set_county
  before insert or update of city on properties
  for each row execute function set_property_county();

update properties p set county = (
  select cl.county from county_lookup cl
  where cl.city_key = regexp_replace(lower(trim(coalesce(p.city,''))), '^in ', '')
) where p.city is not null;

create index if not exists properties_county_idx on properties(county);

-- 3) Per-county market baselines (per property_type + a county-wide rollup where property_type is null)
create or replace view v_county_market_stats as
with lease as (
  select county, property_type::text as ptype, asking_rate_psf as v
  from properties where county is not null and asking_rate_psf is not null and asking_rate_psf > 0
),
sale as (
  select county, property_type::text as ptype, (asking_price/building_sf) as v, cap_rate_pct
  from properties where county is not null and asking_price is not null and building_sf is not null and building_sf > 0
),
land as (
  select county, (asking_price/land_acres) as v
  from properties where county is not null and asking_price is not null and land_acres is not null and land_acres > 0
    and property_type::text = 'land'
),
lstats as (
  select county, ptype, count(*) n,
    round(avg(v)::numeric,2) avg_psf,
    round(percentile_cont(0.5) within group (order by v)::numeric,2) median_psf,
    round(percentile_cont(0.25) within group (order by v)::numeric,2) p25_psf,
    round(percentile_cont(0.75) within group (order by v)::numeric,2) p75_psf
  from lease group by grouping sets ((county, ptype),(county))
),
sstats as (
  select county, ptype, count(*) n,
    round(avg(v)::numeric,2) avg_psf,
    round(percentile_cont(0.5) within group (order by v)::numeric,2) median_psf,
    round(percentile_cont(0.25) within group (order by v)::numeric,2) p25_psf,
    round(percentile_cont(0.75) within group (order by v)::numeric,2) p75_psf,
    round(avg(cap_rate_pct)::numeric,2) avg_cap, count(cap_rate_pct) cap_n
  from sale group by grouping sets ((county, ptype),(county))
),
combined as (
  select
    coalesce(l.county, s.county) as county,
    coalesce(l.ptype, s.ptype) as property_type,
    l.n as lease_n, l.avg_psf as lease_avg_psf, l.median_psf as lease_median_psf, l.p25_psf as lease_p25_psf, l.p75_psf as lease_p75_psf,
    s.n as sale_n, s.avg_psf as sale_avg_psf, s.median_psf as sale_median_psf, s.p25_psf as sale_p25_psf, s.p75_psf as sale_p75_psf,
    s.avg_cap as sale_avg_cap, s.cap_n as sale_cap_n
  from lstats l
  full join sstats s
    on l.county = s.county and coalesce(l.ptype, '__all__') = coalesce(s.ptype, '__all__')
),
dom as (
  select county, count(*) listing_n, round(avg(days_on_market)::numeric,0) avg_dom
  from properties where county is not null group by county
),
landstats as (
  select county, count(*) n,
    round(avg(v)::numeric,0) avg_per_acre,
    round(percentile_cont(0.5) within group (order by v)::numeric,0) median_per_acre
  from land group by county
)
select c.county, c.property_type,
  c.lease_n, c.lease_avg_psf, c.lease_median_psf, c.lease_p25_psf, c.lease_p75_psf,
  c.sale_n, c.sale_avg_psf, c.sale_median_psf, c.sale_p25_psf, c.sale_p75_psf, c.sale_avg_cap, c.sale_cap_n,
  ls2.n as land_n, ls2.avg_per_acre as land_avg_per_acre, ls2.median_per_acre as land_median_per_acre,
  d.listing_n, d.avg_dom
from combined c
left join dom d on d.county = c.county and c.property_type is null
left join landstats ls2 on ls2.county = c.county and c.property_type is null;

-- 4) Per-property market position + good-deal flags (county-wide baseline; land excluded from building PSF)
create or replace view v_property_market_position as
with prop as (
  select p.id, p.county, p.property_type::text as ptype,
    p.asking_rate_psf,
    case when p.asking_price is not null and p.building_sf > 0 then round((p.asking_price/p.building_sf)::numeric,2) end as sale_psf,
    case when p.asking_price is not null and p.land_acres > 0 and p.property_type::text='land' then round((p.asking_price/p.land_acres)::numeric,0) end as land_per_acre
  from properties p where p.county is not null
),
base as (
  select pr.*,
    cw.lease_median_psf as lease_med, cw.lease_n,
    cw.sale_median_psf as sale_med, cw.sale_n,
    cw.land_median_per_acre as land_med, cw.land_n
  from prop pr
  left join v_county_market_stats cw on cw.county = pr.county and cw.property_type is null
)
select
  id, county, ptype as property_type,
  asking_rate_psf, lease_med as lease_baseline_median, lease_n as lease_baseline_n,
  case when asking_rate_psf is not null and ptype is distinct from 'land' and lease_med > 0 and lease_n >= 4
       then round(((asking_rate_psf - lease_med)/lease_med*100)::numeric,0) end as lease_vs_market_pct,
  (asking_rate_psf is not null and ptype is distinct from 'land' and lease_med > 0 and lease_n >= 4 and asking_rate_psf <= lease_med*0.85) as good_lease_deal,
  sale_psf, sale_med as sale_baseline_median, sale_n as sale_baseline_n,
  case when sale_psf is not null and ptype is distinct from 'land' and sale_med > 0 and sale_n >= 4
       then round(((sale_psf - sale_med)/sale_med*100)::numeric,0) end as sale_vs_market_pct,
  (sale_psf is not null and ptype is distinct from 'land' and sale_med > 0 and sale_n >= 4 and sale_psf <= sale_med*0.85) as good_sale_deal,
  land_per_acre, land_med as land_baseline_median, land_n as land_baseline_n,
  case when land_per_acre is not null and land_med > 0 and land_n >= 4
       then round(((land_per_acre - land_med)/land_med*100)::numeric,0) end as land_vs_market_pct,
  (land_per_acre is not null and land_med > 0 and land_n >= 4 and land_per_acre <= land_med*0.85) as good_land_deal
from base;

grant select on v_county_market_stats, v_property_market_position to anon, authenticated;