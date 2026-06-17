-- Tour moves capture a time and become a scheduled task.
-- 'tour' task kind + a precise due_at timestamp on tasks + tour_time on pursuits.
alter type task_kind add value if not exists 'tour';
alter table public.tasks add column if not exists due_at timestamptz;
alter table public.pursuits add column if not exists tour_time time;
