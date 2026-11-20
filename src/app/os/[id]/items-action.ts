"use server";

import { redirect } from "next/navigation";
import { parseItemRows } from "@/lib/items";
import { formatBRL, parseBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

export type EditItemsState = { error?: string; field?: string; values?: Record<string, string> };

const ERRORS: Record<string, string> = {
  has_payments: "Esta OS já tem recebimento registrado. Estorne o recebimento antes de mudar os itens.",
  has_open_charges:
    "Há cobrança aberta no Asaas para esta OS. Ela seria cobrada com o valor antigo: receba ou cancele a cobrança antes de mudar os itens.",
  cancelled: "OS cancelada não pode ser alterada.",
  total_not_positive: "O total da OS precisa ser maior que zero (confira o desconto).",
  total_below_installments: "O total ficou menor que o número de parcelas.",
  items_required: "Inclua pelo menos um serviço ou produto.",
};

export async function updateItems(_prev: EditItemsState, form: FormData): Promise<EditItemsState> {
  const values: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string") values[k] = v;
  });
  const id = values.id;
  const rows = Math.min(50, Math.max(1, Number(values.rows || 0)));
  const fail = (error: string, field?: string): EditItemsState => ({ error, field, values });

  const parsed = parseItemRows(values, rows);
  if ("error" in parsed) return fail(parsed.error, parsed.field);
  const discount = parseBRL(values.discount?.trim() || "0");
  if (discount === null || discount < 0) return fail("Desconto inválido. Use, por exemplo, 10,00.", "discount");

  const { sb, orgId } = await requireOrg();
  const { data: own } = await sb.from("service_orders").select("id").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (!own) return fail("OS não encontrada.");

  const { data: total, error } = await sb.rpc("update_service_order_items", {
    p_service_order: id,
    p_items: parsed.items,
    p_discount_cents: discount,
  });
  if (error) return fail(ERRORS[error.message.split(":")[0]] ?? "Não foi possível salvar os itens.");
  redirect(`/os/${id}?ok=${encodeURIComponent(`Itens atualizados. Novo total: ${formatBRL(Number(total))}.`)}`);
}
