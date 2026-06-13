-- Tasks (renewal reminders, follow-ups, general to-dos), an activity "kind" on
-- notes (note/call/text/email/meeting), and the lease renewal-notice date on matches.

create type task_kind as enum ('renewal', 'follow_up', 'general');
create type task_status as enum ('open', 'done');
create type note_kind as enum ('note', 'call', 'text', 'email', 'meeting');

create table tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null,
  details text,
  kind task_kind not null default 'general',
  status task_status not null default 'open',
  due_date date,
  -- optional link to the deal this task belongs to
  entity_type note_entity,
  entity_id uuid,
  contact_id uuid references contacts(id) on delete set null,
  auto_generated boolean not null default false,
  source text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_owner_status_idx on tasks(owner_id, status);
create index tasks_due_idx on tasks(due_date);
create index tasks_entity_idx on tasks(entity_type, entity_id);

create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();

alter table tasks enable row level security;
create policy tasks_auth_all on tasks for all to authenticated using (true) with check (true);

-- Activity log: notes gain a kind + optional associated contact
alter table notes add column kind note_kind not null default 'note';
alter table notes add column contact_id uuid references contacts(id) on delete set null;

-- Renewal-notice deadline captured from an executed lease (tenant must notify
-- the landlord by this date — typically 90-120 days before lease_expiration)
alter table matches add column lease_renewal_date date;
