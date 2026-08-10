-- Two import functions for the bulk-load pipe.
--
-- enrich_tenant_companies: firmographics (website, employees, NAICS, SIC, industry,
-- phone) plus named tenant contacts from the CoStar lease-comp exports. Fills ONLY
-- null company fields -- never overwrites anything typed by hand ("I can fill in
-- stuff later so don't make anything up"). Named contacts arrive as SUSPECTED
-- decision makers: CoStar says they are the tenant contact, nobody has spoken to them.
--
-- import_email_leads: people from email-campaign lead lists, one row per person
-- (pre-grouped upstream). email_verified_at is stamped when the campaign got a reply
-- or an out-of-office back -- that proves the ADDRESS reaches them, nothing more.
--
-- Both respect contacts_phone_norm_uniq: a phone that already belongs to some contact
-- is dropped from the incoming row rather than stolen or duplicated.

create or replace function enrich_tenant_companies(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r jsonb; ct jsonb;
  v_co uuid; v_ct uuid;
  n_in int := 0; n_matched int := 0; n_no_co int := 0;
  n_ct_new int := 0; n_ct_filled int := 0; n_phone_dropped int := 0;
begin
  for r in select * from jsonb_array_elements(p) loop
    n_in := n_in + 1;
    select id into v_co from companies
    where lower(btrim(name)) = lower(btrim(r->>'name')) limit 1;
    if v_co is null then n_no_co := n_no_co + 1; continue; end if;
    n_matched := n_matched + 1;

    update companies set
      website        = coalesce(website, nullif(btrim(r->>'website'), '')),
      phone          = coalesce(phone, nullif(btrim(r->>'phone'), '')),
      industry       = coalesce(industry, nullif(btrim(r->>'industry'), '')),
      employee_count = coalesce(employee_count, nullif(r->>'employees', '')::int),
      naics          = coalesce(naics, nullif(btrim(r->>'naics'), '')),
      sic            = coalesce(sic, nullif(btrim(r->>'sic'), ''))
    where id = v_co;

    for ct in select * from jsonb_array_elements(coalesce(r->'contacts', '[]'::jsonb)) loop
      if nullif(btrim(coalesce(ct->>'first', '')), '') is null then continue; end if;
      -- same-name person already at this company: fill their gaps, don't duplicate
      select id into v_ct from contacts
      where company_id = v_co
        and lower(btrim(first_name || ' ' || coalesce(last_name, '')))
          = lower(btrim((ct->>'first') || ' ' || coalesce(ct->>'last', '')))
      limit 1;
      if v_ct is not null then
        update contacts set
          title = coalesce(title, nullif(btrim(ct->>'title'), '')),
          email = coalesce(email, nullif(btrim(ct->>'email'), '')),
          phone = coalesce(phone, case
            when exists (select 1 from contacts c2
                         where normalize_phone(c2.phone) = normalize_phone(ct->>'phone'))
            then null else nullif(btrim(ct->>'phone'), '') end),
          decision_maker = case when decision_maker = 'none' then 'suspected' else decision_maker end
        where id = v_ct;
        n_ct_filled := n_ct_filled + 1;
        continue;
      end if;
      -- a phone already owned by any contact stays where it is
      if normalize_phone(ct->>'phone') is not null and exists (
        select 1 from contacts c2 where normalize_phone(c2.phone) = normalize_phone(ct->>'phone')
      ) then
        n_phone_dropped := n_phone_dropped + 1;
        insert into contacts (first_name, last_name, title, email, company_id,
                              decision_maker, source_system)
        values (btrim(ct->>'first'), nullif(btrim(coalesce(ct->>'last','')), ''),
                nullif(btrim(coalesce(ct->>'title','')), ''),
                nullif(btrim(coalesce(ct->>'email','')), ''),
                v_co, 'suspected', 'costar_import');
      else
        insert into contacts (first_name, last_name, title, email, phone, company_id,
                              decision_maker, source_system)
        values (btrim(ct->>'first'), nullif(btrim(coalesce(ct->>'last','')), ''),
                nullif(btrim(coalesce(ct->>'title','')), ''),
                nullif(btrim(coalesce(ct->>'email','')), ''),
                nullif(btrim(coalesce(ct->>'phone','')), ''),
                v_co, 'suspected', 'costar_import');
      end if;
      n_ct_new := n_ct_new + 1;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'received', n_in, 'companies_matched', n_matched,
    'no_company', n_no_co, 'contacts_created', n_ct_new, 'contacts_filled', n_ct_filled,
    'phones_left_where_they_were', n_phone_dropped);
end $$;

create or replace function import_email_leads(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r jsonb;
  v_co uuid; v_ct uuid;
  v_phone text;
  n_in int := 0; n_co_new int := 0; n_ct_new int := 0; n_ct_upd int := 0;
  n_verified int := 0; n_phone_dropped int := 0;
begin
  for r in select * from jsonb_array_elements(p) loop
    n_in := n_in + 1;

    -- company: find or create (tenant universe, tagged with its origin)
    v_co := null;
    if nullif(btrim(coalesce(r->>'company', '')), '') is not null then
      select id into v_co from companies
      where lower(btrim(name)) = lower(btrim(r->>'company')) limit 1;
      if v_co is null then
        insert into companies (name, type, source, website, phone)
        values (btrim(r->>'company'), 'tenant', 'email_campaign',
                nullif(btrim(coalesce(r->>'website','')), ''),
                nullif(btrim(coalesce(r->>'company_phone','')), ''))
        returning id into v_co;
        n_co_new := n_co_new + 1;
      else
        update companies set
          website = coalesce(website, nullif(btrim(coalesce(r->>'website','')), '')),
          phone   = coalesce(phone, nullif(btrim(coalesce(r->>'company_phone','')), ''))
        where id = v_co;
      end if;
    end if;

    -- personal phone only if nobody owns it already
    v_phone := nullif(btrim(coalesce(r->>'phone', '')), '');
    if v_phone is not null and exists (
      select 1 from contacts c2 where normalize_phone(c2.phone) = normalize_phone(v_phone)
    ) then
      v_phone := null;
      n_phone_dropped := n_phone_dropped + 1;
    end if;

    -- the person: match by email anywhere, then by name at the company
    v_ct := null;
    if nullif(btrim(coalesce(r->>'email', '')), '') is not null then
      select id into v_ct from contacts
      where lower(btrim(email)) = lower(btrim(r->>'email')) limit 1;
    end if;
    if v_ct is null and v_co is not null then
      select id into v_ct from contacts
      where company_id = v_co
        and lower(btrim(first_name || ' ' || coalesce(last_name, '')))
          = lower(btrim((r->>'first') || ' ' || coalesce(r->>'last', '')))
      limit 1;
    end if;

    if v_ct is not null then
      update contacts set
        email = coalesce(email, nullif(btrim(coalesce(r->>'email','')), '')),
        phone = coalesce(phone, v_phone),
        company_id = coalesce(company_id, v_co),
        email_verified_at = case
          when (r->>'email_verified')::boolean
           and lower(btrim(coalesce(email, r->>'email'))) = lower(btrim(r->>'email'))
          then coalesce(email_verified_at, now()) else email_verified_at end,
        notes = case when nullif(btrim(coalesce(r->>'note','')), '') is null then notes
                     else coalesce(notes || E'\n', '') || btrim(r->>'note') end
      where id = v_ct;
      n_ct_upd := n_ct_upd + 1;
    else
      insert into contacts (first_name, last_name, email, phone, company_id,
                            email_verified_at, notes, source_system)
      values (btrim(r->>'first'), nullif(btrim(coalesce(r->>'last','')), ''),
              nullif(btrim(coalesce(r->>'email','')), ''), v_phone, v_co,
              case when (r->>'email_verified')::boolean then now() else null end,
              nullif(btrim(coalesce(r->>'note','')), ''),
              'email_campaign');
      n_ct_new := n_ct_new + 1;
    end if;
    if (r->>'email_verified')::boolean then n_verified := n_verified + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'received', n_in, 'companies_created', n_co_new,
    'contacts_created', n_ct_new, 'contacts_updated', n_ct_upd,
    'emails_verified', n_verified, 'phones_left_where_they_were', n_phone_dropped);
end $$;
