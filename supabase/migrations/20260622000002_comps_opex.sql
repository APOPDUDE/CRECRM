-- Lease comps carry their own OPEX so the widget can show base rate -> opex ->
-- all-in monthly (same economics the old property pricing block had), and so a
-- suite's opex can differ over time. Backfill lease comps from the property's opex.
alter table public.comps add column if not exists opex_psf numeric;

update public.comps c set opex_psf = p.opex_psf
  from public.properties p
  where c.property_id = p.id and c.deal_type = 'lease' and c.opex_psf is null and p.opex_psf is not null;
