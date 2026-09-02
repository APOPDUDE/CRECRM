-- Dashboard triage: "yes" keeps a listing (stamps reviewed_at) so it leaves the
-- new-to-review queue but stays a live radar row; "no" sets status='dead'.
alter table deal_radar add column reviewed_at timestamptz;

create index deal_radar_triage_idx on deal_radar (found_at desc)
  where status = 'new' and reviewed_at is null;
