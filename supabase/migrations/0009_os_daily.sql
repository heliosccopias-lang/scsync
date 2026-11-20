-- Etapa 1: OS do dia a dia.

-- Public, unguessable link to share the OS with the customer (WhatsApp). 2 random UUIDs = 244 bits.
alter table service_orders
  add column share_token text not null
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
create unique index service_orders_share_token on service_orders (share_token);

-- New OS takes technician, dates, warranty and notes too.
create or replace function create_service_order(p_org uuid, p jsonb)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_number bigint;
  v_id uuid;
  v_services bigint := 0;
  v_products bigint := 0;
  v_item jsonb;
  v_inst jsonb;
  v_pos int := 0;
  v_total bigint;
  v_line bigint;
  v_sum bigint := 0;
  v_bank uuid;
begin
  if not is_org_member(p_org) then raise exception 'forbidden'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'items_required'; end if;

  update org_counters set value = value + 1
   where org_id = p_org and name = 'service_order'
   returning value into v_number;
  if v_number is null then
    insert into org_counters (org_id, name, value) values (p_org, 'service_order', 1) returning value into v_number;
  end if;

  select id into v_bank from bank_accounts where org_id = p_org and kind = 'asaas' limit 1;

  insert into service_orders (org_id, number, kind, attendance_type, customer_id, technician_id,
                              equipment, problem, notes, internal_notes, receipt_notes, technical_report,
                              warranty, delivery_date, bank_account_id, created_by)
  values (p_org, v_number, coalesce(p->>'kind','order'), coalesce(p->>'attendance_type','external'),
          (p->>'customer_id')::uuid, nullif(p->>'technician_id','')::uuid,
          p->>'equipment', p->>'problem', p->>'notes', p->>'internal_notes', p->>'receipt_notes', p->>'technical_report',
          p->>'warranty', nullif(p->>'delivery_date','')::date, v_bank, auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    v_line := round((v_item->>'quantity')::numeric * (v_item->>'unit_price_cents')::bigint);
    insert into service_order_items (org_id, service_order_id, kind, catalog_item_id, description,
                                     quantity, unit_price_cents, total_cents, position)
    values (p_org, v_id, v_item->>'kind', nullif(v_item->>'catalog_item_id','')::uuid, v_item->>'description',
            (v_item->>'quantity')::numeric, (v_item->>'unit_price_cents')::bigint, v_line, v_pos);
    v_pos := v_pos + 1;
    if v_item->>'kind' = 'service' then v_services := v_services + v_line; else v_products := v_products + v_line; end if;
  end loop;

  update service_orders set services_cents = v_services, products_cents = v_products,
         discount_cents = coalesce((p->>'discount_cents')::bigint, 0)
   where id = v_id returning total_cents into v_total;

  v_pos := 0;
  for v_inst in select * from jsonb_array_elements(coalesce(p->'installments','[]')) loop
    v_pos := v_pos + 1;
    insert into service_order_installments (org_id, service_order_id, number, due_date, amount_cents, method)
    values (p_org, v_id, v_pos, (v_inst->>'due_date')::date, (v_inst->>'amount_cents')::bigint,
            coalesce(v_inst->>'method','pix'));
    v_sum := v_sum + (v_inst->>'amount_cents')::bigint;
  end loop;

  if v_pos > 0 and v_sum <> v_total then
    raise exception 'installments_sum_mismatch: % <> %', v_sum, v_total;
  end if;
  return v_id;
end $$;

-- A quote is not billed: convert it to an OS first.
create or replace function launch_accounts(p_service_order uuid)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_os service_orders%rowtype;
  v_count int := 0;
  v_sum bigint;
  v_cat uuid;
begin
  select * into v_os from service_orders where id = p_service_order for update;
  if not found then raise exception 'not_found'; end if;
  if v_os.kind = 'quote' then raise exception 'is_quote'; end if;
  if v_os.accounts_launched_at is not null then raise exception 'already_launched'; end if;
  if v_os.status = 'cancelled' then raise exception 'cancelled'; end if;

  select coalesce(sum(amount_cents), 0), count(*) into v_sum, v_count
    from service_order_installments where service_order_id = v_os.id;
  if v_count = 0 then raise exception 'no_installments'; end if;
  if v_sum <> v_os.total_cents then raise exception 'installments_sum_mismatch: % <> %', v_sum, v_os.total_cents; end if;
  if v_os.bank_account_id is null then raise exception 'bank_account_required'; end if;

  select id into v_cat from financial_categories
   where org_id = v_os.org_id and direction = 'in' and name = 'Serviços' limit 1;

  insert into receivables (org_id, name, customer_id, bank_account_id, category_id, due_date, amount_cents,
                           method, origin_type, origin_id, installment_id)
  select v_os.org_id,
         format('OS %s - parcela %s/%s', v_os.number, i.number, v_count),
         v_os.customer_id, v_os.bank_account_id, v_cat, i.due_date, i.amount_cents,
         i.method, 'service_order', v_os.id, i.id
    from service_order_installments i
   where i.service_order_id = v_os.id
   order by i.number;

  update service_orders set accounts_launched_at = now(), updated_at = now() where id = v_os.id;
  return v_count;
end $$;

-- Catalog: unique names per org and kind (case-insensitive) so the OS can pick by name.
create unique index catalog_items_name_unique on catalog_items (org_id, kind, lower(name));
