-- Nota fiscal de serviço (NFS-e) emitida pela conta Asaas de cada empresa.

alter table orgs add column if not exists nfse jsonb not null default '{}';  -- defaults: service, ISS, taxes, auto issue
alter table asaas_connections
  add column if not exists invoice_webhook_id text,
  add column if not exists invoice_webhook_token_hash text;

create table if not exists service_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  service_order_id uuid references service_orders(id) on delete set null,
  receivable_id uuid references receivables(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  asaas_invoice_id text,
  asaas_payment_id text,
  status text not null default 'scheduled'
    check (status in ('scheduled','synchronized','authorized','processing_cancellation','canceled','cancellation_denied','error')),
  number text,
  value_cents bigint not null check (value_cents > 0),
  deductions_cents bigint not null default 0 check (deductions_cents >= 0),
  effective_date date not null,
  service_description text not null,
  observations text not null default '',
  municipal_service_id text,
  municipal_service_code text,
  municipal_service_name text not null,
  taxes jsonb not null default '{}',
  pdf_url text,
  xml_url text,
  status_description text,
  validation_code text,
  auto boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists service_invoices_asaas on service_invoices (org_id, asaas_invoice_id) where asaas_invoice_id is not null;
create index if not exists service_invoices_org on service_invoices (org_id, created_at desc);
create index if not exists service_invoices_os on service_invoices (service_order_id);
create index if not exists service_invoices_rec on service_invoices (receivable_id);
create index if not exists service_invoices_customer on service_invoices (customer_id);
-- One automatic invoice per Asaas payment.
create unique index if not exists service_invoices_auto_payment on service_invoices (org_id, asaas_payment_id) where auto and asaas_payment_id is not null;

create table if not exists invoice_events (
  id text not null,
  org_id uuid not null references orgs(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, id)
);
alter table invoice_events enable row level security;  -- written by the webhook (service role) only

-- Permission to issue/cancel invoices; Administrador, Atendimento and Financeiro have it.
create or replace function role_perms(p_role text) returns text[]
language sql immutable set search_path = public as $$
  select case p_role
    when 'admin' then array['os.view','os.edit','os.status','os.cancel','customers.edit','catalog.edit','prices.view',
                            'finance.view','finance.receive','finance.edit','finance.reverse','reports','reports.commissions','settings','fiscal.issue']
    when 'attendance' then array['os.view','os.edit','os.status','customers.edit','prices.view','finance.receive','fiscal.issue']
    when 'production' then array['os.view','os.status']
    when 'products' then array['catalog.edit','prices.view','os.view','reports']
    when 'finance' then array['os.view','customers.edit','prices.view','finance.view','finance.receive','finance.edit','finance.reverse','reports','reports.commissions','fiscal.issue']
    when 'viewer' then array['os.view','prices.view','finance.view','reports']
    else array[]::text[]
  end
$$;

alter table service_invoices enable row level security;
drop policy if exists service_invoices_read on service_invoices;
drop policy if exists service_invoices_ins on service_invoices;
drop policy if exists service_invoices_upd on service_invoices;
drop policy if exists service_invoices_del on service_invoices;
create policy service_invoices_read on service_invoices for select using (has_any_perm(org_id, array['fiscal.issue','finance.view','os.view']));
create policy service_invoices_ins on service_invoices for insert with check (has_perm(org_id, 'fiscal.issue'));
create policy service_invoices_upd on service_invoices for update using (has_perm(org_id, 'fiscal.issue')) with check (has_perm(org_id, 'fiscal.issue'));
create policy service_invoices_del on service_invoices for delete using (false);

drop trigger if exists audit_service_invoices on service_invoices;
create trigger audit_service_invoices after insert or update on service_invoices for each row execute function audit_row('status,number,value_cents');

-- Module switch: on by default for every company; the plan decides whether it is available.
update orgs set modules = modules || '{"nfse": true}'::jsonb where not (modules ? 'nfse');
create or replace function default_modules(p_model text) returns jsonb
language sql immutable set search_path = public as $$
  select case p_model
    when 'services' then '{"os":true,"stock":false,"commissions":true,"finance":true,"asaas":true,"bank_reconciliation":true,"cards":false,"nfse":true}'::jsonb
    when 'products' then '{"os":false,"stock":true,"commissions":false,"finance":true,"asaas":true,"bank_reconciliation":true,"cards":false,"nfse":true}'::jsonb
    else '{"os":true,"stock":true,"commissions":true,"finance":true,"asaas":true,"bank_reconciliation":true,"cards":true,"nfse":true}'::jsonb
  end
$$;
