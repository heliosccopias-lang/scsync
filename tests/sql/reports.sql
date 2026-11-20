\set ON_ERROR_STOP 1
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111115');
select set_config('app.uid','11111111-1111-1111-1111-111111111115',false);
select create_org('Oficina Rel') as org \gset
insert into technicians(id, org_id, name, commission_pct) values ('77777777-0000-0000-0000-000000000001', :'org', 'João', 10);
insert into customers(id,org_id,name) values ('22222222-2222-2222-2222-222222222226', :'org', 'Eva');
select create_service_order(:'org', jsonb_build_object('customer_id','22222222-2222-2222-2222-222222222226','technician_id','77777777-0000-0000-0000-000000000001',
  'items', jsonb_build_array(jsonb_build_object('kind','service','description','Troca de tela','quantity',1,'unit_price_cents',30000),
                             jsonb_build_object('kind','product','description','Tela','quantity',1,'unit_price_cents',20000)),
  'installments', jsonb_build_array(jsonb_build_object('due_date', (current_date - 40)::text,'amount_cents',25000,'method','pix'),
                                    jsonb_build_object('due_date', (current_date + 10)::text,'amount_cents',25000,'method','pix')))) as os \gset
update service_orders set status = 'delivered' where id = :'os';
select launch_accounts(:'os');
\echo '--- aging: one 31-60 late, one to come'
select bucket, titles, open_cents from report_aging(:'org') where titles > 0;
\echo '--- batch settle both'
select settle_batch('receivable', array(select id from receivables where origin_id = :'os'), current_date, 'cash');
select status, paid_cents from receivables where origin_id = :'os' order by due_date;
select * from report_receipts(:'org', current_date - 1, current_date);
select technician, os_count, services_cents, commission_cents from report_commissions(:'org', current_date - 30, current_date);
select kind, description, total_cents from report_top_items(:'org', current_date - 30, current_date);
select in_cents, out_cents from report_cashflow(:'org', current_date - 30, current_date);
select * from report_service_orders(:'org', current_date - 30, current_date);
