-- 2026-09-03: the FRA crossing inventory spells the marks its own way ('CSX' where the
-- network layer says 'CSXT') and fills a blank parent with '-1'. Numeric-only marks are
-- nothing, and concat_ws drops the null so "parent: -1" disappears. Applied via MCP.
create or replace function gis.railroad_name(mark text) returns text
language sql immutable as $$
  select case
    when coalesce(mark, '') ~ '^\s*-?\d*\s*$' then null
    else case upper(trim(mark))
      when 'CSXT' then 'CSX Transportation (CSXT)'
      when 'CSX'  then 'CSX Transportation (CSXT)'
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
      else upper(trim(mark)) end
    end
$$;
