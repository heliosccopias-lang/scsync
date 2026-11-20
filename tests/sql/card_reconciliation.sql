-- Run inside a transaction; raises ALL_OK at the end (which rolls everything back).
do $$
declare o uuid; b uuid; c uuid; s uuid; t1 uuid; t2 uuid; t3 uuid; e1 uuid; p uuid; amt bigint; st text; ok boolean;
begin
  select id into o from orgs limit 1;
  select id into b from bank_accounts where org_id = o limit 1;
  insert into credit_cards (org_id, name, last4) values (o, 'TESTE Itaú', '1234') returning id into c;
  insert into card_statements (org_id, card_id, reference, closing_date, due_date, source) values (o, c, '2099-01', '2099-01-03', '2099-01-10', 'file') returning id into s;
  insert into card_transactions (org_id, card_id, statement_id, posted_on, description, amount_cents) values (o,c,s,'2099-01-01','POSTO',15000) returning id into t1;
  insert into card_transactions (org_id, card_id, statement_id, posted_on, description, amount_cents) values (o,c,s,'2099-01-02','ESTORNO',-2000) returning id into t2;
  insert into card_transactions (org_id, card_id, statement_id, posted_on, description, amount_cents) values (o,c,s,'2099-01-02','ANUIDADE',500) returning id into t3;
  insert into card_expenses (org_id, spent_on, amount_cents, description, source) values (o,'2099-01-01',15000,'gasolina','whatsapp') returning id into e1;
  perform card_match(t1, e1);
  begin perform card_match(t1, e1); raise exception 'should fail'; exception when others then if sqlerrm <> 'already_matched' then raise; end if; end;
  begin perform close_card_statement(s, b, null); raise exception 'should fail'; exception when others then if sqlerrm <> 'pending_lines' then raise; end if; end;
  update card_transactions set status='categorized' where id = t2;
  update card_transactions set status='ignored' where id = t3;
  p := close_card_statement(s, b, null);
  select amount_cents into amt from payables where id = p;
  if amt <> 13000 then raise exception 'wrong total %', amt; end if;
  begin perform card_unmatch(t1); raise exception 'should fail'; exception when others then if sqlerrm <> 'statement_closed' then raise; end if; end;
  perform reopen_card_statement(s);
  select status into st from payables where id = p;
  if st <> 'cancelled' then raise exception 'payable not cancelled'; end if;
  perform card_unmatch(t1);
  select status = 'pending' into ok from card_expenses where id = e1;
  if not ok then raise exception 'unmatch failed'; end if;
  raise exception 'ALL_OK';
end $$;
