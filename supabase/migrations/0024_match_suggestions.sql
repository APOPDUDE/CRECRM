-- Pending property suggestions from the daily market sweep. The broker reviews these
-- on the dashboard and either adds them to a tenant's board (creates a match) or dismisses.
create table if not exists match_suggestions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  tenant_rep_id uuid not null references tenant_reps(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (property_id, tenant_rep_id)
);
create index if not exists match_suggestions_status_idx on match_suggestions(status);

alter table match_suggestions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='match_suggestions' and policyname='match_suggestions_auth_all') then
    create policy match_suggestions_auth_all on match_suggestions for all to authenticated using (true) with check (true);
  end if;
end $$;
