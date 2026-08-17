-- Merge the remaining 192 shared-phone flags -- the DIFFERENT-NAME pairs (Alex, 2026-08-17:
-- "I think you can merge those name and stuff"). Phone wins: two names on one number collapse
-- into the target that owns the calls row.
--
-- These are the Tony/Robert-Marshall-shaped pairs, so the merge is deliberately NOT lossy: the
-- losing row's name/company/email land in the keeper's raw->'merged_aliases', so if one of them
-- ever replies as a different human, the evidence of who else rode this number is still there.
-- (The email row itself survives on the keeper regardless -- only the spine row collapses.)

begin;

do $$
declare
  r record;
  v_pid uuid;
  v_merged int := 0;
begin
  create temp table _merge_map2 (fid uuid primary key, pid uuid) on commit drop;

  for r in
    select distinct on (f.id) f.id as fid, c.target_id as pid
    from outreach_targets f
    join outreach_calls c on normalize_phone(c.phone) = normalize_phone(f.phone)
    join outreach_targets p on p.id = c.target_id and p.id <> f.id
    where f.hold_reason = 'shared_phone_conflicting_email'
    order by f.id
  loop
    v_pid := r.pid;
    while exists (select 1 from _merge_map2 where fid = v_pid) loop
      select pid into v_pid from _merge_map2 where fid = v_pid;
    end loop;
    if v_pid = r.fid then continue; end if;

    update outreach_email set target_id = v_pid where target_id = r.fid;
    update outreach_calls set target_id = v_pid where target_id = r.fid;
    update outreach_mail  set target_id = v_pid where target_id = r.fid;

    update outreach_targets k
       set lists           = (select coalesce(array_agg(distinct x), '{}'::text[])
                              from unnest(k.lists || d.lists) x),
           first_name      = coalesce(k.first_name, d.first_name),
           last_name       = coalesce(k.last_name, d.last_name),
           company_name    = coalesce(k.company_name, d.company_name),
           email           = coalesce(k.email, d.email),
           mailing_address = coalesce(k.mailing_address, d.mailing_address),
           mailing_city    = coalesce(k.mailing_city, d.mailing_city),
           mailing_state   = coalesce(k.mailing_state, d.mailing_state),
           mailing_zip     = coalesce(k.mailing_zip, d.mailing_zip),
           property_id     = coalesce(k.property_id, d.property_id),
           parcel_id       = coalesce(k.parcel_id, d.parcel_id),
           company_id      = coalesce(k.company_id, d.company_id),
           contact_id      = coalesce(k.contact_id, d.contact_id),
           raw = coalesce(k.raw, '{}'::jsonb) || jsonb_build_object('merged_aliases',
                   coalesce(k.raw->'merged_aliases', '[]'::jsonb) || jsonb_build_array(
                     jsonb_strip_nulls(jsonb_build_object(
                       'first_name', d.first_name, 'last_name', d.last_name,
                       'company_name', d.company_name, 'email', d.email,
                       'merged_at', to_char(now(), 'YYYY-MM-DD')))))
      from outreach_targets d
     where k.id = v_pid and d.id = r.fid;

    delete from outreach_targets where id = r.fid;
    insert into _merge_map2 (fid, pid) values (r.fid, v_pid);
    v_merged := v_merged + 1;
  end loop;

  raise notice 'merged % name-conflict shared-phone targets', v_merged;
end $$;

commit;
