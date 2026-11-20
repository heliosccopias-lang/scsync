-- Etapa 4: financeiro, configurações e relatórios.

-- Late fees applied to Asaas charges (fine once, interest per month), as Asaas expects them.
alter table orgs add column fine_pct numeric(5,2) not null default 0 check (fine_pct between 0 and 10);
alter table orgs add column interest_month_pct numeric(5,2) not null default 0 check (interest_month_pct between 0 and 10);

-- Settle many receivables/payables at once, each for its open balance.
create or replace function settle_batch(p_kind text, p_ids uuid[], p_paid_on date, p_method text)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_n int := 0;
  r record;
begin
  if p_kind not in ('receivable','payable') then raise exception 'invalid_kind'; end if;
  if p_kind = 'receivable' then
    for r in select id, org_id, amount_cents - paid_cents as open from receivables
              where id = any(p_ids) and status in ('open','partial') for update loop
      insert into settlements (org_id, receivable_id, paid_on, amount_cents, method, source, created_by)
      values (r.org_id, r.id, p_paid_on, r.open, p_method, 'batch', auth.uid());
      v_n := v_n + 1;
    end loop;
  else
    for r in select id, org_id, amount_cents - paid_cents as open from payables
              where id = any(p_ids) and status in ('open','partial') for update loop
      insert into settlements (org_id, payable_id, paid_on, amount_cents, method, source, created_by)
      values (r.org_id, r.id, p_paid_on, r.open, p_method, 'batch', auth.uid());
      v_n := v_n + 1;
    end loop;
  end if;
  return v_n;
end $$;

-- Reports. All security invoker: row level security keeps each company to its own data.

create or replace function report_service_orders(p_org uuid, p_from date, p_to date)
returns table (status text, kind text, os_count bigint, total_cents bigint)
language sql stable security invoker set search_path = public as $$
  select status, kind, count(*), coalesce(sum(total_cents), 0)::bigint
    from service_orders
   where org_id = p_org and os_date between p_from and p_to
   group by status, kind
   order by 1, 2
$$;

create or replace function report_receipts(p_org uuid, p_from date, p_to date)
returns table (method text, source text, receipts bigint, amount_cents bigint, interest_cents bigint)
language sql stable security invoker set search_path = public as $$
  select s.method, s.source, count(*), coalesce(sum(s.amount_cents), 0)::bigint, coalesce(sum(s.interest_cents), 0)::bigint
    from settlements s
   where s.org_id = p_org and s.receivable_id is not null and s.reversed_at is null and s.paid_on between p_from and p_to
   group by 1, 2
   order by 4 desc
$$;

-- Open receivables by how late they are (today in the org's timezone).
create or replace function report_aging(p_org uuid)
returns table (bucket text, bucket_order int, titles bigint, open_cents bigint)
language sql stable security invoker set search_path = public as $$
  with t as (
    select r.amount_cents - r.paid_cents as open,
           (now() at time zone o.timezone)::date - r.due_date as late
      from receivables r join orgs o on o.id = r.org_id
     where r.org_id = p_org and r.status in ('open','partial')
  )
  select b.bucket, b.ord, count(t.open), coalesce(sum(t.open), 0)::bigint
    from (values ('A vencer', 1, -100000, 0), ('1 a 30 dias', 2, 1, 30), ('31 a 60 dias', 3, 31, 60),
                 ('61 a 90 dias', 4, 61, 90), ('Mais de 90 dias', 5, 91, 100000)) as b(bucket, ord, lo, hi)
    left join t on t.late between b.lo and b.hi
   group by b.bucket, b.ord
   order by b.ord
$$;

-- Commission on services of OS delivered/done in the period (by OS date), per main technician.
create or replace function report_commissions(p_org uuid, p_from date, p_to date)
returns table (technician text, commission_pct numeric, os_count bigint, services_cents bigint, commission_cents bigint)
language sql stable security invoker set search_path = public as $$
  select t.name, t.commission_pct, count(so.id), coalesce(sum(so.services_cents), 0)::bigint,
         coalesce(round(sum(so.services_cents) * t.commission_pct / 100), 0)::bigint
    from technicians t
    join service_orders so on so.technician_id = t.id and so.kind = 'order'
                          and so.status in ('done','delivered') and so.os_date between p_from and p_to
   where t.org_id = p_org
   group by t.id, t.name, t.commission_pct
   order by 5 desc
$$;

create or replace function report_top_items(p_org uuid, p_from date, p_to date)
returns table (kind text, description text, quantity numeric, total_cents bigint, os_count bigint)
language sql stable security invoker set search_path = public as $$
  select i.kind, i.description, sum(i.quantity), sum(i.total_cents)::bigint, count(distinct i.service_order_id)
    from service_order_items i
    join service_orders so on so.id = i.service_order_id
   where so.org_id = p_org and so.kind = 'order' and so.status <> 'cancelled' and not i.rejected
     and so.os_date between p_from and p_to
   group by i.kind, lower(i.description), i.description
   order by 4 desc
   limit 50
$$;

-- Money in and out per month (receipts and payments actually made), plus transfers ignored.
create or replace function report_cashflow(p_org uuid, p_from date, p_to date)
returns table (month date, in_cents bigint, out_cents bigint)
language sql stable security invoker set search_path = public as $$
  select date_trunc('month', s.paid_on)::date,
         coalesce(sum(case when s.receivable_id is not null then s.amount_cents + s.interest_cents end), 0)::bigint,
         coalesce(sum(case when s.payable_id is not null then s.amount_cents + s.interest_cents end), 0)::bigint
    from settlements s
   where s.org_id = p_org and s.reversed_at is null and s.paid_on between p_from and p_to
   group by 1
   order by 1
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function settle_batch(text, uuid[], date, text) from public, anon;
    revoke execute on function report_service_orders(uuid, date, date) from public, anon;
    revoke execute on function report_receipts(uuid, date, date) from public, anon;
    revoke execute on function report_aging(uuid) from public, anon;
    revoke execute on function report_commissions(uuid, date, date) from public, anon;
    revoke execute on function report_top_items(uuid, date, date) from public, anon;
    revoke execute on function report_cashflow(uuid, date, date) from public, anon;
    grant execute on function settle_batch(text, uuid[], date, text), report_service_orders(uuid, date, date),
      report_receipts(uuid, date, date), report_aging(uuid), report_commissions(uuid, date, date),
      report_top_items(uuid, date, date), report_cashflow(uuid, date, date) to authenticated;
  end if;
end $$;
