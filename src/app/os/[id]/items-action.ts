"use server";

import { redirect } from "next/navigation";
import { syncChargeAmount, type ChargeSyncResult } from "@/lib/charges";
import { parseItemRows } from "@/lib/items";
import { formatBRL, parseBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

export type EditItemsState = { error?: string; field?: string; values?: Record<string, string> };

const ERRORS: Record<string, string> = {
  below_paid: "O novo total ficou menor do que o cliente já pagou. Estorne um recebimento antes de reduzir o valor.",
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

  const { data, error } = await sb.rpc("update_service_order_items", {
    p_service_order: id,
    p_items: parsed.items,
    p_discount_cents: discount,
  });
  if (error) return fail(ERRORS[error.message.split(":")[0]] ?? "Não foi possível salvar os itens.");

  const result = data as { total: number; changed: { receivable_id: string; amount_cents: number; due_date: string }[]; added_receivable_id?: string | null };
  const counts: Record<ChargeSyncResult, number> = { none: 0, updated: 0, recreated: 0, cancelled_below_min: 0, failed: 0 };
  for (const c of result.changed ?? []) {
    counts[await syncChargeAmount(sb, orgId, c.receivable_id, c.amount_cents, c.due_date)]++;
  }

  const parts = [`Itens atualizados. Novo total: ${formatBRL(Number(result.total))}.`];
  if (counts.updated + counts.recreated > 0) parts.push("A cobrança no Asaas foi ajustada para o novo valor: reenvie pelo WhatsApp.");
  if (counts.cancelled_below_min > 0) parts.push("Uma parcela ficou abaixo de R$ 5,00 e a cobrança dela no Asaas foi cancelada: receba na maquininha ou em dinheiro.");
  if (result.added_receivable_id) parts.push("Como o restante já estava pago, o acréscimo virou uma nova parcela.");
  if (counts.failed > 0) {
    redirect(
      `/os/${id}?error=${encodeURIComponent(parts.join(" ") + " Atenção: não consegui ajustar uma cobrança no Asaas; use \"Consultar no Asaas\" e, se preciso, gere a cobrança de novo.")}`,
    );
  }
  redirect(`/os/${id}?ok=${encodeURIComponent(parts.join(" "))}`);
}
