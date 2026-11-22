import "server-only";
import { decryptSecret } from "./crypto";
import { supabaseAdmin } from "./supabase";
import { StoneClient, StoneError, paidInfo } from "./stone";
import { asaasFor } from "./charges";
import { formatBRL, todayInSaoPaulo } from "./money";

type Sb = ReturnType<typeof supabaseAdmin>;
export class PosError extends Error {}

export async function stoneFor(orgId: string): Promise<StoneClient | null> {
  const referer = process.env.STONE_SERVICE_REFERER_NAME;
  const { data } = await supabaseAdmin().from("orgs").select("stone_secret_key_encrypted").eq("id", orgId).single();
  if (!referer || !data?.stone_secret_key_encrypted) return null;
  return new StoneClient(decryptSecret(data.stone_secret_key_encrypted), referer);
}

/** Sends the open amount of a receivable to a Stone terminal. */
export async function sendToStone(
  sb: Sb,
  orgId: string,
  input: { receivableId: string; terminalId: string; paymentType: "any" | "credit" | "debit"; installments: number; amountCents?: number },
): Promise<string> {
  const stone = await stoneFor(orgId);
  if (!stone) throw new PosError(process.env.STONE_SERVICE_REFERER_NAME ? "Conecte a Stone em Configurações → Maquininhas." : "A integração Stone ainda não foi ativada no SCsync (falta o código de parceiro Stone).");
  const [{ data: rec }, { data: term }] = await Promise.all([
    sb.from("receivables").select("id, name, amount_cents, paid_cents, status, origin_type, origin_id, customers(name, email, cpf_cnpj)").eq("id", input.receivableId).eq("org_id", orgId).single(),
    sb.from("pos_terminals").select("id, name, serial_number, provider, active").eq("id", input.terminalId).eq("org_id", orgId).single(),
  ]);
  if (!rec) throw new PosError("Parcela não encontrada.");
  if (rec.status === "paid" || rec.status === "cancelled") throw new PosError("Esta parcela já está quitada.");
  if (!term || !term.active || term.provider !== "stone") throw new PosError("Escolha uma maquininha Stone ativa.");
  const open = Number(rec.amount_cents) - Number(rec.paid_cents);
  const amount = input.amountCents && input.amountCents > 0 ? Math.min(input.amountCents, open) : open;
  if (amount < 100) throw new PosError("Valor mínimo para a maquininha: R$ 1,00.");
  let osNumber: number | null = null;
  if (rec.origin_type === "service_order" && rec.origin_id) {
    const { data: os } = await sb.from("service_orders").select("number").eq("id", rec.origin_id).single();
    osNumber = os?.number ?? null;
  }
  const { data: row, error } = await sb
    .from("pos_charges")
    .insert({
      org_id: orgId,
      provider: "stone",
      terminal_id: term.id,
      receivable_id: rec.id,
      service_order_id: rec.origin_type === "service_order" ? rec.origin_id : null,
      amount_cents: amount,
      payment_type: input.paymentType,
      installments: input.paymentType === "credit" ? Math.max(1, Math.min(18, input.installments)) : 1,
    })
    .select("id")
    .single();
  if (error || !row) throw new PosError(error?.code === "23505" ? "Já existe uma cobrança aguardando na maquininha para esta parcela. Cancele-a antes de mandar outra." : "Não foi possível registrar a cobrança.");
  const customer = rec.customers as unknown as { name: string; email: string | null; cpf_cnpj: string | null } | null;
  try {
    const order = await stone.createPosOrder({
      amountCents: amount,
      description: rec.name as string,
      code: row.id.replace(/-/g, "").slice(0, 32),
      customer: { name: customer?.name ?? "Cliente", email: customer?.email, document: customer?.cpf_cnpj },
      serialNumber: term.serial_number,
      displayName: osNumber ? `OS ${osNumber} ${formatBRL(amount)}` : `${formatBRL(amount)}`,
      paymentType: input.paymentType,
      installments: input.installments,
      metadata: { scsync_pos_charge_id: row.id, receivable_id: rec.id, org_id: orgId },
    });
    await supabaseAdmin().from("pos_charges").update({ external_order_id: order.id, updated_at: new Date().toISOString() }).eq("id", row.id);
    return row.id;
  } catch (e) {
    const msg = e instanceof StoneError ? e.message : "Não foi possível falar com a Stone.";
    await supabaseAdmin().from("pos_charges").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", row.id);
    throw new PosError(`A Stone recusou: ${msg}`);
  }
}

/**
 * Reads the order from Stone and, when paid, records the receipt once (method, installments, authorization code),
 * cancels any open Asaas charge for the same parcela and closes the order on the POS.
 */
export async function syncStoneCharge(orgId: string, chargeId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: pc } = await admin.from("pos_charges").select("*").eq("id", chargeId).eq("org_id", orgId).single();
  if (!pc?.external_order_id) return "no_order";
  if (pc.status !== "pending") return pc.status;
  const stone = await stoneFor(orgId);
  if (!stone) return "not_configured";
  const order = await stone.getOrder(pc.external_order_id);
  const info = paidInfo(order);
  const now = new Date().toISOString();
  if (!info) {
    if (order.status === "canceled" || order.status === "failed") {
      await admin.from("pos_charges").update({ status: order.status, updated_at: now }).eq("id", pc.id).eq("status", "pending");
      return order.status;
    }
    return "pending";
  }
  // Claim the charge: only one run records the receipt.
  const { data: claimed } = await admin
    .from("pos_charges")
    .update({ status: "paid", method: info.method, card_brand: info.brand, authorization_code: info.authCode, paid_installments: info.installments, paid_at: now, updated_at: now })
    .eq("id", pc.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return "paid";

  const { data: rec } = await admin.from("receivables").select("amount_cents, paid_cents").eq("id", pc.receivable_id).single();
  const open = rec ? Number(rec.amount_cents) - Number(rec.paid_cents) : 0;
  const amount = Math.min(info.amountCents || Number(pc.amount_cents), Math.max(open, 0));
  if (amount > 0) {
    // An open Asaas charge for the same parcela must go, or the customer could pay twice.
    const { data: live } = await admin.from("charges").select("id, asaas_payment_id").eq("receivable_id", pc.receivable_id).in("status", ["pending", "overdue"]).maybeSingle();
    if (live) {
      const asaas = await asaasFor(orgId);
      try {
        await asaas?.deletePayment(live.asaas_payment_id);
        await admin.from("charges").update({ status: "cancelled", updated_at: now }).eq("id", live.id);
      } catch {
        /* keep going: the receipt on the POS is real; the Asaas charge shows up for review */
      }
    }
    const { data: st } = await admin
      .from("settlements")
      .insert({
        org_id: orgId,
        receivable_id: pc.receivable_id,
        paid_on: info.paidOn ?? todayInSaoPaulo(),
        amount_cents: amount,
        method: info.method,
        source: "pos_terminal",
        reference: info.authCode,
        card_installments: info.installments,
        notes: `Maquininha Stone${info.brand ? ` · ${info.brand}` : ""}`,
        created_by: pc.created_by,
      })
      .select("id")
      .single();
    if (st) await admin.from("pos_charges").update({ settlement_id: st.id }).eq("id", pc.id);
  }
  try {
    await stone.closeOrder(pc.external_order_id, "paid");
  } catch {
    /* closing only cleans the POS list */
  }
  return "paid";
}

export async function cancelStoneCharge(orgId: string, chargeId: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: pc } = await admin.from("pos_charges").select("id, status, external_order_id").eq("id", chargeId).eq("org_id", orgId).single();
  if (!pc || pc.status !== "pending") throw new PosError("Esta cobrança não está mais aguardando.");
  // If it was paid meanwhile, record it instead of cancelling.
  if ((await syncStoneCharge(orgId, chargeId).catch(() => "pending")) === "paid") throw new PosError("A maquininha já recebeu este pagamento; ele foi registrado.");
  const stone = await stoneFor(orgId);
  if (stone && pc.external_order_id) {
    try {
      await stone.closeOrder(pc.external_order_id, "canceled");
    } catch (e) {
      throw new PosError(e instanceof StoneError ? `A Stone não cancelou: ${e.message}` : "Não foi possível falar com a Stone.");
    }
  }
  await admin.from("pos_charges").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", pc.id).eq("status", "pending");
}
