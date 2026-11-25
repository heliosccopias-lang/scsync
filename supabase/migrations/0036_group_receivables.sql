-- 0036: group several open receivables of the same customer into one charge ("fatura do mês").
-- For customers with recurring work: at month end, the open installments of their OS are grouped into ONE
-- receivable (origin_type 'grouping'), which is charged once (Pix, boleto, card link, card machine, manual).
-- The grouped items keep status 'grouped' and point to the group (grouped_into_id). When the group is fully
-- paid, every OS inside it counts as paid and a Concluída OS becomes Paga. Ungrouping is possible while the
-- group has no payment and no live charge.

-- An OS is fully paid when its own receivables are paid, counting a grouped one as paid once its group is paid.
create or replace function os_fully_paid(p_os uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.amount_cents), 0) > 0
     and coalesce(sum(case when r.status = 'grouped'
                           then case when g.status = 'paid' then r.amount_cents else 0 end
                           else r.paid_cents end), 0) >= coalesce(sum(r.amount_cents), 0)
    from receivables r
    left join receivables g on g.id = r.grouped_into_id
   where r.origin_type = 'service_order' and r.origin_id = p_os and r.status <> 'cancelled'
$$;

create or replace function group_receivables(p_org uuid, p_ids uuid[], p_due date, p_method text, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_n int;
  v_customers int;
  v_customer uuid;
  v_first receivables%rowtype;
  v_total bigint;
  v_id uuid;
  v_name text;
  v_notes text;
begin
  if not has_any_perm(p_org, array['finance.receive', 'finance.edit']) then raise exception 'permission_denied'; end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) < 2 then raise exception 'need_two'; end if;
  if p_method not in ('pix', 'boleto', 'credit_card', 'other') then raise exception 'invalid_method'; end if;
  if p_due is null then raise exception 'due_required'; end if;

  -- Lock the rows and check them all.
  perform 1 from receivables where id = any(p_ids) for update;
  select count(*), count(distinct customer_id), min(customer_id::text)::uuid, sum(amount_cents)
    into v_n, v_customers, v_customer, v_total
    from receivables where id = any(p_ids) and org_id = p_org;
  if v_n <> array_length(p_ids, 1) then raise exception 'not_found'; end if;
  if v_customers <> 1 or v_customer is null or exists (select 1 from receivables where id = any(p_ids) and customer_id is null) then raise exception 'same_customer'; end if;
  if exists (select 1 from customers where id = v_customer and name = 'Consumidor final') then raise exception 'walk_in_customer'; end if;
  if exists (select 1 from receivables where id = any(p_ids) and (status <> 'open' or paid_cents > 0)) then raise exception 'not_open'; end if;
  if exists (select 1 from receivables where id = any(p_ids) and origin_type = 'grouping') then raise exception 'already_group'; end if;
  if exists (select 1 from charges where receivable_id = any(p_ids) and status in ('pending', 'overdue', 'confirmed')) then raise exception 'live_charge'; end if;
  if exists (select 1 from pos_charges where receivable_id = any(p_ids) and status = 'pending') then raise exception 'live_charge'; end if;

  select * into v_first from receivables where id = any(p_ids) order by due_date, created_at limit 1;
  v_name := coalesce(nullif(trim(p_name), ''),
                     format('Fatura %s · %s itens', to_char(p_due, 'MM/YYYY'), v_n));
  select string_agg(format('%s — %s', r.name, to_char(r.amount_cents / 100.0, 'FM999G999G990D00')), E'\n' order by r.due_date, r.name)
    into v_notes from receivables r where r.id = any(p_ids);

  insert into receivables (org_id, name, customer_id, bank_account_id, category_id, cost_center_id, due_date, amount_cents,
                           method, notes, origin_type)
  values (p_org, left(v_name, 200), v_customer, v_first.bank_account_id, v_first.category_id, v_first.cost_center_id, p_due, v_total,
          p_method, 'Itens agrupados:' || E'\n' || v_notes, 'grouping')
  returning id into v_id;

  update receivables set status = 'grouped', grouped_into_id = v_id, updated_at = now() where id = any(p_ids);
  return v_id;
end $$;

create or replace function ungroup_receivable(p_group uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_g receivables%rowtype;
  v_n int;
begin
  select * into v_g from receivables where id = p_group for update;
  if not found or v_g.origin_type <> 'grouping' then raise exception 'not_found'; end if;
  if not has_any_perm(v_g.org_id, array['finance.receive', 'finance.edit']) then raise exception 'permission_denied'; end if;
  if v_g.paid_cents > 0 or v_g.status in ('paid', 'partial') then raise exception 'group_paid'; end if;
  if exists (select 1 from charges where receivable_id = p_group and status in ('pending', 'overdue', 'confirmed'))
     or exists (select 1 from pos_charges where receivable_id = p_group and status = 'pending') then
    raise exception 'live_charge';
  end if;
  update receivables set status = 'open', grouped_into_id = null, updated_at = now() where grouped_into_id = p_group and status = 'grouped';
  get diagnostics v_n = row_count;
  update receivables set status = 'cancelled', updated_at = now() where id = p_group;
  return v_n;
end $$;

-- When a group's payment changes, the OS inside it follow (Concluída <-> Paga).
create or replace function group_paid_propagate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.origin_type = 'grouping' and (new.paid_cents, new.status) is distinct from (old.paid_cents, old.status) then
    update service_orders so
       set status = case when os_fully_paid(so.id) then 'paid' else 'done' end, updated_at = now()
     where so.id in (select origin_id from receivables where grouped_into_id = new.id and origin_type = 'service_order')
       and so.status in ('done', 'paid')
       and so.status is distinct from case when os_fully_paid(so.id) then 'paid' else 'done' end;
  end if;
  return new;
end $$;
drop trigger if exists receivables_group_paid on receivables;
create trigger receivables_group_paid after update on receivables for each row execute function group_paid_propagate();

revoke execute on function group_receivables(uuid, uuid[], date, text, text) from public, anon;
grant execute on function group_receivables(uuid, uuid[], date, text, text) to authenticated;
revoke execute on function ungroup_receivable(uuid) from public, anon;
grant execute on function ungroup_receivable(uuid) to authenticated;
revoke execute on function group_paid_propagate() from public, anon, authenticated;
