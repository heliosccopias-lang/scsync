-- Mercado Pago Point (API de Orders): mesma cobrança na maquininha, pela nuvem.
alter table orgs
  add column if not exists mp_access_token_encrypted text,
  add column if not exists mp_webhook_token_hash text;
alter table pos_terminals drop constraint if exists pos_terminals_provider_check;
alter table pos_terminals add constraint pos_terminals_provider_check check (provider in ('stone','pagbank','mercadopago'));
alter table pos_terminals drop constraint if exists pos_terminals_serial_number_check;
alter table pos_terminals add constraint pos_terminals_serial_number_check check (char_length(serial_number) between 3 and 80);
alter table pos_charges drop constraint if exists pos_charges_provider_check;
alter table pos_charges add constraint pos_charges_provider_check check (provider in ('stone','pagbank','mercadopago'));
