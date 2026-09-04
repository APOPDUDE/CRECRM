-- A logged call (GHL export poll -> communications, identity resolved by phone in the BEFORE trigger)
-- stamps the contact's OPEN leads: details.called_at (first), last_called_at, last_call_direction, calls.
-- The Leads page shows "Called Sep 4" from this. Dead/converted leads are left alone.
create or replace function public.mark_lead_called()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.channel <> 'call' or new.contact_id is null then
    return new;
  end if;
  update prospects
     set details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
           'called_at', coalesce(details->'called_at', to_jsonb(new.occurred_at)),
           'last_called_at', to_jsonb(new.occurred_at),
           'last_call_direction', new.direction::text,
           'calls', coalesce((details->>'calls')::int, 0) + 1)
   where contact_id = new.contact_id and status = 'open';
  return new;
end $$;

drop trigger if exists communications_mark_lead_called on public.communications;
create trigger communications_mark_lead_called
  after insert on public.communications
  for each row execute function public.mark_lead_called();

-- backfill the website leads that already have calls logged
update prospects p
   set details = coalesce(p.details, '{}'::jsonb) || x.j
  from (
    select c.contact_id,
           jsonb_build_object('called_at', min(c.occurred_at), 'last_called_at', max(c.occurred_at), 'calls', count(*),
                              'last_call_direction', (array_agg(c.direction::text order by c.occurred_at desc))[1]) as j
      from communications c
     where c.channel = 'call' and c.contact_id is not null
     group by c.contact_id
  ) x
 where p.contact_id = x.contact_id and p.status = 'open' and p.sourced_by = 'website';
