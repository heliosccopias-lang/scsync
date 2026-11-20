\set ON_ERROR_STOP 1
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111112');
select set_config('app.uid','11111111-1111-1111-1111-111111111112',false);
select create_org('Oficina Edit') as org \gset
insert into customers(id,org_id,name) values ('22222222-2222-2222-2222-222222222223', :'org', 'Bia');
select create_service_order(:'org', jsonb_build_object('customer_id','22222222-2222-2222-2222-222222222223',
  'items', jsonb_build_array(jsonb_build_object('kind','service','description','Diagnóstico','quantity',1,'unit_price_cents',125)),
  'installments', jsonb_build_array(jsonb_build_object('due_date','2026-12-10','amount_cents',63,'method','pix'),
                                    jsonb_build_object('due_date','2027-01-10','amount_cents',62,'method','pix')))) as os \gset
select launch_accounts(:'os');

\echo '--- 1: open charge on parcel 2, add a service: both parcels re-split, parcel 2 reported as changed'
insert into charges(org_id,receivable_id,billing_type,asaas_payment_id,value_cents,due_date)
select :'org', id, 'PIX', 'pay_E', amount_cents, due_date from receivables where origin_id = :'os' and name like '%2/2';
select update_service_order_items(:'os', jsonb_build_array(
  jsonb_build_object('kind','service','description','Diagnóstico','quantity',1,'unit_price_cents',125),
  jsonb_build_object('kind','service','description','Troca de tela','quantity',1,'unit_price_cents',10000)), 0) as r1;
select name, amount_cents from receivables where origin_id = :'os' order by name;

\echo '--- 2: parcel 1 paid by card; add more: parcel 1 frozen, parcel 2 takes the difference'
insert into settlements(org_id,receivable_id,paid_on,amount_cents,method,source)
select :'org', id, current_date, amount_cents, 'debit_card','manual' from receivables where origin_id = :'os' and name like '%1/2';
select update_service_order_items(:'os', jsonb_build_array(
  jsonb_build_object('kind','service','description','Diagnóstico','quantity',1,'unit_price_cents',125),
  jsonb_build_object('kind','service','description','Troca de tela','quantity',1,'unit_price_cents',10000),
  jsonb_build_object('kind','product','description','Película','quantity',1,'unit_price_cents',3000)), 0) as r2;
select name, amount_cents, paid_cents, status from receivables where origin_id = :'os' order by name;

\echo '--- 3: below what was already paid: refused'
\set ON_ERROR_STOP 0
select update_service_order_items(:'os', jsonb_build_array(jsonb_build_object('kind','service','description','x','quantity',1,'unit_price_cents',100)), 0);
\set ON_ERROR_STOP 1

\echo '--- 4: everything paid, then add a service: new installment + receivable'
insert into settlements(org_id,receivable_id,paid_on,amount_cents,method,source)
select :'org', id, current_date, amount_cents, 'cash','manual' from receivables where origin_id = :'os' and name like '%2/2';
select update_service_order_items(:'os', jsonb_build_array(
  jsonb_build_object('kind','service','description','Diagnóstico','quantity',1,'unit_price_cents',125),
  jsonb_build_object('kind','service','description','Troca de tela','quantity',1,'unit_price_cents',10000),
  jsonb_build_object('kind','product','description','Película','quantity',1,'unit_price_cents',3000),
  jsonb_build_object('kind','service','description','Limpeza','quantity',1,'unit_price_cents',2000)), 0) ? 'added_receivable_id' as r4_added;
select name, amount_cents, paid_cents, status from receivables where origin_id = :'os' order by name;
select payment_status, billed_cents, paid_cents from service_order_payment_view where service_order_id = :'os';
