"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { parseBRL } from "@/lib/money";
import { NfseError, cancelInvoice, issueInvoice, refreshInvoice } from "@/lib/nfse-db";

function go(path: string, key: "error" | "ok", msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}

export async function issue(form: FormData) {
  const ctx = await requireOrg();
  const osId = String(form.get("service_order_id") ?? "") || null;
  const back = osId ? `/notas/nova?os=${osId}` : "/notas/nova";
  if (!ctx.can("fiscal.issue")) go(back, "error", "Seu perfil não emite notas.");
  const customerId = String(form.get("customer_id") ?? "");
  const value = parseBRL(String(form.get("value") ?? ""));
  const deductions = parseBRL(String(form.get("deductions") ?? "") || "0");
  const description = String(form.get("description") ?? "").trim();
  if (!customerId) go(back, "error", "Escolha o cliente (tomador do serviço).");
  if (!value || value <= 0) go(back, "error", "Informe o valor da nota.");
  if (deductions === null || deductions > value) go(back, "error", "Deduções inválidas.");
  if (!description) go(back, "error", "Descreva o serviço prestado.");
  try {
    const r = await issueInvoice(ctx.sb, ctx.orgId, {
      customerId,
      serviceOrderId: osId,
      valueCents: value,
      deductionsCents: deductions,
      description,
      observations: String(form.get("observations") ?? ""),
      effectiveDate: String(form.get("effective_date") ?? "") || undefined,
    });
    go(
      osId ? `/os/${osId}` : "/notas",
      "ok",
      r.status === "authorized" ? "Nota fiscal emitida." : "Nota enviada para emissão. A prefeitura costuma responder em alguns minutos; o número e o PDF aparecem aqui sozinhos.",
    );
  } catch (e) {
    if (e instanceof NfseError) go(back, "error", `Não foi possível emitir: ${e.message}`);
    throw e;
  }
}

export async function refresh(form: FormData) {
  const ctx = await requireOrg();
  const back = String(form.get("back") ?? "/notas");
  await refreshInvoice(ctx.orgId, String(form.get("id")));
  go(back, "ok", "Situação atualizada.");
}

export async function cancel(form: FormData) {
  const ctx = await requireOrg();
  const back = String(form.get("back") ?? "/notas");
  if (!ctx.can("fiscal.issue")) go(back, "error", "Seu perfil não cancela notas.");
  try {
    await cancelInvoice(ctx.orgId, String(form.get("id")));
  } catch (e) {
    if (e instanceof NfseError) go(back, "error", e.message);
    throw e;
  }
  go(back, "ok", "Cancelamento pedido à prefeitura.");
}
