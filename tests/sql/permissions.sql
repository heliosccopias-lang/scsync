-- Profiles enforced by the database. Raises ALL_OK at the end (rolls everything back).
do $$
declare o uuid; uprod uuid := gen_random_uuid(); uatt uuid := gen_random_uuid(); ufin uuid := gen_random_uuid(); so uuid; n int; ok boolean;
begin
  select id into o from orgs limit 1;
  select id into so from service_orders where org_id = o and status <> 'cancelled' limit 1;
  insert into auth.users (id, email, aud, role) values (uprod,'p@t.x','authenticated','authenticated'),(uatt,'a@t.x','authenticated','authenticated'),(ufin,'f@t.x','authenticated','authenticated');
  insert into org_members (org_id,user_id,role) values (o,uprod,'production'),(o,uatt,'attendance'),(o,ufin,'finance');

  -- Produção: moves the job forward, cannot touch values, sees no money.
  perform set_config('request.jwt.claims', json_build_object('sub', uprod, 'role','authenticated')::text, true);
  set local role authenticated;
  update service_orders set status = status, internal_notes = coalesce(internal_notes,'') where id = so;
  begin update service_orders set discount_cents = discount_cents + 1 where id = so; raise exception 'prod changed discount';
  exception when others then if sqlerrm <> 'permission_denied' then raise; end if; end;
  select count(*) into n from receivables; if n <> 0 then raise exception 'prod sees receivables'; end if;
  select count(*) into n from service_orders; if n = 0 then raise exception 'prod cannot see OS'; end if;
  update catalog_items set price_cents = price_cents + 1; get diagnostics n = row_count; if n <> 0 then raise exception 'prod edited catalog'; end if;
  reset role;

  -- Atendimento: OS and receiving, no payables, cannot cancel OS nor change prices (stock moves are fine).
  perform set_config('request.jwt.claims', json_build_object('sub', uatt, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from receivables; if n = 0 then raise exception 'att cannot see receivables'; end if;
  select count(*) into n from payables; if n <> 0 then raise exception 'att sees payables'; end if;
  begin update service_orders set status = 'cancelled' where id = so; raise exception 'att cancelled';
  exception when others then if sqlerrm <> 'permission_denied' then raise; end if; end;
  begin update catalog_items set price_cents = price_cents + 1 where org_id = o; raise exception 'att changed price';
  exception when others then if sqlerrm <> 'permission_denied' then raise; end if; end;
  update catalog_items set stock_qty = stock_qty where org_id = o and kind = 'product';
  select has_perm(o,'finance.edit') into ok; if ok then raise exception 'att finance.edit'; end if;
  reset role;

  -- Financeiro: finance yes, company settings and audit no.
  perform set_config('request.jwt.claims', json_build_object('sub', ufin, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from receivables; if n = 0 then raise exception 'fin no receivables'; end if;
  select count(*) into n from audit_log; if n <> 0 then raise exception 'fin sees audit'; end if;
  update orgs set name = name || 'x' where id = o; get diagnostics n = row_count; if n <> 0 then raise exception 'fin changed org'; end if;
  reset role;
  select count(*) into n from audit_log where entity = 'org_members'; if n < 3 then raise exception 'audit missing %', n; end if;
  raise exception 'ALL_OK';
end $$;
