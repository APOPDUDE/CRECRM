-- Files can now attach to a property directly (not only to a deal). Adds
-- files.property_id and widens the one-parent CHECK to include it.
alter table public.files add column if not exists property_id uuid references public.properties(id) on delete cascade;

alter table public.files drop constraint if exists files_one_parent;
alter table public.files add constraint files_one_parent
  check (num_nonnulls(client_id, listing_id, pursuit_id, property_id) = 1);

create index if not exists files_property_idx on public.files(property_id);
