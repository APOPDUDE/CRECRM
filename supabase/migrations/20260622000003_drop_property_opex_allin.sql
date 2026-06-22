-- Property is the static record: OPEX + derived all-in monthly now live on the (lease)
-- comps, not the property. Nothing in functions/views/frontend reads these. Drop the
-- generated column first (it depends on opex_psf + asking_rate_psf).
alter table public.properties drop column if exists all_in_monthly_rent;
alter table public.properties drop column if exists opex_psf;
