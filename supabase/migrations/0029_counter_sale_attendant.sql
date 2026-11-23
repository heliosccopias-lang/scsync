-- 0029: the counter sale records who sold it (technician/attendant), for the OS and the commission report.
create or replace function create_counter_sale(p_org uuid, p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_customer uuid := nullif(p->>'customer_id', '')::uuid;
  v_method text := coalesce(nullif(p->>'method', ''), 'cash');
  v_pay boolean := coalesce((p->>'pay_now')::boolean, true);
  v_tech uuid := nullif(p->>'technician_id', '')::uuid;
  v_id uuid; v_total bigint; v_today date; v_rec uuid; v_bank uuid;
begin
  if not has_perm(p_org, 'os.edit') then raise exception 'permission_denied'; end if;
  if v_pay and not has_perm(p_org, 'finance.receive') then raise exception 'permission_denied'; end if;
  if v_method not in ('cash', 'pix', 'debit_card', 'credit_card', 'transfer') then raise exception 'invalid_method'; end if;
  select (now() at time zone timezone)::date into v_today from orgs where id = p_org;
  if v_tech is not null and not exists (select 1 from technicians where id = v_tech and org_id = p_org) then raise exception 'invalid_technician'; end if;

  if v_customer is null then
    select id into v_customer from customers where org_id = p_org and name = 'Consumidor final' order by created_at limit 1;
    if v_customer is null then
      insert into customers (org_id, name) values (p_org, 'Consumidor final') returning id into v_customer;
    end if;
  end if;

  v_id := create_service_order(p_org, jsonb_build_object(
    'kind', 'order', 'customer_id', v_customer, 'technician_id', v_tech, 'items', p->'items',
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
