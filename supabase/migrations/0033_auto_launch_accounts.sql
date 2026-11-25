-- 0033: accounts are launched automatically, and an OS stays editable until money or a charge is involved.
--
-- Before: "Lançar contas" was a manual step and, once launched, the OS items were frozen.
-- Now:    sync_os_accounts() launches (or re-launches) the receivables whenever the OS is saved, edited,
--         approved or reopened, and cancels them when the OS is cancelled. The OS is only frozen when
--         os_financial_lock() is true: a payment was received, a Pix/boleto charge or a card-machine
--         charge is live, the receivable was grouped, or a service invoice (NFS-e) was issued.

create or replace function os_financial_lock(p_os uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (
    select 1
      from receivables r
     where r.origin_type = 'service_order' and r.origin_id = p_os and r.status <> 'cancelled'
       and (
         r.paid_cents > 0
         or r.status in ('partial', 'paid', 'grouped')
         or exists (select 1 from charges c where c.receivable_id = r.id
                     and c.status in ('pending', 'overdue', 'confirmed', 'received', 'chargeback'))
         or exists (select 1 from pos_charges pc where pc.receivable_id = r.id and pc.status in ('pending', 'paid'))
       )
  )
  or exists (
    select 1 from service_invoices si
     where si.service_order_id = p_os and si.status not in ('canceled', 'error')
  );
$$;

-- Items and totals can change while nothing was charged or paid (the receivables follow).
create or replace function guard_items_before_launch() returns trigger
language plpgsql set search_path = public as $$
declare
  v_os uuid := coalesce(new.service_order_id, old.service_order_id);
begin
  if os_financial_lock(v_os) then raise exception 'locked_by_payment'; end if;
  return coalesce(new, old);
end $$;

create or replace function guard_totals_before_launch() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.services_cents, new.products_cents, new.expenses_cents, new.discount_cents)
       is distinct from (old.services_cents, old.products_cents, old.expenses_cents, old.discount_cents)
     and os_financial_lock(new.id) then
    raise exception 'locked_by_payment';
  end if;
  return new;
end $$;

/*
 * Brings the OS receivables in line with the OS. Returns what it did:
 *   launched | relaunched | unchanged | cancelled | locked | skipped_quote | skipped_<reason>
 * Never raises for business reasons, so a save never fails because of it.
 */
create or replace function sync_os_accounts(p_service_order uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_os service_orders%rowtype;
  v_n int;
  v_sum bigint;
  v_r record;
begin
  select * into v_os from service_orders where id = p_service_order for update;
  if not found then return 'not_found'; end if;
  if not has_perm(v_os.org_id, 'os.edit') then raise exception 'permission_denied'; end if;

  if os_financial_lock(v_os.id) then return 'locked'; end if;

  -- Drop the current (untouched) receivables: delete them, or cancel the ones an old charge/invoice still points to.
  if v_os.accounts_launched_at is not null then
    for v_r in select id from receivables
                where origin_type = 'service_order' and origin_id = v_os.id and status <> 'cancelled' loop
      if exists (select 1 from charges where receivable_id = v_r.id)
         or exists (select 1 from pos_charges where receivable_id = v_r.id)
         or exists (select 1 from settlements where receivable_id = v_r.id)
         or exists (select 1 from service_invoices where receivable_id = v_r.id)
         or exists (select 1 from reconciliations where created_receivable_id = v_r.id) then
        update receivables set status = 'cancelled', installment_id = null, updated_at = now() where id = v_r.id;
      else
        delete from receivables where id = v_r.id;
      end if;
    end loop;
    update service_orders set accounts_launched_at = null where id = v_os.id;
  end if;

  if v_os.status = 'cancelled' then
    return case when v_os.accounts_launched_at is not null then 'cancelled' else 'skipped_cancelled' end;
  end if;
  if v_os.kind = 'quote' then return 'skipped_quote'; end if;
  if v_os.total_cents <= 0 then return 'skipped_no_total'; end if;
  select count(*), coalesce(sum(amount_cents), 0) into v_n, v_sum from service_order_installments where service_order_id = v_os.id;
  if v_n = 0 then return 'skipped_no_installments'; end if;
  if v_sum <> v_os.total_cents then return 'skipped_installments_mismatch'; end if;
  if v_os.bank_account_id is null then return 'skipped_bank_account'; end if;

  perform launch_accounts(v_os.id);
  return case when v_os.accounts_launched_at is not null then 'relaunched' else 'launched' end;
end $$;
revoke execute on function sync_os_accounts(uuid) from public, anon;
grant execute on function sync_os_accounts(uuid) to authenticated;
grant execute on function os_financial_lock(uuid) to authenticated;
