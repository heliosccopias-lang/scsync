-- SaaS: cada gráfica cliente é uma CONTA; a conta tem uma ou mais EMPRESAS (CNPJs); cada pessoa tem login próprio
-- e um PERFIL por empresa. O Dono da conta (account_members.role = 'owner') pode tudo em todas as empresas da conta.
-- As permissões valem no banco (RLS), não só na tela.

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'trial' check (status in ('trial','active','suspended','cancelled')),
  plan text not null default 'trial',
  trial_ends_at date,
  max_companies int not null default 3,
  max_users int not null default 10,
  created_at timestamptz not null default now()
);

create table if not exists account_members (
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index if not exists account_members_user on account_members (user_id);

create table if not exists user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

alter table orgs
  add column if not exists account_id uuid references accounts(id) on delete restrict,
  add column if not exists business_model text not null default 'both' check (business_model in ('services','products','both')),
  add column if not exists modules jsonb not null default '{}';
create index if not exists orgs_account on orgs (account_id);

alter table org_members drop constraint if exists org_members_role_check;
alter table org_members
  add column if not exists permissions text[],
  add column if not exists active boolean not null default true;
alter table org_members add constraint org_members_role_check
  check (role in ('owner','admin','attendance','production','products','finance','viewer','custom','member','technician'));

-- Backfill: each existing org becomes its own account; its owners become account owners (Dono).
do $$
declare o record; a uuid;
begin
  for o in select * from orgs where account_id is null loop
    insert into accounts (name, status, plan) values (o.name, 'active', 'founder') returning id into a;
    update orgs set account_id = a where id = o.id;
    insert into account_members (account_id, user_id)
      select a, user_id from org_members where org_id = o.id and role = 'owner' on conflict do nothing;
  end loop;
end $$;
update org_members set role = 'admin' where role in ('owner','member');
update org_members set role = 'production' where role = 'technician';
insert into user_profiles (user_id, email)
  select id, coalesce(email, '') from auth.users on conflict (user_id) do nothing;
alter table orgs alter column account_id set not null;

-- ---------------------------------------------------------------- permissions
-- os.view, os.edit, os.status, os.cancel, customers.edit, catalog.edit, prices.view,
-- finance.view, finance.receive, finance.edit, finance.reverse, reports, reports.commissions, settings
create or replace function role_perms(p_role text) returns text[]
language sql immutable set search_path = public as $$
  select case p_role
    when 'admin' then array['os.view','os.edit','os.status','os.cancel','customers.edit','catalog.edit','prices.view',
                            'finance.view','finance.receive','finance.edit','finance.reverse','reports','reports.commissions','settings']
    when 'attendance' then array['os.view','os.edit','os.status','customers.edit','prices.view','finance.receive']
    when 'production' then array['os.view','os.status']
    when 'products' then array['catalog.edit','prices.view','os.view','reports']
    when 'finance' then array['os.view','customers.edit','prices.view','finance.view','finance.receive','finance.edit','finance.reverse','reports','reports.commissions']
    when 'viewer' then array['os.view','prices.view','finance.view','reports']
    else array[]::text[]
  end
$$;

create or replace function is_account_owner(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from account_members where account_id = p_account and user_id = (select auth.uid()))
$$;

create or replace function is_org_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orgs o join account_members am on am.account_id = o.account_id
                 where o.id = p_org and am.user_id = (select auth.uid()))
$$;

create or replace function is_org_member(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members m where m.org_id = target and m.user_id = (select auth.uid()) and m.active)
      or is_org_owner(target)
$$;

-- Effective permissions of the signed-in user in a company. The Dono gets everything.
create or replace function my_perms(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when is_org_owner(p_org) then role_perms('admin') || array['owner']
    else coalesce((select coalesce(m.permissions, role_perms(m.role)) from org_members m
                   where m.org_id = p_org and m.user_id = (select auth.uid()) and m.active), array[]::text[])
  end
$$;

create or replace function has_any_perm(p_org uuid, p_perms text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select my_perms(p_org) && p_perms
$$;

create or replace function has_perm(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_perm = any (my_perms(p_org))
$$;

-- ---------------------------------------------------------------- policies by module
do $$
declare
  r record;
begin
  for r in select * from (values
    -- table, read perms (null = any member), write perms
    ('org_counters', null, array['os.edit']),
    ('customers', null, array['customers.edit','os.edit']),
    ('vehicles', null, array['os.edit']),
    ('technicians', null, array['settings']),
    ('catalog_items', null, array['catalog.edit','os.edit']),
    ('price_lists', null, array['catalog.edit','settings']),
    ('price_list_items', null, array['catalog.edit','settings']),
    ('rejection_reasons', null, array['settings','os.edit']),
    ('payment_conditions', null, array['settings','finance.edit']),
    ('checklists', null, array['settings','os.edit']),
    ('checklist_questions', null, array['settings','os.edit']),
    ('bank_accounts', null, array['finance.edit','settings']),
    ('financial_categories', null, array['finance.edit','settings']),
    ('cost_centers', null, array['finance.edit','settings']),
    ('service_orders', array['os.view'], array['os.edit','os.status']),
    ('service_order_items', array['os.view'], array['os.edit']),
    ('service_order_item_technicians', array['os.view'], array['os.edit']),
    ('service_order_installments', array['os.view'], array['os.edit']),
    ('attachments', null, array['os.edit','os.status','finance.edit']),
    ('checklist_runs', array['os.view'], array['os.edit','os.status']),
    ('checklist_answers', array['os.view'], array['os.edit','os.status']),
    ('receivables', array['finance.view','finance.receive'], array['finance.edit','finance.receive','os.edit']),
    ('charges', array['finance.view','finance.receive'], array['finance.edit','finance.receive','os.edit']),
    ('settlements', array['finance.view','finance.receive'], array['finance.edit','finance.receive']),
    ('payables', array['finance.view'], array['finance.edit']),
    ('transfers', array['finance.view'], array['finance.edit']),
    ('statement_imports', array['finance.view'], array['finance.edit']),
    ('statement_lines', array['finance.view'], array['finance.edit']),
    ('reconciliations', array['finance.view'], array['finance.edit']),
    ('stock_movements', null, array['catalog.edit','os.edit']),
    ('catalog_imports', array['catalog.edit'], array['catalog.edit']),
    ('credit_cards', array['finance.view'], array['finance.edit']),
    ('card_statements', array['finance.view'], array['finance.edit']),
    ('card_transactions', array['finance.view'], array['finance.edit']),
    ('card_expenses', array['finance.view'], array['finance.edit']),
    ('whatsapp_senders', array['finance.view'], array['finance.edit']),
    ('whatsapp_inbox', array['finance.view'], array['finance.edit'])
  ) as t(tbl, rd, wr) loop
    execute format('drop policy if exists %I on %I', r.tbl || '_member', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_read', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_ins', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_upd', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_del', r.tbl);
    if r.rd is null then
      execute format('create policy %I on %I for select using (is_org_member(org_id))', r.tbl || '_read', r.tbl);
    else
      execute format('create policy %I on %I for select using (has_any_perm(org_id, %L::text[]))', r.tbl || '_read', r.tbl, r.rd);
    end if;
    execute format('create policy %I on %I for insert with check (has_any_perm(org_id, %L::text[]))', r.tbl || '_ins', r.tbl, r.wr);
    execute format('create policy %I on %I for update using (has_any_perm(org_id, %L::text[])) with check (has_any_perm(org_id, %L::text[]))', r.tbl || '_upd', r.tbl, r.wr, r.wr);
    execute format('create policy %I on %I for delete using (has_any_perm(org_id, %L::text[]))', r.tbl || '_del', r.tbl, r.wr);
  end loop;
end $$;

-- orgs: members read; settings changes by admin/Dono; creating companies only through functions.
drop policy if exists orgs_member on orgs;
drop policy if exists orgs_read on orgs;
drop policy if exists orgs_upd on orgs;
create policy orgs_read on orgs for select using (is_org_member(id));
create policy orgs_upd on orgs for update using (has_perm(id, 'settings')) with check (has_perm(id, 'settings'));

-- org_members: read inside the company; changes only by the Dono's server actions (service role).
drop policy if exists members_read on org_members;
create policy members_read on org_members for select using (is_org_member(org_id) or user_id = (select auth.uid()));

alter table accounts enable row level security;
alter table account_members enable row level security;
alter table user_profiles enable row level security;
drop policy if exists accounts_read on accounts;
create policy accounts_read on accounts for select using (
  is_account_owner(id) or exists (select 1 from orgs o where o.account_id = accounts.id and is_org_member(o.id)));
drop policy if exists account_members_read on account_members;
create policy account_members_read on account_members for select using (user_id = (select auth.uid()) or is_account_owner(account_id));
drop policy if exists user_profiles_read on user_profiles;
create policy user_profiles_read on user_profiles for select using (
  user_id = (select auth.uid())
  or exists (select 1 from org_members m1 join org_members m2 on m2.org_id = m1.org_id
             where m1.user_id = (select auth.uid()) and m2.user_id = user_profiles.user_id)
  or exists (select 1 from org_members m join orgs o on o.id = m.org_id
             where m.user_id = user_profiles.user_id and is_account_owner(o.account_id)));

-- ---------------------------------------------------------------- column guards
-- Without os.edit (e.g. Produção) only the job's progress can change on an OS.
create or replace function guard_os_columns() returns trigger
language plpgsql security invoker set search_path = public as $$
-- total_cents is a generated column (not computed yet in a BEFORE trigger); it follows the checked amount columns.
declare allowed text[] := array['status','technical_report','internal_notes','updated_at','delivery_date','total_cents'];
begin
  if (select auth.uid()) is null or has_perm(new.org_id, 'os.edit') then return new; end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then raise exception 'permission_denied'; end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then raise exception 'permission_denied'; end if;
  return new;
end $$;
drop trigger if exists service_orders_guard_columns on service_orders;
create trigger service_orders_guard_columns before update on service_orders for each row execute function guard_os_columns();

-- Cancelling an OS needs os.cancel even with os.edit.
create or replace function guard_os_cancel() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if (select auth.uid()) is not null and new.status = 'cancelled' and old.status <> 'cancelled' and not has_perm(new.org_id, 'os.cancel') then
    raise exception 'permission_denied';
  end if;
  return new;
end $$;
drop trigger if exists service_orders_guard_cancel on service_orders;
create trigger service_orders_guard_cancel before update on service_orders for each row execute function guard_os_cancel();

-- Without catalog.edit (OS launching stock) only the stock balance of an item may change.
create or replace function guard_catalog_columns() returns trigger
language plpgsql security invoker set search_path = public as $$
declare allowed text[] := array['stock_qty','updated_at'];
begin
  if (select auth.uid()) is null or has_perm(coalesce(new.org_id, old.org_id), 'catalog.edit') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'UPDATE' or (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then raise exception 'permission_denied'; end if;
  return new;
end $$;
drop trigger if exists catalog_items_guard_columns on catalog_items;
create trigger catalog_items_guard_columns before insert or update or delete on catalog_items for each row execute function guard_catalog_columns();

-- Reversing a payment needs finance.reverse.
create or replace function guard_settlement_reverse() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if (select auth.uid()) is not null and not has_perm(old.org_id, 'finance.reverse') then raise exception 'permission_denied'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists settlements_guard_reverse on settlements;
create trigger settlements_guard_reverse before delete on settlements for each row execute function guard_settlement_reverse();

-- ---------------------------------------------------------------- audit
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  account_id uuid,
  org_id uuid,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_log_account on audit_log (account_id, created_at desc);
create index if not exists audit_log_org on audit_log (org_id, created_at desc);
alter table audit_log enable row level security;
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (is_account_owner(account_id));

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
  v_org := case when tg_table_name = 'orgs' then (rec ->> 'id')::uuid else (rec ->> 'org_id')::uuid end;
  v_acc := coalesce((rec ->> 'account_id')::uuid, (select account_id from orgs where id = v_org));
  insert into audit_log (account_id, org_id, user_id, action, entity, entity_id, details)
  values (v_acc, v_org, (select auth.uid()), lower(tg_op), tg_table_name, coalesce(rec ->> 'id', rec ->> 'user_id'),
          case when tg_op = 'UPDATE' then diff
               else jsonb_strip_nulls(jsonb_build_object('name', rec -> 'name', 'number', rec -> 'number', 'amount_cents', rec -> 'amount_cents',
                                                         'role', rec -> 'role', 'user_id', rec -> 'user_id')) end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists audit_orgs on orgs;
create trigger audit_orgs after update on orgs for each row execute function audit_row('name,cnpj,business_model,modules,fine_pct,interest_month_pct');
drop trigger if exists audit_org_members on org_members;
create trigger audit_org_members after insert or update or delete on org_members for each row execute function audit_row('role,permissions,active');
drop trigger if exists audit_service_orders on service_orders;
create trigger audit_service_orders after update on service_orders for each row execute function audit_row('status,discount_cents,total_cents,accounts_launched_at');
drop trigger if exists audit_catalog on catalog_items;
create trigger audit_catalog after update on catalog_items for each row execute function audit_row('price_cents,name,active');
drop trigger if exists audit_settlements on settlements;
create trigger audit_settlements after insert or delete on settlements for each row execute function audit_row();
drop trigger if exists audit_receivables on receivables;
create trigger audit_receivables after update on receivables for each row execute function audit_row('status,amount_cents,due_date');
drop trigger if exists audit_payables on payables;
create trigger audit_payables after update on payables for each row execute function audit_row('status,amount_cents,due_date');
drop trigger if exists audit_card_statements on card_statements;
create trigger audit_card_statements after update on card_statements for each row execute function audit_row('status');

-- ---------------------------------------------------------------- companies
-- New gráfica (SaaS sign-up): account in 14-day trial + first company. The caller becomes the Dono.
create or replace function create_account(p_account text, p_company text, p_cnpj text, p_model text, p_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_acc uuid; v_org uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from account_members where user_id = v_uid) then raise exception 'already_has_account'; end if;
  if coalesce(trim(p_company), '') = '' then raise exception 'name_required'; end if;
  insert into accounts (name, status, plan, trial_ends_at)
  values (coalesce(nullif(trim(p_account), ''), trim(p_company)), 'trial', 'trial', (now() at time zone 'America/Sao_Paulo')::date + 14)
  returning id into v_acc;
  insert into account_members (account_id, user_id) values (v_acc, v_uid);
  insert into user_profiles (user_id, name, email) values (v_uid, coalesce(p_name, ''), coalesce((select email from auth.users where id = v_uid), ''))
    on conflict (user_id) do update set name = case when excluded.name <> '' then excluded.name else user_profiles.name end;
  v_org := create_company(v_acc, p_company, p_cnpj, p_model);
  return v_org;
end $$;

-- Another CNPJ in the account (Dono only). Every Dono becomes admin of it.
create or replace function create_company(p_account uuid, p_name text, p_cnpj text, p_model text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_max int;
begin
  if not is_account_owner(p_account) then raise exception 'permission_denied'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  select max_companies into v_max from accounts where id = p_account;
  if (select count(*) from orgs where account_id = p_account) >= v_max then raise exception 'company_limit'; end if;
  insert into orgs (name, cnpj, account_id, business_model, modules)
  values (trim(p_name), nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), ''), p_account,
          coalesce(nullif(p_model, ''), 'both'), default_modules(coalesce(nullif(p_model, ''), 'both')))
  returning id into v_org;
  insert into org_members (org_id, user_id, role)
    select v_org, user_id, 'admin' from account_members where account_id = p_account;
  insert into bank_accounts (org_id, name, kind) values (v_org, 'Conta Asaas', 'asaas');
  insert into org_counters (org_id, name, value) values (v_org, 'service_order', 0);
  return v_org;
end $$;

create or replace function default_modules(p_model text) returns jsonb
language sql immutable set search_path = public as $$
  select case p_model
    when 'services' then '{"os":true,"stock":false,"commissions":true,"finance":true,"asaas":true,"bank_reconciliation":true,"cards":false}'::jsonb
    when 'products' then '{"os":false,"stock":true,"commissions":false,"finance":true,"asaas":true,"bank_reconciliation":true,"cards":false}'::jsonb
    else '{"os":true,"stock":true,"commissions":true,"finance":true,"asaas":true,"bank_reconciliation":true,"cards":true}'::jsonb
  end
$$;
update orgs set modules = default_modules(business_model) where modules = '{}'::jsonb;

-- Old entry point kept for compatibility: now goes through create_account.
create or replace function create_org(p_name text, p_cnpj text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return create_account(p_name, p_name, p_cnpj, 'both', '');
end $$;

do $$ begin
  revoke execute on function create_account(text, text, text, text, text) from public, anon;
  grant execute on function create_account(text, text, text, text, text) to authenticated;
  revoke execute on function create_company(uuid, text, text, text) from public, anon;
  grant execute on function create_company(uuid, text, text, text) to authenticated;
  revoke execute on function my_perms(uuid) from public, anon;
  grant execute on function my_perms(uuid) to authenticated, service_role;
  revoke execute on function has_perm(uuid, text) from public, anon;
  grant execute on function has_perm(uuid, text) to authenticated, service_role;
  revoke execute on function has_any_perm(uuid, text[]) from public, anon;
  grant execute on function has_any_perm(uuid, text[]) to authenticated, service_role;
  revoke execute on function is_account_owner(uuid) from public, anon;
  grant execute on function is_account_owner(uuid) to authenticated, service_role;
  revoke execute on function is_org_owner(uuid) from public, anon;
  grant execute on function is_org_owner(uuid) to authenticated, service_role;
  revoke execute on function audit_row() from public, anon, authenticated;
end $$;
