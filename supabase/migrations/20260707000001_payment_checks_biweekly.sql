-- Payment follow-ups move from monthly to every two weeks.
--
-- Cadence: when a deal executes, the app seeds the FIRST "payment received?" check one
-- month out. Answering "not received" (dashboard/tasks buttons, or checking the task off)
-- completes that check and seeds the next one two weeks out. This daily-engine backstop
-- (called by n8n) only fills gaps — an executed, unpaid, fee-booked deal with no open
-- check and none created recently gets one seeded due today. Shrink its re-seed window
-- from 30 to 14 days to match the new follow-up cadence.
create or replace function public.ensure_payment_checks()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_created int := 0;
begin
  with due as (
    select p.id as pursuit_id, p.owner_id, p.client_id,
      coalesce(co.name, nullif(trim(ct.first_name||' '||coalesce(ct.last_name,'')),''), 'client') as who
    from pursuits p
    join clients c on c.id = p.client_id
    left join companies co on co.id = c.company_id
    left join contacts ct on ct.id = c.contact_id
    where p.stage = 'executed'
      and p.actual_fee is not null
      and p.payment_received = false
      and not exists (
        select 1 from tasks t
        where t.pursuit_id = p.id and t.source = 'payment_check'
          and (t.status = 'open' or t.created_at > now() - interval '14 days')
      )
  ), ins as (
    insert into tasks (owner_id, title, kind, status, due_date, pursuit_id, auto_generated, source)
    select owner_id, 'Payment received from ' || who || '?', 'follow_up', 'open', current_date,
           pursuit_id, true, 'payment_check'
    from due
    returning 1
  )
  select count(*) into v_created from ins;
  return jsonb_build_object('created', v_created);
end $$;

-- Re-assert the hardened ACLs (create or replace preserves them, but keep the file
-- self-contained for fresh environments): daily n8n engine (service_role) + the app.
grant execute on function public.ensure_payment_checks() to authenticated, service_role;
revoke execute on function public.ensure_payment_checks() from anon, public;
