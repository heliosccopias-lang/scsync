import "server-only";
import { AsaasClient, billingTypeFor, type AsaasEnvironment, type AsaasPayment } from "./asaas";
import { decryptSecret } from "./crypto";
import { ASAAS_MIN_CHARGE_CENTS } from "./constants";
import { centsToReais, formatBRL } from "./money";
import { supabaseAdmin } from "./supabase";

type UserClient = Awaited<ReturnType<typeof import("./supabase").supabaseUser>>;

export async function asaasFor(orgId: string): Promise<AsaasClient | null> {
  const { data } = await supabaseAdmin()
    .from("asaas_connections")
    .select("environment, api_key_encrypted")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) return null;
  return new AsaasClient(decryptSecret(data.api_key_encrypted), data.environment as AsaasEnvironment);
}

/** Creates the Asaas cobrança for one receivable. The user client enforces that the receivable is theirs. */
export async function createChargeForReceivable(sb: UserClient, orgId: string, receivableId: string) {
  const { data: rec, error } = await sb
    .from("receivables")
    .select("id, name, due_date, amount_cents, paid_cents, method, status, customer_id, customers(id, name, cpf_cnpj, email, phone, asaas_customer_id)")
    .eq("id", receivableId)
    .eq("org_id", orgId)
    .single();
  if (error || !rec) throw new Error("Título não encontrado.");
  if (rec.status === "paid" || rec.status === "cancelled") throw new Error("Este título não está em aberto.");

  const { data: live } = await sb
    .from("charges")
    .select("id")
    .eq("receivable_id", receivableId)
    .not("status", "in", "(cancelled,refunded)")
    .maybeSingle();
  if (live) throw new Error("Já existe uma cobrança ativa para este título.");

  const asaas = await asaasFor(orgId);
  if (!asaas) throw new Error("Conecte o Asaas em Configurações antes de cobrar.");

  const customer = rec.customers as unknown as {
    id: string;
    name: string;
    cpf_cnpj: string | null;
    email: string | null;
    phone: string | null;
    asaas_customer_id: string | null;
  } | null;
  if (!customer) throw new Error("O título não tem cliente.");
  if (!customer.cpf_cnpj) throw new Error("O Asaas exige CPF/CNPJ do cliente. Complete o cadastro.");

  let asaasCustomerId = customer.asaas_customer_id;
  if (!asaasCustomerId) {
    const created = await asaas.createCustomer({
      name: customer.name,
      cpfCnpj: customer.cpf_cnpj,
      email: customer.email,
      mobilePhone: customer.phone,
      externalReference: customer.id,
    });
    asaasCustomerId = created.id;
    await sb.from("customers").update({ asaas_customer_id: asaasCustomerId }).eq("id", customer.id).eq("org_id", orgId);
  }

  const openCents = rec.amount_cents - rec.paid_cents;
  if (openCents < ASAAS_MIN_CHARGE_CENTS) {
    throw new Error(
      `O Asaas só aceita cobranças a partir de ${formatBRL(ASAAS_MIN_CHARGE_CENTS)}. Esta parcela é de ${formatBRL(openCents)}: receba na maquininha ou em dinheiro.`,
    );
  }
  const billingType = billingTypeFor(rec.method);
  const payment = await asaas.createPayment({
    customer: asaasCustomerId,
    billingType,
    value: centsToReais(openCents),
    dueDate: rec.due_date,
    description: rec.name,
    externalReference: rec.id,
  });

  let pixPayload: string | null = null;
  if (billingType === "PIX" || billingType === "BOLETO" || billingType === "UNDEFINED") {
    try {
      pixPayload = (await asaas.pixQrCode(payment.id)).payload;
    } catch {
      // no Pix key on the account yet: the invoice link still works
    }
  }

  const { error: insErr } = await sb.from("charges").insert({
    org_id: orgId,
    receivable_id: rec.id,
    billing_type: billingType,
    asaas_payment_id: payment.id,
    value_cents: openCents,
    invoice_url: payment.invoiceUrl ?? null,
    bank_slip_url: payment.bankSlipUrl ?? null,
    pix_payload: pixPayload,
    due_date: rec.due_date,
  });
  if (insErr) {
    // keep Asaas and our books in step: undo the charge we could not record
    await asaas.deletePayment(payment.id).catch(() => undefined);
    throw new Error("Não foi possível registrar a cobrança.");
  }
  return payment;
}

const STATUS_EVENT: Record<string, string> = {
  RECEIVED: "PAYMENT_RECEIVED",
  RECEIVED_IN_CASH: "PAYMENT_RECEIVED",
  CONFIRMED: "PAYMENT_CONFIRMED",
  OVERDUE: "PAYMENT_OVERDUE",
  REFUNDED: "PAYMENT_REFUNDED",
};

/**
 * Safety net for lost webhooks: reads the payment from Asaas and feeds it through the same
 * idempotent database function, under a synthetic event id per (payment, status).
 */
export async function syncChargeFromAsaas(orgId: string, asaas: AsaasClient, asaasPaymentId: string) {
  const payment: AsaasPayment = await asaas.getPayment(asaasPaymentId);
  const event = STATUS_EVENT[payment.status];
  if (!event) return "ignored";
  const { data, error } = await supabaseAdmin().rpc("apply_asaas_event", {
    p_org: orgId,
    p_event: { id: `sync_${payment.id}_${payment.status}`, event, payment },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export type ChargeSyncResult = "none" | "updated" | "recreated" | "cancelled_below_min" | "failed";

/**
 * After an OS edit changed a título's amount, bring its open Asaas charge to the new value
 * (same charge, same link). If Asaas refuses the update, replace the charge with a new one.
 */
export async function syncChargeAmount(sb: UserClient, orgId: string, receivableId: string, amountCents: number, dueDate: string): Promise<ChargeSyncResult> {
  const { data: live } = await sb
    .from("charges")
    .select("id, asaas_payment_id, billing_type")
    .eq("receivable_id", receivableId)
    .eq("org_id", orgId)
    .in("status", ["pending", "overdue"])
    .maybeSingle();
  if (!live) return "none";
  const asaas = await asaasFor(orgId);
  if (!asaas) return "failed";

  const markCancelled = () =>
    sb.from("charges").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", live.id);

  if (amountCents < ASAAS_MIN_CHARGE_CENTS) {
    try {
      await asaas.deletePayment(live.asaas_payment_id);
      await markCancelled();
      return "cancelled_below_min";
    } catch {
      return "failed";
    }
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const due = dueDate < today ? today : dueDate;
  try {
    const p = await asaas.updatePayment(live.asaas_payment_id, {
      billingType: live.billing_type as AsaasPayment["billingType"],
      value: centsToReais(amountCents),
      dueDate: due,
    });
    let pixPayload: string | null = null;
    try {
      pixPayload = (await asaas.pixQrCode(live.asaas_payment_id)).payload;
    } catch {
      // no Pix key: link still works
    }
    await sb
      .from("charges")
      .update({
        value_cents: amountCents,
        due_date: due,
        invoice_url: p.invoiceUrl ?? undefined,
        bank_slip_url: p.bankSlipUrl ?? null,
        pix_payload: pixPayload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", live.id);
    return "updated";
  } catch {
    // Asaas would not change it: swap for a fresh charge
    try {
      await asaas.deletePayment(live.asaas_payment_id);
      await markCancelled();
      await createChargeForReceivable(sb, orgId, receivableId);
      return "recreated";
    } catch {
      return "failed";
    }
  }
}
