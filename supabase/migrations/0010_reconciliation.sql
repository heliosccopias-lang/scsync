-- Etapa 2: conciliação bancária.
-- A statement line (from OFX or the Asaas statement) is matched to what the books say happened:
--   credit  -> an open receivable (creates the receipt) or a receipt already recorded (Asaas webhook, card machine)
--   debit   -> an open payable (creates the payment) or a new expense (bank fee) or a transfer between own accounts
-- Every money effect a reconciliation creates is remembered so "desfazer" can undo exactly that.

alter table statement_lines add column provider_payment_id text;      -- Asaas payment id on Asaas statement lines
alter table statement_lines add column kind text;                      -- provider's own type (PAYMENT_RECEIVED, PAYMENT_FEE...)
create index on statement_lines (org_id, provider_payment_id) where provider_payment_id is not null;

alter table reconciliations add column created_settlement_id uuid references settlements(id) on delete set null;
alter table reconciliations add column created_payable_id uuid references payables(id) on delete set null;
alter table reconciliations add column created_transfer_id uuid references transfers(id) on delete set null;
alter table reconciliations add column fee_payable_id uuid references payables(id) on delete set null;
alter table reconciliations add column created_receivable_id uuid references receivables(id) on delete set null;
create index on reconciliations (created_settlement_id);
create index on reconciliations (created_payable_id);
create index on reconciliations (created_transfer_id);
create index on reconciliations (fee_payable_id);
create index on reconciliations (created_receivable_id);
-- one live reconciliation per line
create unique index reconciliations_one_live_per_line on reconciliations (statement_line_id) where undone_at is null;

-- Is this receipt already tied to a bank line?
create or replace function settlement_is_reconciled(p_settlement uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from reconciliations
     where undone_at is null
       and ((target_type = 'settlement' and target_id = p_settlement) or created_settlement_id = p_settlement)
  )
$$;

-- Candidates for one statement line, best first. score 0..1.
create or replace function suggest_matches(p_line uuid)
returns table (target_type text, target_id uuid, label text, amount_cents bigint, ref_date date, score numeric)
language plpgsql stable security invoker set search_path = public as $$
declare
  l statement_lines%rowtype;
  v_abs bigint;
begin
  select * into l from statement_lines where id = p_line;
  if not found then return; end if;
  v_abs := abs(l.amount_cents);

  if l.amount_cents > 0 then
    -- receipts already in the books (webhook, card machine, cash) that no line claimed yet
    return query
    select 'settlement'::text, s.id,
           coalesce(r.name, 'Recebimento') || ' · ' || coalesce(c.name, ''),
           s.amount_cents + s.interest_cents, s.paid_on,
           round(least(1,
             (case when ch.asaas_payment_id is not null and ch.asaas_payment_id = l.provider_payment_id then 1.0 else 0 end)
             + (case when s.amount_cents + s.interest_cents = v_abs then 0.6
                     when abs(s.amount_cents + s.interest_cents - v_abs) <= greatest(500, (s.amount_cents + s.interest_cents) * 0.05) then 0.35 else 0 end)
             + (case when abs(s.paid_on - l.posted_on) <= 1 then 0.3 when abs(s.paid_on - l.posted_on) <= 5 then 0.15 else 0 end)
             + (case when c.cpf_cnpj is not null and l.counterpart_doc = c.cpf_cnpj then 0.2 else 0 end)
           )::numeric, 3)
      from settlements s
      join receivables r on r.id = s.receivable_id
      left join customers c on c.id = r.customer_id
      left join charges ch on ch.id = s.charge_id
     where s.org_id = l.org_id and s.reversed_at is null
       and not settlement_is_reconciled(s.id)
       and (
         (ch.asaas_payment_id is not null and ch.asaas_payment_id = l.provider_payment_id)
         or (s.paid_on between l.posted_on - 7 and l.posted_on + 7
             and abs(s.amount_cents + s.interest_cents - v_abs) <= greatest(500, v_abs * 0.1))
       );

    -- open receivables
    return query
    select 'receivable'::text, r.id, r.name || ' · ' || coalesce(c.name, ''), r.amount_cents - r.paid_cents, r.due_date,
           round(least(1,
             (case when r.amount_cents - r.paid_cents = v_abs then 0.5
                   when v_abs < r.amount_cents - r.paid_cents then 0.2
                   when v_abs - (r.amount_cents - r.paid_cents) <= greatest(500, (r.amount_cents - r.paid_cents) * 0.1) then 0.25 else 0 end)
             + (case when abs(r.due_date - l.posted_on) <= 3 then 0.25 when abs(r.due_date - l.posted_on) <= 15 then 0.1 else 0 end)
             + (case when c.cpf_cnpj is not null and l.counterpart_doc = c.cpf_cnpj then 0.2 else 0 end)
             + (case when c.name is not null and length(c.name) > 3 and l.description ilike '%' || split_part(c.name, ' ', 1) || '%' then 0.05 else 0 end)
           )::numeric, 3)
      from receivables r
      left join customers c on c.id = r.customer_id
     where r.org_id = l.org_id and r.status in ('open','partial')
       and (r.amount_cents - r.paid_cents) between v_abs * 0.5 and v_abs * 1.5 + 1000;
  else
    return query
    select 'payable'::text, p.id, p.name || coalesce(' · ' || p.supplier_name, ''), p.amount_cents - p.paid_cents, p.due_date,
           round(least(1,
             (case when p.amount_cents - p.paid_cents = v_abs then 0.6 when v_abs < p.amount_cents - p.paid_cents then 0.25 else 0.2 end)
             + (case when abs(p.due_date - l.posted_on) <= 3 then 0.3 when abs(p.due_date - l.posted_on) <= 15 then 0.1 else 0 end)
           )::numeric, 3)
      from payables p
     where p.org_id = l.org_id and p.status in ('open','partial')
       and (p.amount_cents - p.paid_cents) between v_abs * 0.5 and v_abs * 1.5 + 1000;

    return query
    select 'settlement'::text, s.id, coalesce(p.name, 'Pagamento'), s.amount_cents + s.interest_cents, s.paid_on,
           round(least(1,
             (case when s.amount_cents + s.interest_cents = v_abs then 0.6 else 0.3 end)
             + (case when abs(s.paid_on - l.posted_on) <= 1 then 0.3 when abs(s.paid_on - l.posted_on) <= 5 then 0.15 else 0 end)
           )::numeric, 3)
      from settlements s
      join payables p on p.id = s.payable_id
     where s.org_id = l.org_id and s.reversed_at is null
       and not settlement_is_reconciled(s.id)
       and s.paid_on between l.posted_on - 7 and l.posted_on + 7
       and abs(s.amount_cents + s.interest_cents - v_abs) <= greatest(500, v_abs * 0.1);
  end if;
end $$;

-- Reconcile a line with a receivable, payable or an existing settlement.
-- p_action for amount differences: null (must match), 'partial', 'interest', 'discount', 'fee'.
create or replace function reconcile_line(p_line uuid, p_target_type text, p_target_id uuid, p_action text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  l statement_lines%rowtype;
  v_abs bigint;
  v_open bigint;
  v_rec receivables%rowtype;
  v_pay payables%rowtype;
  v_set settlements%rowtype;
  v_new_settlement uuid;
  v_fee_payable uuid;
  v_diff bigint := 0;
  v_principal bigint;
  v_interest bigint := 0;
  v_cat uuid;
  v_id uuid;
begin
  select * into l from statement_lines where id = p_line for update;
  if not found then raise exception 'not_found'; end if;
  if l.status in ('reconciled','ignored') then raise exception 'line_not_pending'; end if;
  v_abs := abs(l.amount_cents);

  if p_target_type = 'receivable' then
    if l.amount_cents < 0 then raise exception 'sign_mismatch'; end if;
    select * into v_rec from receivables where id = p_target_id and org_id = l.org_id for update;
    if not found then raise exception 'target_not_found'; end if;
    if v_rec.status not in ('open','partial') then raise exception 'target_not_open'; end if;
    v_open := v_rec.amount_cents - v_rec.paid_cents;
    v_principal := v_abs;
    if v_abs > v_open then
      if p_action = 'interest' then v_principal := v_open; v_interest := v_abs - v_open;
      else raise exception 'amount_exceeds_open'; end if;
    elsif v_abs < v_open then
      if p_action is null then raise exception 'amount_below_open'; end if;
      if p_action not in ('partial','discount') then raise exception 'invalid_action'; end if;
    end if;
    v_diff := v_abs - v_open;
    insert into settlements (org_id, receivable_id, paid_on, amount_cents, interest_cents, method, source, notes, created_by)
    values (l.org_id, v_rec.id, l.posted_on, v_principal, v_interest, 'transfer', 'reconciliation',
            left(l.description, 200), auth.uid())
    returning id into v_new_settlement;
    if p_action = 'discount' and v_abs < v_open then
      update receivables set amount_cents = paid_cents, notes = coalesce(notes || E'\n', '') ||
             format('Desconto de %s na conciliação de %s', to_char((v_open - v_abs) / 100.0, 'FM999G999G990D00'), l.posted_on)
       where id = v_rec.id;
    end if;

  elsif p_target_type = 'payable' then
    if l.amount_cents > 0 then raise exception 'sign_mismatch'; end if;
    select * into v_pay from payables where id = p_target_id and org_id = l.org_id for update;
    if not found then raise exception 'target_not_found'; end if;
    if v_pay.status not in ('open','partial') then raise exception 'target_not_open'; end if;
    v_open := v_pay.amount_cents - v_pay.paid_cents;
    v_principal := v_abs;
    if v_abs > v_open then
      if p_action = 'interest' then v_principal := v_open; v_interest := v_abs - v_open;
      else raise exception 'amount_exceeds_open'; end if;
    elsif v_abs < v_open and p_action is null then raise exception 'amount_below_open';
    end if;
    v_diff := v_abs - v_open;
    insert into settlements (org_id, payable_id, paid_on, amount_cents, interest_cents, method, source, notes, created_by)
    values (l.org_id, v_pay.id, l.posted_on, v_principal, v_interest, 'transfer', 'reconciliation', left(l.description, 200), auth.uid())
    returning id into v_new_settlement;
    if p_action = 'discount' and v_abs < v_open then
      update payables set amount_cents = paid_cents where id = v_pay.id;
    end if;

  elsif p_target_type = 'settlement' then
    select * into v_set from settlements where id = p_target_id and org_id = l.org_id and reversed_at is null;
    if not found then raise exception 'target_not_found'; end if;
    if settlement_is_reconciled(v_set.id) then raise exception 'already_reconciled'; end if;
    if (v_set.receivable_id is not null) <> (l.amount_cents > 0) then raise exception 'sign_mismatch'; end if;
    v_diff := v_abs - (v_set.amount_cents + v_set.interest_cents);
    if v_diff <> 0 then
      if p_action = 'fee' and v_diff < 0 and v_set.receivable_id is not null then
        -- money arrived net of the provider's fee: record the fee as a paid expense
        select id into v_cat from financial_categories where org_id = l.org_id and direction = 'out' and name = 'Tarifas bancárias' limit 1;
        insert into payables (org_id, name, supplier_name, bank_account_id, category_id, due_date, amount_cents)
        values (l.org_id, 'Tarifa de recebimento', null, l.bank_account_id, v_cat, l.posted_on, -v_diff)
        returning id into v_fee_payable;
        insert into settlements (org_id, payable_id, paid_on, amount_cents, method, source, created_by)
        values (l.org_id, v_fee_payable, l.posted_on, -v_diff, 'other', 'reconciliation', auth.uid());
      elsif p_action is null then
        raise exception 'amount_differs';
      end if;
    end if;
  else
    raise exception 'invalid_target';
  end if;

  insert into reconciliations (org_id, statement_line_id, target_type, target_id, amount_cents, difference_cents,
                               difference_action, matched_by, created_settlement_id, fee_payable_id)
  values (l.org_id, l.id, p_target_type, p_target_id, l.amount_cents, v_diff, p_action, auth.uid(),
          v_new_settlement, v_fee_payable)
  returning id into v_id;
  update statement_lines set status = 'reconciled' where id = l.id;
  return v_id;
end $$;

-- Debit with nothing in the books (bank fee, a bill paid straight from the account): create it already paid.
create or replace function expense_from_line(p_line uuid, p_name text, p_category uuid, p_cost_center uuid default null, p_supplier text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  l statement_lines%rowtype;
  v_payable uuid;
  v_settlement uuid;
  v_id uuid;
begin
  select * into l from statement_lines where id = p_line for update;
  if not found then raise exception 'not_found'; end if;
  if l.status in ('reconciled','ignored') then raise exception 'line_not_pending'; end if;
  if l.amount_cents > 0 then raise exception 'sign_mismatch'; end if;
  insert into payables (org_id, name, supplier_name, bank_account_id, category_id, cost_center_id, due_date, amount_cents)
  values (l.org_id, coalesce(nullif(trim(p_name), ''), left(l.description, 120), 'Despesa'), nullif(trim(p_supplier), ''),
          l.bank_account_id, p_category, p_cost_center, l.posted_on, abs(l.amount_cents))
  returning id into v_payable;
  insert into settlements (org_id, payable_id, paid_on, amount_cents, method, source, created_by)
  values (l.org_id, v_payable, l.posted_on, abs(l.amount_cents), 'transfer', 'reconciliation', auth.uid())
  returning id into v_settlement;
  insert into reconciliations (org_id, statement_line_id, target_type, target_id, amount_cents, matched_by,
                               created_settlement_id, created_payable_id)
  values (l.org_id, l.id, 'payable', v_payable, l.amount_cents, auth.uid(), v_settlement, v_payable)
  returning id into v_id;
  update statement_lines set status = 'reconciled' where id = l.id;
  return v_id;
end $$;

-- Credit with nothing in the books (other income): create a receivable already received.
create or replace function income_from_line(p_line uuid, p_name text, p_category uuid, p_customer uuid default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  l statement_lines%rowtype;
  v_rec uuid;
  v_settlement uuid;
  v_id uuid;
begin
  select * into l from statement_lines where id = p_line for update;
  if not found then raise exception 'not_found'; end if;
  if l.status in ('reconciled','ignored') then raise exception 'line_not_pending'; end if;
  if l.amount_cents < 0 then raise exception 'sign_mismatch'; end if;
  insert into receivables (org_id, name, customer_id, bank_account_id, category_id, due_date, issue_date, amount_cents, method)
  values (l.org_id, coalesce(nullif(trim(p_name), ''), left(l.description, 120), 'Receita'), p_customer, l.bank_account_id,
          p_category, l.posted_on, l.posted_on, l.amount_cents, 'transfer')
  returning id into v_rec;
  insert into settlements (org_id, receivable_id, paid_on, amount_cents, method, source, created_by)
  values (l.org_id, v_rec, l.posted_on, l.amount_cents, 'transfer', 'reconciliation', auth.uid())
  returning id into v_settlement;
  insert into reconciliations (org_id, statement_line_id, target_type, target_id, amount_cents, matched_by,
                               created_settlement_id, created_receivable_id)
  values (l.org_id, l.id, 'receivable', v_rec, l.amount_cents, auth.uid(), v_settlement, v_rec)
  returning id into v_id;
  update statement_lines set status = 'reconciled' where id = l.id;
  return v_id;
end $$;

-- Money moved between two of the company's own accounts.
create or replace function transfer_from_line(p_line uuid, p_other_account uuid)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  l statement_lines%rowtype;
  v_transfer uuid;
  v_id uuid;
begin
  select * into l from statement_lines where id = p_line for update;
  if not found then raise exception 'not_found'; end if;
  if l.status in ('reconciled','ignored') then raise exception 'line_not_pending'; end if;
  if p_other_account = l.bank_account_id then raise exception 'same_account'; end if;
  if not exists (select 1 from bank_accounts where id = p_other_account and org_id = l.org_id) then raise exception 'target_not_found'; end if;
  insert into transfers (org_id, from_account_id, to_account_id, amount_cents, transferred_on, notes)
  values (l.org_id,
          case when l.amount_cents < 0 then l.bank_account_id else p_other_account end,
          case when l.amount_cents < 0 then p_other_account else l.bank_account_id end,
          abs(l.amount_cents), l.posted_on, left(l.description, 200))
  returning id into v_transfer;
  insert into reconciliations (org_id, statement_line_id, target_type, target_id, amount_cents, matched_by, created_transfer_id)
  values (l.org_id, l.id, 'transfer', v_transfer, l.amount_cents, auth.uid(), v_transfer)
  returning id into v_id;
  update statement_lines set status = 'reconciled' where id = l.id;
  return v_id;
end $$;

-- Undo: reverses exactly what the reconciliation created; the line goes back to pending.
create or replace function undo_reconciliation(p_line uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  r reconciliations%rowtype;
begin
  select * into r from reconciliations where statement_line_id = p_line and undone_at is null for update;
  if not found then raise exception 'not_reconciled'; end if;
  if r.created_settlement_id is not null then
    update settlements set reversed_at = now(), reversed_by = auth.uid() where id = r.created_settlement_id and reversed_at is null;
  end if;
  if r.created_payable_id is not null then
    update payables set status = 'cancelled' where id = r.created_payable_id;
  end if;
  if r.fee_payable_id is not null then
    update settlements set reversed_at = now(), reversed_by = auth.uid() where payable_id = r.fee_payable_id and reversed_at is null;
    update payables set status = 'cancelled' where id = r.fee_payable_id;
  end if;
  if r.created_transfer_id is not null then
    delete from transfers where id = r.created_transfer_id;
  end if;
  if r.created_receivable_id is not null then
    update receivables set status = 'cancelled' where id = r.created_receivable_id;
  end if;
  update reconciliations set undone_at = now() where id = r.id;
  update statement_lines set status = 'pending' where id = p_line;
end $$;

-- Asaas statement lines carry the payment id: match them to the webhook receipts in one go.
-- Net amounts (gross minus Asaas fee) are reconciled with the fee recorded as an expense.
create or replace function auto_reconcile_provider_lines(p_org uuid)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  l record;
  v_set uuid;
  v_gross bigint;
  v_n int := 0;
begin
  for l in
    select sl.* from statement_lines sl
     where sl.org_id = p_org and sl.status in ('pending','suggested') and sl.provider_payment_id is not null and sl.amount_cents > 0
  loop
    select s.id, s.amount_cents + s.interest_cents into v_set, v_gross
      from settlements s join charges ch on ch.id = s.charge_id
     where ch.org_id = p_org and ch.asaas_payment_id = l.provider_payment_id and s.reversed_at is null
       and not settlement_is_reconciled(s.id)
     limit 1;
    if v_set is null then continue; end if;
    if l.amount_cents = v_gross then
      perform reconcile_line(l.id, 'settlement', v_set, null);
      v_n := v_n + 1;
    elsif l.amount_cents < v_gross and v_gross - l.amount_cents <= greatest(1000, v_gross * 0.1) then
      perform reconcile_line(l.id, 'settlement', v_set, 'fee');
      v_n := v_n + 1;
    end if;
    v_set := null;
  end loop;
  return v_n;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function settlement_is_reconciled(uuid) from public, anon;
    revoke execute on function suggest_matches(uuid) from public, anon;
    revoke execute on function reconcile_line(uuid, text, uuid, text) from public, anon;
    revoke execute on function expense_from_line(uuid, text, uuid, uuid, text) from public, anon;
    revoke execute on function income_from_line(uuid, text, uuid, uuid) from public, anon;
    revoke execute on function transfer_from_line(uuid, uuid) from public, anon;
    revoke execute on function undo_reconciliation(uuid) from public, anon;
    revoke execute on function auto_reconcile_provider_lines(uuid) from public, anon;
    grant execute on function settlement_is_reconciled(uuid), suggest_matches(uuid), reconcile_line(uuid, text, uuid, text),
      expense_from_line(uuid, text, uuid, uuid, text), income_from_line(uuid, text, uuid, uuid), transfer_from_line(uuid, uuid),
      undo_reconciliation(uuid), auto_reconcile_provider_lines(uuid) to authenticated;
  end if;
end $$;
