-- Redesign G: notes / files / tasks get real typed FK parents
-- (client_id | listing_id | pursuit_id) instead of a polymorphic type+id pair.

-- notes
alter table public.notes add column client_id  uuid references public.clients(id)  on delete cascade;
alter table public.notes add column listing_id uuid references public.listings(id) on delete cascade;
alter table public.notes add column pursuit_id uuid references public.pursuits(id) on delete cascade;
update public.notes set client_id  = entity_id where entity_type = 'tenant_rep';
update public.notes set listing_id = entity_id where entity_type = 'listing';
update public.notes set pursuit_id = entity_id where entity_type = 'match';
alter table public.notes add constraint notes_one_parent
  check (num_nonnulls(client_id, listing_id, pursuit_id) = 1);
alter table public.notes drop column entity_type, drop column entity_id;
create index notes_client_idx  on public.notes(client_id);
create index notes_listing_idx on public.notes(listing_id);
create index notes_pursuit_idx on public.notes(pursuit_id);

-- files
alter table public.files add column client_id  uuid references public.clients(id)  on delete cascade;
alter table public.files add column listing_id uuid references public.listings(id) on delete cascade;
alter table public.files add column pursuit_id uuid references public.pursuits(id) on delete cascade;
update public.files set client_id  = entity_id where entity_type = 'tenant_rep';
update public.files set listing_id = entity_id where entity_type = 'listing';
update public.files set pursuit_id = entity_id where entity_type = 'match';
alter table public.files add constraint files_one_parent
  check (num_nonnulls(client_id, listing_id, pursuit_id) = 1);
alter table public.files drop column entity_type, drop column entity_id;
create index files_client_idx  on public.files(client_id);
create index files_listing_idx on public.files(listing_id);
create index files_pursuit_idx on public.files(pursuit_id);

-- tasks (parent optional — standalone to-dos allowed)
alter table public.tasks add column client_id  uuid references public.clients(id)  on delete cascade;
alter table public.tasks add column listing_id uuid references public.listings(id) on delete cascade;
alter table public.tasks add column pursuit_id uuid references public.pursuits(id) on delete cascade;
update public.tasks set client_id  = entity_id where entity_type = 'tenant_rep';
update public.tasks set listing_id = entity_id where entity_type = 'listing';
update public.tasks set pursuit_id = entity_id where entity_type = 'match';
update public.tasks set pursuit_id = coalesce(pursuit_id, match_id) where match_id is not null;
alter table public.tasks add constraint tasks_one_parent
  check (num_nonnulls(client_id, listing_id, pursuit_id) <= 1);
alter table public.tasks drop column entity_type, drop column entity_id, drop column match_id;
create index tasks_client_idx  on public.tasks(client_id);
create index tasks_listing_idx on public.tasks(listing_id);
create index tasks_pursuit_idx on public.tasks(pursuit_id);
