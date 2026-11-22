import "server-only";
import { asaasFor } from "./charges";
import { AsaasError, type AsaasInvoice } from "./asaas";
import { newWebhookToken, sha256 } from "./crypto";
import { supabaseAdmin } from "./supabase";
import { invoiceTaxes, mapInvoiceStatus, nfseReady, type NfseSettings } from "./nfse";
import { todayInSaoPaulo } from "./money";
import { planAllows } from "./plans";

type Sb = Awaited<ReturnType<typeof import("./supabase").supabaseUser>> | ReturnType<typeof supabaseAdmin>;

export class NfseError extends Error {}

const reais = (c: number) => Math.round(c) / 100;

/** Webhook for invoice events (separate from the payments one), created once per company. */
export async function ensureInvoiceWebhook(orgId: string, email: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: conn } = await admin.from("asaas_connections").select("invoice_webhook_id").eq("org_id", orgId).maybeSingle();
  if (!conn || conn.invoice_webhook_id || !process.env.APP_URL) return;
  const asaas = await asaasFor(orgId);
  if (!asaas) return;
  const token = newWebhookToken();
  const url = new URL(`/api/webhooks/asaas-notas/${orgId}`, process.env.APP_URL);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);
  const hook = await asaas.createInvoiceWebhook({ url: url.toString(), email, authToken: token });
  await admin.from("asaas_connections").update({ invoice_webhook_id: hook.id, invoice_webhook_token_hash: sha256(token) }).eq("org_id", orgId);
}

/** Asaas customer for the NFS-e "tomador", with the address the city hall usually requires. */
async function asaasCustomerFor(sb: Sb, orgId: string, customerId: string): Promise<string> {
  const asaas = await asaasFor(orgId);
  if (!asaas) throw new NfseError("Conecte o Asaas da empresa antes de emitir notas.");
  const { data: c } = await sb.from("customers").select("id, name, cpf_cnpj, email, phone, address, asaas_customer_id").eq("id", customerId).eq("org_id", orgId).single();
  if (!c) throw new NfseError("Cliente não encontrado.");
  if (!c.cpf_cnpj) throw new NfseError(`Complete o CPF/CNPJ de ${c.name} no cadastro de clientes.`);
  const addr = (c.address ?? {}) as { cep?: string; number?: string; complement?: string };
  const address = addr.cep ? { postalCode: addr.cep.replace(/\D/g, ""), addressNumber: addr.number || "S/N", complement: addr.complement || null } : {};
  if (c.asaas_customer_id) {
    await asaas.updateCustomer(c.asaas_customer_id, { name: c.name, cpfCnpj: c.cpf_cnpj, email: c.email, mobilePhone: c.phone, ...address });
    return c.asaas_customer_id;
  }
  const created = await asaas.createCustomer({ name: c.name, cpfCnpj: c.cpf_cnpj, email: c.email, mobilePhone: c.phone, externalReference: c.id });
  if (addr.cep) await asaas.updateCustomer(created.id, address);
  await supabaseAdmin().from("customers").update({ asaas_customer_id: created.id }).eq("id", c.id).eq("org_id", orgId);
  return created.id;
}

export type IssueInput = {
  customerId: string;
  serviceOrderId?: string | null;
  receivableId?: string | null;
  asaasPaymentId?: string | null;
  valueCents: number;
  deductionsCents?: number;
  description: string;
  observations?: string;
  effectiveDate?: string;
  auto?: boolean;
};

/** Schedules the NFS-e on Asaas and, when it is for today, asks for it to be issued now. */
export async function issueInvoice(sb: Sb, orgId: string, input: IssueInput): Promise<{ id: string; status: string }> {
  const { data: org } = await sb.from("orgs").select("nfse").eq("id", orgId).single();
  const settings = (org?.nfse ?? {}) as NfseSettings;
  const notReady = nfseReady(settings);
  if (notReady) throw new NfseError(notReady);
  if (input.valueCents <= 0) throw new NfseError("O valor da nota precisa ser maior que zero.");
  const asaas = await asaasFor(orgId);
  if (!asaas) throw new NfseError("Conecte o Asaas da empresa antes de emitir notas.");
  const today = todayInSaoPaulo();
  const effectiveDate = input.effectiveDate && input.effectiveDate > today ? input.effectiveDate : today;
  const observations = (input.observations ?? settings.observations ?? "").slice(0, 1000);
  const taxes = invoiceTaxes(settings);

  const { data: row, error } = await sb
    .from("service_invoices")
    .insert({
      org_id: orgId,
      service_order_id: input.serviceOrderId ?? null,
      receivable_id: input.receivableId ?? null,
      customer_id: input.customerId,
      asaas_payment_id: input.asaasPaymentId ?? null,
      value_cents: input.valueCents,
      deductions_cents: input.deductionsCents ?? 0,
      effective_date: effectiveDate,
      service_description: input.description.slice(0, 900),
      observations,
      municipal_service_id: settings.service_id || null,
      municipal_service_code: settings.service_id ? null : settings.service_code || null,
      municipal_service_name: settings.service_name!,
      taxes,
      auto: !!input.auto,
    })
    .select("id")
    .single();
  if (error || !row) {
    if (error?.code === "23505") throw new NfseError("Já existe nota automática para este pagamento.");
    throw new NfseError("Não foi possível registrar a nota.");
  }

  try {
    const customer = await asaasCustomerFor(sb, orgId, input.customerId);
    let inv: AsaasInvoice = await asaas.createInvoice({
      // Linked to the payment when there is one (the invoice then shows on the Asaas charge).
      ...(input.asaasPaymentId ? { payment: input.asaasPaymentId } : { customer }),
      serviceDescription: input.description.slice(0, 900),
      observations,
      externalReference: row.id,
      value: reais(input.valueCents),
      deductions: reais(input.deductionsCents ?? 0),
      effectiveDate,
      ...(settings.service_id ? { municipalServiceId: settings.service_id } : { municipalServiceCode: settings.service_code! }),
      municipalServiceName: settings.service_name!,
      taxes,
    });
    if (effectiveDate === today) {
      try {
        inv = await asaas.authorizeInvoice(inv.id);
      } catch {
        // Stays scheduled for today; Asaas issues it on its own.
      }
    }
    await saveInvoiceState(orgId, row.id, inv);
    return { id: row.id, status: mapInvoiceStatus(inv.status) };
  } catch (e) {
    const msg = e instanceof AsaasError || e instanceof NfseError ? e.message : "Não foi possível falar com o Asaas.";
    await supabaseAdmin().from("service_invoices").update({ status: "error", status_description: msg, updated_at: new Date().toISOString() }).eq("id", row.id);
    throw new NfseError(msg);
  }
}

export async function saveInvoiceState(orgId: string, rowId: string | null, inv: AsaasInvoice): Promise<void> {
  const patch = {
    asaas_invoice_id: inv.id,
    status: mapInvoiceStatus(inv.status),
    number: inv.number ?? null,
    pdf_url: inv.pdfUrl ?? null,
    xml_url: inv.xmlUrl ?? null,
    status_description: inv.statusDescription ?? null,
    validation_code: inv.validationCode ?? null,
    updated_at: new Date().toISOString(),
  };
  const admin = supabaseAdmin();
  if (rowId) await admin.from("service_invoices").update(patch).eq("id", rowId).eq("org_id", orgId);
  else await admin.from("service_invoices").update(patch).eq("asaas_invoice_id", inv.id).eq("org_id", orgId);
}

export async function refreshInvoice(orgId: string, rowId: string): Promise<void> {
  const { data } = await supabaseAdmin().from("service_invoices").select("asaas_invoice_id").eq("id", rowId).eq("org_id", orgId).single();
  const asaas = await asaasFor(orgId);
  if (!data?.asaas_invoice_id || !asaas) return;
  await saveInvoiceState(orgId, rowId, await asaas.getInvoice(data.asaas_invoice_id));
}

export async function cancelInvoice(orgId: string, rowId: string): Promise<void> {
  const { data } = await supabaseAdmin().from("service_invoices").select("asaas_invoice_id, status").eq("id", rowId).eq("org_id", orgId).single();
  if (!data?.asaas_invoice_id) throw new NfseError("Nota não encontrada no Asaas.");
  const asaas = await asaasFor(orgId);
  if (!asaas) throw new NfseError("Conecte o Asaas da empresa.");
  try {
    await saveInvoiceState(orgId, rowId, await asaas.cancelInvoice(data.asaas_invoice_id));
  } catch (e) {
    throw new NfseError(e instanceof AsaasError ? e.message : "Não foi possível cancelar agora.");
  }
}

/**
 * Automatic issue when a payment of an OS is received (setting "on_payment"). Called after the payments webhook;
 * failures are recorded on the invoice row and never break the payment flow.
 */
export async function autoIssueForPayment(orgId: string, asaasPaymentId: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: org } = await admin.from("orgs").select("nfse, modules, accounts(plan, status)").eq("id", orgId).single();
  const settings = (org?.nfse ?? {}) as NfseSettings;
  const acc = org?.accounts as unknown as { plan: string; status: string } | null;
  if (settings.auto !== "on_payment" || (org?.modules as Record<string, boolean>)?.nfse === false || nfseReady(settings)) return;
  if (!planAllows(acc?.plan, acc?.status ?? "trial", "nfse")) return;
  const { data: charge } = await admin.from("charges").select("receivable_id, value_cents").eq("org_id", orgId).eq("asaas_payment_id", asaasPaymentId).maybeSingle();
  if (!charge) return;
  const { data: rec } = await admin.from("receivables").select("id, customer_id, origin_type, origin_id, name").eq("id", charge.receivable_id).single();
  if (!rec?.customer_id) return;
  let description = rec.name as string;
  if (rec.origin_type === "service_order" && rec.origin_id) {
    const { data: os } = await admin.from("service_orders").select("number").eq("id", rec.origin_id).single();
    if (os) description = `Ordem de serviço nº ${os.number} — ${rec.name}`;
  }
  try {
    await issueInvoice(admin, orgId, {
      customerId: rec.customer_id,
      serviceOrderId: rec.origin_type === "service_order" ? rec.origin_id : null,
      receivableId: rec.id,
      asaasPaymentId,
      valueCents: Number(charge.value_cents),
      description,
      auto: true,
    });
  } catch (e) {
    console.error("auto nfse failed", { orgId, asaasPaymentId, error: e instanceof Error ? e.message : e });
  }
}
