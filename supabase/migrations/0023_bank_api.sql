-- Extrato bancário também pela API (Pluggy/Open Finance) e importação automática diária de contas e cartões.
alter table statement_imports drop constraint if exists statement_imports_source_check;
alter table statement_imports add constraint statement_imports_source_check check (source in ('ofx','asaas_api','pluggy_api'));
alter table bank_accounts
  add column if not exists pluggy_item_id text,
  add column if not exists pluggy_account_id text,
  add column if not exists auto_sync boolean not null default false,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_error text;
alter table credit_cards
  add column if not exists auto_sync boolean not null default false,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_error text;
