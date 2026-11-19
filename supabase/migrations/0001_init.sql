-- SCsync: ordens de serviço + cobrança Asaas + conciliação
-- First migration. Postgres 15+ on Supabase (auth.users, auth.uid() come from Supabase).
-- Conventions: uuid ids, timestamptz in UTC, money as integer centavos (bigint) + currency,
-- every tenant row carries org_id, row level security on every table.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text,
  timezone text not null default 'America/Sao_Paulo',
  os_settings jsonb not null default '{}',      -- S21 toggles: technicians, vehicles, price lists...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','technician')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on org_members (user_id);

-- Per-org counters (OS number). Incremented with UPDATE ... RETURNING inside the OS insert transaction.
create table org_counters (
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  value bigint not null default 0,
  primary key (org_id, name)
);

-- ---------------------------------------------------------------------------
-- Asaas connection (one Asaas account per org)
-- api_key is stored encrypted by the app (AES-GCM with a server secret), never sent to the browser.
-- webhook_token_hash: sha256 of the token Asaas sends in the asaas-access-token header.
-- ---------------------------------------------------------------------------
create table asaas_connections (
  org_id uuid primary key references orgs(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  api_key_encrypted text not null,
  webhook_id text,
  webhook_token_hash text not null,
  pix_key_ok boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  cpf_cnpj text,
  email text,
  phone text,
  address jsonb not null default '{}',
  asaas_customer_id text,                       -- cus_... created lazily on first charge
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on customers (org_id, name);
create unique index on customers (org_id, cpf_cnpj) where cpf_cnpj is not null;
create unique index on customers (org_id, asaas_customer_id) where asaas_customer_id is not null;

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  plate text not null,
  model text,
  km integer check (km >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on vehicles (org_id, upper(plate));
create index on vehicles (customer_id);

create table technicians (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on technicians (org_id, active);
create index on technicians (user_id);

create table catalog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('service','product')),
  name text not null,
  unit text not null default 'un',
  price_cents bigint not null default 0 check (price_cents >= 0),
  currency char(3) not null default 'BRL',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on catalog_items (org_id, kind, name);

create table price_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  attendance_type text check (attendance_type in ('internal','external','warranty')),
  adjust_pct numeric(6,2) not null default 0,   -- e.g. -20 for Interno, +30 for Garantia
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on price_lists (org_id, attendance_type) where attendance_type is not null;

create table price_list_items (
  price_list_id uuid not null references price_lists(id) on delete cascade,
  catalog_item_id uuid not null references catalog_items(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  price_cents bigint not null check (price_cents >= 0),
  primary key (price_list_id, catalog_item_id)
);
create index on price_list_items (catalog_item_id);
create index on price_list_items (org_id);

create table rejection_reasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);
create index on rejection_reasons (org_id);

-- ---------------------------------------------------------------------------
-- Finance setup
-- ---------------------------------------------------------------------------
create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('asaas','bank','cash')),
  bank_code text,
  agency text,
  account_number text,
  opening_balance_cents bigint not null default 0,
  currency char(3) not null default 'BRL',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on bank_accounts (org_id);
create unique index on bank_accounts (org_id) where kind = 'asaas';  -- one Asaas account per org

create table financial_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  direction text not null check (direction in ('in','out')),
  parent_id uuid references financial_categories(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on financial_categories (org_id, direction);
create index on financial_categories (parent_id);

create table cost_centers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on cost_centers (org_id);

create table payment_conditions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,                           -- "30/60/90", "À vista"
  installment_days integer[] not null default '{0}',
  default_method text not null default 'pix'
    check (default_method in ('pix','boleto','credit_card','cash','debit_card','transfer','other')),
  created_at timestamptz not null default now()
);
create index on payment_conditions (org_id);

-- ---------------------------------------------------------------------------
-- Ordens de serviço
-- ---------------------------------------------------------------------------
create table service_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  number bigint not null,
  kind text not null default 'order' check (kind in ('order','quote')),
  attendance_type text not null default 'external' check (attendance_type in ('internal','external','warranty')),
  status text not null default 'open'
    check (status in ('open','approved','in_progress','waiting_parts','done','delivered','cancelled')),
  customer_id uuid not null references customers(id) on delete restrict,
  vehicle_id uuid references vehicles(id) on delete set null,
  km_at_open integer check (km_at_open >= 0),
  technician_id uuid references technicians(id) on delete set null,
  second_technician_id uuid references technicians(id) on delete set null,
  price_list_id uuid references price_lists(id) on delete set null,
  payment_condition_id uuid references payment_conditions(id) on delete set null,
  bank_account_id uuid references bank_accounts(id) on delete restrict,
  os_date date not null default current_date,
  delivery_date date,
  warranty text,
  performed_at timestamptz,
  reference text,
  notes text,
  internal_notes text,
  equipment text,
  problem text,
  receipt_notes text,
  technical_report text,
  services_cents bigint not null default 0 check (services_cents >= 0),
  products_cents bigint not null default 0 check (products_cents >= 0),
  expenses_cents bigint not null default 0 check (expenses_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint generated always as (services_cents + products_cents + expenses_cents - discount_cents) stored,
  currency char(3) not null default 'BRL',
  accounts_launched_at timestamptz,             -- set by "Lançar contas"; locks payment fields
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint total_not_negative check (services_cents + products_cents + expenses_cents - discount_cents >= 0),
  unique (org_id, number)
);
create index on service_orders (org_id, status, os_date desc);
create index on service_orders (customer_id);
create index on service_orders (vehicle_id);
create index on service_orders (technician_id);
create index on service_orders (second_technician_id);
create index on service_orders (price_list_id);
create index on service_orders (payment_condition_id);
create index on service_orders (bank_account_id);
create index on service_orders (created_by);

create table service_order_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  service_order_id uuid not null references service_orders(id) on delete cascade,
  kind text not null check (kind in ('service','product')),
  catalog_item_id uuid references catalog_items(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),   -- round(quantity * unit) computed in app, checked in tests
  position integer not null default 0,
  rejected boolean not null default false,
  rejection_reason_id uuid references rejection_reasons(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on service_order_items (service_order_id, position);
create index on service_order_items (catalog_item_id);
create index on service_order_items (rejection_reason_id);
create index on service_order_items (org_id);

create table service_order_item_technicians (
  item_id uuid not null references service_order_items(id) on delete cascade,
  technician_id uuid not null references technicians(id) on delete restrict,
  org_id uuid not null references orgs(id) on delete cascade,
  primary key (item_id, technician_id)
);
create index on service_order_item_technicians (technician_id);
create index on service_order_item_technicians (org_id);

create table service_order_installments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  service_order_id uuid not null references service_orders(id) on delete cascade,
  number integer not null check (number >= 1),
  due_date date not null,                       -- a calendar date in the org's timezone, not an instant
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('pix','boleto','credit_card','cash','debit_card','transfer','other')),
  notes text,
  unique (service_order_id, number)
);
create index on service_order_installments (org_id);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  owner_type text not null check (owner_type in ('service_order','checklist_answer')),
  owner_id uuid not null,
  storage_path text not null,
  file_name text not null,
  size_bytes integer not null check (size_bytes between 1 and 5242880),   -- 5 MB
  created_at timestamptz not null default now()
);
create index on attachments (owner_type, owner_id);
create index on attachments (org_id);

-- ---------------------------------------------------------------------------
-- Checklists
-- ---------------------------------------------------------------------------
create table checklists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  mode text not null default 'by_steps' check (mode in ('all_at_once','by_steps')),
  active boolean not null default true,
  locked boolean not null default false,        -- true after first use; edit = duplicate
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on checklists (org_id, active);

create table checklist_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  checklist_id uuid not null references checklists(id) on delete cascade,
  position integer not null,
  prompt text not null,
  type text not null check (type in ('single','multi','rating','upload')),
  options jsonb not null default '[]',
  required boolean not null default false,
  comment_required text not null default 'never' check (comment_required in ('never','always','some_options')),
  comment_required_options jsonb not null default '[]'
);
create index on checklist_questions (checklist_id, position);
create index on checklist_questions (org_id);

create table checklist_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  checklist_id uuid not null references checklists(id) on delete restrict,
  service_order_id uuid not null references service_orders(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started','in_progress','done')),
  updated_at timestamptz not null default now(),
  unique (service_order_id, checklist_id)
);
create index on checklist_runs (checklist_id);
create index on checklist_runs (org_id);

create table checklist_answers (
  run_id uuid not null references checklist_runs(id) on delete cascade,
  question_id uuid not null references checklist_questions(id) on delete restrict,
  org_id uuid not null references orgs(id) on delete cascade,
  value jsonb not null,
  comment text,
  answered_by uuid references auth.users(id) on delete set null,
  answered_at timestamptz not null default now(),
  primary key (run_id, question_id)
);
create index on checklist_answers (question_id);
create index on checklist_answers (org_id);
create index on checklist_answers (answered_by);

-- ---------------------------------------------------------------------------
-- Contas a receber / pagar
-- ---------------------------------------------------------------------------
create table receivables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  customer_id uuid references customers(id) on delete restrict,
  bank_account_id uuid not null references bank_accounts(id) on delete restrict,
  category_id uuid references financial_categories(id) on delete set null,
  cost_center_id uuid references cost_centers(id) on delete set null,
  issue_date date not null default current_date,
  due_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),   -- maintained by trigger from settlements
  currency char(3) not null default 'BRL',
  method text not null default 'pix' check (method in ('pix','boleto','credit_card','cash','debit_card','transfer','other')),
  document_number text,
  notes text,
  status text not null default 'open' check (status in ('open','partial','paid','cancelled','grouped')),
  origin_type text not null default 'manual' check (origin_type in ('manual','service_order','grouping')),
  origin_id uuid,
  installment_id uuid unique references service_order_installments(id) on delete restrict,
  grouped_into_id uuid references receivables(id) on delete set null,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on receivables (org_id, status, due_date);
create index on receivables (org_id, origin_type, origin_id);
create index on receivables (customer_id);
create index on receivables (bank_account_id);
create index on receivables (category_id);
create index on receivables (cost_center_id);
create index on receivables (grouped_into_id);

create table payables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  supplier_name text,
  bank_account_id uuid not null references bank_accounts(id) on delete restrict,
  category_id uuid references financial_categories(id) on delete set null,
  cost_center_id uuid references cost_centers(id) on delete set null,
  due_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  currency char(3) not null default 'BRL',
  status text not null default 'open' check (status in ('open','partial','paid','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on payables (org_id, status, due_date);
create index on payables (bank_account_id);
create index on payables (category_id);
create index on payables (cost_center_id);

create table transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  from_account_id uuid not null references bank_accounts(id) on delete restrict,
  to_account_id uuid not null references bank_accounts(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  transferred_on date not null,
  notes text,
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index on transfers (org_id, transferred_on);
create index on transfers (from_account_id);
create index on transfers (to_account_id);

-- Asaas webhook events, stored before processing. Unique event id = idempotency.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider text not null default 'asaas',
  event_id text not null,                        -- evt_... from Asaas
  event_type text not null,                      -- PAYMENT_RECEIVED, ...
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);
create index on webhook_events (org_id, received_at desc);
create index on webhook_events (processed_at) where processed_at is null;

-- One Asaas cobrança per receivable (a new one only after the old is cancelled).
create table charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  receivable_id uuid not null references receivables(id) on delete restrict,
  provider text not null default 'asaas',
  billing_type text not null check (billing_type in ('PIX','BOLETO','CREDIT_CARD','UNDEFINED')),
  asaas_payment_id text not null,                -- pay_...
  status text not null default 'pending'
    check (status in ('pending','overdue','confirmed','received','refunded','cancelled','chargeback')),
  value_cents bigint not null check (value_cents > 0),
  net_value_cents bigint,
  invoice_url text,
  bank_slip_url text,
  pix_payload text,
  due_date date not null,
  confirmed_at timestamptz,
  received_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, asaas_payment_id)
);
create unique index charges_one_live_per_receivable on charges (receivable_id)
  where status not in ('cancelled','refunded');
create index on charges (receivable_id);
create index on charges (org_id, status);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  receivable_id uuid references receivables(id) on delete cascade,
  payable_id uuid references payables(id) on delete cascade,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents > 0),  -- principal applied to the título
  interest_cents bigint not null default 0 check (interest_cents >= 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  method text not null check (method in ('pix','boleto','credit_card','cash','debit_card','transfer','other')),
  source text not null check (source in ('manual','batch','asaas_webhook','reconciliation')),
  charge_id uuid references charges(id) on delete set null,
  webhook_event_id uuid references webhook_events(id) on delete set null,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((receivable_id is null) <> (payable_id is null))
);
create index on settlements (receivable_id);
create index on settlements (payable_id);
create index on settlements (org_id, paid_on);
create index on settlements (webhook_event_id);
create index on settlements (charge_id);
create index on settlements (reversed_by);
create index on settlements (created_by);
-- A charge can settle its receivable once (webhooks repeat; CONFIRMED and RECEIVED both arrive).
create unique index settlements_one_per_charge on settlements (charge_id)
  where charge_id is not null and reversed_at is null;

-- ---------------------------------------------------------------------------
-- Conciliação
-- ---------------------------------------------------------------------------
create table statement_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  bank_account_id uuid not null references bank_accounts(id) on delete cascade,
  source text not null check (source in ('ofx','asaas_api')),
  file_name text,
  invert_signs boolean not null default false,
  period_start date,
  period_end date,
  lines_total integer not null default 0,
  lines_duplicate integer not null default 0,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now()
);
create index on statement_imports (bank_account_id, imported_at desc);
create index on statement_imports (org_id);
create index on statement_imports (imported_by);

create table statement_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  import_id uuid not null references statement_imports(id) on delete cascade,
  bank_account_id uuid not null references bank_accounts(id) on delete cascade,
  external_id text not null,                     -- OFX FITID or Asaas financial transaction id
  posted_on date not null,
  amount_cents bigint not null check (amount_cents <> 0),   -- signed: + credit, - debit
  description text,
  counterpart_doc text,                          -- CPF/CNPJ when the bank sends it
  status text not null default 'pending' check (status in ('pending','suggested','reconciled','ignored')),
  created_at timestamptz not null default now(),
  unique (bank_account_id, external_id)          -- re-importing the same OFX adds nothing
);
create index on statement_lines (org_id, status, posted_on);
create index on statement_lines (import_id);

create table reconciliations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  statement_line_id uuid not null references statement_lines(id) on delete cascade,
  target_type text not null check (target_type in ('receivable','payable','transfer','settlement')),
  target_id uuid not null,
  amount_cents bigint not null,
  difference_cents bigint not null default 0,
  difference_action text check (difference_action in ('interest','discount','partial','fee')),
  match_score numeric(4,3),                      -- null when matched by hand
  matched_by uuid references auth.users(id) on delete set null,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index on reconciliations (statement_line_id);
create index on reconciliations (target_type, target_id);
create index on reconciliations (org_id, created_at desc);
create index on reconciliations (matched_by);

-- ---------------------------------------------------------------------------
-- Money integrity: paid_cents and status follow settlements, inside the same transaction.
-- ---------------------------------------------------------------------------
create or replace function refresh_titulo_balance() returns trigger
language plpgsql set search_path = public as $$
declare
  r_id uuid := coalesce(new.receivable_id, old.receivable_id);
  p_id uuid := coalesce(new.payable_id, old.payable_id);
begin
  if r_id is not null then
    update receivables r
       set paid_cents = s.total,
           status = case
             when r.status in ('cancelled','grouped') then r.status
             when s.total >= r.amount_cents then 'paid'
             when s.total > 0 then 'partial'
             else 'open' end,
           updated_at = now()
      from (select coalesce(sum(amount_cents),0) total
              from settlements where receivable_id = r_id and reversed_at is null) s
     where r.id = r_id;
  end if;
  if p_id is not null then
    update payables p
       set paid_cents = s.total,
           status = case
             when p.status = 'cancelled' then p.status
             when s.total >= p.amount_cents then 'paid'
             when s.total > 0 then 'partial'
             else 'open' end,
           updated_at = now()
      from (select coalesce(sum(amount_cents),0) total
              from settlements where payable_id = p_id and reversed_at is null) s
     where p.id = p_id;
  end if;
  return null;
end $$;

create trigger settlements_refresh_balance
after insert or update or delete on settlements
for each row execute function refresh_titulo_balance();

-- Overdue is derived, never stored: a date comparison in the org's timezone.
create view receivables_view with (security_invoker = true) as
select r.*,
       r.amount_cents - r.paid_cents as open_cents,
       (r.status in ('open','partial')
        and r.due_date < (now() at time zone o.timezone)::date) as overdue
  from receivables r join orgs o on o.id = r.org_id;

-- OS payment status for the list screen.
create view service_order_payment_view with (security_invoker = true) as
select so.id as service_order_id,
       so.org_id,
       coalesce(sum(r.amount_cents),0) as billed_cents,
       coalesce(sum(r.paid_cents),0) as paid_cents,
       case when count(r.id) = 0 then 'not_billed'
            when sum(r.paid_cents) >= sum(r.amount_cents) then 'paid'
            when sum(r.paid_cents) > 0 then 'partial'
            else 'open' end as payment_status
  from service_orders so
  left join receivables r
    on r.origin_type = 'service_order' and r.origin_id = so.id and r.status <> 'cancelled'
 group by so.id, so.org_id;

-- ---------------------------------------------------------------------------
-- Row level security: a user sees rows of orgs they belong to.
-- Webhook handler and jobs use the service role (bypasses RLS) and always filter by org_id.
-- ---------------------------------------------------------------------------
create or replace function is_org_member(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members m where m.org_id = target and m.user_id = (select auth.uid()))
$$;

alter table orgs enable row level security;
create policy orgs_member on orgs for all using (is_org_member(id)) with check (is_org_member(id));

alter table org_members enable row level security;
create policy members_read on org_members for select using (is_org_member(org_id));

do $$
declare t text;
begin
  foreach t in array array[
    'org_counters','customers','vehicles','technicians','catalog_items','price_lists','price_list_items',
    'rejection_reasons','bank_accounts','financial_categories','cost_centers','payment_conditions',
    'service_orders','service_order_items','service_order_item_technicians','service_order_installments',
    'attachments','checklists','checklist_questions','checklist_runs','checklist_answers',
    'receivables','payables','transfers','charges','settlements',
    'statement_imports','statement_lines','reconciliations'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all using (is_org_member(org_id)) with check (is_org_member(org_id))',
      t || '_member', t);
  end loop;
end $$;

-- Secrets and raw webhook payloads: no browser access at all (service role only).
alter table asaas_connections enable row level security;
alter table webhook_events enable row level security;
