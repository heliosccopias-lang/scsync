-- 0037: a paid grouped charge shows as paid everywhere.
-- When the group is fully paid, each item inside it becomes 'paid' too (paid_cents = its amount; the money
-- itself stays recorded once, on the group's settlement), and every OS inside it becomes Paga whatever its
-- production status was (except Cancelada). If the group's payment is reversed, the items go back to
-- 'grouped' and those OS back to Concluída.

create or replace function group_paid_propagate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.origin_type <> 'grouping' or (new.paid_cents, new.status) is not distinct from (old.paid_cents, old.status) then
    return new;
  end if;

  if new.status = 'paid' then
    update receivables set status = 'paid', paid_cents = amount_cents, updated_at = now()
     where grouped_into_id = new.id and status = 'grouped';
    update service_orders so set status = 'paid', updated_at = now()
     where so.id in (select origin_id from receivables where grouped_into_id = new.id and origin_type = 'service_order')
       and so.status not in ('paid', 'cancelled')
       and os_fully_paid(so.id);
  elsif old.status = 'paid' then
    update receivables set status = 'grouped', paid_cents = 0, updated_at = now()
     where grouped_into_id = new.id and status = 'paid';
    update service_orders so set status = 'done', updated_at = now()
     where so.id in (select origin_id from receivables where grouped_into_id = new.id and origin_type = 'service_order')
       and so.status = 'paid'
       and not os_fully_paid(so.id);
  end if;
  return new;
end $$;

-- Groups already paid before this fix.
update receivables c set status = 'paid', paid_cents = c.amount_cents, updated_at = now()
  from receivables g
 where c.grouped_into_id = g.id and g.origin_type = 'grouping' and g.status = 'paid' and c.status = 'grouped';
update service_orders so set status = 'paid', updated_at = now()
 where so.status not in ('paid', 'cancelled')
   and so.id in (select c.origin_id from receivables c join receivables g on g.id = c.grouped_into_id
                  where g.origin_type = 'grouping' and g.status = 'paid' and c.origin_type = 'service_order')
   and os_fully_paid(so.id);
