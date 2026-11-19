-- Functions for the vertical slice. Money rules live here so they run in one transaction.

-- Create an org for the signed-in user, make them owner, add the Asaas bank account.
create or replace function create_org(p_name text, p_cnpj text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  insert into orgs (name, cnpj) values (trim(p_name), nullif(trim(p_cnpj), '')) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into bank_accounts (org_id, name, kind) values (v_org, 'Conta Asaas', 'asaas');
  insert into org_counters (org_id, name, value) values (v_org, 'service_order', 0);
  return v_org;
end $$;

-- Create a service order with its items and installments, numbered per org.
-- p jsonb: { customer_id, kind, attendance_type, equipment, problem, notes, discount_cents,
--            items: [{kind, description, quantity, unit_price_cents, catalog_item_id?}],
--            installments: [{due_date, amount_cents, method}] }
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

  insert into service_orders (org_id, number, kind, attendance_type, customer_id, equipment, problem, notes,
                              bank_account_id, created_by)
  values (p_org, v_number, coalesce(p->>'kind','order'), coalesce(p->>'attendance_type','external'),
          (p->>'customer_id')::uuid, p->>'equipment', p->>'problem', p->>'notes',
          v_bank, auth.uid())
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

  -- discount applied last: the row is only checked once all totals are in
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

-- "Lançar contas": installments -> receivables, once.
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

-- Asaas webhook: store once, then apply. Called by the server with the service role only.
-- Returns 'duplicate' | 'ignored' | 'applied' | 'unknown_charge'.
create or replace function apply_asaas_event(p_org uuid, p_event jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_event_id text := p_event->>'id';
  v_type text := p_event->>'event';
  v_pay jsonb := p_event->'payment';
  v_evt uuid;
  v_charge charges%rowtype;
  v_rec receivables%rowtype;
  v_value bigint;
  v_principal bigint;
  v_paid_on date;
  v_open bigint;
begin
  if v_event_id is null or v_type is null then raise exception 'invalid_event'; end if;

  insert into webhook_events (org_id, event_id, event_type, payload)
  values (p_org, v_event_id, v_type, p_event)
  on conflict (provider, event_id) do nothing
  returning id into v_evt;
  if v_evt is null then return 'duplicate'; end if;

  if v_pay is null then
    update webhook_events set processed_at = now() where id = v_evt;
    return 'ignored';
  end if;

  select * into v_charge from charges
   where org_id = p_org and provider = 'asaas' and asaas_payment_id = v_pay->>'id'
   for update;
  if not found then
    update webhook_events set processed_at = now(), error = 'unknown_charge' where id = v_evt;
    return 'unknown_charge';
  end if;

  v_value := round((v_pay->>'value')::numeric * 100);
  v_paid_on := coalesce((v_pay->>'clientPaymentDate')::date, (v_pay->>'paymentDate')::date,
                        (v_pay->>'confirmedDate')::date, (now() at time zone 'America/Sao_Paulo')::date);

  if v_type in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH') then
    update charges set
      status = case when v_type = 'PAYMENT_CONFIRMED' and status <> 'received' then 'confirmed' else 'received' end,
      confirmed_at = coalesce(confirmed_at, now()),
      received_at = case when v_type <> 'PAYMENT_CONFIRMED' then coalesce(received_at, now()) else received_at end,
      net_value_cents = coalesce(round((v_pay->>'netValue')::numeric * 100), net_value_cents),
      last_event_at = now(), updated_at = now()
     where id = v_charge.id;

    if not exists (select 1 from settlements where charge_id = v_charge.id and reversed_at is null) then
      select * into v_rec from receivables where id = v_charge.receivable_id for update;
      v_open := v_rec.amount_cents - v_rec.paid_cents;
      v_principal := least(v_value, v_open);
      if v_principal > 0 then
        insert into settlements (org_id, receivable_id, paid_on, amount_cents, interest_cents, method,
                                 source, charge_id, webhook_event_id)
        values (p_org, v_rec.id, v_paid_on, v_principal, greatest(v_value - v_principal, 0),
                case v_charge.billing_type when 'BOLETO' then 'boleto' when 'CREDIT_CARD' then 'credit_card' else 'pix' end,
                'asaas_webhook', v_charge.id, v_evt);
      end if;
    end if;

  elsif v_type = 'PAYMENT_OVERDUE' then
    update charges set status = 'overdue', last_event_at = now(), updated_at = now()
     where id = v_charge.id and status = 'pending';

  elsif v_type in ('PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_REVERSED') then
    update charges set status = case when v_type = 'PAYMENT_REFUNDED' then 'refunded' else 'chargeback' end,
           last_event_at = now(), updated_at = now()
     where id = v_charge.id;
    update settlements set reversed_at = now()
     where charge_id = v_charge.id and reversed_at is null;

  elsif v_type = 'PAYMENT_DELETED' then
    update charges set status = 'cancelled', last_event_at = now(), updated_at = now()
     where id = v_charge.id and status in ('pending','overdue');

  else
    update webhook_events set processed_at = now() where id = v_evt;
    return 'ignored';
  end if;

  update webhook_events set processed_at = now() where id = v_evt;
  return 'applied';
end $$;

-- Default category used by launch_accounts.
create or replace function seed_org_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into financial_categories (org_id, name, direction) values
    (new.id, 'Serviços', 'in'), (new.id, 'Produtos', 'in'), (new.id, 'Tarifas bancárias', 'out');
  return new;
end $$;
create trigger orgs_seed_defaults after insert on orgs for each row execute function seed_org_defaults();

-- Supabase grants EXECUTE to anon/authenticated by default: narrow it down.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function apply_asaas_event(uuid, jsonb) from public, anon, authenticated;
    grant execute on function apply_asaas_event(uuid, jsonb) to service_role;
    revoke execute on function create_org(text, text) from public, anon;
    grant execute on function create_org(text, text) to authenticated;
    revoke execute on function seed_org_defaults() from public, anon, authenticated;
    revoke execute on function refresh_titulo_balance() from public, anon, authenticated;
    revoke execute on function create_service_order(uuid, jsonb) from public, anon;
    grant execute on function create_service_order(uuid, jsonb) to authenticated;
    revoke execute on function launch_accounts(uuid) from public, anon;
    grant execute on function launch_accounts(uuid) to authenticated;
  end if;
end $$;
