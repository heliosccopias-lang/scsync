-- Cobrança na maquininha (caminho A: o SCsync envia o valor para a maquininha e recebe a confirmação).
alter table orgs
  add column if not exists stone_secret_key_encrypted text,
  add column if not exists stone_webhook_token_hash text;

create table if not exists pos_terminals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider text not null check (provider in ('stone','pagbank')),
  name text not null check (char_length(name) between 1 and 60),
  serial_number text not null check (char_length(serial_number) between 3 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, provider, serial_number)
);
create index if not exists pos_terminals_org on pos_terminals (org_id);

create table if not exists pos_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider text not null check (provider in ('stone','pagbank')),
  terminal_id uuid references pos_terminals(id) on delete set null,
  receivable_id uuid not null references receivables(id) on delete cascade,
  service_order_id uuid references service_orders(id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_type text not null default 'any' check (payment_type in ('any','credit','debit')),
  installments smallint not null default 1 check (installments between 1 and 18),
  external_order_id text,
  status text not null default 'pending' check (status in ('pending','paid','canceled','failed')),
  method text,
  card_brand text,
  authorization_code text,
  paid_installments smallint,
  paid_at timestamptz,
  settlement_id uuid references settlements(id) on delete set null,
  error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pos_charges_external on pos_charges (provider, external_order_id) where external_order_id is not null;
create index if not exists pos_charges_org on pos_charges (org_id, created_at desc);
create index if not exists pos_charges_receivable on pos_charges (receivable_id);
create index if not exists pos_charges_os on pos_charges (service_order_id);
create index if not exists pos_charges_terminal on pos_charges (terminal_id);
create index if not exists pos_charges_settlement on pos_charges (settlement_id);
-- One charge waiting on the terminal per receivable.
create unique index if not exists pos_charges_one_pending on pos_charges (receivable_id) where status = 'pending';

alter table settlements drop constraint if exists settlements_source_check;
alter table settlements add constraint settlements_source_check check (source in ('manual','batch','asaas_webhook','reconciliation','pos_terminal'));

alter table pos_terminals enable row level security;
alter table pos_charges enable row level security;
drop policy if exists pos_terminals_read on pos_terminals;
drop policy if exists pos_terminals_write on pos_terminals;
create policy pos_terminals_read on pos_terminals for select using (is_org_member(org_id));
create policy pos_terminals_write on pos_terminals for all using (has_perm(org_id, 'settings')) with check (has_perm(org_id, 'settings'));
drop policy if exists pos_charges_read on pos_charges;
drop policy if exists pos_charges_ins on pos_charges;
drop policy if exists pos_charges_upd on pos_charges;
create policy pos_charges_read on pos_charges for select using (has_any_perm(org_id, array['finance.view','finance.receive']));
create policy pos_charges_ins on pos_charges for insert with check (has_perm(org_id, 'finance.receive'));
create policy pos_charges_upd on pos_charges for update using (has_perm(org_id, 'finance.receive')) with check (has_perm(org_id, 'finance.receive'));

drop trigger if exists audit_pos_charges on pos_charges;
create trigger audit_pos_charges after insert or update on pos_charges for each row execute function audit_row('status,amount_cents');
