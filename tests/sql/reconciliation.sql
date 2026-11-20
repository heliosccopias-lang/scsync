\set ON_ERROR_STOP 1
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111113');
select set_config('app.uid','11111111-1111-1111-1111-111111111113',false);
select create_org('Oficina Conc') as org \gset
select id as bank from bank_accounts where org_id = :'org' limit 1 \gset
insert into bank_accounts(id, org_id, name, kind) values ('33333333-3333-3333-3333-333333333333', :'org', 'Banco do Brasil', 'bank');
insert into customers(id,org_id,name,cpf_cnpj) values ('22222222-2222-2222-2222-222222222224', :'org', 'Carlos Souza', '52998224725');
select create_service_order(:'org', jsonb_build_object('customer_id','22222222-2222-2222-2222-222222222224',
  'items', jsonb_build_array(jsonb_build_object('kind','service','description','Serviço','quantity',1,'unit_price_cents',30000)),
  'installments', jsonb_build_array(jsonb_build_object('due_date','2026-12-10','amount_cents',10000,'method','pix'),
                                    jsonb_build_object('due_date','2027-01-10','amount_cents',10000,'method','pix'),
                                    jsonb_build_object('due_date','2027-02-10','amount_cents',10000,'method','pix')))) as os \gset
select launch_accounts(:'os');
select id as r1 from receivables where name like '%1/3' \gset
select id as r2 from receivables where name like '%2/3' \gset
select id as r3 from receivables where name like '%3/3' \gset
-- parcel 1 paid by Asaas webhook (charge pay_1)
insert into charges(org_id,receivable_id,billing_type,asaas_payment_id,value_cents,due_date) values (:'org', :'r1', 'PIX', 'pay_1', 10000, '2026-12-10');
select apply_asaas_event(:'org', '{"id":"e1","event":"PAYMENT_RECEIVED","payment":{"id":"pay_1","value":100.00,"clientPaymentDate":"2026-12-09"}}');

insert into statement_imports(id, org_id, bank_account_id, source) values ('44444444-4444-4444-4444-444444444444', :'org', :'bank', 'asaas_api');
insert into statement_lines(id, org_id, import_id, bank_account_id, external_id, posted_on, amount_cents, description, provider_payment_id) values
 ('55555555-0000-0000-0000-000000000001', :'org', '44444444-4444-4444-4444-444444444444', :'bank', 'ft_1', '2026-12-09', 9901, 'Cobrança recebida', 'pay_1');
insert into statement_imports(id, org_id, bank_account_id, source) values ('44444444-4444-4444-4444-444444444445', :'org', '33333333-3333-3333-3333-333333333333', 'ofx');
insert into statement_lines(id, org_id, import_id, bank_account_id, external_id, posted_on, amount_cents, description, counterpart_doc) values
 ('55555555-0000-0000-0000-000000000002', :'org', '44444444-4444-4444-4444-444444444445', '33333333-3333-3333-3333-333333333333', 'f2', '2027-01-11', 10000, 'PIX RECEBIDO CARLOS SOUZA', '52998224725'),
 ('55555555-0000-0000-0000-000000000003', :'org', '44444444-4444-4444-4444-444444444445', '33333333-3333-3333-3333-333333333333', 'f3', '2027-01-12', -1290, 'TARIFA PACOTE SERVICOS', null),
 ('55555555-0000-0000-0000-000000000004', :'org', '44444444-4444-4444-4444-444444444445', '33333333-3333-3333-3333-333333333333', 'f4', '2027-02-15', 10350, 'PIX RECEBIDO CARLOS', null),
 ('55555555-0000-0000-0000-000000000005', :'org', '44444444-4444-4444-4444-444444444445', '33333333-3333-3333-3333-333333333333', 'f5', '2027-02-16', -50000, 'TED MESMA TITULARIDADE', null);

\echo '--- auto: Asaas line net of fee matched to webhook receipt'
select auto_reconcile_provider_lines(:'org') as auto_n;
select name, amount_cents, status from payables order by created_at;

\echo '--- suggestions for the PIX of parcel 2 (CPF match should rank r2 first)'
select target_type, label, amount_cents, score from suggest_matches('55555555-0000-0000-0000-000000000002') order by score desc limit 3;
select reconcile_line('55555555-0000-0000-0000-000000000002', 'receivable', :'r2') is not null as ok2;

\echo '--- bank fee -> expense'
select id as cat_fee from financial_categories where org_id = :'org' and name = 'Tarifas bancárias' \gset
select expense_from_line('55555555-0000-0000-0000-000000000003', 'Tarifa pacote', :'cat_fee') is not null as ok3;

\echo '--- paid late with interest: 103,50 for 100,00 -> needs interest action'
\set ON_ERROR_STOP 0
select reconcile_line('55555555-0000-0000-0000-000000000004', 'receivable', :'r3');
\set ON_ERROR_STOP 1
select reconcile_line('55555555-0000-0000-0000-000000000004', 'receivable', :'r3', 'interest') is not null as ok4;

\echo '--- transfer to own account'
select transfer_from_line('55555555-0000-0000-0000-000000000005', :'bank') is not null as ok5;

select r.name, r.amount_cents, r.paid_cents, r.status from receivables r where r.origin_id = :'os' order by r.name;
select external_id, status from statement_lines order by external_id;

\echo '--- undo the interest one: parcel 3 back to open, line back to pending'
select undo_reconciliation('55555555-0000-0000-0000-000000000004');
select name, paid_cents, status from receivables where id = :'r3';
select status from statement_lines where external_id = 'f4';
\echo '--- reconciling again the same receipt is refused'
\set ON_ERROR_STOP 0
select reconcile_line('55555555-0000-0000-0000-000000000004', 'settlement', (select id from settlements where charge_id is not null limit 1));
