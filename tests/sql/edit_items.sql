\set ON_ERROR_STOP 1
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111112');
select set_config('app.uid','11111111-1111-1111-1111-111111111112',false);
select create_org('Oficina Edit') as org \gset
insert into customers(id,org_id,name) values ('22222222-2222-2222-2222-222222222223', :'org', 'Bia');
select create_service_order(:'org', jsonb_build_object('customer_id','22222222-2222-2222-2222-222222222223',
  'items', jsonb_build_array(jsonb_build_object('kind','service','description','Diagnóstico','quantity',1,'unit_price_cents',125)),
  'installments', jsonb_build_array(jsonb_build_object('due_date','2026-12-10','amount_cents',63,'method','pix'),
                                    jsonb_build_object('due_date','2027-01-10','amount_cents',62,'method','pix')))) as os \gset
\echo '--- before launch: add a service, installments re-split'
select update_service_order_items(:'os', jsonb_build_array(
  jsonb_build_object('kind','service','description','Diagnóstico','quantity',1,'unit_price_cents',125),
  jsonb_build_object('kind','service','description','Troca de tela','quantity',1,'unit_price_cents',10000)), 0)->>'total' as total;
select number, amount_cents from service_order_installments where service_order_id = :'os' order by number;
select launch_accounts(:'os');
\echo '--- after launch: refused (expect already_launched twice)'
\set ON_ERROR_STOP 0
select update_service_order_items(:'os', jsonb_build_array(jsonb_build_object('kind','service','description','x','quantity',1,'unit_price_cents',99999)), 0);
update service_orders set discount_cents = 10 where id = :'os';
\set ON_ERROR_STOP 1
\echo '--- status change still allowed after launch'
update service_orders set status = 'done' where id = :'os';
select status, total_cents from service_orders where id = :'os';
