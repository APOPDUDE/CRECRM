-- Property-page owner contact management + the phone-less twin merge.
--
-- 1. The app's "add verified contact" reuses ghl_verify_owner() -- one code path for
--    "a human vouched for this owner", whether the voucher is the VA's GHL tag or Alex
--    on the property page.
grant execute on function ghl_verify_owner(jsonb) to authenticated;

-- 2. MERGE PHONE-LESS TWINS (applied live 2026-08-03; idempotent -- re-running finds none).
-- The HubSpot import carried no phones (identity = hubspot_id) while Terrakotta rows keyed
-- on phone, so the same human became two contacts: one holding the conversation history,
-- one holding the number. Each phone-less contact merges into its phone-carrying twin
-- (same name, same owner): FKs repointed via the catalog (unique collisions drop the
-- redundant dup-side row), dup deleted, THEN the survivor inherits email/title/hubspot_id
-- (that order avoids both the hubspot_id unique index and contacts_needs_identity firing
-- on intermediate states). 436 twins merged, 272 conversations moved on first run.
do $$
declare
  pr record;
  r  record;
  d  contacts;
  n_merged int := 0;
begin
  for pr in
    with ranked as (
      select c_less.id as dup_id, c_phone.id as target_id,
             row_number() over (
               partition by c_less.id
               order by (o2.confidence = 'confirmed') desc, c_phone.created_at
             ) as rn
      from owner_contacts o1
      join contacts c_less on c_less.id = o1.contact_id and c_less.phone is null
      join owner_contacts o2 on o2.owner_id = o1.owner_id
      join contacts c_phone on c_phone.id = o2.contact_id and c_phone.phone is not null
      where lower(btrim(c_less.first_name)) = lower(btrim(c_phone.first_name))
        and lower(coalesce(btrim(c_less.last_name),'')) = lower(coalesce(btrim(c_phone.last_name),''))
    )
    select dup_id, target_id from ranked where rn = 1
  loop
    select * into d from contacts where id = pr.dup_id;
    continue when d.id is null;

    for r in
      select con.conrelid::regclass::text as tbl, att.attname as col
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
      where con.confrelid = 'public.contacts'::regclass and con.contype = 'f'
    loop
      begin
        execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col)
          using pr.target_id, pr.dup_id;
      exception when unique_violation then
        execute format('delete from %s where %I = $1', r.tbl, r.col) using pr.dup_id;
      end;
    end loop;

    delete from contacts where id = pr.dup_id;

    update contacts t
    set email      = coalesce(t.email, d.email),
        title      = coalesce(t.title, d.title),
        hubspot_id = coalesce(t.hubspot_id, d.hubspot_id),
        notes      = coalesce(t.notes, d.notes),
        company_id = coalesce(t.company_id, d.company_id),
        import_addresses = (
          select case when count(*) = 0 then null else array_agg(distinct x) end
          from (select unnest(coalesce(t.import_addresses, '{}'::text[])) as x
                union select unnest(coalesce(d.import_addresses, '{}'::text[]))) u
          where x is not null)
    where t.id = pr.target_id;

    n_merged := n_merged + 1;
  end loop;
  raise notice 'merged % phone-less twins', n_merged;
end $$;
