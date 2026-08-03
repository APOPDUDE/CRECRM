-- Alex's rule 2026-08-03 (the Toni Derby case): verification belongs to the NUMBER the
-- evidence names, not to every number sharing the person's name. Where a deal-evidenced
-- number exists (contact with hubspot_id + phone + confirmed link), sibling numbers that
-- were confirmed only by the blanket passes (same_person_phone / terrakotta_list) drop
-- back to unconfirmed. 44 links demoted across 31 owners on first run; no owner lost
-- verified status (each kept its evidenced number). Idempotent.
update owner_contacts oc2
set confidence = 'unconfirmed', verified_at = null, verified_by = null
from contacts c2
where c2.id = oc2.contact_id
  and oc2.confidence = 'confirmed'
  and c2.hubspot_id is null
  and coalesce(oc2.verified_by, '') in ('same_person_phone', 'terrakotta_list')
  and exists (
    select 1 from owner_contacts oc1
    join contacts c1 on c1.id = oc1.contact_id
    where oc1.owner_id = oc2.owner_id
      and oc1.id <> oc2.id
      and oc1.confidence = 'confirmed'
      and c1.hubspot_id is not null
      and c1.phone is not null
      and lower(btrim(c1.first_name)) = lower(btrim(c2.first_name))
      and lower(coalesce(btrim(c1.last_name), '')) = lower(coalesce(btrim(c2.last_name), ''))
  );

update owners o set verification_status = 'unverified', verification_updated_at = now()
where o.verification_status = 'verified'
  and not exists (select 1 from owner_contacts oc where oc.owner_id = o.id and oc.confidence = 'confirmed');
