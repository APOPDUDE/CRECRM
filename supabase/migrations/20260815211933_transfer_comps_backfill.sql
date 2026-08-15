-- Sale history backfill (plan item 3): one kind='transfer' comp per property carrying county
-- last-sale data (10,193 inserted). Idempotent by (kind, source_key); re-runnable after any
-- parcels-mode bulk import that stamps last_sale_* on new properties. Grantor -> grantee preserved
-- from appraiser_data (only the LATEST pair survived the old overwrite model). Applied only after
-- the app-side kind bucketer deployed (use-comps.ts guard, bundle index-qST-YXi3).
insert into comps (property_id, deal_type, kind, sale_price, executed_at, as_of_date, source, source_key, notes)
select p.id, 'sale', 'transfer', p.last_sale_price, p.last_sale_date,
       coalesce(p.last_sale_date, current_date),
       'county_appraiser',
       'transfer:' || p.id || ':' || coalesce(p.last_sale_date::text, 'undated'),
       nullif(btrim(concat_ws(' -> ',
         nullif(btrim(coalesce(p.appraiser_data->>'grantor', '')), ''),
         nullif(btrim(coalesce(p.appraiser_data->>'grantee', '')), ''))), '')
from properties p
where (p.last_sale_date is not null or p.last_sale_price is not null)
  and not exists (
    select 1 from comps c2
    where c2.kind = 'transfer'
      and c2.source_key = 'transfer:' || p.id || ':' || coalesce(p.last_sale_date::text, 'undated'));
