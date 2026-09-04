-- Daily activity counters for the dashboard Activity table: how many verified property
-- owners were reached, how many new buyers came in and how many people were talked to,
-- per calendar day in America/New_York (the broker's day, not UTC's).
--
--   verified_owners  contacts.verified_at stamped that day, where the contact's company (or a
--                    company in the same owner portfolio) owns at least one property.
--   buyers           the first day a contact became a buyer: the GHL "buyer" tag (buyer_intakes,
--                    dismissed excluded) or a buyer client on the roster, whichever came first —
--                    approving an intake days later never counts the same person twice.
--   conversations    distinct people (contact, else phone) touched by a call, text, email, note
--                    or meeting that day; calls/texts/emails/notes break that down by entry.
--                    text_messages (the cold-texting silo) count by phone as texts.
create or replace function public.activity_daily_counts(p_since date default null)
returns table (
  day date,
  verified_owners integer,
  buyers integer,
  conversations integer,
  calls integer,
  texts integer,
  emails integer,
  notes integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with vo as (
  -- two separate EXISTS so each probes properties_owner_company_idx; one OR'd EXISTS with
  -- a subplan made the planner materialize all 127k properties per contact (15 s)
  select (c.verified_at at time zone 'America/New_York')::date as day, count(*)::int as n
    from contacts c
    join companies co on co.id = c.company_id
   where c.verified_at is not null
     and (
       exists (select 1 from properties p where p.owner_company_id = co.id)
       or (co.portfolio_id is not null and exists (
             select 1
               from companies c2
               join properties p on p.owner_company_id = c2.id
              where c2.portfolio_id = co.portfolio_id))
     )
   group by 1
),
by_ as (
  select day, count(*)::int as n
    from (
      select coalesce(contact_id::text, id::text) as who,
             min(first_at at time zone 'America/New_York')::date as day
        from (
          select contact_id, id, created_at as first_at
            from clients where is_rep and deal_type <> 'lease'
          union all
          select contact_id, id, tagged_at
            from buyer_intakes where status <> 'dismissed'
        ) b
       group by 1
    ) x
   group by 1
),
comm as (
  select (occurred_at at time zone 'America/New_York')::date as day,
         coalesce(contact_id::text, phone) as who,
         channel::text as ch
    from communications
   where channel <> 'other'
  union all
  select (coalesce(sent_at, created_at) at time zone 'America/New_York')::date, phone, 'sms'
    from text_messages
),
cv as (
  select day,
         count(distinct who)::int as conversations,
         (count(*) filter (where ch = 'call'))::int as calls,
         (count(*) filter (where ch = 'sms'))::int as texts,
         (count(*) filter (where ch = 'email'))::int as emails,
         (count(*) filter (where ch in ('note', 'meeting')))::int as notes
    from comm
   group by 1
),
days as (
  select day from vo union select day from by_ union select day from cv
)
select d.day,
       coalesce(vo.n, 0),
       coalesce(by_.n, 0),
       coalesce(cv.conversations, 0),
       coalesce(cv.calls, 0),
       coalesce(cv.texts, 0),
       coalesce(cv.emails, 0),
       coalesce(cv.notes, 0)
  from days d
  left join vo on vo.day = d.day
  left join by_ on by_.day = d.day
  left join cv on cv.day = d.day
 where p_since is null or d.day >= p_since
 order by d.day desc;
$$;

revoke execute on function public.activity_daily_counts(date) from public, anon;
grant execute on function public.activity_daily_counts(date) to authenticated, service_role;
