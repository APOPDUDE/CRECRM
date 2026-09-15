-- Queue reader + writer.
-- NOTE: the listing_queue() defined here was replaced twice in the same session and the
-- surviving definition lives in 20260915145422_listing_queue_fix_asking_fanout.sql. Only
-- review_listing() and v_listing_queue survive from this migration, so replaying the file
-- set in order still lands on the correct end state.

create or replace view v_listing_queue as
select
  p.id                              as property_id,
  p.address, p.city, p.state, p.zip, p.county,
  p.property_type, p.gross_sf, p.land_acres, p.lat, p.lng,
  p.parcel_number, p.source_key, p.title,
  p.created_at                      as first_seen,
  listing_match_state(p.parcel_number, p.lat) as match_state,
  coalesce(lr.status, 'new'::listing_review_status) as review_status,
  lr.attached_property_id,
  ap.address                        as attached_address,
  lr.note, lr.reviewed_at,
  ca.deal_type::text                as asking_deal_type,
  ca.sale_price, ca.asking_lease_rate_psf, ca.cap_rate_pct,
  ca.listing_url, ca.broker_name, ca.broker_company,
  ca.listing_title, ca.listing_description
from properties p
left join listing_reviews lr on lr.property_id = p.id
left join properties ap      on ap.id = lr.attached_property_id
left join v_property_current_asking ca on ca.property_id = p.id
where p.source = 'scrape'
  and p.listing_status = 'on_market';

/** Triage one listing. Attaching records which property in the book it belongs to. */
create or replace function review_listing(
  p_property_id uuid,
  p_status text,
  p_attach_to uuid default null,
  p_note text default null
) returns listing_reviews
language plpgsql security invoker set search_path to 'public' as $fn$
declare out_row listing_reviews;
begin
  if p_status not in ('new','attached','dismissed') then
    raise exception 'bad status: %', p_status;
  end if;
  if p_status = 'attached' and p_attach_to is null then
    raise exception 'attaching requires a target property';
  end if;

  insert into listing_reviews (property_id, status, attached_property_id, note, reviewed_by, reviewed_at)
  values (p_property_id, p_status::listing_review_status,
          case when p_status = 'attached' then p_attach_to end,
          p_note, auth.uid(),
          case when p_status = 'new' then null else now() end)
  on conflict (property_id) do update
    set status               = excluded.status,
        attached_property_id = excluded.attached_property_id,
        note                 = coalesce(excluded.note, listing_reviews.note),
        reviewed_by          = excluded.reviewed_by,
        reviewed_at          = excluded.reviewed_at
  returning * into out_row;

  return out_row;
end;
$fn$;

-- New functions inherit EXECUTE for PUBLIC on this project (reference-anon-grant-sweep.md).
revoke all on function review_listing(uuid,text,uuid,text) from public, anon;
grant execute on function review_listing(uuid,text,uuid,text) to authenticated;
