-- Outreach spine prerequisite: companies.normalized_name becomes a real key.
--
-- The tenant side of an outreach target anchors on company_id (a tenant does not own the
-- building, so a property cannot anchor them). That only works if normalized_name is unique.
-- Measured 2026-08-17: 13,793 companies, 13,785 distinct normalized names, exactly 8 duplicate
-- groups -- each a punctuation twin ("Keefe Group, LLC" / "Keefe Group LLC"). Merge them,
-- then add the unique index so it can never regress.
--
-- Merge rule: keeper = oldest row. Every FK column that references companies(id) is repointed
-- (clients.company_id, communications.owner_company_id, comps.tenant_company_id,
-- contacts.company_id, listings.landlord_company_id, properties.owner_company_id,
-- prospects.company_id), scalar fields are coalesced into the keeper, tags are unioned with
-- companies_push_tags DISABLED (it posts one GHL webhook per row), then the dupe is deleted.

begin;

alter table companies disable trigger companies_push_tags;

do $$
declare
  g record;
  v_keep uuid;
  v_dupe uuid;
begin
  for g in
    select normalized_name, array_agg(id order by created_at) as ids
    from companies
    where normalized_name is not null
    group by normalized_name
    having count(*) > 1
  loop
    v_keep := g.ids[1];
    for i in 2 .. array_length(g.ids, 1) loop
      v_dupe := g.ids[i];

      update clients        set company_id       = v_keep where company_id       = v_dupe;
      update communications set owner_company_id = v_keep where owner_company_id = v_dupe;
      update comps          set tenant_company_id= v_keep where tenant_company_id= v_dupe;
      update contacts       set company_id       = v_keep where company_id       = v_dupe;
      update listings       set landlord_company_id = v_keep where landlord_company_id = v_dupe;
      update properties     set owner_company_id = v_keep where owner_company_id = v_dupe;
      update prospects      set company_id       = v_keep where company_id       = v_dupe;

      update companies k
         set phone           = coalesce(k.phone,           d.phone),
             website         = coalesce(k.website,         d.website),
             notes           = case
                                 when d.notes is null or d.notes = '' or k.notes = d.notes then k.notes
                                 when k.notes is null or k.notes = '' then d.notes
                                 else k.notes || E'\n' || d.notes
                               end,
             industry        = coalesce(k.industry,        d.industry),
             employee_count  = coalesce(k.employee_count,  d.employee_count),
             annual_revenue  = coalesce(k.annual_revenue,  d.annual_revenue),
             naics           = coalesce(k.naics,           d.naics),
             sic             = coalesce(k.sic,             d.sic),
             entity_kind     = coalesce(k.entity_kind,     d.entity_kind),
             mailing_address = coalesce(k.mailing_address, d.mailing_address),
             mailing_city    = coalesce(k.mailing_city,    d.mailing_city),
             mailing_state   = coalesce(k.mailing_state,   d.mailing_state),
             mailing_zip     = coalesce(k.mailing_zip,     d.mailing_zip),
             tags            = (select coalesce(array_agg(distinct t), '{}'::text[])
                                from unnest(coalesce(k.tags,'{}') || coalesce(d.tags,'{}')) t)
        from companies d
       where k.id = v_keep and d.id = v_dupe;

      delete from companies where id = v_dupe;
    end loop;
  end loop;
end $$;

alter table companies enable trigger companies_push_tags;

-- The key the tenant-side anchor stands on.
create unique index companies_normalized_name_uniq
  on companies (normalized_name) where normalized_name is not null;

comment on index companies_normalized_name_uniq is
  'One company per normalized name. The outreach spine anchors tenant-side targets on '
  'company_id resolved through this name, so it must be a real key.';

commit;
