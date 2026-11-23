"use server";

import { redirect } from "next/navigation";
import { parseItemRows } from "@/lib/items";
import { parseBRL } from "@/lib/money";
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
};

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
  if (payNow && !ctx.can("finance.receive")) return fail("Seu perfil não registra recebimentos: escolha \"Cobrar em seguida\".", "method");

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
      method: payNow ? how : values.later_method || "pix",
      pay_now: payNow,
      card_installments: Number(values.card_installments || 1),
      reference: (values.reference ?? "").trim() || null,
      notes: (values.notes ?? "").trim() || null,
    },
  });
  if (error || !id) return fail(ERRORS[error?.message.split(":")[0] ?? ""] ?? "Não foi possível registrar a venda.");
  redirect(
    `/os/${id}?ok=${encodeURIComponent(payNow ? "Venda registrada e recebida." : "Venda registrada. Gere o Pix ou envie para a maquininha logo abaixo, em Pagamento.")}`,
  );
}
