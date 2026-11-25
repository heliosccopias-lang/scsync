-- 0035: WhatsApp notices to customers.
--   * Payment reminders: N days before the due date, on the due date and N days after (overdue).
--   * "OS pronta": when the OS becomes Concluída.
-- Sent from the company's connected WhatsApp (Z-API / Evolution, same connection as the card robot).
-- Without a connection, each notice waits in the outbox as "manual": one click opens WhatsApp with the text ready.

alter table orgs
  add column if not exists notify_reminders boolean not null default false,
  add column if not exists notify_ready boolean not null default false,
  add column if not exists reminder_days_before int not null default 1 check (reminder_days_before between 0 and 15),
  add column if not exists reminder_days_after int not null default 3 check (reminder_days_after between 1 and 30),
  add column if not exists tpl_reminder text,
  add column if not exists tpl_ready text;

create table if not exists whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('reminder_before', 'reminder_due', 'reminder_overdue', 'os_ready')),
  receivable_id uuid references receivables(id) on delete cascade,
  service_order_id uuid references service_orders(id) on delete cascade,
  customer_name text,
  phone text,
  text text not null,
  status text not null check (status in ('sent', 'failed', 'manual', 'manual_done', 'no_phone')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- One notice of each kind per installment (reminders) and per OS ("OS pronta"): the daily job never repeats itself.
create unique index if not exists whatsapp_outbox_one_reminder on whatsapp_outbox (receivable_id, kind) where receivable_id is not null;
create unique index if not exists whatsapp_outbox_one_ready on whatsapp_outbox (service_order_id, kind) where kind = 'os_ready';
create index if not exists whatsapp_outbox_org on whatsapp_outbox (org_id, created_at desc);

alter table whatsapp_outbox enable row level security;
drop policy if exists whatsapp_outbox_read on whatsapp_outbox;
create policy whatsapp_outbox_read on whatsapp_outbox for select to authenticated
  using (has_any_perm(org_id, array['finance.view', 'finance.receive', 'os.edit']));
-- Writes come from the server (service role); people only mark a manual notice as sent.
drop policy if exists whatsapp_outbox_mark on whatsapp_outbox;
create policy whatsapp_outbox_mark on whatsapp_outbox for update to authenticated
  using (has_any_perm(org_id, array['finance.receive', 'os.edit']))
  with check (has_any_perm(org_id, array['finance.receive', 'os.edit']));
