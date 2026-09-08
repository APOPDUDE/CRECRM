-- New functions inherit EXECUTE for PUBLIC (and therefore anon) on this project.
-- The investor page needs exactly ONE anon door; everything else is Alex-only.
-- See memory/reference-anon-grant-sweep.md.
revoke all on function create_deal_room(uuid,text,text,text,numeric,numeric,text[],boolean) from public, anon;
grant execute on function create_deal_room(uuid,text,text,text,numeric,numeric,text[],boolean) to authenticated;

revoke all on function deal_room_fill_comps(uuid,numeric,integer,integer,date,text,integer) from public, anon;
grant execute on function deal_room_fill_comps(uuid,numeric,integer,integer,date,text,integer) to authenticated;

revoke all on function deal_room_slug(text) from public, anon;
grant execute on function deal_room_slug(text) to authenticated;

revoke all on function geo_miles(double precision,double precision,double precision,double precision) from public, anon;
grant execute on function geo_miles(double precision,double precision,double precision,double precision) to authenticated;
