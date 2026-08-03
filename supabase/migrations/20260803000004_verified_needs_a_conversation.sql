-- Alex's tightened rule 2026-08-03: a Terrakotta number is verified only when a human
-- actually engaged -- a tag, written notes, or a connected call (Call Ended / Called Back).
-- A dropped voicemail proves nothing. Deal-attached (hubspot_id) verification unaffected.
-- First run: 335 voicemail-only links demoted; verified owners 579 -> 390 (the honest book).
--
-- The rule is also baked into the importer via import_terrakotta_evidence_upgrade(), called
-- per record after events are filed, so future skip-trace drops confirm on engagement and
-- never on silence. (import_terrakotta_batch v3 with that call applied live 2026-08-03 --
-- body identical to v2 in 20260729000003 plus the `perform import_terrakotta_evidence_upgrade`
-- line after the event loop.)
update owner_contacts oc
set confidence = 'unconfirmed', verified_at = null, verified_by = null
from contacts c
where c.id = oc.contact_id
  and oc.confidence = 'confirmed'
  and oc.verified_by = 'terrakotta_list'
  and c.hubspot_id is null
  and not exists (
    select 1 from communications cm
    where cm.contact_id = c.id
      and (array_length(cm.tags, 1) > 0
           or nullif(btrim(coalesce(cm.body, '')), '') is not null
           or cm.disposition ilike 'Call Ended%'
           or cm.disposition ilike 'Called Back%'
           or cm.source in ('ghl', 'manual'))
  );

update owners o set verification_status = 'unverified', verification_updated_at = now()
where o.verification_status = 'verified'
  and not exists (select 1 from owner_contacts oc where oc.owner_id = o.id and oc.confidence = 'confirmed');

create or replace function import_terrakotta_evidence_upgrade(p_contact uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update owner_contacts oc
  set confidence = 'confirmed',
      verified_at = coalesce(oc.verified_at, now()),
      verified_by = coalesce(oc.verified_by, 'terrakotta_activity'),
      match_basis = coalesce(oc.match_basis, 'terrakotta_activity')
  where oc.contact_id = p_contact
    and oc.confidence <> 'confirmed'
    and exists (
      select 1 from communications cm
      where cm.contact_id = p_contact
        and (array_length(cm.tags, 1) > 0
             or nullif(btrim(coalesce(cm.body, '')), '') is not null
             or cm.disposition ilike 'Call Ended%'
             or cm.disposition ilike 'Called Back%')
    );
  update owners o set verification_status = 'verified', verification_updated_at = now()
  where o.verification_status not in ('verified', 'do_not_call')
    and exists (select 1 from owner_contacts oc where oc.owner_id = o.id
                and oc.contact_id = p_contact and oc.confidence = 'confirmed');
$$;

revoke all on function import_terrakotta_evidence_upgrade(uuid) from public, anon;
grant execute on function import_terrakotta_evidence_upgrade(uuid) to service_role, authenticated;
