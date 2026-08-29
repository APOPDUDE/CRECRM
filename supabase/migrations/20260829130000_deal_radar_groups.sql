-- Deal Radar sources: Marketplace listings AND Facebook group posts. Group posts
-- run the same parse/classify/dedupe pipeline; they just arrive from a different
-- reader (the Marketplace MCP can't see groups). external_id stays the global
-- dedupe key: 'group:<group_id>:<post_id>' for group posts.

create type deal_radar_source as enum ('marketplace', 'group');

alter table deal_radar
  add column source deal_radar_source not null default 'marketplace',
  add column group_id text,
  add column group_name text,
  add column author_name text;

create index deal_radar_source_idx on deal_radar(source);
