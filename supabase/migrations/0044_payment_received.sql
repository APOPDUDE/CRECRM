-- Payment tracking on a closed deal + a monthly "did payment arrive?" reminder
-- engine. While an executed pursuit has a booked fee and payment_received=false,
-- ensure_payment_checks() (called daily by n8n) seeds a follow-up task at most once
-- per 30 days. Approving it (payment received) flips the flag and stops the cycle.
alter table public.pursuits
  add column if not exists payment_received boolean not null default false;

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
          and (t.status = 'open' or t.created_at > now() - interval '30 days')
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
