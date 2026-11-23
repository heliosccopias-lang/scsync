-- 0028: products shared between the companies (CNPJs) of one account, and the counter sale.

-- ---------------------------------------------------------------- shared catalog
-- Each company keeps its own row (so stock stays per CNPJ); rows of the same product share a share_key.
-- Name, code, unit, price, active and stock control follow the last change made in any company.
alter table accounts add column if not exists share_catalog boolean not null default false;
alter table catalog_items add column if not exists share_key uuid;
create index if not exists catalog_items_share_key on catalog_items (share_key) where share_key is not null;

create or replace function catalog_share_targets(p_org uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select o2.id
    from orgs o
    join accounts a on a.id = o.account_id and a.share_catalog
    join orgs o2 on o2.account_id = o.account_id and o2.id <> o.id
   where o.id = p_org
$$;
revoke execute on function catalog_share_targets(uuid) from public, anon, authenticated;

create or replace function catalog_share_key() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'product' and new.share_key is null and exists (select 1 from catalog_share_targets(new.org_id)) then
    new.share_key := gen_random_uuid();
  end if;
  return new;
end $$;

create or replace function catalog_share_propagate() returns trigger
language plpgsql security definer set search_path = public as $$
declare t uuid; v_id uuid;
begin
  -- Only the change a person made spreads; the copies it writes do not spread again.
  if pg_trigger_depth() > 1 or new.kind <> 'product' or new.share_key is null then return null; end if;
  -- Stock movements and other columns do not spread (unless sharing is being turned on).
  if tg_op = 'UPDATE' and coalesce(current_setting('scsync.force_share', true), '') <> '1'
     and old.share_key is not distinct from new.share_key
     and (old.code, old.name, old.unit, old.price_cents, old.active, old.track_stock)
         is not distinct from (new.code, new.name, new.unit, new.price_cents, new.active, new.track_stock) then
    return null;
  end if;
  for t in select catalog_share_targets(new.org_id) loop
    select id into v_id from catalog_items where org_id = t and kind = 'product' and share_key = new.share_key;
    if v_id is null then
      select id into v_id from catalog_items
       where org_id = t and kind = 'product' and share_key is null
         and (lower(name) = lower(new.name) or (new.code is not null and lower(code) = lower(new.code)))
       order by (lower(name) = lower(new.name)) desc
       limit 1;
    end if;
    begin
      if v_id is null then
        insert into catalog_items (org_id, kind, code, name, unit, price_cents, active, track_stock, share_key)
        values (t, 'product', new.code, new.name, new.unit, new.price_cents, new.active, new.track_stock, new.share_key);
      else
        update catalog_items
           set share_key = new.share_key, code = new.code, name = new.name, unit = new.unit,
               price_cents = new.price_cents, active = new.active, track_stock = new.track_stock, updated_at = now()
         where id = v_id;
      end if;
    exception when unique_violation then
      -- another product of that company already uses this name or code: it is left as it is
      null;
    end;
  end loop;
  return null;
end $$;

drop trigger if exists catalog_items_share_key on catalog_items;
create trigger catalog_items_share_key before insert or update on catalog_items
  for each row execute function catalog_share_key();
drop trigger if exists catalog_items_share_propagate on catalog_items;
create trigger catalog_items_share_propagate after insert or update on catalog_items
  for each row execute function catalog_share_propagate();

-- The copies are written by the trigger above, in companies the person may not belong to.
create or replace function guard_catalog_columns() returns trigger
language plpgsql security invoker set search_path = public as $$
declare allowed text[] := array['stock_qty','updated_at'];
begin
  if pg_trigger_depth() > 1 or (select auth.uid()) is null or has_perm(coalesce(new.org_id, old.org_id), 'catalog.edit') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'UPDATE' or (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then raise exception 'permission_denied'; end if;
  return new;
end $$;

-- Turning sharing on links products with the same name or code and copies the missing ones.
-- p_source wins where the companies disagree: its products spread first; the others only add what it lacks.
create or replace function set_catalog_sharing(p_account uuid, p_on boolean, p_source uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not is_account_owner(p_account) then raise exception 'forbidden'; end if;
  update accounts set share_catalog = p_on where id = p_account;
  if not p_on then return 0; end if;
  perform set_config('scsync.force_share', '1', true);
  update catalog_items c set updated_at = now()
   where c.org_id = p_source and c.kind = 'product'
     and exists (select 1 from orgs o where o.id = p_source and o.account_id = p_account);
  update catalog_items c set updated_at = now()
    from orgs o
   where o.id = c.org_id and o.account_id = p_account and c.kind = 'product' and o.id <> p_source and c.share_key is null;
  select count(distinct share_key) into n from catalog_items c join orgs o on o.id = c.org_id
   where o.account_id = p_account and c.kind = 'product' and c.share_key is not null;
  perform set_config('scsync.force_share', '', true);
  return n;
end $$;
revoke execute on function set_catalog_sharing(uuid, boolean, uuid) from public, anon;
grant execute on function set_catalog_sharing(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------- counter sale
-- A sale at the counter is an OS (channel 'counter') created already concluded, with one installment due today,
-- accounts launched, stock taken out and, when paid on the spot, the receipt registered (the OS becomes Paga).
alter table service_orders add column if not exists channel text not null default 'os';
do $$ begin
  alter table service_orders add constraint service_orders_channel_check check (channel in ('os', 'counter'));
exception when duplicate_object then null; end $$;

create or replace function create_counter_sale(p_org uuid, p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_customer uuid := nullif(p->>'customer_id', '')::uuid;
  v_method text := coalesce(nullif(p->>'method', ''), 'cash');
  v_pay boolean := coalesce((p->>'pay_now')::boolean, true);
  v_id uuid; v_total bigint; v_today date; v_rec uuid; v_bank uuid;
begin
  if not has_perm(p_org, 'os.edit') then raise exception 'permission_denied'; end if;
  if v_pay and not has_perm(p_org, 'finance.receive') then raise exception 'permission_denied'; end if;
  if v_method not in ('cash', 'pix', 'debit_card', 'credit_card', 'transfer') then raise exception 'invalid_method'; end if;
  select (now() at time zone timezone)::date into v_today from orgs where id = p_org;

  if v_customer is null then
    select id into v_customer from customers where org_id = p_org and name = 'Consumidor final' order by created_at limit 1;
    if v_customer is null then
      insert into customers (org_id, name) values (p_org, 'Consumidor final') returning id into v_customer;
    end if;
  end if;

  v_id := create_service_order(p_org, jsonb_build_object(
    'kind', 'order', 'customer_id', v_customer, 'items', p->'items',
    'discount_cents', coalesce((p->>'discount_cents')::bigint, 0), 'notes', p->>'notes'));
  select total_cents into v_total from service_orders where id = v_id;
  if v_total is null or v_total <= 0 then raise exception 'total_not_positive'; end if;

  insert into service_order_installments (org_id, service_order_id, number, due_date, amount_cents, method)
  values (p_org, v_id, 1, v_today, v_total, v_method);

  select id into v_bank from bank_accounts
   where org_id = p_org and kind = case when v_method = 'cash' then 'cash' else 'asaas' end limit 1;
  if v_bank is null then select id into v_bank from bank_accounts where org_id = p_org order by (kind = 'asaas') desc, created_at limit 1; end if;
  update service_orders set channel = 'counter', status = 'done', bank_account_id = coalesce(v_bank, bank_account_id), updated_at = now()
   where id = v_id;

  perform launch_accounts(v_id);
  begin
    perform launch_stock(v_id);
  exception when others then
    if sqlerrm <> 'no_stock_items' then raise; end if;
  end;

  if v_pay then
    select id into v_rec from receivables where origin_type = 'service_order' and origin_id = v_id and status <> 'cancelled' limit 1;
    insert into settlements (org_id, receivable_id, paid_on, amount_cents, method, source, reference, card_installments, created_by)
    values (p_org, v_rec, v_today, v_total, v_method, 'manual', nullif(p->>'reference', ''),
            case when v_method = 'credit_card' then greatest(1, least(24, coalesce((p->>'card_installments')::int, 1))) end, auth.uid());
  end if;
  return v_id;
end $$;
revoke execute on function create_counter_sale(uuid, jsonb) from public, anon;
grant execute on function create_counter_sale(uuid, jsonb) to authenticated;
