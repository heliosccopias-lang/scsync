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
-- add a service: total 125 + 10000 = 10125, two installments 5062 + 5063
select update_service_order_items(:'os', jsonb_build_array(
  jsonb_build_object('kind','service','description','Diagnóstico','quantity',1,'unit_price_cents',125),
  jsonb_build_object('kind','service','description','Troca de tela','quantity',1,'unit_price_cents',10000)), 0) as total;
select number, amount_cents, due_date from service_order_installments where service_order_id = :'os' order by number;
select name, amount_cents from receivables where origin_id = :'os' order by name;
-- with a receipt: must refuse
insert into settlements(org_id,receivable_id,paid_on,amount_cents,method,source)
select :'org', id, current_date, 100, 'cash','manual' from receivables where origin_id = :'os' and name like '%1/2';
\set ON_ERROR_STOP 0
select update_service_order_items(:'os', jsonb_build_array(jsonb_build_object('kind','service','description','x','quantity',1,'unit_price_cents',9999)), 0);
\set ON_ERROR_STOP 1
update settlements set reversed_at = now() where receivable_id in (select id from receivables where origin_id = :'os');
select update_service_order_items(:'os', jsonb_build_array(jsonb_build_object('kind','product','description','Peça','quantity',2,'unit_price_cents',3000)), 1000) as total_after_reverse;
select status, paid_cents, amount_cents from receivables where origin_id = :'os' order by name;
