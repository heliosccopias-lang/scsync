-- Conciliação de cartão de crédito: faturas (arquivo ou Pluggy), despesas lançadas pelo robô de WhatsApp
-- e o casamento entre as duas no fechamento da fatura.

alter table orgs
  add column if not exists wa_token_hash text,
  add column if not exists wa_verify_token text,
  add column if not exists wa_provider text check (wa_provider in ('generic','meta','zapi','evolution')),
  add column if not exists pluggy_client_id text,
  add column if not exists pluggy_secret_encrypted text;

alter table financial_categories add column if not exists keywords text[] not null default '{}';

create table if not exists credit_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  last4 text check (last4 ~ '^\d{4}$'),
  aliases text[] not null default '{}',
  closing_day int check (closing_day between 1 and 31),
  due_day int check (due_day between 1 and 31),
  bank_account_id uuid references bank_accounts(id) on delete set null,
  category_id uuid references financial_categories(id) on delete set null,
  pluggy_item_id text,
  pluggy_account_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists credit_cards_org on credit_cards (org_id);
create index if not exists credit_cards_bank on credit_cards (bank_account_id);
create index if not exists credit_cards_cat on credit_cards (category_id);

create table if not exists card_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  card_id uuid not null references credit_cards(id) on delete cascade,
  reference text not null,                 -- '2026-11'
  period_start date,
  closing_date date not null,
  due_date date not null,
  source text not null check (source in ('file','api','manual')),
  file_name text,
  external_id text,
  status text not null default 'open' check (status in ('open','closed')),
  payable_id uuid references payables(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (card_id, reference)
);
create index if not exists card_statements_org on card_statements (org_id, closing_date desc);
create index if not exists card_statements_payable on card_statements (payable_id);

create table if not exists card_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  card_id uuid not null references credit_cards(id) on delete cascade,
  statement_id uuid not null references card_statements(id) on delete cascade,
  posted_on date not null,
  description text not null,
  amount_cents bigint not null,            -- positive = purchase, negative = refund/credit
  installment text,
  external_id text,
  category_id uuid references financial_categories(id) on delete set null,
  expense_id uuid,
  status text not null default 'pending' check (status in ('pending','matched','categorized','ignored')),
  created_at timestamptz not null default now()
);
create unique index if not exists card_transactions_ext on card_transactions (card_id, external_id) where external_id is not null;
create index if not exists card_transactions_stmt on card_transactions (statement_id, posted_on);
create index if not exists card_transactions_org on card_transactions (org_id);
create index if not exists card_transactions_card on card_transactions (card_id);
create index if not exists card_transactions_cat on card_transactions (category_id);

create table if not exists card_expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  card_id uuid references credit_cards(id) on delete set null,
  spent_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  description text not null,
  category_id uuid references financial_categories(id) on delete set null,
  source text not null check (source in ('whatsapp','manual')),
  sender_phone text,
  sender_name text,
  raw_text text,
  transaction_id uuid references card_transactions(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','matched','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists card_expenses_org on card_expenses (org_id, spent_on desc);
create index if not exists card_expenses_card on card_expenses (card_id);
create index if not exists card_expenses_cat on card_expenses (category_id);
create index if not exists card_expenses_tx on card_expenses (transaction_id);

do $$ begin
  alter table card_transactions add constraint card_transactions_expense_fk foreign key (expense_id) references card_expenses(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists card_transactions_exp on card_transactions (expense_id);

create table if not exists whatsapp_senders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  phone text not null check (phone ~ '^\d{10,15}$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, phone)
);

create table if not exists whatsapp_inbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider text not null,
  message_id text not null,
  from_phone text,
  text text,
  result text not null check (result in ('saved','ignored','unauthorized','error')),
  reply text,
  expense_id uuid references card_expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, provider, message_id)
);
create index if not exists whatsapp_inbox_org on whatsapp_inbox (org_id, created_at desc);
create index if not exists whatsapp_inbox_exp on whatsapp_inbox (expense_id);

do $$
declare t text;
begin
  foreach t in array array['credit_cards','card_statements','card_transactions','card_expenses','whatsapp_senders','whatsapp_inbox'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_member', t);
    execute format('create policy %I on %I for all using (is_org_member(org_id)) with check (is_org_member(org_id))', t || '_member', t);
  end loop;
end $$;

-- Ties a statement line to an expense told to the robot (or typed in). Category comes from the expense.
create or replace function card_match(p_tx uuid, p_expense uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_tx card_transactions; v_exp card_expenses; v_st text;
begin
  select * into v_tx from card_transactions where id = p_tx for update;
  select * into v_exp from card_expenses where id = p_expense for update;
  if v_tx.id is null or v_exp.id is null or v_tx.org_id <> v_exp.org_id then raise exception 'not_found'; end if;
  select status into v_st from card_statements where id = v_tx.statement_id;
  if v_st = 'closed' then raise exception 'statement_closed'; end if;
  if v_tx.expense_id is not null or v_exp.transaction_id is not null then raise exception 'already_matched'; end if;
  update card_transactions set expense_id = v_exp.id, status = 'matched', category_id = coalesce(v_exp.category_id, category_id) where id = v_tx.id;
  update card_expenses set transaction_id = v_tx.id, status = 'matched', card_id = coalesce(card_id, v_tx.card_id) where id = v_exp.id;
end $$;

create or replace function card_unmatch(p_tx uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_tx card_transactions; v_st text;
begin
  select * into v_tx from card_transactions where id = p_tx for update;
  if v_tx.id is null then raise exception 'not_found'; end if;
  select status into v_st from card_statements where id = v_tx.statement_id;
  if v_st = 'closed' then raise exception 'statement_closed'; end if;
  update card_expenses set transaction_id = null, status = 'pending' where id = v_tx.expense_id;
  update card_transactions set expense_id = null, status = case when category_id is null then 'pending' else 'categorized' end where id = v_tx.id;
end $$;

-- End of period: every line must be matched, categorized or ignored. Creates the bill as a payable.
create or replace function close_card_statement(p_statement uuid, p_bank_account uuid, p_category uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_st card_statements; v_card credit_cards; v_total bigint; v_pending int; v_payable uuid;
begin
  select * into v_st from card_statements where id = p_statement for update;
  if v_st.id is null then raise exception 'not_found'; end if;
  if v_st.status = 'closed' then raise exception 'already_closed'; end if;
  select * into v_card from credit_cards where id = v_st.card_id;
  select count(*) filter (where status = 'pending'), coalesce(sum(amount_cents) filter (where status <> 'ignored'), 0)
    into v_pending, v_total from card_transactions where statement_id = v_st.id;
  if v_pending > 0 then raise exception 'pending_lines'; end if;
  if v_total > 0 then
    insert into payables (org_id, name, supplier_name, bank_account_id, category_id, due_date, amount_cents, notes)
    values (v_st.org_id, 'Fatura ' || v_card.name || ' ' || v_st.reference, v_card.name, p_bank_account, p_category, v_st.due_date, v_total,
            'Gerada no fechamento da conciliação do cartão.')
    returning id into v_payable;
  end if;
  update card_statements set status = 'closed', closed_at = now(), payable_id = v_payable where id = v_st.id;
  return v_payable;
end $$;

-- Reopens a closed statement: the bill payable is cancelled if nothing was paid on it yet.
create or replace function reopen_card_statement(p_statement uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_st card_statements; v_paid bigint;
begin
  select * into v_st from card_statements where id = p_statement for update;
  if v_st.id is null then raise exception 'not_found'; end if;
  if v_st.payable_id is not null then
    select paid_cents into v_paid from payables where id = v_st.payable_id for update;
    if coalesce(v_paid, 0) > 0 then raise exception 'bill_paid'; end if;
    update payables set status = 'cancelled', updated_at = now() where id = v_st.payable_id;
  end if;
  update card_statements set status = 'open', closed_at = null, payable_id = null where id = v_st.id;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function card_match(uuid, uuid) from public, anon;
    revoke execute on function card_unmatch(uuid) from public, anon;
    revoke execute on function close_card_statement(uuid, uuid, uuid) from public, anon;
    revoke execute on function reopen_card_statement(uuid) from public, anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function card_match(uuid, uuid) to authenticated;
    grant execute on function card_unmatch(uuid) to authenticated;
    grant execute on function close_card_statement(uuid, uuid, uuid) to authenticated;
    grant execute on function reopen_card_statement(uuid) to authenticated;
  end if;
end $$;
