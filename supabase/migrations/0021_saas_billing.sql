-- Assinatura do SCsync (cobrada pela conta Asaas da própria plataforma, não pela conta da gráfica).
alter table accounts drop constraint if exists accounts_status_check;
alter table accounts add constraint accounts_status_check check (status in ('trial','active','past_due','suspended','cancelled'));
alter table accounts
  add column if not exists billing_cycle text check (billing_cycle in ('monthly','yearly')),
  add column if not exists price_cents int,
  add column if not exists paid_until date,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists billing_doc text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text,
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists accounts_subscription on accounts (asaas_subscription_id) where asaas_subscription_id is not null;

-- Events from the platform's Asaas webhook, stored once (idempotency).
create table if not exists platform_billing_events (
  id text primary key,
  event text not null,
  account_id uuid references accounts(id) on delete set null,
  payment_id text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists platform_billing_events_account on platform_billing_events (account_id, created_at desc);
alter table platform_billing_events enable row level security;
drop policy if exists platform_billing_events_owner on platform_billing_events;
create policy platform_billing_events_owner on platform_billing_events for select using (is_account_owner(account_id));

-- audit_row also understands the accounts table.
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  rec jsonb := coalesce(n, o);
  diff jsonb := '{}';
  k text;
  v_org uuid;
  v_acc uuid;
  watch text[] := string_to_array(coalesce(tg_argv[0], ''), ',');
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if (cardinality(watch) = 0 or k = any(watch)) and n -> k is distinct from o -> k and k not in ('updated_at') then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  end if;
  v_org := case when tg_table_name = 'orgs' then (rec ->> 'id')::uuid when tg_table_name = 'accounts' then null else (rec ->> 'org_id')::uuid end;
  v_acc := case when tg_table_name = 'accounts' then (rec ->> 'id')::uuid
                else coalesce((rec ->> 'account_id')::uuid, (select account_id from orgs where id = v_org)) end;
  insert into audit_log (account_id, org_id, user_id, action, entity, entity_id, details)
  values (v_acc, v_org, (select auth.uid()), lower(tg_op), tg_table_name, coalesce(rec ->> 'id', rec ->> 'user_id'),
          case when tg_op = 'UPDATE' then diff
               else jsonb_strip_nulls(jsonb_build_object('name', rec -> 'name', 'number', rec -> 'number', 'amount_cents', rec -> 'amount_cents',
                                                         'role', rec -> 'role', 'user_id', rec -> 'user_id')) end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists audit_accounts on accounts;
create trigger audit_accounts after update on accounts for each row execute function audit_row('status,plan,billing_cycle,price_cents,paid_until,cancel_at_period_end');
