-- Tasks: carry the HubSpot task id so the import is idempotent.
--
-- 811 tasks came over from HubSpot. Without a stable external key a re-run
-- duplicates every one of them, so the id is stored and uniquely indexed —
-- the same thing that makes the contact sync safe to repeat.

alter table tasks add column if not exists hubspot_id text;

create unique index if not exists tasks_hubspot_id_uniq
  on tasks (hubspot_id) where hubspot_id is not null;

comment on column tasks.hubspot_id is
  'HubSpot task object id. Present only on imported tasks; the unique index makes re-import a no-op.';
