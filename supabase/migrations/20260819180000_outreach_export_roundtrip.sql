-- The export -> skiptrace -> import ROUND TRIP (Alex, 2026-08-19).
--
-- Today the export and the import don't know about each other: Alex exports a property list,
-- skiptraces it in Terrakotta, and imports the result -- with no record of what went out, no
-- way to see what the skiptrace missed, and no reuse of records we already hold on those
-- properties. Three additions close the loop:
--
--   1. outreach_exports -- every skip-trace export gets a NAME and a snapshot of the property
--      ids it carried. The import page offers these as "which export is this from?".
--   2. import_outreach_targets v2 -- given export_id it reports COVERAGE (which exported
--      properties the skiptrace never returned, as a downloadable list), reports CONFLICTS
--      between Terrakotta's property facts and ours (report only, never a write: gross_sf /
--      land_acres are county-sourced and trigger-locked; owner name + mailing live on
--      companies), and ADOPTS prior skiptraced records -- targets already tied to this
--      import's properties join the list (wrong-person excluded), so old numbers get worked
--      and validated instead of forgotten.
--   3. outreach_ghl_push_rows -- carries the full property envelope (address/city/county/
--      state/zip/SF/acres/parcel/CRM link + grade/line type) so pushed GHL contacts are
--      formatted exactly like the tk-to-ghl era, and stops pushing numbers already known bad
--      (wrong number / disconnected): they would only waste dials.

begin;

-- ------------------------------------------------------------------ 1. the export registry
create table outreach_exports (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  property_ids uuid[] not null default '{}',
  row_count    integer not null default 0,
  created_at   timestamptz not null default now()
);

create unique index outreach_exports_name_uniq on outreach_exports (lower(btrim(name)));

comment on table outreach_exports is
  'Every skip-trace property export, by name, with the property ids it carried. The import '
  'page matches a Terrakotta CSV back to one of these to report what the skiptrace missed.';

alter table outreach_exports enable row level security;
create policy outreach_exports_auth_all on outreach_exports
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------------ 2. import v2
create or replace function import_outreach_targets(p jsonb) returns jsonb
language plpgsql security definer
set search_path to public, pg_temp
as $$
declare
  v_list   text := lower(regexp_replace(btrim(coalesce(p->>'list','')), '\s+', '-', 'g'));
  v_source text := coalesce(nullif(btrim(p->>'source'),''), 'terrakotta');
  v_export uuid := nullif(btrim(coalesce(p->>'export_id','')), '')::uuid;
  v_adopt  boolean := coalesce((p->>'adopt_prior')::boolean, true);
  r jsonb;

  v_first text; v_last text; v_name text; v_company text; v_name_source text;
  v_phone_raw text; v_phone text; v_email text;
  v_mail text; v_mail_norm text; v_mail_city text; v_mail_state text; v_mail_zip text;
  v_parcel text; v_prop_addr text; v_prop_city text;
  v_prop uuid; v_prop_n int;
  v_comp uuid;
  v_disp text; v_hold text;
  v_tid uuid; v_matched text;
  v_other uuid;

  -- conflict working state
  v_csv_sf numeric; v_csv_acres numeric;
  pr record; oc record;

  c_rows int := 0; c_skipped int := 0;
  c_new int := 0; c_existing int := 0; c_verified int := 0;
  c_by_phone int := 0; c_by_email int := 0; c_by_name int := 0;
  c_new_phone int := 0; c_new_email int := 0; c_new_mail int := 0;
  c_held int := 0; c_conflicts int := 0;
  v_held jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_missed jsonb := '[]'::jsonb;
  v_export_name text; v_export_ids uuid[];
  c_missed int := 0;
  c_adopted int := 0; c_adopted_phones int := 0;
begin
  if v_list = '' then
    return jsonb_build_object('ok', false, 'reason', 'list name is required');
  end if;
  if v_list not like 'list-%' then
    v_list := 'list-' || v_list;
  end if;
  if v_source not in ('terrakotta','ghl','smartlead','manual') then
    return jsonb_build_object('ok', false, 'reason', 'unknown source ' || v_source);
  end if;
  if jsonb_typeof(p->'rows') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'rows must be an array');
  end if;

  drop table if exists _ot_parcel;
  drop table if exists _ot_addr;
  drop table if exists _ot_hit;
  drop table if exists _ot_conflict_seen;
  create temp table _ot_parcel on commit drop as
    select pr2.id, upper(btrim(x)) as parcel
    from properties pr2, unnest(string_to_array(coalesce(pr2.parcel_number,''), ',')) x
    where btrim(x) <> '';
  create index on _ot_parcel (parcel);

  create temp table _ot_addr on commit drop as
    select pr2.id, normalize_mail_address(pr2.address) as na,
           upper(btrim(coalesce(pr2.city,''))) as city
    from properties pr2
    where pr2.address is not null;
  create index on _ot_addr (na, city);

  create temp table _ot_hit (prop uuid primary key) on commit drop;
  create temp table _ot_conflict_seen (prop uuid, field text, primary key (prop, field)) on commit drop;

  for r in select * from jsonb_array_elements(p->'rows') loop
    c_rows := c_rows + 1;

    v_first  := nullif(btrim(coalesce(r->>'first_name','')), '');
    v_last   := nullif(btrim(coalesce(r->>'last_name','')), '');
    v_company:= nullif(btrim(coalesce(r->>'company_name','')), '');
    v_name_source := nullif(btrim(coalesce(r->>'name_source','')), '');
    v_phone_raw := nullif(btrim(coalesce(r->>'phone','')), '');
    v_phone  := normalize_phone(v_phone_raw);
    v_email  := lower(btrim(coalesce(r->>'email','')));
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' then v_email := null; end if;
    v_mail       := nullif(btrim(coalesce(r->>'mailing_address','')), '');
    v_mail_norm  := normalize_mail_address(v_mail);
    v_mail_city  := nullif(btrim(coalesce(r->>'mailing_city','')), '');
    v_mail_state := nullif(btrim(coalesce(r->>'mailing_state','')), '');
    v_mail_zip   := nullif(btrim(coalesce(r->>'mailing_zip','')), '');
    v_parcel     := nullif(upper(regexp_replace(coalesce(r->>'parcel_id',''), '\s', '', 'g')), '');
    v_prop_addr  := nullif(btrim(coalesce(r->>'property_address','')), '');
    v_prop_city  := nullif(btrim(coalesce(r->>'property_city','')), '');
    v_name := nullif(upper(btrim(coalesce(v_first,'') || ' ' || coalesce(v_last,''))), '');

    v_disp := lower(nullif(btrim(coalesce(r->>'disposition','')), ''));
    if v_disp in ('wrong person','wrong_person') then v_disp := 'wrong number'; end if;

    if v_phone is null and v_email is null and v_mail_norm is null then
      c_skipped := c_skipped + 1;
      continue;
    end if;

    -- Parcel first (unambiguous only), and when the parcel is one of the 104 duplicate
    -- (county,parcel) twins, the ADDRESS gets a turn at disambiguating before we give up.
    v_prop := null; v_prop_n := 0; v_hold := null;
    if v_parcel is not null then
      select count(distinct id), min(id::text)::uuid into v_prop_n, v_prop
      from _ot_parcel where parcel = v_parcel;
    end if;
    if v_prop_n > 1 then
      v_prop := null; v_hold := 'ambiguous_property';
    end if;
    if v_prop is null and v_prop_addr is not null and v_prop_city is not null
       and length(coalesce(normalize_mail_address(v_prop_addr),'')) >= 6 then
      select count(distinct id), min(id::text)::uuid into v_prop_n, v_prop
      from _ot_addr
      where na = normalize_mail_address(v_prop_addr)
        and city = upper(btrim(v_prop_city));
      if v_prop_n = 1 then
        v_hold := null;  -- the address settled what the parcel could not
      else
        v_prop := null;
        if v_prop_n > 1 then v_hold := 'ambiguous_property'; end if;
      end if;
    end if;
    if v_prop is null and v_hold is null and (v_parcel is not null or v_prop_addr is not null) then
      v_hold := 'no_anchor';
    end if;

    if v_prop is not null then
      insert into _ot_hit values (v_prop) on conflict do nothing;
    end if;

    v_comp := null;
    if v_company is not null then
      select id into v_comp from companies
      where normalized_name = normalize_owner_name(v_company);
    end if;
    if v_comp is not null and v_hold = 'no_anchor' then
      v_hold := null;
    end if;

    -- ------------------------------------------------------------ Terrakotta vs CRM facts
    -- Report-only: county owns the physical facts (trigger-locked) and companies own the
    -- owner identity/mailing. A conflict is a thing for Alex to LOOK at, never a write.
    if v_prop is not null and c_conflicts < 300 then
      select p2.gross_sf, p2.land_acres, p2.address, p2.parcel_number, p2.owner_company_id
        into pr from properties p2 where p2.id = v_prop;

      v_csv_sf    := nullif(regexp_replace(coalesce(r->>'building_sf',''), '[^0-9.]', '', 'g'), '')::numeric;
      v_csv_acres := nullif(regexp_replace(coalesce(r->>'acres',''), '[^0-9.]', '', 'g'), '')::numeric;

      if v_csv_sf is not null and v_csv_sf > 0 and pr.gross_sf is not null and pr.gross_sf > 0
         and abs(v_csv_sf - pr.gross_sf) / greatest(pr.gross_sf, 1) > 0.10 then
        if not exists (select 1 from _ot_conflict_seen where prop = v_prop and field = 'building_sf') then
          insert into _ot_conflict_seen values (v_prop, 'building_sf');
          v_conflicts := v_conflicts || jsonb_build_object(
            'property_id', v_prop, 'property_address', pr.address, 'parcel_id', pr.parcel_number,
            'field', 'building_sf', 'csv_value', v_csv_sf::text, 'crm_value', pr.gross_sf::text);
          c_conflicts := c_conflicts + 1;
        end if;
      end if;

      if v_csv_acres is not null and v_csv_acres > 0 and pr.land_acres is not null and pr.land_acres > 0
         and abs(v_csv_acres - pr.land_acres) / greatest(pr.land_acres, 0.01) > 0.15 then
        if not exists (select 1 from _ot_conflict_seen where prop = v_prop and field = 'land_acres') then
          insert into _ot_conflict_seen values (v_prop, 'land_acres');
          v_conflicts := v_conflicts || jsonb_build_object(
            'property_id', v_prop, 'property_address', pr.address, 'parcel_id', pr.parcel_number,
            'field', 'land_acres', 'csv_value', v_csv_acres::text, 'crm_value', pr.land_acres::text);
          c_conflicts := c_conflicts + 1;
        end if;
      end if;

      if pr.owner_company_id is not null then
        select c2.name, c2.normalized_name, c2.mailing_address into oc
        from companies c2 where c2.id = pr.owner_company_id;

        if v_company is not null and oc.normalized_name is not null
           and normalize_owner_name(v_company) <> oc.normalized_name then
          if not exists (select 1 from _ot_conflict_seen where prop = v_prop and field = 'owner_name') then
            insert into _ot_conflict_seen values (v_prop, 'owner_name');
            v_conflicts := v_conflicts || jsonb_build_object(
              'property_id', v_prop, 'property_address', pr.address, 'parcel_id', pr.parcel_number,
              'field', 'owner_name', 'csv_value', v_company, 'crm_value', oc.name);
            c_conflicts := c_conflicts + 1;
          end if;
        end if;

        if v_mail_norm is not null then
          if oc.mailing_address is null then
            if not exists (select 1 from _ot_conflict_seen where prop = v_prop and field = 'owner_mailing_missing') then
              insert into _ot_conflict_seen values (v_prop, 'owner_mailing_missing');
              v_conflicts := v_conflicts || jsonb_build_object(
                'property_id', v_prop, 'property_address', pr.address, 'parcel_id', pr.parcel_number,
                'field', 'owner_mailing_missing', 'csv_value', v_mail, 'crm_value', null);
              c_conflicts := c_conflicts + 1;
            end if;
          elsif normalize_mail_address(oc.mailing_address) <> v_mail_norm then
            if not exists (select 1 from _ot_conflict_seen where prop = v_prop and field = 'owner_mailing') then
              insert into _ot_conflict_seen values (v_prop, 'owner_mailing');
              v_conflicts := v_conflicts || jsonb_build_object(
                'property_id', v_prop, 'property_address', pr.address, 'parcel_id', pr.parcel_number,
                'field', 'owner_mailing', 'csv_value', v_mail, 'crm_value', oc.mailing_address);
              c_conflicts := c_conflicts + 1;
            end if;
          end if;
        end if;
      end if;
    end if;

    v_tid := null; v_matched := null;
    if v_phone is not null then
      select target_id into v_tid from outreach_calls
      where normalize_phone(phone) = v_phone limit 1;
      if v_tid is not null then v_matched := 'phone'; end if;
    end if;

    if v_matched = 'phone' and v_email is not null
       and exists (select 1 from outreach_email e where e.target_id = v_tid)
       and not exists (select 1 from outreach_email e
                       where e.target_id = v_tid and lower(btrim(e.email)) = v_email) then
      v_tid := null; v_matched := null;
      v_hold := 'shared_phone_conflicting_email';
      v_phone := null;
    end if;

    if v_tid is null and v_email is not null then
      select target_id into v_tid from outreach_email
      where lower(btrim(email)) = v_email limit 1;
      if v_tid is not null then v_matched := 'email'; end if;
    end if;

    if v_tid is null and v_name is not null and (v_prop is not null or v_comp is not null) then
      select case when count(distinct id) = 1 then min(id::text)::uuid end into v_tid
      from outreach_targets t
      where upper(btrim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) = v_name
        and ((v_prop is not null and t.property_id = v_prop)
          or (v_comp is not null and t.company_id  = v_comp));
      if v_tid is not null then v_matched := 'name_anchor'; end if;
    end if;

    if v_tid is null then
      insert into outreach_targets
        (first_name, last_name, name_source, company_name, phone, email,
         mailing_address, mailing_city, mailing_state, mailing_zip,
         property_id, parcel_id, company_id, lists, source, hold_reason,
         wrong_person_at, raw)
      values
        (v_first, v_last, v_name_source, v_company, v_phone_raw, v_email,
         v_mail, v_mail_city, v_mail_state, v_mail_zip,
         v_prop, v_parcel, v_comp, array[v_list], v_source, v_hold,
         case when coalesce((r->>'wrong_person')::boolean, false) then now() end,
         coalesce(r->'raw', r))
      returning id into v_tid;
      c_new := c_new + 1;
      if v_hold is not null then
        c_held := c_held + 1;
        if jsonb_array_length(v_held) < 200 then
          v_held := v_held || jsonb_build_object(
            'name', coalesce(v_name, v_company, v_email, v_phone_raw),
            'reason', v_hold);
        end if;
      end if;
    else
      c_existing := c_existing + 1;
      if v_matched = 'phone' then c_by_phone := c_by_phone + 1;
      elsif v_matched = 'email' then c_by_email := c_by_email + 1;
      else c_by_name := c_by_name + 1; end if;

      if exists (select 1 from outreach_targets t join contacts c on c.id = t.contact_id
                 where t.id = v_tid and c.verified_at is not null) then
        c_verified := c_verified + 1;
      end if;

      update outreach_targets t
         set lists           = case when v_list = any(t.lists) then t.lists else t.lists || v_list end,
             first_name      = coalesce(t.first_name, v_first),
             last_name       = coalesce(t.last_name, v_last),
             company_name    = coalesce(t.company_name, v_company),
             mailing_address = coalesce(t.mailing_address, v_mail),
             mailing_city    = coalesce(t.mailing_city, v_mail_city),
             mailing_state   = coalesce(t.mailing_state, v_mail_state),
             mailing_zip     = coalesce(t.mailing_zip, v_mail_zip),
             property_id     = coalesce(t.property_id, v_prop),
             parcel_id       = coalesce(t.parcel_id, v_parcel),
             company_id      = coalesce(t.company_id, v_comp)
       where t.id = v_tid;
    end if;

    if v_phone is not null then
      select target_id into v_other from outreach_calls where normalize_phone(phone) = v_phone;
      if v_other is null then
        insert into outreach_calls (target_id, phone, disposition, line_type, phone_grade, dnc, ghl_contact_id)
        values (v_tid, v_phone_raw, v_disp,
                nullif(btrim(coalesce(r->>'line_type','')), ''),
                nullif(btrim(coalesce(r->>'phone_grade','')), ''),
                coalesce((r->>'dnc')::boolean, false),
                nullif(btrim(coalesce(r->>'ghl_contact_id','')), ''));
        c_new_phone := c_new_phone + 1;
      else
        update outreach_calls c
           set disposition    = coalesce(v_disp, c.disposition),
               line_type      = coalesce(c.line_type,  nullif(btrim(coalesce(r->>'line_type','')), '')),
               phone_grade    = coalesce(c.phone_grade, nullif(btrim(coalesce(r->>'phone_grade','')), '')),
               dnc            = c.dnc or coalesce((r->>'dnc')::boolean, false),
               ghl_contact_id = coalesce(c.ghl_contact_id, nullif(btrim(coalesce(r->>'ghl_contact_id','')), ''))
         where normalize_phone(c.phone) = v_phone;
      end if;
    end if;

    if v_email is not null then
      select target_id into v_other from outreach_email where lower(btrim(email)) = v_email;
      if v_other is null then
        insert into outreach_email (target_id, email) values (v_tid, v_email);
        c_new_email := c_new_email + 1;
      elsif v_other <> v_tid then
        update outreach_targets set hold_reason = coalesce(hold_reason, 'email_on_other_target')
        where id = v_tid;
        c_held := c_held + 1;
        if jsonb_array_length(v_held) < 200 then
          v_held := v_held || jsonb_build_object(
            'name', coalesce(v_name, v_email), 'reason', 'email_on_other_target');
        end if;
      end if;
    end if;

    if v_mail_norm is not null then
      select target_id into v_other from outreach_mail
      where normalize_mail_address(mail_address) = v_mail_norm
        and coalesce(upper(btrim(mail_zip)), '') = coalesce(upper(btrim(v_mail_zip)), '');
      if v_other is null then
        insert into outreach_mail (target_id, mail_address, mail_city, mail_state, mail_zip)
        values (v_tid, v_mail, v_mail_city, v_mail_state, v_mail_zip);
        c_new_mail := c_new_mail + 1;
      end if;
    end if;
  end loop;

  -- ------------------------------------------------------------ adopt prior skiptraces
  -- People already on the spine, tied to this import's properties, join the list -- unless
  -- confirmed wrong person. Their numbers ride the GHL push (which drops dnc / wrong-person /
  -- known-bad numbers), so old records get worked and validated instead of forgotten.
  -- The import may arrive in batches (one RPC call per 500 rows), so the property set here is
  -- the LIST's whole footprint -- every property any target on this list carries -- union the
  -- properties this call resolved. _ot_hit alone would only see the current batch.
  drop table if exists _ot_props;
  create temp table _ot_props on commit drop as
    select prop from _ot_hit
    union
    select t.property_id from outreach_targets t
    where v_list = any(t.lists) and t.property_id is not null;

  if v_adopt then
    with adopted as (
      update outreach_targets t
         set lists = t.lists || v_list
       where t.property_id in (select prop from _ot_props)
         and not (v_list = any(t.lists))
         and t.wrong_person_at is null
      returning t.id
    )
    select count(*) into c_adopted from adopted;

    select count(*) into c_adopted_phones
    from outreach_calls c
    join outreach_targets t on t.id = c.target_id
    where v_list = any(t.lists) and t.property_id in (select prop from _ot_props)
      and not c.dnc
      and lower(coalesce(c.disposition,'')) not in ('wrong number','disconnected','bad number');
  end if;

  -- ------------------------------------------------------------ coverage vs the export
  if v_export is not null then
    select name, property_ids into v_export_name, v_export_ids
    from outreach_exports where id = v_export;
    if v_export_name is not null then
      select count(*), coalesce(jsonb_agg(m order by m->>'address') filter (where rn <= 2000), '[]'::jsonb)
        into c_missed, v_missed
      from (
        select jsonb_build_object(
                 'property_id', p2.id, 'address', p2.address, 'city', p2.city,
                 'state', p2.state, 'zip', p2.zip, 'parcel_number', p2.parcel_number,
                 'owner_name', co.name) as m,
               row_number() over (order by p2.address) as rn
        from unnest(v_export_ids) x(pid)
        join properties p2 on p2.id = x.pid
        left join companies co on co.id = p2.owner_company_id
        where not exists (select 1 from _ot_props h where h.prop = x.pid)
      ) s;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'list', v_list,
    'source', v_source,
    'rows', c_rows,
    'skipped_unreachable', c_skipped,
    'new', c_new,
    'existing', c_existing,
    'already_verified', c_verified,
    'new_phone_rows', c_new_phone,
    'new_email_rows', c_new_email,
    'new_mail_rows', c_new_mail,
    'matched_by_phone', c_by_phone,
    'matched_by_email', c_by_email,
    'matched_by_name_anchor', c_by_name,
    'held', c_held,
    'held_detail', v_held,
    'properties_matched', (select count(*) from _ot_hit),
    'conflicts', c_conflicts,
    'conflict_detail', v_conflicts,
    'prior_adopted', c_adopted,
    'prior_adopted_phones', c_adopted_phones,
    'export_id', v_export,
    'export_name', v_export_name,
    'export_total', coalesce(array_length(v_export_ids, 1), 0),
    'export_missed', c_missed,
    'export_missed_detail', v_missed
  );
end;
$$;

comment on function import_outreach_targets(jsonb) is
  'THE ONLY DOOR into the outreach spine. p = {list, source, rows:[...], export_id?, '
  'adopt_prior?}. Matches each row phone -> email -> name+anchor (never name alone), never '
  'binds a new email onto a phone-matched target holding a different one, resolves properties '
  'without guessing. With export_id it reports which exported properties the skiptrace missed; '
  'it reports Terrakotta-vs-CRM fact conflicts (report only -- county owns physical facts); '
  'and it adopts prior skiptraced targets on the same properties into the list (wrong-person '
  'excluded).';

-- ------------------------------------------------------------------ 3. richer GHL push
create or replace function outreach_ghl_push_rows(p_list text) returns jsonb
language sql security definer
set search_path to public
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'phone',            c.phone,
           'first_name',       t.first_name,
           'last_name',        t.last_name,
           'email',            t.email,
           'company_name',     t.company_name,
           'ghl_contact_id',   c.ghl_contact_id,
           'phone_grade',      c.phone_grade,
           'line_type',        c.line_type,
           'property_address', pr.address,
           'property_city',    pr.city,
           'property_county',  pr.county,
           'property_state',   pr.state,
           'property_zip',     pr.zip,
           'building_sf',      pr.gross_sf,
           'land_acres',       pr.land_acres,
           'parcel_id',        coalesce(t.parcel_id, pr.parcel_number),
           'crm_property_id',  t.property_id
         )) order by c.created_at), '[]'::jsonb)
  from outreach_calls c
  join outreach_targets t on t.id = c.target_id
  left join properties pr on pr.id = t.property_id
  where btrim(coalesce(p_list,'')) <> ''
    and p_list = any(t.lists)
    and not c.dnc
    and t.wrong_person_at is null
    and lower(coalesce(c.disposition,'')) not in ('wrong number','disconnected','bad number')
$$;

comment on function outreach_ghl_push_rows(text) is
  'The phone channel of one outreach list, ready to push to GHL: one row per number with the '
  'full property envelope (county-sourced facts win). Excluded: dnc, wrong person, and numbers '
  'already known bad (wrong number / disconnected) -- they would only waste dials.';

commit;
