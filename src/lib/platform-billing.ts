import "server-only";
import { AsaasClient, type AsaasEnvironment } from "./asaas";
import { addDaysISO, coveredUntil, type Cycle } from "./plans";
import { supabaseAdmin } from "./supabase";

/**
 * The SCsync platform's own Asaas account (it charges the gráficas). Not the gráficas' Asaas connections.
 * Env: ASAAS_PLATFORM_API_KEY, ASAAS_PLATFORM_ENV (sandbox|production), ASAAS_PLATFORM_WEBHOOK_TOKEN.
 */
export function platformAsaas(): AsaasClient | null {
  const key = process.env.ASAAS_PLATFORM_API_KEY;
  if (!key) return null;
  const env: AsaasEnvironment = process.env.ASAAS_PLATFORM_ENV === "production" ? "production" : "sandbox";
  return new AsaasClient(key, env);
}

/** Platform admins (who sell SCsync): comma-separated e-mails in PLATFORM_ADMIN_EMAILS. */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}

type Payment = { id: string; status: string; dueDate: string; subscription?: string | null; value?: number };
const PAID = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);

/**
 * Applies a subscription payment to the account: paid → active and covered for one cycle;
 * overdue → past_due (blocked after the grace days); refunded/chargeback → past_due.
 * Returns what changed, or null if the payment is not from a known subscription.
 */
export async function applySubscriptionPayment(event: string, p: Payment): Promise<string | null> {
  if (!p.subscription) return null;
  const admin = supabaseAdmin();
  const { data: acc } = await admin.from("accounts").select("id, status, paid_until, billing_cycle, plan").eq("asaas_subscription_id", p.subscription).maybeSingle();
  if (!acc) return null;
  const cycle = (acc.billing_cycle as Cycle) ?? "monthly";
  const now = new Date().toISOString();
  if (PAID.has(p.status) || event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
    const until = coveredUntil(p.dueDate, cycle);
    const paidUntil = acc.paid_until && acc.paid_until > until ? acc.paid_until : until;
    await admin.from("accounts").update({ status: "active", paid_until: paidUntil, updated_at: now }).eq("id", acc.id);
    return `active until ${paidUntil}`;
  }
  if (event === "PAYMENT_OVERDUE" && acc.status !== "trial") {
    // paid_until stays: billingBlock() blocks GRACE_DAYS after it.
    await admin.from("accounts").update({ status: "past_due", paid_until: acc.paid_until ?? p.dueDate, updated_at: now }).eq("id", acc.id);
    return "past_due";
  }
  if (["PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED"].includes(event)) {
    await admin.from("accounts").update({ status: "past_due", paid_until: addDaysISO(p.dueDate, 0), updated_at: now }).eq("id", acc.id);
    return "past_due (refund)";
  }
  return "ignored";
}
