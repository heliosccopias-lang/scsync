"use server";

import { redirect } from "next/navigation";
import { AsaasError } from "@/lib/asaas";
import { deleteAttachment } from "@/lib/attachments";
import { onlyDigits, isValidCpfCnpj } from "@/lib/br";
import { asaasFor, createChargeForReceivable, syncChargeFromAsaas } from "@/lib/charges";
import { parseBRL, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { readPrintSpec } from "@/lib/grafica";

/** `id` is an OS id, or a path starting with "/" when the same action is used from another screen (e.g. /receber/<id>). */
function back(id: string, key: "error" | "ok", msg: string): never {
  const base = id.startsWith("/") && !id.startsWith("//") ? id : `/os/${id}`;
  redirect(`${base}?${key}=${encodeURIComponent(msg)}`);
}

const ERRORS: Record<string, string> = {
  already_launched: "As contas desta OS já foram lançadas.",
  no_installments: "A OS não tem parcelas.",
  installments_sum_mismatch: "A soma das parcelas não bate com o total da OS.",
  cancelled: "OS cancelada.",
  is_quote: "Isto é um orçamento: aprove e converta em OS antes de lançar as contas.",
};

export async function launch(form: FormData) {
  const id = String(form.get("id"));
  const { sb } = await requireOrg();
  const { error } = await sb.rpc("launch_accounts", { p_service_order: id });
  if (error) back(id, "error", ERRORS[error.message.split(":")[0]] ?? "Não foi possível lançar as contas.");
  back(id, "ok", "Contas lançadas em contas a receber.");
}

export async function charge(form: FormData) {
  const id = String(form.get("id"));
  const { sb, orgId } = await requireOrg();
  try {
    await createChargeForReceivable(sb, orgId, String(form.get("receivable_id")));
  } catch (e) {
    back(id, "error", e instanceof Error ? e.message : "Falha ao gerar a cobrança.");
  }
  back(id, "ok", "Cobrança criada no Asaas. Agora é só enviar ao cliente.");
}

export async function refresh(form: FormData) {
  const id = String(form.get("id"));
  const paymentId = String(form.get("asaas_payment_id"));
  const { sb, orgId } = await requireOrg();
  const { data: own } = await sb.from("charges").select("id").eq("org_id", orgId).eq("asaas_payment_id", paymentId).maybeSingle();
  if (!own) back(id, "error", "Cobrança não encontrada.");
  const asaas = await asaasFor(orgId);
  if (!asaas) back(id, "error", "Asaas não conectado.");
  await syncChargeFromAsaas(orgId, asaas, paymentId);
  back(id, "ok", "Situação atualizada com o Asaas.");
}

export async function setStatus(form: FormData) {
  const id = String(form.get("id"));
  const { sb, orgId } = await requireOrg();
  const { error } = await sb
    .from("service_orders")
    .update({ status: String(form.get("status")), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) back(id, "error", "Status inválido.");
  back(id, "ok", "Status atualizado.");
}

/** Card machine, cash or a Pix straight to the company's account: settle by hand. */
export async function receiveManual(form: FormData) {
  const id = String(form.get("id"));
  const receivableId = String(form.get("receivable_id"));
  const method = String(form.get("method"));
  const { sb, orgId, user } = await requireOrg();

  if (!["debit_card", "credit_card", "cash", "pix", "transfer"].includes(method)) back(id, "error", "Escolha a forma de recebimento.");

  const { data: rec } = await sb
    .from("receivables")
    .select("id, amount_cents, paid_cents, status")
    .eq("id", receivableId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!rec) back(id, "error", "Título não encontrado.");
  if (rec.status === "paid" || rec.status === "cancelled") back(id, "error", "Este título já está quitado.");

  const open = rec.amount_cents - rec.paid_cents;
  const amount = parseBRL(String(form.get("amount") ?? "")) ?? open;
  if (amount <= 0) back(id, "error", "Valor recebido inválido.");
  if (amount > open) back(id, "error", "O valor é maior que o saldo em aberto deste título.");
  const paidOn = String(form.get("paid_on") || todayInSaoPaulo());
  const cardInstallments = method === "credit_card" ? Math.max(1, Math.min(24, Number(form.get("card_installments") || 1))) : null;

  // An open Asaas charge for the same título must go, or the customer could pay twice.
  const { data: live } = await sb
    .from("charges")
    .select("id, asaas_payment_id")
    .eq("receivable_id", receivableId)
    .in("status", ["pending", "overdue"])
    .maybeSingle();
  if (live) {
    const asaas = await asaasFor(orgId);
    if (!asaas) back(id, "error", "Há uma cobrança no Asaas, mas o Asaas não está conectado para cancelá-la.");
    try {
      await asaas.deletePayment(live.asaas_payment_id);
    } catch (e) {
      await syncChargeFromAsaas(orgId, asaas, live.asaas_payment_id).catch(() => undefined);
      back(
        id,
        "error",
        e instanceof AsaasError
          ? `O Asaas não deixou cancelar a cobrança (${e.message}). Ela pode já ter sido paga: confira com "Consultar no Asaas".`
          : "Não foi possível cancelar a cobrança no Asaas.",
      );
    }
    await sb.from("charges").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", live.id);
  }

  const { error } = await sb.from("settlements").insert({
    org_id: orgId,
    receivable_id: receivableId,
    paid_on: paidOn,
    amount_cents: amount,
    method,
    source: "manual",
    reference: String(form.get("reference") ?? "").trim() || null,
    card_installments: cardInstallments,
    created_by: user.id,
  });
  if (error) back(id, "error", "Não foi possível registrar o recebimento.");
  back(id, "ok", live ? "Recebimento registrado e cobrança do Asaas cancelada." : "Recebimento registrado.");
}

export async function reverseSettlement(form: FormData) {
  const id = String(form.get("id"));
  const { sb, orgId, user } = await requireOrg();
  const { error, count } = await sb
    .from("settlements")
    .update({ reversed_at: new Date().toISOString(), reversed_by: user.id }, { count: "exact" })
    .eq("id", String(form.get("settlement_id")))
    .eq("org_id", orgId)
    .in("source", ["manual", "batch"])
    .is("reversed_at", null);
  if (error || !count) back(id, "error", "Não foi possível estornar. Recebimentos do Asaas se estornam no próprio Asaas.");
  back(id, "ok", "Recebimento estornado; o título voltou a ficar em aberto.");
}

export async function updateCustomer(form: FormData) {
  const id = String(form.get("id"));
  const customerId = String(form.get("customer_id"));
  const { sb, orgId } = await requireOrg();
  const name = String(form.get("name") ?? "").trim();
  const doc = onlyDigits(String(form.get("cpf_cnpj") ?? ""));
  const email = String(form.get("email") ?? "").trim() || null;
  const phone = String(form.get("phone") ?? "").trim() || null;
  if (!name) back(id, "error", "O nome do cliente é obrigatório.");
  if (doc && !isValidCpfCnpj(doc)) back(id, "error", "CPF/CNPJ inválido. Confira os números.");

  const { data: cust, error } = await sb
    .from("customers")
    .update({ name, cpf_cnpj: doc || null, email, phone, updated_at: new Date().toISOString() })
    .eq("id", customerId)
    .eq("org_id", orgId)
    .select("asaas_customer_id")
    .single();
  if (error) back(id, "error", error.code === "23505" ? "Já existe outro cliente com este CPF/CNPJ." : "Não foi possível salvar o cliente.");

  if (cust?.asaas_customer_id) {
    const asaas = await asaasFor(orgId);
    if (asaas) {
      await asaas
        .updateCustomer(cust.asaas_customer_id, { name, ...(doc ? { cpfCnpj: doc } : {}), email, mobilePhone: phone })
        .catch(() => undefined);
    }
  }
  back(id, "ok", "Cliente atualizado.");
}

/** Non-financial fields: allowed at any time, even after accounts are launched. */
export async function updateDetails(form: FormData) {
  const id = String(form.get("id"));
  const { sb, orgId } = await requireOrg();
  const s = (k: string) => String(form.get(k) ?? "").trim() || null;
  const delivery = s("delivery_date");
  const attendance = s("attendance_type");
  const { error } = await sb
    .from("service_orders")
    .update({
      technician_id: s("technician_id"),
      second_technician_id: s("second_technician_id"),
      delivery_date: delivery && /^\d{4}-\d{2}-\d{2}$/.test(delivery) ? delivery : null,
      attendance_type: attendance && ["internal", "external", "warranty"].includes(attendance) ? attendance : "external",
      ...readPrintSpec((k) => String(form.get(k) ?? ""), todayInSaoPaulo()),
      technical_report: s("technical_report"),
      notes: s("notes"),
      internal_notes: s("internal_notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) back(id, "error", "Não foi possível salvar os dados da OS.");
  back(id, "ok", "Dados da OS atualizados.");
}

export async function convertQuote(form: FormData) {
  const id = String(form.get("id"));
  const { sb, orgId } = await requireOrg();
  const { error, count } = await sb
    .from("service_orders")
    .update({ kind: "order", status: "approved", updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("kind", "quote");
  if (error || !count) back(id, "error", "Não foi possível converter o orçamento.");
  back(id, "ok", "Orçamento aprovado e convertido em ordem de serviço. Agora você pode lançar as contas.");
}

export async function addChecklist(form: FormData) {
  const id = String(form.get("id"));
  const { sb, orgId } = await requireOrg();
  const checklistId = String(form.get("checklist_id") ?? "");
  if (!checklistId) back(id, "error", "Escolha um checklist.");
  const { data, error } = await sb
    .from("checklist_runs")
    .insert({ org_id: orgId, checklist_id: checklistId, service_order_id: id })
    .select("id")
    .single();
  if (error || !data) back(id, "error", error?.code === "23505" ? "Este checklist já está nesta OS." : "Não foi possível incluir o checklist.");
  redirect(`/os/${id}/checklist/${data.id}`);
}

export async function removeAttachment(form: FormData) {
  const id = String(form.get("id"));
  const { sb, orgId } = await requireOrg();
  const ok = await deleteAttachment(sb, orgId, String(form.get("attachment_id")));
  if (!ok) back(id, "error", "Não foi possível remover o anexo.");
  back(id, "ok", "Anexo removido.");
}

export async function stockAction(form: FormData) {
  const id = String(form.get("id"));
  const op = form.get("op") === "reverse" ? "reverse_stock" : "launch_stock";
  const { sb } = await requireOrg();
  const { data, error } = await sb.rpc(op, { p_service_order: id });
  if (error) {
    const msg: Record<string, string> = {
      stock_already_launched: "O estoque desta OS já foi baixado.",
      no_stock_items: "Nenhum produto desta OS tem controle de estoque ligado (Cadastros → Serviços e produtos).",
      is_quote: "Orçamento não baixa estoque: converta em OS antes.",
      stock_not_launched: "O estoque desta OS não foi baixado.",
    };
    back(id, "error", msg[error.message] ?? "Não foi possível atualizar o estoque.");
  }
  back(id, "ok", op === "launch_stock" ? `Estoque baixado (${data} produto(s)).` : "Estoque devolvido.");
}
