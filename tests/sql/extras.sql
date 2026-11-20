\set ON_ERROR_STOP 1
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111116');
select set_config('app.uid','11111111-1111-1111-1111-111111111116',false);
select create_org('Oficina Extra') as org \gset
insert into catalog_items(id, org_id, kind, name, price_cents, track_stock) values ('88888888-0000-0000-0000-000000000001', :'org', 'product', 'Tela 15', 20000, true);
insert into stock_movements(org_id, catalog_item_id, quantity, reason) values (:'org', '88888888-0000-0000-0000-000000000001', 5, 'purchase');
insert into technicians(id, org_id, name, commission_pct) values ('77777777-0000-0000-0000-000000000011', :'org', 'Ana', 10), ('77777777-0000-0000-0000-000000000012', :'org', 'Bruno', 20);
insert into customers(id,org_id,name) values ('22222222-2222-2222-2222-222222222227', :'org', 'Fábio');
select create_service_order(:'org', jsonb_build_object('customer_id','22222222-2222-2222-2222-222222222227','technician_id','77777777-0000-0000-0000-000000000011',
  'items', jsonb_build_array(jsonb_build_object('kind','service','description','Troca','quantity',1,'unit_price_cents',10000),
                             jsonb_build_object('kind','product','description','tela 15','quantity',2,'unit_price_cents',20000)))) as os \gset
update service_orders set second_technician_id = '77777777-0000-0000-0000-000000000012', status = 'done' where id = :'os';
select launch_stock(:'os');
select stock_qty from catalog_items where id = '88888888-0000-0000-0000-000000000001';
\set ON_ERROR_STOP 0
select launch_stock(:'os');
\set ON_ERROR_STOP 1
select reverse_stock(:'os');
select stock_qty from catalog_items where id = '88888888-0000-0000-0000-000000000001';
select technician, services_cents, commission_cents from report_commissions(:'org', current_date - 1, current_date) order by 1;
