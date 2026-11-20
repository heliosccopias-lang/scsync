\set ON_ERROR_STOP 1
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111111');
select set_config('app.uid','11111111-1111-1111-1111-111111111111',false);
select create_org('Oficina Teste','00.000.000/0001-00') as org \gset
insert into customers(id,org_id,name,cpf_cnpj) values ('22222222-2222-2222-2222-222222222222', :'org', 'Ana', '12345678909');
select create_service_order(:'org', jsonb_build_object(
  'customer_id','22222222-2222-2222-2222-222222222222','equipment','Notebook','problem','Não liga','discount_cents',1000,
  'items', jsonb_build_array(
     jsonb_build_object('kind','service','description','Troca de tela','quantity',1,'unit_price_cents',30000),
     jsonb_build_object('kind','product','description','Tela 15"','quantity',2,'unit_price_cents',2500)),
  'installments', jsonb_build_array(
     jsonb_build_object('due_date','2026-12-10','amount_cents',17000,'method','pix'),
     jsonb_build_object('due_date','2027-01-10','amount_cents',17000,'method','boleto')))) as os \gset
select number, total_cents from service_orders where id = :'os';
select launch_accounts(:'os') as launched;
select name, amount_cents, status, category_id is not null as has_cat from receivables order by name;
-- second launch must fail
\set ON_ERROR_STOP 0
select launch_accounts(:'os');
\set ON_ERROR_STOP 1
insert into charges(org_id,receivable_id,billing_type,asaas_payment_id,value_cents,due_date)
select :'org', id, 'PIX', 'pay_A', amount_cents, due_date from receivables where name like '%1/2';
select apply_asaas_event(:'org', '{"id":"evt_1","event":"PAYMENT_RECEIVED","payment":{"id":"pay_A","value":170.00,"netValue":169.01,"clientPaymentDate":"2026-12-09"}}');
select apply_asaas_event(:'org', '{"id":"evt_1","event":"PAYMENT_RECEIVED","payment":{"id":"pay_A","value":170.00}}');
select apply_asaas_event(:'org', '{"id":"evt_2","event":"PAYMENT_RECEIVED","payment":{"id":"pay_A","value":170.00}}');
select apply_asaas_event(:'org', '{"id":"evt_3","event":"PAYMENT_RECEIVED","payment":{"id":"pay_X","value":1}}');
-- late boleto with interest
insert into charges(org_id,receivable_id,billing_type,asaas_payment_id,value_cents,due_date)
select :'org', id, 'BOLETO', 'pay_B', amount_cents, due_date from receivables where name like '%2/2';
select apply_asaas_event(:'org', '{"id":"evt_4","event":"PAYMENT_OVERDUE","payment":{"id":"pay_B","value":170.00}}');
select apply_asaas_event(:'org', '{"id":"evt_5","event":"PAYMENT_CONFIRMED","payment":{"id":"pay_B","value":175.40,"paymentDate":"2027-01-15"}}');
select apply_asaas_event(:'org', '{"id":"evt_6","event":"PAYMENT_RECEIVED","payment":{"id":"pay_B","value":175.40}}');
select asaas_payment_id, status, net_value_cents from charges order by 1;
select r.name, s.amount_cents, s.interest_cents, s.paid_on, s.method from settlements s join receivables r on r.id=s.receivable_id order by 1;
select payment_status, billed_cents, paid_cents from service_order_payment_view;
-- refund reverses
select apply_asaas_event(:'org', '{"id":"evt_7","event":"PAYMENT_REFUNDED","payment":{"id":"pay_A","value":170.00}}');
select payment_status, paid_cents from service_order_payment_view;
select count(*) as events, count(*) filter (where processed_at is not null) as processed from webhook_events;
-- cash undo reopens; restore after delete
insert into charges(org_id,receivable_id,billing_type,asaas_payment_id,value_cents,due_date,status)
select :'org', id, 'PIX', 'pay_C', amount_cents, due_date, 'cancelled' from receivables where name like '%1/2';
select apply_asaas_event(:'org', '{"id":"evt_8","event":"PAYMENT_RESTORED","payment":{"id":"pay_C","value":170.00}}');
select status from charges where asaas_payment_id='pay_C';
select apply_asaas_event(:'org', '{"id":"evt_9","event":"PAYMENT_RECEIVED","payment":{"id":"pay_C","value":170.00,"billingType":"RECEIVED_IN_CASH"}}');
select apply_asaas_event(:'org', '{"id":"evt_10","event":"PAYMENT_RECEIVED_IN_CASH_UNDONE","payment":{"id":"pay_C","value":170.00}}');
select asaas_payment_id, status from charges order by 1;
select payment_status, paid_cents from service_order_payment_view;
