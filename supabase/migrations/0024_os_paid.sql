-- Status "Paga": a OS concluída e totalmente recebida passa sozinha para Paga (e volta para Concluída se um recebimento for estornado).
alter table service_orders drop constraint if exists service_orders_status_check;
alter table service_orders add constraint service_orders_status_check
  check (status in ('open','approved','in_progress','waiting_parts','done','paid','delivered','cancelled'));

create or replace function os_fully_paid(p_os uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.amount_cents), 0) > 0 and coalesce(sum(r.paid_cents), 0) >= coalesce(sum(r.amount_cents), 0)
  from receivables r
  where r.origin_type = 'service_order' and r.origin_id = p_os and r.status <> 'cancelled'
$$;

-- Moving an OS to Concluída when it is already paid lands on Paga; Paga is never set by hand on an unpaid OS.
create or replace function os_paid_on_status() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'done' and new.status is distinct from old.status and os_fully_paid(new.id) then new.status := 'paid'; end if;
  if new.status = 'paid' and not os_fully_paid(new.id) then new.status := 'done'; end if;
  return new;
end $$;
drop trigger if exists service_orders_paid_status on service_orders;
create trigger service_orders_paid_status before update of status on service_orders for each row execute function os_paid_on_status();

-- A payment (or its reversal) on an OS receivable moves the OS between Concluída and Paga.
create or replace function os_paid_on_receivable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.origin_type = 'service_order' and new.origin_id is not null and (new.paid_cents, new.status) is distinct from (old.paid_cents, old.status) then
    update service_orders set status = case when os_fully_paid(id) then 'paid' else 'done' end, updated_at = now()
    where id = new.origin_id and status in ('done','paid')
      and status is distinct from case when os_fully_paid(id) then 'paid' else 'done' end;
  end if;
  return new;
end $$;
drop trigger if exists receivables_os_paid on receivables;
create trigger receivables_os_paid after update on receivables for each row execute function os_paid_on_receivable();

revoke execute on function os_fully_paid(uuid) from public, anon;
grant execute on function os_fully_paid(uuid) to authenticated, service_role;
revoke execute on function os_paid_on_receivable() from public, anon, authenticated;

-- OS already concluded and paid move now.
update service_orders so set status = 'paid' where status = 'done' and os_fully_paid(so.id);
