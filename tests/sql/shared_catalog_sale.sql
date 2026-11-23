-- Shared catalog between two CNPJs and the counter sale. Raises ALL_OK at the end (rolls everything back).
do $$
declare o uuid; o2 uuid; acc uuid; owner uuid; p1 uuid; p1b uuid; n int; q numeric; sale uuid; st text; price bigint;
begin
  select id, account_id into o, acc from orgs limit 1;
  select user_id into owner from account_members where account_id = acc limit 1;
  insert into orgs (name, account_id) values ('TESTE CNPJ 2', acc) returning id into o2;
  insert into catalog_items (org_id, kind, name, price_cents, track_stock) values (o2, 'product', 'TESTE Caneta azul', 300, true);

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into catalog_items (org_id, kind, name, price_cents, track_stock) values (o, 'product', 'TESTE Caneta azul', 350, true) returning id into p1;
  insert into catalog_items (org_id, kind, name, price_cents) values (o, 'product', 'TESTE Agenda 2027', 4500);
  -- not shared yet: the second company keeps its own price
  select price_cents into price from catalog_items where org_id = o2 and name = 'TESTE Caneta azul';
  if price <> 300 then raise exception 'shared too early %', price; end if;

  n := set_catalog_sharing(acc, true, o);
  select price_cents into price from catalog_items where org_id = o2 and name = 'TESTE Caneta azul';
  if price <> 350 then raise exception 'source company did not win %', price; end if;
  select count(*) into n from catalog_items where org_id = o2 and name = 'TESTE Agenda 2027';
  if n <> 1 then raise exception 'missing copy'; end if;

  -- a later change spreads; stock does not
  update catalog_items set price_cents = 400 where id = p1;
  select id, price_cents into p1b, price from catalog_items where org_id = o2 and name = 'TESTE Caneta azul';
  if price <> 400 then raise exception 'price did not spread %', price; end if;
  insert into stock_movements (org_id, catalog_item_id, quantity, reason) values (o, p1, 10, 'purchase');
  select stock_qty into q from catalog_items where id = p1b;
  if q <> 0 then raise exception 'stock leaked to the other CNPJ %', q; end if;

  -- counter sale: 3 pens in cash, paid now
  sale := create_counter_sale(o, jsonb_build_object('method', 'cash', 'pay_now', true,
    'items', jsonb_build_array(jsonb_build_object('kind', 'product', 'catalog_item_id', p1, 'description', 'TESTE Caneta azul', 'quantity', 3, 'unit_price_cents', 400))));
  select status into st from service_orders where id = sale;
  if st <> 'paid' then raise exception 'sale status %', st; end if;
  select stock_qty into q from catalog_items where id = p1;
  if q <> 7 then raise exception 'stock not taken out %', q; end if;
  select count(*) into n from service_orders where id = sale and channel = 'counter' and total_cents = 1200;
  if n <> 1 then raise exception 'sale not recorded'; end if;

  -- sale to be charged later stays Concluída
  sale := create_counter_sale(o, jsonb_build_object('method', 'pix', 'pay_now', false,
    'items', jsonb_build_array(jsonb_build_object('kind', 'product', 'description', 'Avulso', 'quantity', 1, 'unit_price_cents', 900))));
  select status into st from service_orders where id = sale;
  if st <> 'done' then raise exception 'unpaid sale status %', st; end if;
  reset role;
  raise exception 'ALL_OK';
end $$;
