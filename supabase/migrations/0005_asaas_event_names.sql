-- Event names aligned with Asaas's documented list: cash undo, restore, partial refund.
create or replace function apply_asaas_event(p_org uuid, p_event jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_event_id text := p_event->>'id';
  v_type text := p_event->>'event';
  v_pay jsonb := p_event->'payment';
  v_evt uuid;
  v_charge charges%rowtype;
  v_rec receivables%rowtype;
  v_value bigint;
  v_principal bigint;
  v_paid_on date;
  v_open bigint;
begin
  if v_event_id is null or v_type is null then raise exception 'invalid_event'; end if;

  insert into webhook_events (org_id, event_id, event_type, payload)
  values (p_org, v_event_id, v_type, p_event)
  on conflict (provider, event_id) do nothing
  returning id into v_evt;
  if v_evt is null then return 'duplicate'; end if;

  if v_pay is null then
    update webhook_events set processed_at = now() where id = v_evt;
    return 'ignored';
  end if;

  select * into v_charge from charges
   where org_id = p_org and provider = 'asaas' and asaas_payment_id = v_pay->>'id'
   for update;
  if not found then
    update webhook_events set processed_at = now(), error = 'unknown_charge' where id = v_evt;
    return 'unknown_charge';
  end if;

  v_value := round((v_pay->>'value')::numeric * 100);
  v_paid_on := coalesce((v_pay->>'clientPaymentDate')::date, (v_pay->>'paymentDate')::date,
                        (v_pay->>'confirmedDate')::date, (now() at time zone 'America/Sao_Paulo')::date);

  if v_type in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH') then
    update charges set
      status = case when v_type = 'PAYMENT_CONFIRMED' and status <> 'received' then 'confirmed' else 'received' end,
      confirmed_at = coalesce(confirmed_at, now()),
      received_at = case when v_type <> 'PAYMENT_CONFIRMED' then coalesce(received_at, now()) else received_at end,
      net_value_cents = coalesce(round((v_pay->>'netValue')::numeric * 100), net_value_cents),
      last_event_at = now(), updated_at = now()
     where id = v_charge.id;

    if not exists (select 1 from settlements where charge_id = v_charge.id and reversed_at is null) then
      select * into v_rec from receivables where id = v_charge.receivable_id for update;
      v_open := v_rec.amount_cents - v_rec.paid_cents;
      v_principal := least(v_value, v_open);
      if v_principal > 0 then
        insert into settlements (org_id, receivable_id, paid_on, amount_cents, interest_cents, method,
                                 source, charge_id, webhook_event_id)
        values (p_org, v_rec.id, v_paid_on, v_principal, greatest(v_value - v_principal, 0),
                case v_charge.billing_type when 'BOLETO' then 'boleto' when 'CREDIT_CARD' then 'credit_card' else 'pix' end,
                'asaas_webhook', v_charge.id, v_evt);
      end if;
    end if;

  elsif v_type = 'PAYMENT_OVERDUE' then
    update charges set status = 'overdue', last_event_at = now(), updated_at = now()
     where id = v_charge.id and status = 'pending';

  elsif v_type in ('PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED') then
    update charges set status = case when v_type = 'PAYMENT_REFUNDED' then 'refunded' else 'chargeback' end,
           last_event_at = now(), updated_at = now()
     where id = v_charge.id;
    update settlements set reversed_at = now()
     where charge_id = v_charge.id and reversed_at is null;

  elsif v_type = 'PAYMENT_RECEIVED_IN_CASH_UNDONE' then
    -- a cash receipt marked in Asaas was undone: the charge is open again
    update charges set status = 'pending', received_at = null, confirmed_at = null, last_event_at = now(), updated_at = now()
     where id = v_charge.id;
    update settlements set reversed_at = now()
     where charge_id = v_charge.id and reversed_at is null;

  elsif v_type = 'PAYMENT_PARTIALLY_REFUNDED' then
    -- keep the receipt; flag for a person to adjust the título
    update charges set last_event_at = now(), updated_at = now() where id = v_charge.id;
    update webhook_events set processed_at = now(), error = 'partial_refund_needs_review' where id = v_evt;
    return 'needs_review';

  elsif v_type = 'PAYMENT_DELETED' then
    update charges set status = 'cancelled', last_event_at = now(), updated_at = now()
     where id = v_charge.id and status in ('pending','overdue');

  elsif v_type = 'PAYMENT_RESTORED' then
    update charges set status = 'pending', last_event_at = now(), updated_at = now()
     where id = v_charge.id and status = 'cancelled'
       and not exists (select 1 from charges c2 where c2.receivable_id = v_charge.receivable_id
                         and c2.id <> v_charge.id and c2.status not in ('cancelled','refunded'));

  else
    update webhook_events set processed_at = now() where id = v_evt;
    return 'ignored';
  end if;

  update webhook_events set processed_at = now() where id = v_evt;
  return 'applied';
end $$;

revoke execute on function apply_asaas_event(uuid, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function apply_asaas_event(uuid, jsonb) from anon, authenticated;
    grant execute on function apply_asaas_event(uuid, jsonb) to service_role;
  end if;
end $$;
