-- Etapa 5: extras por segmento (estoque, segundo técnico na comissão).

alter table catalog_items add column track_stock boolean not null default false;
alter table catalog_items add column stock_qty numeric(14,3) not null default 0;
alter table service_orders add column stock_launched_at timestamptz;

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  catalog_item_id uuid not null references catalog_items(id) on delete cascade,
  quantity numeric(14,3) not null check (quantity <> 0),   -- + entrada, - saída
  reason text not null check (reason in ('os','os_reversal','adjust','purchase')),
  service_order_id uuid references service_orders(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on stock_movements (catalog_item_id, created_at desc);
create index on stock_movements (org_id, created_at desc);
create index on stock_movements (service_order_id);
create index on stock_movements (created_by);
alter table stock_movements enable row level security;
create policy stock_movements_member on stock_movements for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Stock follows its movements.
create or replace function apply_stock_movement() returns trigger
language plpgsql set search_path = public as $$
begin
  update catalog_items set stock_qty = stock_qty + new.quantity, updated_at = now() where id = new.catalog_item_id;
  return new;
end $$;
create trigger stock_movements_apply after insert on stock_movements for each row execute function apply_stock_movement();

-- "Lançar estoque": products of the OS leave stock (matched by catalog id, or by name).
create or replace function launch_stock(p_service_order uuid)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_os service_orders%rowtype;
  v_n int := 0;
  r record;
begin
  select * into v_os from service_orders where id = p_service_order for update;
  if not found then raise exception 'not_found'; end if;
  if v_os.stock_launched_at is not null then raise exception 'stock_already_launched'; end if;
  if v_os.kind = 'quote' then raise exception 'is_quote'; end if;
  for r in
    select c.id as item_id, sum(i.quantity) as qty
      from service_order_items i
      join catalog_items c on c.org_id = v_os.org_id and c.kind = 'product' and c.track_stock
                          and (c.id = i.catalog_item_id or (i.catalog_item_id is null and lower(c.name) = lower(i.description)))
     where i.service_order_id = v_os.id and i.kind = 'product' and not i.rejected
     group by c.id
  loop
    insert into stock_movements (org_id, catalog_item_id, quantity, reason, service_order_id, created_by)
    values (v_os.org_id, r.item_id, -r.qty, 'os', v_os.id, auth.uid());
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'no_stock_items'; end if;
  update service_orders set stock_launched_at = now() where id = v_os.id;
  return v_n;
end $$;

create or replace function reverse_stock(p_service_order uuid)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_os service_orders%rowtype;
  v_n int := 0;
  r record;
begin
  select * into v_os from service_orders where id = p_service_order for update;
  if not found then raise exception 'not_found'; end if;
  if v_os.stock_launched_at is null then raise exception 'stock_not_launched'; end if;
  for r in
    select catalog_item_id, sum(quantity) as qty from stock_movements
     where service_order_id = v_os.id and reason in ('os','os_reversal')
     group by catalog_item_id having sum(quantity) <> 0
  loop
    insert into stock_movements (org_id, catalog_item_id, quantity, reason, service_order_id, created_by)
    values (v_os.org_id, r.catalog_item_id, -r.qty, 'os_reversal', v_os.id, auth.uid());
    v_n := v_n + 1;
  end loop;
  update service_orders set stock_launched_at = null where id = v_os.id;
  return v_n;
end $$;

-- Commission: when an OS has a second technician, the services value is split half and half.
create or replace function report_commissions(p_org uuid, p_from date, p_to date)
returns table (technician text, commission_pct numeric, os_count bigint, services_cents bigint, commission_cents bigint)
language sql stable security invoker set search_path = public as $$
  with shares as (
    select so.id, so.technician_id as tech,
           case when so.second_technician_id is not null and so.second_technician_id <> so.technician_id
                then so.services_cents / 2.0 else so.services_cents end as base
      from service_orders so
     where so.org_id = p_org and so.kind = 'order' and so.status in ('done','delivered')
       and so.os_date between p_from and p_to and so.technician_id is not null
    union all
    select so.id, so.second_technician_id, so.services_cents / 2.0
      from service_orders so
     where so.org_id = p_org and so.kind = 'order' and so.status in ('done','delivered')
       and so.os_date between p_from and p_to
       and so.second_technician_id is not null and so.second_technician_id is distinct from so.technician_id
  )
  select t.name, t.commission_pct, count(distinct s.id), round(sum(s.base))::bigint,
         round(sum(s.base) * t.commission_pct / 100)::bigint
    from shares s join technicians t on t.id = s.tech
   group by t.id, t.name, t.commission_pct
   order by 5 desc
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function apply_stock_movement() from public, anon, authenticated;
    revoke execute on function launch_stock(uuid) from public, anon;
    revoke execute on function reverse_stock(uuid) from public, anon;
    grant execute on function launch_stock(uuid), reverse_stock(uuid) to authenticated;
  end if;
end $$;
