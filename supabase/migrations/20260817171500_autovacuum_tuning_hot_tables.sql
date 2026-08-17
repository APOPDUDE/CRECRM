-- 2026-08-17 perf: tonight's bulk work (2,937 tag writes, ~8k contact deletes, 2,079 property
-- deletes, 10k comp inserts) left 5,678 dead tuples on properties — 15%. Postgres' default
-- autovacuum threshold is 20% of the table, so on 32k rows that is ~6,400 dead rows before it
-- even starts: exactly the window a bulk session lives in. The bbox count measured
-- 1,955ms -> 170ms on VACUUM alone. Lower the scale factor on the tables this project rewrites
-- in bulk so routine work self-heals.
alter table properties     set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table comps          set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table contacts       set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
alter table communications set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
alter table companies      set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
