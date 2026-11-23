"use server";

import { redirect } from "next/navigation";
import { parseItemRows } from "@/lib/items";
import { parseBRL, todayInSaoPaulo } from "@/lib/money";
import { isValidCpfCnpj, onlyDigits } from "@/lib/br";
import { requireOrg } from "@/lib/session";
import { SALE_LINES } from "./constants";

export type SaleState = { error?: string; field?: string; values?: Record<string, string> };
const PAY_NOW = ["cash", "pix", "debit_card", "credit_card", "transfer"];

const ERRORS: Record<string, string> = {
  permission_denied: "Seu perfil não registra vendas ou recebimentos.",
  total_not_positive: "O total da venda precisa ser maior que zero.",
  bank_account_required: "Cadastre uma conta bancária ou caixa em Configurações → Contas bancárias.",
  invalid_method: "Escolha a forma de pagamento.",
  invalid_technician: "Escolha um atendente desta empresa.",
  customer_required: "Venda a prazo precisa de um cliente cadastrado: escolha o cliente no topo.",
  invalid_installments: "Número de parcelas entre 1 e 48 (e cada parcela de pelo menos R$ 0,01).",
  plan_not_paid_now: "Venda a prazo não é recebida na hora.",
};
const METHODS = ["cash", "pix", "debit_card", "credit_card", "transfer", "boleto"];

/** Counter sale: one screen, paid on the spot or charged right after (Pix/maquininha on the sale's page). */
export async function createSale(_prev: SaleState, form: FormData): Promise<SaleState> {
  const values: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string") values[k] = v;
  });
  const fail = (error: string, field?: string): SaleState => ({ error, field, values });
  const ctx = await requireOrg();
  if (!ctx.can("os.edit")) return fail(ERRORS.permission_denied);

  const parsed = parseItemRows(values, SALE_LINES);
  if ("error" in parsed) return fail(parsed.error.replace("serviço ou produto", "produto"), parsed.field);
  const discount = parseBRL((values.discount ?? "").trim() || "0");
  if (discount === null || discount < 0) return fail("Desconto inválido. Use, por exemplo, 5,00.", "discount");

  const how = values.method ?? "cash";
  const payNow = PAY_NOW.includes(how);
  if (payNow && !ctx.can("finance.receive")) return fail("Seu perfil não registra recebimentos: escolha \"Cobrar em seguida\" ou \"A prazo\".", "method");

  // Charged later (one installment today) or on credit (several installments / a saved condition).
  let method = payNow ? how : values.later_method || "pix";
  let plan: Record<string, unknown> | null = null;
  if (how === "term") {
    if (!values.customer_id) return fail(ERRORS.customer_required, "customer_id");
    let condMethod: string | null = null;
    if (values.condition_id) {
      const { data: cond } = await ctx.sb.from("payment_conditions").select("installment_days, default_method").eq("org_id", ctx.orgId).eq("id", values.condition_id).maybeSingle();
      if (!cond) return fail("Condição de pagamento não encontrada.", "condition_id");
      plan = { days: cond.installment_days };
      condMethod = cond.default_method as string;
    } else {
      const n = Number(values.term_count || "1");
      if (!Number.isInteger(n) || n < 1 || n > 48) return fail(ERRORS.invalid_installments, "term_count");
      const first = values.term_first_due || todayInSaoPaulo();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return fail("Data do 1º vencimento inválida.", "term_first_due");
      plan = { count: n, first_due: first };
    }
    method = values.term_method || condMethod || "boleto";
  } else if (!payNow && how !== "later") {
    return fail(ERRORS.invalid_method, "method");
  }
  if (!METHODS.includes(method)) method = "boleto";

  // Link each line to the catalog item with the same name (stock is taken out by it).
  const { data: catalog } = await ctx.sb.from("catalog_items").select("id, kind, name").eq("org_id", ctx.orgId).eq("active", true).limit(3000);
  const byName = new Map((catalog ?? []).map((c) => [String(c.name).toLowerCase(), c]));
  const items = parsed.items.map((it) => {
    const hit = byName.get(it.description.toLowerCase());
    return { ...it, kind: hit ? hit.kind : "product", catalog_item_id: hit?.id ?? "" };
  });

  const { data: id, error } = await ctx.sb.rpc("create_counter_sale", {
    p_org: ctx.orgId,
    p: {
      customer_id: values.customer_id || null,
      technician_id: values.technician_id || null,
      items,
      discount_cents: discount,
      method,
      pay_now: payNow,
      plan,
      card_installments: Number(values.card_installments || 1),
      reference: (values.reference ?? "").trim() || null,
      notes: (values.notes ?? "").trim() || null,
    },
  });
  if (error || !id) {
    console.error("create_counter_sale", how, method, error?.message);
    const key = Object.keys(ERRORS).find((k) => (error?.message ?? "").includes(k));
    return fail(key ? ERRORS[key] : `Não foi possível registrar a venda (${error?.message ?? "sem resposta"}).`);
  }
  const ok = payNow
    ? "Venda registrada e recebida."
    : how === "term"
      ? "Venda a prazo registrada: as parcelas estão em Contas a receber."
      : method === "boleto"
        ? "Venda registrada. Gere o boleto logo abaixo, em Pagamento."
        : "Venda registrada. Gere o Pix ou envie para a maquininha logo abaixo, em Pagamento.";
  // Paid now or on credit: straight to the receipt, print dialog open. Charged later: the sale page, to create the Pix/boleto first.
  if (payNow || how === "term") redirect(`/os/${id}/cupom?auto=1`);
  redirect(`/os/${id}?ok=${encodeURIComponent(ok)}`);
}

/** Quick customer sign-up from the counter sale (name required; CPF/CNPJ, phone and e-mail optional). */
export async function quickCustomer(input: { name: string; cpf_cnpj?: string; phone?: string; email?: string }): Promise<{ id?: string; name?: string; error?: string }> {
  const ctx = await requireOrg();
  if (!ctx.can("customers.edit")) return { error: "Seu perfil não cadastra clientes." };
  const name = (input.name ?? "").trim().slice(0, 200);
  const doc = onlyDigits(input.cpf_cnpj ?? "");
  if (!name) return { error: "Informe o nome do cliente." };
  if (doc && !isValidCpfCnpj(doc)) return { error: "CPF/CNPJ inválido. Confira os números." };
  const email = (input.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "E-mail inválido." };
  const { data, error } = await ctx.sb
    .from("customers")
    .insert({ org_id: ctx.orgId, name, cpf_cnpj: doc || null, phone: (input.phone ?? "").trim() || null, email: email || null })
    .select("id, name")
    .single();
  if (error || !data) return { error: error?.code === "23505" ? "Já existe um cliente com este CPF/CNPJ." : "Não foi possível cadastrar o cliente." };
  return { id: data.id, name: data.name };
}
