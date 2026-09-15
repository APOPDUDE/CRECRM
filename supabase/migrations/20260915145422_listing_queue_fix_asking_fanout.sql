-- v_property_current_asking carries ONE ROW PER DEAL TYPE, and 577 properties are listed
-- for both lease and sale. The plain LEFT JOIN multiplied those page rows -- a limit of 50
-- returned 53 -- and the duplicate property_ids then collided as React list keys, leaving
-- stale rows from the previous filter visible in the list. Pick exactly one asking row.
-- This is the surviving definition of listing_queue().
create or replace function listing_queue(
  p_status text default 'new',
  p_match  text default null,
  p_types  text[] default null,
  p_search text default null,
  p_limit  integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $fn$
declare
  v_rows jsonb;
  v_total integer;
  v_counts jsonb;
begin
  -- definer bypasses the restrictive VA policy, so the guard is re-stated here
  if is_va() then
    raise insufficient_privilege using message = 'listing_queue is not available to the VA role';
  end if;

  select jsonb_build_object(
           'new_total', count(*) filter (where review_status = 'new'),
           'matched',   count(*) filter (where review_status = 'new' and match_state = 'matched'),
           'partial',   count(*) filter (where review_status = 'new' and match_state = 'partial'),
           'unmatched', count(*) filter (where review_status = 'new' and match_state = 'unmatched'),
           'attached',  count(*) filter (where review_status = 'attached'),
           'dismissed', count(*) filter (where review_status = 'dismissed')
         )
    into v_counts
  from v_listing_queue_base;

  with filtered as (
    select * from v_listing_queue_base q
    where (p_status is null or q.review_status::text = p_status)
      and (p_match  is null or q.match_state = p_match)
      and (p_types  is null or q.property_type::text = any(p_types))
      and (p_search is null or btrim(p_search) = '' or
           q.address ilike '%'||btrim(p_search)||'%' or
           coalesce(q.city,'') ilike '%'||btrim(p_search)||'%')
  ),
  page as (
    select * from filtered order by first_seen desc, property_id
    limit greatest(p_limit,1) offset greatest(p_offset,0)
  )
  select
    coalesce(jsonb_agg(to_jsonb(e) order by e.first_seen desc, e.property_id), '[]'::jsonb),
    (select count(*) from filtered)
  into v_rows, v_total
  from (
    select pg.*,
           ap.address                as attached_address,
           ca.deal_type::text        as asking_deal_type,
           ca.sale_price, ca.asking_lease_rate_psf, ca.cap_rate_pct,
           ca.listing_url, ca.broker_name, ca.broker_company,
           ca.listing_title, ca.listing_description,
           ca.also_listed_other_side
    from page pg
    left join properties ap on ap.id = pg.attached_property_id
    -- LATERAL + limit 1: one asking row per property, newest first, sale as the headline
    -- on a tie. The flag keeps the dual-listing visible rather than silently dropped.
    left join lateral (
      select c.*,
             (count(*) over ()) > 1 as also_listed_other_side
      from v_property_current_asking c
      where c.property_id = pg.property_id
      order by c.as_of_date desc nulls last, (c.deal_type = 'sale') desc
      limit 1
    ) ca on true
  ) e;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'counts', coalesce(v_counts,'{}'::jsonb));
end;
$fn$;

revoke all on function listing_queue(text,text,text[],text,integer,integer) from public, anon;
grant execute on function listing_queue(text,text,text[],text,integer,integer) to authenticated;
