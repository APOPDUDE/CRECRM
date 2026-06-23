-- Associate a task with a note (and vice-versa): when a task + note are created together
-- from the board, the task points at the note. From a note you find its task via this FK.
-- on delete set null so deleting the note keeps the task.
alter table public.tasks
  add column note_id uuid references public.notes(id) on delete set null;

create index on public.tasks (note_id);
