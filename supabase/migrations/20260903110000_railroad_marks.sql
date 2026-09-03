-- 2026-09-03: three more reporting marks seen in the six counties once the FRA network
-- landed — PVTX (private industry track), SCXF (South Central Florida Express) and
-- CFCR (Central Florida Rail Corridor, FDOT-owned, Amtrak rights). Applied via MCP.
create or replace function gis.railroad_name(mark text) returns text
language sql immutable as $$
  select case upper(trim(coalesce(mark, '')))
    when 'CSXT' then 'CSX Transportation (CSXT)'
    when 'FCEN' then 'Florida Central Railroad (FCEN)'
    when 'FMID' then 'Florida Midland Railroad (FMID)'
    when 'FNOR' then 'Florida Northern Railroad (FNOR)'
    when 'SGLR' then 'Seminole Gulf Railway (SGLR)'
    when 'SCXF' then 'South Central Florida Express (SCXF)'
    when 'SCFE' then 'South Central Florida Express (SCFE)'
    when 'CFCR' then 'Central Florida Rail Corridor, FDOT (CFCR)'
    when 'PVTX' then 'Private industry track (PVTX)'
    when 'AMTK' then 'Amtrak (AMTK)'
    when 'FEC'  then 'Florida East Coast Railway (FEC)'
    when 'BAYL' then 'Bay Line Railroad (BAYL)'
    when ''     then null
    else upper(trim(mark)) end
$$;
