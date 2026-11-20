\set ON_ERROR_STOP 1
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111114');
select set_config('app.uid','11111111-1111-1111-1111-111111111114',false);
select create_org('Oficina Check') as org \gset
insert into customers(id,org_id,name) values ('22222222-2222-2222-2222-222222222225', :'org', 'Dani');
select create_service_order(:'org', jsonb_build_object('customer_id','22222222-2222-2222-2222-222222222225',
  'items', jsonb_build_array(jsonb_build_object('kind','service','description','Revisão','quantity',1,'unit_price_cents',5000)))) as os \gset
insert into checklists(id, org_id, name) values ('66666666-0000-0000-0000-000000000001', :'org', 'Entrada de notebook');
insert into checklist_questions(org_id, checklist_id, position, prompt, type, options, required) values
 (:'org', '66666666-0000-0000-0000-000000000001', 1, 'Liga?', 'single', '["Sim","Não"]', true),
 (:'org', '66666666-0000-0000-0000-000000000001', 2, 'Acessórios', 'multi', '["Carregador","Bolsa"]', false);
insert into checklist_runs(org_id, checklist_id, service_order_id) values (:'org', '66666666-0000-0000-0000-000000000001', :'os');
select locked from checklists where id = '66666666-0000-0000-0000-000000000001';
\echo '--- editing a used checklist is refused'
\set ON_ERROR_STOP 0
update checklist_questions set prompt = 'Mudou' where checklist_id = '66666666-0000-0000-0000-000000000001';
\set ON_ERROR_STOP 1
select duplicate_checklist('66666666-0000-0000-0000-000000000001') as copy \gset
select name, locked, (select count(*) from checklist_questions where checklist_id = :'copy') as questions from checklists where id = :'copy';
update checklist_questions set prompt = 'Liga normalmente?' where checklist_id = :'copy' and position = 1;
