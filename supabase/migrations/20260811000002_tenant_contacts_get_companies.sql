-- Tenant-campaign contacts belong to a COMPANY, not to a building.
--
-- Alex: most of the leads in the 1407 Whitfield and 3609 15th St campaigns are TENANTS,
-- not owners. A tenant's association is their employer -- the company that would take the
-- space -- and never an owner_contacts link to a parcel. The tenant lead import already
-- created companies (type 'tenant'), but the later thread import created 424 contacts
-- from orphan reply addresses with no company at all, because a message-history row
-- carries an address and nothing else.
--
-- Two sources, in order of trust:
--   1. the campaign list's own Company Name for that address (passed in)
--   2. the email domain, matched against a company we already hold a website for --
--      only for non-generic domains, since gmail.com tells you nothing about an employer
--
-- Companies created here are type 'tenant' (source 'email_campaign'), same as the lead
-- import, so the tenant universe stays one population rather than two.

create or replace function attach_tenant_companies(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r jsonb;
  v_ct uuid; v_co uuid; v_domain text;
  n_in int := 0; n_named int := 0; n_domain int := 0; n_new int := 0; n_miss int := 0;
begin
  for r in select * from jsonb_array_elements(p) loop
    n_in := n_in + 1;
    select id into v_ct from contacts
    where lower(btrim(email)) = lower(btrim(r->>'email')) and company_id is null limit 1;
    if v_ct is null then continue; end if;   -- already has a company, or no such contact

    v_co := null;

    -- 1. the name the campaign itself carried
    if nullif(btrim(coalesce(r->>'company','')), '') is not null then
      select id into v_co from companies
      where lower(btrim(name)) = lower(btrim(r->>'company')) limit 1;
      if v_co is null then
        insert into companies (name, type, source, website)
        values (btrim(r->>'company'), 'tenant', 'email_campaign',
                nullif(btrim(coalesce(r->>'website','')), ''))
        returning id into v_co;
        n_new := n_new + 1;
      end if;
      n_named := n_named + 1;
    else
      -- 2. a work domain we already know: gmail/yahoo/etc name no employer, so they are
      --    excluded rather than collapsing strangers into one "company"
      v_domain := lower(split_part(btrim(r->>'email'), '@', 2));
      if v_domain is not null and v_domain not in (
        'gmail.com','yahoo.com','aol.com','hotmail.com','outlook.com','icloud.com','me.com',
        'msn.com','comcast.net','verizon.net','att.net','bellsouth.net','live.com','mac.com')
      then
        select id into v_co from companies
        where website is not null
          and lower(regexp_replace(website, '^https?://(www\.)?', '')) like v_domain || '%'
        limit 1;
        if v_co is not null then n_domain := n_domain + 1; end if;
      end if;
    end if;

    if v_co is null then n_miss := n_miss + 1; continue; end if;
    update contacts set company_id = v_co where id = v_ct;
    -- a company holding a tenant lead IS a tenant company; 'other' is just an unset default
    update companies set type = 'tenant' where id = v_co and type = 'other';
  end loop;
  return jsonb_build_object('ok', true, 'received', n_in, 'by_campaign_name', n_named,
    'by_email_domain', n_domain, 'companies_created', n_new, 'still_no_company', n_miss);
end $$;
