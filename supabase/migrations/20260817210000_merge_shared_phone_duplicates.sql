-- Merge the shared-phone duplicate humans (Alex, 2026-08-17: "yes merge the people").
--
-- The legacy email_leads load flagged 499 targets shared_phone_conflicting_email: same phone as
-- an existing target but a different email, kept separate by the shared-landline guard. Measured
-- before merging: 296 pairs carry the SAME normalized name, 11 have a nameless side, 192 carry
-- DIFFERENT names (47 of those share a company). The name-compatible 307 merge here -- same
-- human, multiple skiptraced emails. The 192 different-name pairs are exactly the shape the
-- guard exists for (ROBERT MARSHALL / TONY MARSHALL on one landline = two real people), so they
-- STAY flagged for a human pass rather than being auto-merged into the wrong person.
--
-- Merge = repoint the flagged target's channel rows onto the phone-owning target, union lists,
-- coalesce fields, then delete the flagged row. Chains (A->B while B->C) resolve through a
-- mapping so nothing repoints onto a deleted row.

begin;

do $$
declare
  r record;
  v_pid uuid;
  v_merged int := 0;
begin
  create temp table _merge_map (fid uuid primary key, pid uuid) on commit drop;

  for r in
    select distinct on (f.id) f.id as fid, c.target_id as pid
    from outreach_targets f
    join outreach_calls c on normalize_phone(c.phone) = normalize_phone(f.phone)
    join outreach_targets p on p.id = c.target_id and p.id <> f.id
    where f.hold_reason = 'shared_phone_conflicting_email'
      and (
        -- names compatible: identical, or one side has no name at all
        upper(btrim(coalesce(f.first_name,'')||' '||coalesce(f.last_name,''))) =
        upper(btrim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')))
        or btrim(coalesce(f.first_name,'')||coalesce(f.last_name,'')) = ''
        or btrim(coalesce(p.first_name,'')||coalesce(p.last_name,'')) = ''
      )
    order by f.id
  loop
    -- follow the chain: if the destination was itself merged away, land on ITS destination
    v_pid := r.pid;
    while exists (select 1 from _merge_map where fid = v_pid) loop
      select pid into v_pid from _merge_map where fid = v_pid;
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
           contact_id      = coalesce(k.contact_id, d.contact_id)
      from outreach_targets d
     where k.id = v_pid and d.id = r.fid;

    delete from outreach_targets where id = r.fid;
    insert into _merge_map (fid, pid) values (r.fid, v_pid);
    v_merged := v_merged + 1;
  end loop;

  raise notice 'merged % shared-phone duplicate targets', v_merged;
end $$;

commit;
