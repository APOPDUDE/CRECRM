-- Commission-collection ladder, anchored to the deal's CLOSE date:
--   day 4  -> "Payment follow-up"
--   day 14 -> "Payment formal notice"
--   day 30 -> "Payment final notice"
--   after  -> weekly "Payment received?"
-- The app seeds each rung as checks get answered "not received"; this daily backstop
-- (called by n8n) only fills gaps — an executed, unpaid, fee-booked deal with NO open
-- check and none created in the last 7 days gets the correct rung for where it sits on
-- the ladder today (due today when it's already past day 30). Replaces the flat
-- 14-day / due-today behaviour from 20260707000001.
create or replace function public.ensure_payment_checks()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_created int := 0;
begin
  with due as (
    select p.id as pursuit_id, p.owner_id, p.executed_date,
      coalesce(pr.address, coalesce(co.name,
        nullif(trim(ct.first_name||' '||coalesce(ct.last_name,'')),''), 'deal')) as what
    from pursuits p
    join clients c on c.id = p.client_id
    left join companies co on co.id = c.company_id
    left join contacts ct on ct.id = c.contact_id
    left join properties pr on pr.id = p.property_id
    where p.stage = 'executed'
      and p.actual_fee is not null
      and p.payment_received = false
      and not exists (
        select 1 from tasks t
        where t.pursuit_id = p.id and t.source = 'payment_check'
          and (t.status = 'open' or t.created_at > now() - interval '7 days')
      )
  ), ins as (
    insert into tasks (owner_id, title, kind, status, due_date, pursuit_id, auto_generated, source)
    select owner_id,
      case
        when executed_date is null then 'Payment received? — ' || what
        when executed_date + 4  > current_date then 'Payment follow-up — ' || what
        when executed_date + 14 > current_date then 'Payment formal notice — ' || what
        when executed_date + 30 > current_date then 'Payment final notice — ' || what
        else 'Payment received? — ' || what
      end,
      'follow_up', 'open',
      case
        when executed_date is null then current_date
        when executed_date + 4  > current_date then executed_date + 4
        when executed_date + 14 > current_date then executed_date + 14
        when executed_date + 30 > current_date then executed_date + 30
        else current_date
      end,
      pursuit_id, true, 'payment_check'
    from due
    returning 1
  )
  select count(*) into v_created from ins;
  return jsonb_build_object('created', v_created);
end $$;

grant execute on function public.ensure_payment_checks() to authenticated, service_role;
revoke execute on function public.ensure_payment_checks() from anon, public;
