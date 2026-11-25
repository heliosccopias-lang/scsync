"use server";

import { redirect } from "next/navigation";
import { addMonths, parseBRL, splitInstallments, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { AsaasError } from "@/lib/asaas";
import { asaasFor, syncChargeFromAsaas } from "@/lib/charges";
import { cancelPosCharge } from "@/lib/pos-db";

function back(path: string, key: "error" | "ok", msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}

const METHODS = ["pix", "boleto", "credit_card", "debit_card", "cash", "transfer", "other"];

/** Manual título (not from an OS) for receivables or payables, optionally split in monthly installments. */
export async function createTitle(form: FormData) {
  const kind = form.get("kind") === "payable" ? "payable" : "receivable";
  const path = kind === "payable" ? "/pagar" : "/receber";
  const ctx = await requireOrg();
  if (!ctx.can("finance.edit")) back(path, "error", "Seu perfil não lança contas.");
  const { sb, orgId } = ctx;
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
  const ctx = await requireOrg();
  if (!ctx.can(kind === "payable" ? "finance.edit" : "finance.receive")) back(path, "error", "Seu perfil não dá baixa nessas contas.");
  const { sb } = ctx;
  const { data, error } = await sb.rpc("settle_batch", { p_kind: kind, p_ids: ids, p_paid_on: paidOn, p_method: method });
  if (error) back(path, "error", "Não foi possível dar baixa.");
  back(path, "ok", `${data} conta(s) baixada(s) pelo valor em aberto.`);
}

export async function payOne(form: FormData) {
  const path = String(form.get("return_to") || "/pagar");
  const ctx = await requireOrg();
  if (!ctx.can("finance.edit")) back(path, "error", "Seu perfil não registra pagamentos.");
  const { sb, orgId, user } = ctx;
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
  const ctx = await requireOrg();
  if (!ctx.can("finance.edit")) back(path, "error", "Seu perfil não cancela contas.");
  const { sb, orgId } = ctx;
  const table = kind === "payable" ? "payables" : "receivables";
  const { data: t } = await sb
    .from(table)
    .select(kind === "receivable" ? "id, paid_cents, status, origin_type" : "id, paid_cents, status")
    .eq("id", String(form.get("id")))
    .eq("org_id", orgId)
    .maybeSingle<{ id: string; paid_cents: number; status: string; origin_type?: string }>();
  if (!t) back(path, "error", "Conta não encontrada.");
  if (t.origin_type === "service_order") back(path, "error", "Esta parcela é de uma OS: cancele a OS em vez da parcela.");
  if (t.origin_type === "grouping") back(path, "error", "Esta é uma cobrança agrupada: use \"Desagrupar\" para devolver as contas ao aberto.");
  if (t.status === "grouped") back(path, "error", "Esta conta está numa cobrança agrupada: desagrupe antes.");
  if (t.paid_cents > 0) back(path, "error", "Esta conta tem pagamento registrado: estorne antes de cancelar.");
  if (kind === "receivable") {
    const { data: live } = await sb.from("charges").select("id").eq("receivable_id", t.id).in("status", ["pending", "overdue"]).maybeSingle();
    if (live) back(path, "error", "Há cobrança aberta no Asaas: cancele-a antes (receba manualmente ou consulte no Asaas).");
  }
  const { error } = await sb.from(table).update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", t.id);
  if (error) back(path, "error", "Não foi possível cancelar.");
  back(path, "ok", "Conta cancelada.");
}

const GROUP_ERRORS: Record<string, string> = {
  permission_denied: "Seu perfil não agrupa cobranças.",
  need_two: "Marque pelo menos duas contas do mesmo cliente para agrupar.",
  invalid_method: "Escolha a forma de cobrança do grupo.",
  due_required: "Informe o vencimento da cobrança agrupada.",
  not_found: "Alguma conta marcada não foi encontrada.",
  same_customer: "Só dá para agrupar contas do mesmo cliente. Filtre pelo cliente e marque de novo.",
  walk_in_customer: "Contas de Consumidor final não podem ser agrupadas: cadastre o cliente.",
  not_open: "Só contas em aberto e sem pagamento parcial podem ser agrupadas.",
  already_group: "Uma das contas marcadas já é uma cobrança agrupada.",
  live_charge: "Uma das contas ainda tem cobrança ativa (Pix, boleto ou maquininha) que não pôde ser cancelada. Confira em \"Consultar no Asaas\" e tente de novo.",
  group_paid: "Esta cobrança agrupada já tem pagamento: estorne antes de desagrupar.",
};
const groupError = (m: string | undefined) => GROUP_ERRORS[Object.keys(GROUP_ERRORS).find((k) => (m ?? "").includes(k)) ?? ""];

/**
 * "Agrupar em uma cobrança": the marked open receivables of ONE customer become a single receivable
 * (e.g. the month's recurring jobs), charged once. Opens the new receivable to generate Pix/boleto/link.
 */
export async function groupSelected(form: FormData) {
  const path = String(form.get("return_to") || "/receber");
  const ids = [...new Set(form.getAll("ids").map(String))];
  if (ids.length < 2) back(path, "error", GROUP_ERRORS.need_two);
  const due = String(form.get("group_due") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) back(path, "error", GROUP_ERRORS.due_required);
  const method = ["pix", "boleto", "credit_card", "other"].includes(String(form.get("group_method"))) ? String(form.get("group_method")) : "pix";
  const name = String(form.get("group_name") ?? "").trim().slice(0, 200) || null;
  const ctx = await requireOrg();
  if (!ctx.can("finance.receive") && !ctx.can("finance.edit")) back(path, "error", GROUP_ERRORS.permission_denied);
  const { sb, orgId } = ctx;

  // Check everything that does not depend on the charges first, so nothing is cancelled for a grouping that would fail.
  const { data: recs } = await sb.from("receivables").select("id, name, customer_id, status, paid_cents, origin_type, customers(name)").eq("org_id", orgId).in("id", ids);
  if ((recs ?? []).length !== ids.length) back(path, "error", GROUP_ERRORS.not_found);
  const customers = new Set((recs ?? []).map((r) => r.customer_id as string | null));
  if (customers.size !== 1 || customers.has(null)) back(path, "error", GROUP_ERRORS.same_customer);
  if ((recs ?? []).some((r) => (r.customers as unknown as { name: string } | null)?.name === "Consumidor final")) back(path, "error", GROUP_ERRORS.walk_in_customer);
  if ((recs ?? []).some((r) => r.status !== "open" || Number(r.paid_cents) > 0)) back(path, "error", GROUP_ERRORS.not_open);
  if ((recs ?? []).some((r) => r.origin_type === "grouping")) back(path, "error", GROUP_ERRORS.already_group);
  const nameOf = new Map((recs ?? []).map((r) => [r.id as string, r.name as string]));

  // Live charges of the marked accounts are cancelled here, so the customer never pays an item twice.
  const { data: live } = await sb.from("charges").select("id, receivable_id, asaas_payment_id, status").in("receivable_id", ids).in("status", ["pending", "overdue", "confirmed"]);
  const confirmed = (live ?? []).find((c) => c.status === "confirmed");
  if (confirmed) back(path, "error", `${nameOf.get(confirmed.receivable_id as string)}: o cartão já foi aprovado no Asaas (aguardando crédito). Ela não pode entrar no grupo.`);
  let cancelled = 0;
  if ((live ?? []).length) {
    const asaas = await asaasFor(orgId);
    if (!asaas) back(path, "error", "Há cobrança aberta no Asaas, mas o Asaas não está conectado para cancelá-la.");
    for (const c of live ?? []) {
      try {
        await asaas.deletePayment(c.asaas_payment_id as string);
      } catch (e) {
        await syncChargeFromAsaas(orgId, asaas, c.asaas_payment_id as string).catch(() => undefined);
        back(
          path,
          "error",
          `${nameOf.get(c.receivable_id as string)}: ${e instanceof AsaasError ? `o Asaas não deixou cancelar a cobrança (${e.message}); ela pode já ter sido paga` : "não foi possível cancelar a cobrança no Asaas"}. Nada foi agrupado.`,
        );
      }
      await sb.from("charges").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", c.id);
      cancelled++;
    }
  }
  const { data: pos } = await sb.from("pos_charges").select("id, receivable_id").in("receivable_id", ids).eq("status", "pending");
  for (const p of pos ?? []) {
    try {
      await cancelPosCharge(orgId, p.id as string);
      cancelled++;
    } catch {
      back(path, "error", `${nameOf.get(p.receivable_id as string)}: não foi possível tirar o valor da maquininha. Use "Tirar da maquininha" e tente de novo.`);
    }
  }

  const { data, error } = await sb.rpc("group_receivables", { p_org: orgId, p_ids: ids, p_due: due, p_method: method, p_name: name });
  if (error || !data) back(path, "error", groupError(error?.message) ?? "Não foi possível agrupar.");
  back(
    `/receber/${data}`,
    "ok",
    `${ids.length} contas agrupadas numa cobrança só.${cancelled ? ` ${cancelled} cobrança(s) que estavam abertas foram canceladas.` : ""} Gere o Pix, boleto ou link abaixo e envie ao cliente.`,
  );
}

/** Undoes a grouping that has no payment and no live charge: the items go back to open. */
export async function ungroup(form: FormData) {
  const id = String(form.get("id"));
  const ctx = await requireOrg();
  const { data, error } = await ctx.sb.rpc("ungroup_receivable", { p_group: id });
  if (error) back(`/receber/${id}`, "error", groupError(error.message) ?? "Não foi possível desagrupar.");
  back("/receber", "ok", `Cobrança desagrupada: ${data} conta(s) voltaram a ficar em aberto.`);
}
