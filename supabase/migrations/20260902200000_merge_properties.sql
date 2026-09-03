-- merge_properties(survivor, duplicates[]) -- one building, one row.
--
-- 3145 US Highway 92 E (Lakeland) existed FOUR times on 2026-09-02: the LoopNet sale
-- listing (06-16), the Crexi listing of the same sale (06-17, "US HWY 92 E"), the county
-- roll row (07-30, "3145 HWY 92", parcel digits undashed) and a LoopNet LEASE listing of
-- the same building (08-26, identical address). Each importer keys a property on its OWN
-- id -- listing id, parcel string, mailing-address hash -- so the same building comes in
-- once per source unless the address strings match byte for byte. A book-wide scan found
-- 261 same-parcel groups and 415 same-address groups (867 rows) with the same shape.
--
-- This function is the one door for collapsing them. It keeps the survivor's identity
-- (id, source_key), fills the survivor's blanks from the duplicates, moves every child row
-- (listings, comps, market listings, pursuits, files, notes, communications...) onto the
-- survivor, and deletes the duplicates. It returns the duplicates' full pre-image so the
-- caller can log it for rollback.
--
-- Rules it refuses to decide for you: a pursuit for the same client on both rows raises --
-- that is a deal-stage decision, not a merge rule.
--
-- County-owned physical facts (gross_sf/heated_sf/land_acres/year_built, migration
-- 20260814100000) survive intact: a never-synced survivor adopts a synced duplicate's
-- county figures (under app.county_import), a synced survivor keeps its own.

create or replace function merge_properties(p_survivor uuid, p_duplicates uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dupes      uuid[];
  v_pre        jsonb;
  v_moved      jsonb := '{}'::jsonb;
  v_n          int;
  v_col        text;
  v_tbl        text;
  v_county_src uuid;
  v_tags       text[];
  v_lp         bigint;
  v_conflicts  int;
begin
  if not exists (select 1 from properties where id = p_survivor) then
    raise exception 'merge_properties: survivor % not found', p_survivor;
  end if;

  -- duplicates, best-evidenced first: parcel-bearing, then county-synced, then oldest
  v_dupes := array(
    select id from properties
    where id = any(p_duplicates) and id <> p_survivor
    order by (nullif(split_part(parcel_key, '|', 1), '') is not null) desc,
             (county_synced_at is not null) desc,
             created_at);
  if coalesce(array_length(v_dupes, 1), 0) = 0 then
    return jsonb_build_object('survivor', p_survivor, 'merged', 0);
  end if;

  perform 1 from properties where id = p_survivor or id = any(v_dupes) for update;
  select jsonb_agg(to_jsonb(p) order by p.created_at) into v_pre
  from properties p where id = any(v_dupes);

  select count(*) into v_conflicts
  from pursuits d
  join pursuits s on s.client_id = d.client_id and s.property_id = p_survivor
  where d.property_id = any(v_dupes);
  if v_conflicts > 0 then
    raise exception 'merge_properties: % pursuit(s) for the same client exist on both survivor and duplicate; resolve by hand first', v_conflicts;
  end if;

  -- 1. county-owned facts: a never-synced survivor takes the county's figures
  if (select county_synced_at from properties where id = p_survivor) is null then
    select id into v_county_src from properties
    where id = any(v_dupes) and county_synced_at is not null
    order by county_synced_at desc limit 1;
    if v_county_src is not null then
      perform set_config('app.county_import', 'on', true);
      update properties s
         set gross_sf = d.gross_sf, heated_sf = d.heated_sf, land_acres = d.land_acres,
             year_built = d.year_built, county_synced_at = d.county_synced_at
        from properties d
       where s.id = p_survivor and d.id = v_county_src;
      perform set_config('app.county_import', '', true);
    end if;
  end if;

  -- 2. fill the survivor's blanks, best-evidenced duplicate first
  for v_col in
    select attname from pg_attribute
    where attrelid = 'public.properties'::regclass and attnum > 0
      and not attisdropped and attgenerated = ''
      and attname not in ('id','created_at','updated_at','source_key','loopnet_property_id','tags',
                          'listing_status','scraped_at','last_seen_in_sweep','county_synced_at')
  loop
    execute format(
      'update properties s set %1$I = d.%1$I '
      'from (select %1$I from properties where id = any($2) and %1$I is not null '
      '      order by array_position($2, id) limit 1) d '
      'where s.id = $1 and s.%1$I is null', v_col)
    using p_survivor, v_dupes;
  end loop;

  -- tags: union (fires properties_push_tags once if anything new arrives)
  select array(select distinct t from properties d, unnest(d.tags) t where d.id = any(v_dupes))
    into v_tags;
  if coalesce(array_length(v_tags, 1), 0) > 0 then
    update properties s
       set tags = (select array(select distinct t from unnest(coalesce(s.tags, '{}'::text[]) || v_tags) t))
     where s.id = p_survivor and not (coalesce(s.tags, '{}'::text[]) @> v_tags);
  end if;

  -- market state: on_market wins; freshest sweep timestamps; LoopNet building id carried over
  select min(loopnet_property_id) into v_lp from properties where id = any(v_dupes);
  update properties set loopnet_property_id = null
   where id = any(v_dupes) and loopnet_property_id is not null;
  update properties s
     set listing_status = case
           when s.listing_status = 'on_market' then s.listing_status
           when exists (select 1 from properties where id = any(v_dupes) and listing_status = 'on_market')
             then 'on_market'::listing_market_status
           else s.listing_status end,
         scraped_at = greatest(s.scraped_at, m.sa),
         last_seen_in_sweep = greatest(s.last_seen_in_sweep, m.ls),
         loopnet_property_id = coalesce(s.loopnet_property_id, v_lp)
    from (select max(scraped_at) sa, max(last_seen_in_sweep) ls
            from properties where id = any(v_dupes)) m
   where s.id = p_survivor;

  -- 3. children: plain repoints
  foreach v_tbl in array array['communications','comps','deal_radar','files','market_events',
                          'market_listings','notes','outreach_targets','prospect_properties',
                          'units','valuation_comp_exclusions','listings','pursuits'] loop
    execute format('update %I set property_id = $1 where property_id = any($2)', v_tbl)
      using p_survivor, v_dupes;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_moved := v_moved || jsonb_build_object(v_tbl, v_n); end if;
  end loop;

  -- unique-per-client / composite-key children: move unless the survivor already has one
  update suggestions d set property_id = p_survivor
   where d.property_id = any(v_dupes)
     and not exists (select 1 from suggestions s where s.property_id = p_survivor and s.client_id = d.client_id);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('suggestions', v_n); end if;

  update listing_parcels d set property_id = p_survivor
   where d.property_id = any(v_dupes)
     and not exists (select 1 from listing_parcels s where s.listing_id = d.listing_id and s.property_id = p_survivor);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('listing_parcels', v_n); end if;

  -- one-row-per-property children: adopt a duplicate's only when the survivor has none
  -- (property_owner_rollup / property_market_position are derived and simply cascade away)
  foreach v_tbl in array array['deal_flags','deal_flag_evals','parcel_enrichment'] loop
    execute format(
      'update %1$I set property_id = $1 '
      'where property_id = (select property_id from %1$I where property_id = any($2) '
      '                     order by array_position($2, property_id) limit 1) '
      '  and not exists (select 1 from %1$I where property_id = $1)', v_tbl)
      using p_survivor, v_dupes;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_moved := v_moved || jsonb_build_object(v_tbl, v_n); end if;
  end loop;

  -- 4. the duplicates go
  delete from properties where id = any(v_dupes);
  get diagnostics v_n = row_count;

  return jsonb_build_object(
    'survivor', p_survivor, 'merged', v_n, 'duplicates', to_jsonb(v_dupes),
    'moved', v_moved, 'pre_image', v_pre);
end $$;

comment on function merge_properties(uuid, uuid[]) is
  'Collapse duplicate property rows into one survivor: fills blanks, moves every child row, '
  'deletes the duplicates, returns their pre-image. Raises when both sides hold a pursuit for '
  'the same client.';

revoke all on function merge_properties(uuid, uuid[]) from public, anon;
