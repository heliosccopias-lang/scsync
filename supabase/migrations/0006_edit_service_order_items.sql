-- Edit the items (and discount) of an existing service order.
-- Keeps installments and, if accounts were already launched, the receivables in step with the new total:
-- same number of installments, same due dates and methods, amounts re-split (last one takes the remainder).
-- Refuses when money already moved: a receipt that was not reversed, or an Asaas charge still open.
create or replace function update_service_order_items(p_service_order uuid, p_items jsonb, p_discount_cents bigint)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  v_os service_orders%rowtype;
  v_item jsonb;
  v_pos int := 0;
  v_line bigint;
  v_services bigint := 0;
  v_products bigint := 0;
  v_total bigint;
  v_n int;
  v_base bigint;
  v_i record;
begin
  select * into v_os from service_orders where id = p_service_order for update;
  if not found then raise exception 'not_found'; end if;
  if v_os.status = 'cancelled' then raise exception 'cancelled'; end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'items_required'; end if;

  if exists (
    select 1 from settlements s join receivables r on r.id = s.receivable_id
     where r.origin_type = 'service_order' and r.origin_id = v_os.id and s.reversed_at is null
  ) then raise exception 'has_payments'; end if;

  if exists (
    select 1 from charges c join receivables r on r.id = c.receivable_id
     where r.origin_type = 'service_order' and r.origin_id = v_os.id
       and c.status in ('pending','overdue','confirmed','received')
  ) then raise exception 'has_open_charges'; end if;

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

  select count(*) into v_n from service_order_installments where service_order_id = v_os.id;
  if v_n > 0 then
    if v_total < v_n then raise exception 'total_below_installments'; end if;
    v_base := v_total / v_n;
    for v_i in select id, number from service_order_installments where service_order_id = v_os.id order by number loop
      update service_order_installments
         set amount_cents = case when v_i.number = v_n then v_total - v_base * (v_n - 1) else v_base end
       where id = v_i.id;
    end loop;

    -- launched accounts follow their installment (none has money on it: checked above)
    update receivables r
       set amount_cents = i.amount_cents, updated_at = now()
      from service_order_installments i
     where r.installment_id = i.id and i.service_order_id = v_os.id and r.status <> 'cancelled';
  end if;

  return v_total;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function update_service_order_items(uuid, jsonb, bigint) from public, anon;
    grant execute on function update_service_order_items(uuid, jsonb, bigint) to authenticated;
  end if;
end $$;
