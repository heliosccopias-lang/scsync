-- Editing items never needs cancelling anything:
--  * installments that already received money keep their amount (frozen);
--  * the rest of the new total is re-split across the open installments (last one takes the remainder);
--  * if every installment is already paid and the total grew, a new installment is added (due today);
--  * receivables follow their installment.
-- Returns {"total": ..., "changed": [{receivable_id, amount_cents, due_date, method}], "added_receivable_id": ...}
-- so the app can update the matching Asaas charges.
drop function if exists update_service_order_items(uuid, jsonb, bigint);

create or replace function update_service_order_items(p_service_order uuid, p_items jsonb, p_discount_cents bigint)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_os service_orders%rowtype;
  v_item jsonb;
  v_pos int := 0;
  v_line bigint;
  v_services bigint := 0;
  v_products bigint := 0;
  v_total bigint;
  v_frozen bigint := 0;
  v_open_n int := 0;
  v_remaining bigint;
  v_base bigint;
  v_k int := 0;
  v_i record;
  v_new_amount bigint;
  v_changed jsonb := '[]';
  v_added uuid;
  v_last service_order_installments%rowtype;
  v_count int;
  v_cat uuid;
  v_today date;
begin
  select * into v_os from service_orders where id = p_service_order for update;
  if not found then raise exception 'not_found'; end if;
  if v_os.status = 'cancelled' then raise exception 'cancelled'; end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'items_required'; end if;

  delete from service_order_items where service_order_id = v_os.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := round((v_item->>'quantity')::numeric * (v_item->>'unit_price_cents')::bigint);
    insert into service_order_items (org_id, service_order_id, kind, catalog_item_id, description,
                                     quantity, unit_price_cents, total_cents, position)
    values (v_os.org_id, v_os.id, v_item->>'kind', nullif(v_item->>'catalog_item_id','')::uuid, v_item->>'description',
            (v_item->>'quantity')::numeric, (v_item->>'unit_price_cents')::bigint, v_line, v_pos);
    v_pos := v_pos + 1;
    if v_item->>'kind' = 'service' then v_services := v_services + v_line; else v_products := v_products + v_line; end if;
  end loop;

  update service_orders
     set services_cents = v_services, products_cents = v_products,
         discount_cents = coalesce(p_discount_cents, 0), updated_at = now()
   where id = v_os.id
   returning total_cents into v_total;
  if v_total <= 0 then raise exception 'total_not_positive'; end if;

  -- frozen = installments whose receivable already has money on it
  select coalesce(sum(i.amount_cents), 0)
    into v_frozen
    from service_order_installments i
    left join receivables r on r.installment_id = i.id and r.status <> 'cancelled'
   where i.service_order_id = v_os.id and coalesce(r.paid_cents, 0) > 0;
  select count(*) into v_open_n
    from service_order_installments i
    left join receivables r on r.installment_id = i.id and r.status <> 'cancelled'
   where i.service_order_id = v_os.id and coalesce(r.paid_cents, 0) = 0;

  select count(*) into v_count from service_order_installments where service_order_id = v_os.id;
  if v_count = 0 then
    return jsonb_build_object('total', v_total, 'changed', v_changed);
  end if;

  v_remaining := v_total - v_frozen;
  if v_remaining < 0 then raise exception 'below_paid'; end if;

  if v_open_n = 0 then
    if v_remaining > 0 then
      -- everything was paid and the total grew: one more installment, due today
      select * into v_last from service_order_installments where service_order_id = v_os.id order by number desc limit 1;
      select (now() at time zone timezone)::date into v_today from orgs where id = v_os.org_id;
      insert into service_order_installments (org_id, service_order_id, number, due_date, amount_cents, method)
      values (v_os.org_id, v_os.id, v_last.number + 1, v_today, v_remaining, v_last.method)
      returning * into v_last;
      if v_os.accounts_launched_at is not null then
        select id into v_cat from financial_categories
         where org_id = v_os.org_id and direction = 'in' and name = 'Serviços' limit 1;
        insert into receivables (org_id, name, customer_id, bank_account_id, category_id, due_date, amount_cents,
                                 method, origin_type, origin_id, installment_id)
        values (v_os.org_id, format('OS %s - parcela %s (acréscimo)', v_os.number, v_last.number),
                v_os.customer_id, v_os.bank_account_id, v_cat, v_last.due_date, v_last.amount_cents,
                v_last.method, 'service_order', v_os.id, v_last.id)
        returning id into v_added;
      end if;
    end if;
    return jsonb_build_object('total', v_total, 'changed', v_changed, 'added_receivable_id', v_added);
  end if;

  if v_remaining < v_open_n then raise exception 'below_paid'; end if;
  v_base := v_remaining / v_open_n;

  for v_i in
    select i.id, i.number, i.due_date, i.method, i.amount_cents, r.id as receivable_id
      from service_order_installments i
      left join receivables r on r.installment_id = i.id and r.status <> 'cancelled'
     where i.service_order_id = v_os.id and coalesce(r.paid_cents, 0) = 0
     order by i.number
  loop
    v_k := v_k + 1;
    v_new_amount := case when v_k = v_open_n then v_remaining - v_base * (v_open_n - 1) else v_base end;
    update service_order_installments set amount_cents = v_new_amount where id = v_i.id;
    if v_i.receivable_id is not null then
      update receivables set amount_cents = v_new_amount, updated_at = now() where id = v_i.receivable_id;
      if v_new_amount <> v_i.amount_cents then
        v_changed := v_changed || jsonb_build_object(
          'receivable_id', v_i.receivable_id, 'amount_cents', v_new_amount,
          'due_date', v_i.due_date, 'method', v_i.method);
      end if;
    end if;
  end loop;

  return jsonb_build_object('total', v_total, 'changed', v_changed);
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function update_service_order_items(uuid, jsonb, bigint) from public, anon;
    grant execute on function update_service_order_items(uuid, jsonb, bigint) to authenticated;
  end if;
end $$;
