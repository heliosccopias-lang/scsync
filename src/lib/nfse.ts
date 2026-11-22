/** NFS-e rules shared by screens, webhook and tests. Pure. */
import type { AsaasInvoiceTaxes } from "./asaas";

export type NfseSettings = {
  service_id?: string | null;
  service_code?: string | null;
  service_name?: string | null;
  iss?: number;
  retain_iss?: boolean;
  simples?: boolean;
  pis?: number;
  cofins?: number;
  csll?: number;
  inss?: number;
  ir?: number;
  pis_cofins_tax_status?: string | null;
  auto?: "off" | "on_payment";
  observations?: string | null;
};

export const INVOICE_STATUS: Record<string, [string, string]> = {
  scheduled: ["Agendada", "pill-open"],
  synchronized: ["Enviada à prefeitura", "pill-partial"],
  authorized: ["Emitida", "pill-paid"],
  processing_cancellation: ["Cancelando", "pill-partial"],
  canceled: ["Cancelada", "pill-neutral"],
  cancellation_denied: ["Cancelamento negado", "pill-overdue"],
  error: ["Erro", "pill-overdue"],
};

export const FINAL_STATUSES = new Set(["authorized", "canceled", "error", "cancellation_denied"]);

/** Asaas status (SCHEDULED…) → ours (scheduled…). */
export function mapInvoiceStatus(s: string | null | undefined): string {
  const v = String(s ?? "").toLowerCase();
  return v in INVOICE_STATUS ? v : "scheduled";
}

/** What is missing before a company can issue. */
export function nfseReady(s: NfseSettings | null | undefined): string | null {
  if (!s) return "Configure a nota fiscal em Configurações → Nota fiscal.";
  if (!s.service_id && !s.service_code) return "Escolha o serviço municipal em Configurações → Nota fiscal.";
  if (!s.service_name) return "Informe o nome do serviço em Configurações → Nota fiscal.";
  if (s.iss === undefined || s.iss === null || Number.isNaN(Number(s.iss))) return "Informe a alíquota de ISS em Configurações → Nota fiscal.";
  return null;
}

/** Taxes block. Simples Nacional sends PIS/COFINS/CSLL as zero (Asaas rejects them for Simples issuers). */
export function invoiceTaxes(s: NfseSettings): AsaasInvoiceTaxes {
  const n = (v: unknown) => Math.max(0, Number(v ?? 0) || 0);
  const taxes: AsaasInvoiceTaxes = {
    retainIss: !!s.retain_iss,
    iss: n(s.iss),
    inss: n(s.inss),
    ir: n(s.ir),
    pis: s.simples === false ? n(s.pis) : 0,
    cofins: s.simples === false ? n(s.cofins) : 0,
    csll: s.simples === false ? n(s.csll) : 0,
  };
  if (s.simples === false) taxes.pisCofinsTaxStatus = s.pis_cofins_tax_status || "STANDARD_TAXABLE_OPERATION";
  return taxes;
}

/**
 * NFS-e covers services only: the OS services, with the OS discount split in proportion to services/products.
 */
export function serviceValueOfOrder(servicesCents: number, productsCents: number, discountCents: number): number {
  const gross = servicesCents + productsCents;
  if (gross <= 0 || servicesCents <= 0) return 0;
  return Math.max(0, servicesCents - Math.round((discountCents * servicesCents) / gross));
}

/** "OS 12 — 2 un Cartão de visita; 1 un Arte final". Max 900 characters. */
export function describeOrder(number: number | string, items: { kind: string; description: string; quantity: number; unit?: string | null }[]): string {
  const services = items.filter((i) => i.kind === "service");
  const fmtQ = (q: number) => (Number.isInteger(q) ? String(q) : String(q).replace(".", ","));
  const list = services.map((i) => `${fmtQ(Number(i.quantity))} ${i.unit || "un"} ${i.description}`).join("; ");
  return `Ordem de serviço nº ${number}${list ? ` — ${list}` : ""}`.slice(0, 900);
}
