-- Parcel-first identity, phase 5: make failure visible. One line a day in #deals (n8n
-- "CRE CRM · 8 · Parcel identity daily", ChslJFhE9uXZD3eo, 13:00 ET) built from this
-- function. Silent is how 978 parcel-less scraped rows accumulated in August 2026.
create or replace function parcel_identity_daily_report()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with w as (select now() - interval '24 hours' as since),
  s as (
    select count(*) filter (where p.source = 'scrape' and p.created_at >= w.since) as new_scraped,
           count(*) filter (where p.source = 'scrape' and p.created_at >= w.since
                              and nullif(split_part(p.parcel_key, '|', 1), '') is null) as new_no_parcel,
           count(*) filter (where nullif(split_part(p.parcel_key, '|', 1), '') is null
                              and p.lat is not null and p.lng is not null and not coalesce(p.is_condo_unit, false)
                              and p.county in ('Polk','Hillsborough','Manatee','Pasco','Sarasota','Pinellas')
                              and p.appraiser_updated_at is null) as pending,
           count(*) filter (where nullif(split_part(p.parcel_key, '|', 1), '') is null
                              and p.appraiser_updated_at >= w.since
                              and (p.appraiser_data->'tried') ? 'point') as failed_point,
           count(*) filter (where p.appraiser_updated_at >= w.since
                              and p.appraiser_data ? 'shared_parcel') as shared_parcel
    from properties p, w
  ),
  m as (
    select count(*) as merged from property_merge_log l, w
    where l.batch = 'absorb_parcel_twin' and l.merged_at >= w.since
  )
  select jsonb_build_object(
    'new_scraped', s.new_scraped, 'new_no_parcel', s.new_no_parcel, 'pending', s.pending,
    'failed_point', s.failed_point, 'shared_parcel', s.shared_parcel, 'merged', m.merged,
    'text', case when s.new_scraped + s.failed_point + s.shared_parcel + m.merged = 0 then ''
      else ':card_index: *Parcel identity* — last 24h: ' || s.new_scraped || ' listings scraped, '
        || s.new_no_parcel || ' still without a parcel (' || s.pending || ' waiting for the point lookup, '
        || s.failed_point || ' looked up and not found), ' || m.merged || ' folded into the property that holds the parcel, '
        || s.shared_parcel || ' share a parcel with a different address (review: `select id, address from properties where appraiser_data ? ''shared_parcel'' order by appraiser_updated_at desc`).'
      end)
  from s, m;
$$;
revoke all on function parcel_identity_daily_report() from public, anon;
