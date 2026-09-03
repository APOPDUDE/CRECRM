-- Calendly bookings from alexpoplawski.com become tasks on the lead:
--   * task_kind gains 'meeting' (a booked call/consult is neither a tour nor a generic task)
--   * tasks.external_id: the source system's id (Calendly invitee URI) so re-runs/reschedules
--     update the same task instead of stacking duplicates. Unique per source.
alter type public.task_kind add value if not exists 'meeting';
alter table public.tasks add column if not exists external_id text;
create unique index if not exists tasks_source_external_id_uidx
  on public.tasks (source, external_id) where external_id is not null;
