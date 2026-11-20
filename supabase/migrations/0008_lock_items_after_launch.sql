-- Business rule: items can be changed only before "Lançar contas". After that the OS is locked.
create or replace function guard_items_before_launch() returns trigger
language plpgsql set search_path = public as $$
declare
  v_os uuid := coalesce(new.service_order_id, old.service_order_id);
begin
  if exists (select 1 from service_orders where id = v_os and accounts_launched_at is not null) then
    raise exception 'already_launched';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists service_order_items_locked on service_order_items;
create trigger service_order_items_locked
before insert or update or delete on service_order_items
for each row execute function guard_items_before_launch();

-- Discount and totals are locked too once accounts are launched.
create or replace function guard_totals_before_launch() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.accounts_launched_at is not null
     and (new.services_cents, new.products_cents, new.expenses_cents, new.discount_cents)
         is distinct from (old.services_cents, old.products_cents, old.expenses_cents, old.discount_cents) then
    raise exception 'already_launched';
  end if;
  return new;
end $$;

drop trigger if exists service_orders_totals_locked on service_orders;
create trigger service_orders_totals_locked
before update on service_orders
for each row execute function guard_totals_before_launch();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function guard_items_before_launch() from public, anon, authenticated;
    revoke execute on function guard_totals_before_launch() from public, anon, authenticated;
  end if;
end $$;
