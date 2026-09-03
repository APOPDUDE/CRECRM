-- 2026-09-02: give the harvest's import RPC its own statement budget. Applied via MCP.
--
-- import_gis_features() runs under the API role's 8 s statement_timeout. A page of
-- heavy easement polygons (Lakeland's blanket easements over whole subdivisions,
-- FDEP conservation easements) needs ST_MakeValid + a 5070 transform + two GiST
-- inserts per feature and blew that budget even at 500 features a page. The edge
-- function keeps its own 100 s drain budget, so 90 s here cannot outlive the caller.
alter function public.import_gis_features(jsonb) set statement_timeout = '90s';
