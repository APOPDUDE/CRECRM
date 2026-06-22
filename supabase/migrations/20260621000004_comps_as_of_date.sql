-- Phase A of pricing-as-time-series-comps: give every comp an observation date so
-- asking comps can be historized (executed comps already have executed_at). No
-- constraint/behaviour change yet — import still upserts by source_key until Phase C.
alter table public.comps add column if not exists as_of_date date;

-- Backfill: executed comps date from executed_at; asking comps from when first seen.
update public.comps
  set as_of_date = coalesce(executed_at, created_at::date)
  where as_of_date is null;
