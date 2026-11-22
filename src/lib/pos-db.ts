import "server-only";
import { decryptSecret } from "./crypto";
import { supabaseAdmin } from "./supabase";
import { StoneClient, StoneError, paidInfo, type PaidInfo } from "./stone";
import { MP_FINAL_FAILED, MpClient, MpError, mpPaidInfo } from "./mercadopago";
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

export async function mpFor(orgId: string): Promise<MpClient | null> {
  const { data } = await supabaseAdmin().from("orgs").select("mp_access_token_encrypted").eq("id", orgId).single();
  return data?.mp_access_token_encrypted ? new MpClient(decryptSecret(data.mp_access_token_encrypted)) : null;
}

const PROVIDER_NAME: Record<string, string> = { stone: "Stone", mercadopago: "Mercado Pago" };

/** Sends the open amount of a receivable to a terminal (Stone or Mercado Pago, by the terminal chosen). */
export async function sendToPos(
  sb: Sb,
  orgId: string,
  input: { receivableId: string; terminalId: string; paymentType: "any" | "credit" | "debit"; installments: number; amountCents?: number },
): Promise<string> {
  const [{ data: rec }, { data: term }] = await Promise.all([
    sb.from("receivables").select("id, name, amount_cents, paid_cents, status, origin_type, origin_id, customers(name, email, cpf_cnpj)").eq("id", input.receivableId).eq("org_id", orgId).single(),
    sb.from("pos_terminals").select("id, name, serial_number, provider, active").eq("id", input.terminalId).eq("org_id", orgId).single(),
  ]);
  if (!rec) throw new PosError("Parcela não encontrada.");
  if (rec.status === "paid" || rec.status === "cancelled") throw new PosError("Esta parcela já está quitada.");
  if (!term || !term.active || !["stone", "mercadopago"].includes(term.provider)) throw new PosError("Escolha uma maquininha Stone ou Mercado Pago ativa.");
  const provider = term.provider as "stone" | "mercadopago";
  const stone = provider === "stone" ? await stoneFor(orgId) : null;
  const mp = provider === "mercadopago" ? await mpFor(orgId) : null;
  if (provider === "stone" && !stone) {
    throw new PosError(process.env.STONE_SERVICE_REFERER_NAME ? "Conecte a Stone em Configurações → Maquininhas." : "A integração Stone ainda não foi ativada no SCsync (falta o código de parceiro Stone).");
  }
  if (provider === "mercadopago" && !mp) throw new PosError("Conecte o Mercado Pago em Configurações → Maquininhas.");
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
      provider,
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
    if (mp) {
      const order = await mp.createOrder({
        terminalId: term.serial_number,
        amountCents: amount,
        externalReference: row.id,
        description: osNumber ? `OS ${osNumber} - ${rec.name}` : (rec.name as string),
        paymentType: input.paymentType,
        installments: input.installments,
        idempotencyKey: row.id,
      });
      await supabaseAdmin().from("pos_charges").update({ external_order_id: order.id, updated_at: new Date().toISOString() }).eq("id", row.id);
      return row.id;
    }
    const order = await stone!.createPosOrder({
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
    const msg = e instanceof StoneError || e instanceof MpError ? e.message : `Não foi possível falar com ${PROVIDER_NAME[provider]}.`;
    await supabaseAdmin().from("pos_charges").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", row.id);
    throw new PosError(`${PROVIDER_NAME[provider]} recusou: ${msg}`);
  }
}

/**
 * Reads the order from Stone and, when paid, records the receipt once (method, installments, authorization code),
 * cancels any open Asaas charge for the same parcela and closes the order on the POS.
 */
export async function syncPosCharge(orgId: string, chargeId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: pc } = await admin.from("pos_charges").select("*").eq("id", chargeId).eq("org_id", orgId).single();
  if (!pc?.external_order_id) return "no_order";
  if (pc.status !== "pending") return pc.status;
  const now = new Date().toISOString();
  let info: PaidInfo | null;
  let failedStatus: string | null = null;
  let stone: StoneClient | null = null;
  if (pc.provider === "mercadopago") {
    const mp = await mpFor(orgId);
    if (!mp) return "not_configured";
    const order = await mp.getOrder(pc.external_order_id);
    info = mpPaidInfo(order);
    if (!info && MP_FINAL_FAILED.has(order.status)) failedStatus = order.status === "failed" ? "failed" : "canceled";
  } else {
    stone = await stoneFor(orgId);
    if (!stone) return "not_configured";
    const order = await stone.getOrder(pc.external_order_id);
    info = paidInfo(order);
    if (!info && (order.status === "canceled" || order.status === "failed")) failedStatus = order.status;
  }
  if (!info) {
    if (failedStatus) {
      await admin.from("pos_charges").update({ status: failedStatus, updated_at: now }).eq("id", pc.id).eq("status", "pending");
      return failedStatus;
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
        notes: `Maquininha ${PROVIDER_NAME[pc.provider] ?? pc.provider}${info.brand ? ` · ${info.brand}` : ""}`,
        created_by: pc.created_by,
      })
      .select("id")
      .single();
    if (st) await admin.from("pos_charges").update({ settlement_id: st.id }).eq("id", pc.id);
  }
  if (stone) {
    try {
      await stone.closeOrder(pc.external_order_id, "paid");
    } catch {
      /* closing only cleans the POS list */
    }
  }
  return "paid";
}

export async function cancelPosCharge(orgId: string, chargeId: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: pc } = await admin.from("pos_charges").select("id, status, external_order_id, provider").eq("id", chargeId).eq("org_id", orgId).single();
  if (!pc || pc.status !== "pending") throw new PosError("Esta cobrança não está mais aguardando.");
  // If it was paid meanwhile, record it instead of cancelling.
  if ((await syncPosCharge(orgId, chargeId).catch(() => "pending")) === "paid") throw new PosError("A maquininha já recebeu este pagamento; ele foi registrado.");
  if (pc.provider === "mercadopago" && pc.external_order_id) {
    const mp = await mpFor(orgId);
    try {
      await mp?.cancelOrder(pc.external_order_id, `${pc.id}-cancel`);
    } catch (e) {
      throw new PosError(e instanceof MpError ? `O Mercado Pago não cancelou: ${e.message}` : "Não foi possível falar com o Mercado Pago.");
    }
  }
  const stone = pc.provider === "stone" ? await stoneFor(orgId) : null;
  if (stone && pc.external_order_id) {
    try {
      await stone.closeOrder(pc.external_order_id, "canceled");
    } catch (e) {
      throw new PosError(e instanceof StoneError ? `A Stone não cancelou: ${e.message}` : "Não foi possível falar com a Stone.");
    }
  }
  await admin.from("pos_charges").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", pc.id).eq("status", "pending");
}

/** Kept for the Stone webhook and older callers. */
export const syncStoneCharge = syncPosCharge;
