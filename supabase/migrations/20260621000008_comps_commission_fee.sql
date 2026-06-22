-- Phase G: a comp carries its own booked commission so it's a self-contained,
-- property-attached record (a landlord-side comp may have no tenant pursuit to hold
-- the fee). For tenant-originated comps the editor also syncs pursuits.actual_fee so
-- the dashboard + payment reminders keep working. Backfill from the linked pursuit.
alter table public.comps add column if not exists commission_fee numeric(14,2);

update public.comps c
  set commission_fee = p.actual_fee
  from public.pursuits p
  where c.pursuit_id = p.id and c.commission_fee is null and p.actual_fee is not null;
