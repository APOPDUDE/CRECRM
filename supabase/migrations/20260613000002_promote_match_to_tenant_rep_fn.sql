-- Promote a match's tenant into a full tenant rep, atomically. Reuses an
-- existing active rep for the same tenant (by contact, else company) if one
-- exists, otherwise creates one prefilled from the match's company/contact/
-- source; then re-parents that tenant's unattached matches onto the rep.
-- Idempotent: if the match already has a tenant_rep, returns it unchanged.

create or replace function promote_match_to_tenant_rep(p_match_id uuid, p_owner uuid)
returns tenant_reps
language plpgsql
security invoker
as $$
declare
  m matches;
  new_rep tenant_reps;
begin
  select * into m from matches where id = p_match_id;
  if m.id is null then
    raise exception 'Match % not found', p_match_id;
  end if;

  if m.tenant_rep_id is not null then
    select * into new_rep from tenant_reps where id = m.tenant_rep_id;
    return new_rep;
  end if;

  -- reuse an existing active rep for this tenant (by contact, else company) to avoid duplicates
  select * into new_rep from tenant_reps
    where owner_id = p_owner and status = 'active'
      and (
        (m.tenant_contact_id is not null and tenant_contact_id = m.tenant_contact_id)
        or (m.tenant_contact_id is null and m.tenant_company_id is not null
            and tenant_company_id = m.tenant_company_id)
      )
    order by created_at
    limit 1;

  if new_rep.id is null then
    insert into tenant_reps (owner_id, tenant_company_id, tenant_contact_id, source, broker_contact_id)
      values (
        p_owner, m.tenant_company_id, m.tenant_contact_id, m.source,
        case when m.source = 'broker' then m.broker_contact_id else null end
      )
      returning * into new_rep;
  end if;

  -- attach this tenant's unattached matches (by contact, else by company)
  update matches
    set tenant_rep_id = new_rep.id
    where tenant_rep_id is null
      and (
        (m.tenant_contact_id is not null and tenant_contact_id = m.tenant_contact_id)
        or (m.tenant_contact_id is null and m.tenant_company_id is not null
            and tenant_company_id = m.tenant_company_id)
      );

  return new_rep;
end $$;
