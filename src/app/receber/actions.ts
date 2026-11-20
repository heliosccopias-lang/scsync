"use server";

import { redirect } from "next/navigation";
import { addMonths, parseBRL, splitInstallments, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";

function back(path: string, key: "error" | "ok", msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}

const METHODS = ["pix", "boleto", "credit_card", "debit_card", "cash", "transfer", "other"];

/** Manual título (not from an OS) for receivables or payables, optionally split in monthly installments. */
export async function createTitle(form: FormData) {
  const kind = form.get("kind") === "payable" ? "payable" : "receivable";
  const path = kind === "payable" ? "/pagar" : "/receber";
  const { sb, orgId } = await requireOrg();
  const name = String(form.get("name") ?? "").trim();
  const total = parseBRL(String(form.get("amount") ?? ""));
  const due = String(form.get("due_date") || todayInSaoPaulo());
  const n = Math.max(1, Math.min(48, Number(form.get("installments") || 1)));
  const method = METHODS.includes(String(form.get("method"))) ? String(form.get("method")) : kind === "payable" ? "transfer" : "pix";
  if (!name) back(path, "error", "Informe a descrição.");
  if (total === null || total <= 0) back(path, "error", "Valor inválido. Use, por exemplo, 150,00.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) back(path, "error", "Vencimento inválido.");

  const { data: bank } = await sb
    .from("bank_accounts")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", String(form.get("bank_account_id") || "00000000-0000-0000-0000-000000000000"))
    .maybeSingle();
  const { data: fallback } = bank ? { data: bank } : await sb.from("bank_accounts").select("id").eq("org_id", orgId).eq("kind", "asaas").maybeSingle();
  if (!fallback) back(path, "error", "Cadastre uma conta bancária primeiro.");

  const parts = splitInstallments(total, n);
  const common = {
    org_id: orgId,
    bank_account_id: fallback.id,
    category_id: String(form.get("category_id") || "") || null,
    cost_center_id: String(form.get("cost_center_id") || "") || null,
    notes: String(form.get("notes") ?? "").trim() || null,
  };
  const rows = parts.map((amount, i) => ({
    ...common,
    name: n > 1 ? `${name} - parcela ${i + 1}/${n}` : name,
    due_date: addMonths(due, i),
    amount_cents: amount,
    ...(kind === "receivable"
      ? { customer_id: String(form.get("customer_id") || "") || null, method, origin_type: "manual" }
      : { supplier_name: String(form.get("supplier") ?? "").trim() || null }),
  }));
  const { error } = await sb.from(kind === "payable" ? "payables" : "receivables").insert(rows);
  if (error) back(path, "error", "Não foi possível salvar.");
  back(path, "ok", n > 1 ? `${n} parcelas lançadas.` : "Conta lançada.");
}

export async function settleSelected(form: FormData) {
  const kind = form.get("kind") === "payable" ? "payable" : "receivable";
  const path = String(form.get("return_to") || (kind === "payable" ? "/pagar" : "/receber"));
  const ids = form.getAll("ids").map(String);
  if (!ids.length) back(path, "error", "Marque as contas que foram pagas.");
  const method = METHODS.includes(String(form.get("method"))) ? String(form.get("method")) : "cash";
  const paidOn = String(form.get("paid_on") || todayInSaoPaulo());
  const { sb } = await requireOrg();
  const { data, error } = await sb.rpc("settle_batch", { p_kind: kind, p_ids: ids, p_paid_on: paidOn, p_method: method });
  if (error) back(path, "error", "Não foi possível dar baixa.");
  back(path, "ok", `${data} conta(s) baixada(s) pelo valor em aberto.`);
}

export async function payOne(form: FormData) {
  const path = String(form.get("return_to") || "/pagar");
  const { sb, orgId, user } = await requireOrg();
  const { data: p } = await sb.from("payables").select("id, amount_cents, paid_cents, status").eq("id", String(form.get("id"))).eq("org_id", orgId).maybeSingle();
  if (!p || !["open", "partial"].includes(p.status)) back(path, "error", "Conta não está em aberto.");
  const open = p.amount_cents - p.paid_cents;
  const amount = parseBRL(String(form.get("amount") ?? "")) ?? open;
  if (amount <= 0 || amount > open) back(path, "error", "Valor pago inválido.");
  const method = METHODS.includes(String(form.get("method"))) ? String(form.get("method")) : "transfer";
  const { error } = await sb.from("settlements").insert({
    org_id: orgId,
    payable_id: p.id,
    paid_on: String(form.get("paid_on") || todayInSaoPaulo()),
    amount_cents: amount,
    method,
    source: "manual",
    created_by: user.id,
  });
  if (error) back(path, "error", "Não foi possível registrar o pagamento.");
  back(path, "ok", "Pagamento registrado.");
}

export async function cancelTitle(form: FormData) {
  const kind = form.get("kind") === "payable" ? "payable" : "receivable";
  const path = String(form.get("return_to") || (kind === "payable" ? "/pagar" : "/receber"));
  const { sb, orgId } = await requireOrg();
  const table = kind === "payable" ? "payables" : "receivables";
  const { data: t } = await sb
    .from(table)
    .select(kind === "receivable" ? "id, paid_cents, status, origin_type" : "id, paid_cents, status")
    .eq("id", String(form.get("id")))
    .eq("org_id", orgId)
    .maybeSingle<{ id: string; paid_cents: number; status: string; origin_type?: string }>();
  if (!t) back(path, "error", "Conta não encontrada.");
  if (t.origin_type === "service_order") back(path, "error", "Esta parcela é de uma OS: cancele a OS em vez da parcela.");
  if (t.paid_cents > 0) back(path, "error", "Esta conta tem pagamento registrado: estorne antes de cancelar.");
  if (kind === "receivable") {
    const { data: live } = await sb.from("charges").select("id").eq("receivable_id", t.id).in("status", ["pending", "overdue"]).maybeSingle();
    if (live) back(path, "error", "Há cobrança aberta no Asaas: cancele-a antes (receba manualmente ou consulte no Asaas).");
  }
  const { error } = await sb.from(table).update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", t.id);
  if (error) back(path, "error", "Não foi possível cancelar.");
  back(path, "ok", "Conta cancelada.");
}
