-- One-time sweep of the asking-comp flap that 20260909120000 stops at the source.
--
-- Per (property, deal_type, listing key) series ordered by as_of_date: a row with no
-- rate/price/cap that follows a row WITH information is noise ("upon request" pass), and a
-- row whose terms equal the previous row's is a repeat. Both fold into the previous row
-- (listing-event fields it lacks are carried over, a real space figure beats a building
-- fallback), then delete. Repeated until nothing folds, so A, null, A collapses to A.
-- Two real space figures that differ at the same price are a DIFFERENT UNIT and both stay.
--
-- Keys first: the same listing sits under a parcel-number key (the pass that carried a
-- parcel) and a loopnet:<id> key. Where a series has legacy key(s) and exactly ONE loopnet
-- key (1,185 series), the legacy rows take the loopnet key so the series is one series.
-- Series with two loopnet listings (71) stay apart — two listings, two histories.
--
-- Deal-room / valuation-exclusion references to a folded row move to its survivor.
-- Every folded row is kept whole in `_rollback_asking_comp_dedup_20260909` (row = the
-- full comps record as jsonb, reason, survivor_id); rekeys are there too (reason 'rekey',
-- row = {id, source_key}). Rollback:
--   insert into comps select (jsonb_populate_record(null::comps, row)).* from _rollback_asking_comp_dedup_20260909 where reason <> 'rekey';
--   update comps c set source_key = r.row->>'source_key' from _rollback_asking_comp_dedup_20260909 r where r.reason = 'rekey' and c.id = (r.row->>'id')::uuid;

create table if not exists public._rollback_asking_comp_dedup_20260909 (
  id uuid primary key,
  reason text not null,
  survivor_id uuid,
  row jsonb not null,
  created_at timestamptz not null default now()
);
revoke all on public._rollback_asking_comp_dedup_20260909 from anon, authenticated;

do $$
declare v_rekey int := 0; v_iter int := 0; v_n int; v_total int := 0; v_refs int := 0;
begin
  -- 1. one key per listing series
  create temp table rk on commit drop as
    with k as (
      select property_id, deal_type, source_key
      from comps where kind = 'asking' and source = 'scrape' and source_key is not null
      group by 1, 2, 3),
    one as (
      select property_id, deal_type,
             max(source_key) filter (where source_key like 'loopnet:%') as ln
      from k group by 1, 2
      having count(*) filter (where source_key like 'loopnet:%') = 1
         and count(*) filter (where source_key not like 'loopnet:%') >= 1)
    select c.id, c.source_key as old_key, one.ln as new_key
    from comps c join one using (property_id, deal_type)
    where c.kind = 'asking' and c.source = 'scrape' and c.source_key not like 'loopnet:%';
  insert into public._rollback_asking_comp_dedup_20260909 (id, reason, row)
    select id, 'rekey', jsonb_build_object('id', id, 'source_key', old_key) from rk
    on conflict (id) do nothing;
  update comps c set source_key = rk.new_key from rk where rk.id = c.id;
  get diagnostics v_rekey = row_count;

  -- 2. working copy + the fold set
  create temp table w on commit drop as
    select c.id, c.property_id, c.deal_type, c.source_key,
           c.asking_lease_rate_psf as r, c.sale_price as p, c.cap_rate_pct as cap, c.sf,
           coalesce(c.listing_building_sf, pr.gross_sf) as bld,
           c.as_of_date, c.created_at
    from comps c join properties pr on pr.id = c.property_id
    where c.kind = 'asking' and c.source = 'scrape';
  create temp table del (id uuid primary key, survivor_id uuid not null, reason text not null) on commit drop;

  loop
    with s as (
      select id, r, p, cap, sf, bld,
             lag(id)  over win as pid,  lag(r)   over win as pr_, lag(p)   over win as pp,
             lag(cap) over win as pcap, lag(sf)  over win as psf, lag(bld) over win as pbld
      from w
      window win as (partition by property_id, deal_type, source_key order by as_of_date, created_at, id)
    ), cand as (
      select id, pid,
        case
          when r is null and p is null and cap is null
               and (pr_ is not null or pp is not null or pcap is not null) then 'no_information'
          when r is not distinct from pr_ and p is not distinct from pp and cap is not distinct from pcap
               and (sf is not distinct from psf or sf is null or psf is null
                    or sf = bld or psf = pbld or sf = pbld or psf = bld) then 'repeat'
        end as reason
      from s where pid is not null)
    insert into del (id, survivor_id, reason)
      select id, pid, reason from cand where reason is not null;
    get diagnostics v_n = row_count;
    exit when v_n = 0;
    delete from w where id in (select id from del);
    v_total := v_total + v_n;
    v_iter := v_iter + 1;
    if v_iter > 60 then raise exception 'asking comp dedup did not converge'; end if;
  end loop;

  -- 3. final survivor of each chain (X -> Y -> W: W)
  create temp table fin on commit drop as
    with recursive ch as (
      select id, survivor_id, 1 as depth from del
      union all
      select ch.id, d.survivor_id, ch.depth + 1 from ch join del d on d.id = ch.survivor_id where ch.depth < 100)
    select distinct on (id) id, survivor_id from ch order by id, depth desc;

  -- 4. keep the folded rows whole
  insert into public._rollback_asking_comp_dedup_20260909 (id, reason, survivor_id, row)
    select c.id, d.reason, f.survivor_id, to_jsonb(c)
    from comps c join del d on d.id = c.id join fin f on f.id = c.id
    on conflict (id) do nothing;

  -- 5. carry listing-event fields the survivor lacks; a real space beats the building fallback
  update comps s set
    listing_url          = coalesce(s.listing_url, a.listing_url),
    broker_name          = coalesce(s.broker_name, a.broker_name),
    broker_company       = coalesce(s.broker_company, a.broker_company),
    broker_phone         = coalesce(s.broker_phone, a.broker_phone),
    broker_email         = coalesce(s.broker_email, a.broker_email),
    listing_title        = coalesce(s.listing_title, a.listing_title),
    listing_description  = coalesce(s.listing_description, a.listing_description),
    space_count          = coalesce(s.space_count, a.space_count),
    listing_building_sf  = coalesce(s.listing_building_sf, a.listing_building_sf),
    asking_lease_rate_psf_max = coalesce(s.asking_lease_rate_psf_max, a.rate_max),
    listed_at            = coalesce(s.listed_at, a.listed_at),
    days_on_market       = coalesce(a.days_on_market, s.days_on_market),
    source_last_updated  = coalesce(a.source_last_updated, s.source_last_updated),
    sf = case when s.sf is null or s.sf = coalesce(s.listing_building_sf, a.listing_building_sf, a.gross_sf)
              then coalesce(a.space_sf, s.sf) else s.sf end
  from (
    select f.survivor_id,
      (array_remove(array_agg(c.listing_url         order by c.as_of_date desc, c.created_at desc), null))[1] as listing_url,
      (array_remove(array_agg(c.broker_name         order by c.as_of_date desc, c.created_at desc), null))[1] as broker_name,
      (array_remove(array_agg(c.broker_company      order by c.as_of_date desc, c.created_at desc), null))[1] as broker_company,
      (array_remove(array_agg(c.broker_phone        order by c.as_of_date desc, c.created_at desc), null))[1] as broker_phone,
      (array_remove(array_agg(c.broker_email        order by c.as_of_date desc, c.created_at desc), null))[1] as broker_email,
      (array_remove(array_agg(c.listing_title       order by c.as_of_date desc, c.created_at desc), null))[1] as listing_title,
      (array_remove(array_agg(c.listing_description order by c.as_of_date desc, c.created_at desc), null))[1] as listing_description,
      (array_remove(array_agg(c.space_count         order by c.as_of_date desc, c.created_at desc), null))[1] as space_count,
      (array_remove(array_agg(c.listing_building_sf order by c.as_of_date desc, c.created_at desc), null))[1] as listing_building_sf,
      (array_remove(array_agg(c.asking_lease_rate_psf_max order by c.as_of_date desc, c.created_at desc), null))[1] as rate_max,
      (array_remove(array_agg(c.listed_at           order by c.as_of_date asc,  c.created_at asc),  null))[1] as listed_at,
      (array_remove(array_agg(c.days_on_market      order by c.as_of_date desc, c.created_at desc), null))[1] as days_on_market,
      (array_remove(array_agg(c.source_last_updated order by c.as_of_date desc, c.created_at desc), null))[1] as source_last_updated,
      (array_remove(array_agg(case when c.sf is not null and c.sf <> coalesce(c.listing_building_sf, pr.gross_sf, -1) then c.sf end
                              order by c.as_of_date desc, c.created_at desc), null))[1] as space_sf,
      max(pr.gross_sf) as gross_sf
    from fin f join comps c on c.id = f.id join properties pr on pr.id = c.property_id
    group by f.survivor_id) a
  where s.id = a.survivor_id;

  -- 6. references follow the survivor (drop the move when the survivor is already there)
  delete from deal_room_comps d using fin f
    where d.comp_id = f.id
      and exists (select 1 from deal_room_comps x where x.deal_room_id = d.deal_room_id and x.comp_id = f.survivor_id);
  update deal_room_comps d set comp_id = f.survivor_id from fin f where d.comp_id = f.id;
  get diagnostics v_refs = row_count;
  delete from valuation_comp_exclusions v using fin f
    where v.comp_id = f.id
      and exists (select 1 from valuation_comp_exclusions x where x.property_id = v.property_id and x.comp_id = f.survivor_id);
  update valuation_comp_exclusions v set comp_id = f.survivor_id from fin f where v.comp_id = f.id;

  -- 7. fold
  delete from comps c using del d where d.id = c.id;

  raise notice 'asking comp dedup: rekeyed %, folded % rows in % passes, moved % deal-room refs',
    v_rekey, v_total, v_iter, v_refs;
end $$;

analyze comps;
