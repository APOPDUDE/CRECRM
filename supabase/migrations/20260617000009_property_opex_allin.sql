-- Lease economics on a property: yearly opex ($/SF) plus a generated all-in
-- monthly rent = (base rate + opex) * building_sf / 12. Generated so it stays
-- correct for AI/automation reads without app-side recomputation.
alter table public.properties add column if not exists opex_psf numeric(10,2);

alter table public.properties add column if not exists all_in_monthly_rent numeric(14,2)
  generated always as (
    case
      when asking_rate_psf is not null and building_sf is not null
        then round((((asking_rate_psf + coalesce(opex_psf, 0)) * building_sf) / 12.0)::numeric, 2)
    end
  ) stored;
