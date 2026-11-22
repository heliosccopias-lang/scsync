"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { parseBRL } from "@/lib/money";
import { PosError, cancelStoneCharge, sendToStone, syncStoneCharge } from "@/lib/pos-db";
import type { supabaseAdmin } from "@/lib/supabase";

function back(id: string, key: "error" | "ok", msg: string): never {
  redirect(`/os/${id}?${key}=${encodeURIComponent(msg)}`);
}

export async function sendToTerminal(form: FormData) {
  const id = String(form.get("id"));
  const ctx = await requireOrg();
  if (!ctx.can("finance.receive")) back(id, "error", "Seu perfil não recebe pagamentos.");
  const type = String(form.get("payment_type"));
  try {
    await sendToStone(ctx.sb as unknown as ReturnType<typeof supabaseAdmin>, ctx.orgId, {
      receivableId: String(form.get("receivable_id")),
      terminalId: String(form.get("terminal_id")),
      paymentType: type === "credit" || type === "debit" ? type : "any",
      installments: Number(form.get("installments") || 1),
      amountCents: parseBRL(String(form.get("amount") ?? "")) ?? undefined,
    });
  } catch (e) {
    if (e instanceof PosError) back(id, "error", e.message);
    throw e;
  }
  back(id, "ok", "Valor enviado para a maquininha. O cliente já pode pagar; a baixa acontece sozinha.");
}

export async function checkTerminal(form: FormData) {
  const id = String(form.get("id"));
  const ctx = await requireOrg();
  const r = await syncStoneCharge(ctx.orgId, String(form.get("charge_id"))).catch(() => "error");
  back(id, r === "paid" ? "ok" : "error", r === "paid" ? "Pagamento confirmado pela maquininha." : r === "pending" ? "Ainda aguardando o pagamento na maquininha." : `Situação: ${r}.`);
}

export async function cancelTerminal(form: FormData) {
  const id = String(form.get("id"));
  const ctx = await requireOrg();
  try {
    await cancelStoneCharge(ctx.orgId, String(form.get("charge_id")));
  } catch (e) {
    if (e instanceof PosError) back(id, "error", e.message);
    throw e;
  }
  back(id, "ok", "Cobrança retirada da maquininha.");
}
