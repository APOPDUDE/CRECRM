-- A task can originate from a specific match (e.g. a lease-renewal reminder).
-- Renewal-task dedupe is scoped to the match, not the parent deal, because one
-- tenant rep / listing can have many matches each with their own lease + renewal date.

alter table tasks add column match_id uuid references matches(id) on delete cascade;
create index tasks_match_idx on tasks(match_id);
