-- The import's address-claim lookup (20260708000001) matches on
-- lower(trim(address)) + lower(coalesce(trim(city),'')). Unindexed, that's a full scan
-- per imported item — a 3,541-item sweep ingest blew the statement timeout on
-- 2026-07-13 (n8n execution 66303, "Import properties (RPC)"). This expression index
-- (exactly matching the query's expressions) makes each claim lookup an index probe.
create index if not exists properties_addr_city_claim_idx
  on public.properties (lower(trim(address)), lower(coalesce(trim(city), '')));
