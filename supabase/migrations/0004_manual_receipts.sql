-- Receipts taken outside Asaas (card machine, cash): keep the machine's authorization code and installments.
alter table settlements
  add column reference text,
  add column card_installments smallint check (card_installments between 1 and 24),
  add column notes text;
