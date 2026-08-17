-- GHL push support: the phone channel of one outreach list, and the id writeback.
--
-- GHL is a PUSH DESTINATION for the calls channel, never the source of truth. After an import,
-- n8n (CRE CRM . Outreach list -> GHL push) calls outreach_ghl_push_rows for the list, upserts
-- one GHL contact per phone (email goes to the Owner Email custom field -- GHL's importer
-- collapses rows on the standard email field), tags them list-<name>, then calls
-- outreach_ghl_mark so the spine remembers which GHL contact carries each number.

begin;

create or replace function outreach_ghl_push_rows(p_list text) returns jsonb
language sql security definer
set search_path to public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'phone',         c.phone,
           'first_name',    t.first_name,
           'last_name',     t.last_name,
           'email',         t.email,
           'company_name',  t.company_name,
           'ghl_contact_id', c.ghl_contact_id
         ) order by c.created_at), '[]'::jsonb)
  from outreach_calls c
  join outreach_targets t on t.id = c.target_id
  where btrim(coalesce(p_list,'')) <> ''
    and p_list = any(t.lists)
    and not c.dnc
    and t.wrong_person_at is null
$$;

comment on function outreach_ghl_push_rows(text) is
  'The phone channel of one outreach list, ready to push to GHL: one row per number, dnc and '
  'wrong-person excluded. jsonb so the PostgREST 1000-row cap cannot silently truncate it.';

create or replace function outreach_ghl_mark(p jsonb) returns jsonb
language plpgsql security definer
set search_path to public
as $$
declare v_n int;
begin
  update outreach_calls c
     set ghl_contact_id = x.gid
    from (select e->>'phone' as ph, nullif(btrim(coalesce(e->>'ghl_contact_id','')),'') as gid
            from jsonb_array_elements(case when jsonb_typeof(p->'pairs') = 'array'
                                           then p->'pairs' else '[]'::jsonb end) e) x
   where x.gid is not null
     and normalize_phone(c.phone) = normalize_phone(x.ph)
     and c.ghl_contact_id is distinct from x.gid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'marked', v_n);
end;
$$;

comment on function outreach_ghl_mark(jsonb) is
  'Writeback after a GHL push: p = {pairs:[{phone, ghl_contact_id}]}. Records which GHL contact '
  'carries each number so future imports and syncs can match without a search.';

commit;
