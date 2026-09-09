-- Tasks can hang on a property.
--
-- Notes got property_id on 2026-08-09 so a building could carry its own history. Tasks
-- still only knew deals (client / listing / pursuit), a person, or a lead — so "call the
-- owner of 123 Main St next week" had nowhere to live except a deal that might not exist
-- yet. This gives the property page its own Add task / Add note buttons, and lets the
-- task list route a property task back to /properties/:id.
--
-- tasks_one_parent is untouched on purpose: like prospect_id, property_id sits BESIDE the
-- deal parent rather than competing with it (a tour task belongs to a pursuit AND is
-- about a building). The one-deal-parent rule still holds.

alter table public.tasks
  add column if not exists property_id uuid references public.properties(id) on delete cascade;

create index if not exists tasks_property_idx on public.tasks(property_id) where status = 'open';

comment on column public.tasks.property_id is
  'The building this task is about. Set alone for a task created from the property page; '
  'may sit alongside a deal parent (pursuit_id) for tours.';
