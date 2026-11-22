"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { platformAsaas } from "@/lib/platform-billing";
import { AsaasError } from "@/lib/asaas";
import { planOf, priceCents, type Cycle, type PlanKey } from "@/lib/plans";
import { isValidCnpj, isValidCpf } from "@/lib/br";
import { todayInSaoPaulo } from "@/lib/money";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/conta/assinatura?${key}=${encodeURIComponent(msg)}`);
}

async function owner() {
  const ctx = await requireOrg();
  if (!ctx.isOwner) back("error", "Só o Dono da conta mexe na assinatura.");
  const client = platformAsaas();
  if (!client) back("error", "A cobrança das assinaturas ainda não foi configurada no SCsync. Fale com o suporte.");
  return { ctx, client };
}

const asaasMsg = (e: unknown) => (e instanceof AsaasError ? e.message : "Não foi possível falar com o Asaas agora. Tente de novo.");

/** Chooses or changes the plan. First time: creates the customer and the subscription on the SCsync Asaas account. */
export async function subscribe(form: FormData) {
  const { ctx, client } = await owner();
  const plan = String(form.get("plan")) as PlanKey;
  const cycle: Cycle = form.get("cycle") === "yearly" ? "yearly" : "monthly";
  if (!planOf(plan)) back("error", "Escolha um plano.");
  const doc = String(form.get("doc") ?? "").replace(/\D/g, "");
  const email = String(form.get("email") ?? "").trim();
  const phone = String(form.get("phone") ?? "").replace(/\D/g, "");
  if (!(doc.length === 11 ? isValidCpf(doc) : doc.length === 14 && isValidCnpj(doc))) back("error", "Informe um CPF ou CNPJ válido para a nota da assinatura.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back("error", "Informe o e-mail que recebe as cobranças.");

  const admin = supabaseAdmin();
  const { data: acc } = await admin.from("accounts").select("*").eq("id", ctx.accountId).single();
  if (!acc) back("error", "Conta não encontrada.");
  const value = priceCents(plan, cycle) / 100;
  const description = `SCsync — plano ${planOf(plan)!.name} (${cycle === "yearly" ? "anual" : "mensal"})`;
  const today = todayInSaoPaulo();

  try {
    let customer = acc.asaas_customer_id as string | null;
    if (!customer) {
      customer = (await client.createCustomer({ name: acc.name, cpfCnpj: doc, email, mobilePhone: phone || null, externalReference: acc.id })).id;
    } else {
      await client.updateCustomer(customer, { cpfCnpj: doc, email, mobilePhone: phone || null });
    }
    let subscription = acc.asaas_subscription_id as string | null;
    if (subscription && acc.status !== "cancelled") {
      await client.updateSubscription(subscription, { value, cycle: cycle === "yearly" ? "YEARLY" : "MONTHLY", description, updatePendingPayments: true });
    } else {
      // During the trial the first charge falls on the last day of the trial; otherwise today.
      const firstDue = acc.status === "trial" && acc.trial_ends_at && acc.trial_ends_at >= today ? acc.trial_ends_at : today;
      subscription = (
        await client.createSubscription({
          customer,
          billingType: "UNDEFINED",
          value,
          nextDueDate: firstDue,
          cycle: cycle === "yearly" ? "YEARLY" : "MONTHLY",
          description,
          externalReference: acc.id,
        })
      ).id;
    }
    const { error } = await admin
      .from("accounts")
      .update({
        plan,
        billing_cycle: cycle,
        price_cents: priceCents(plan, cycle),
        billing_doc: doc,
        billing_email: email,
        billing_phone: phone || null,
        asaas_customer_id: customer,
        asaas_subscription_id: subscription,
        cancel_at_period_end: false,
        status: acc.status === "cancelled" ? "past_due" : acc.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", acc.id);
    if (error) back("error", "A assinatura foi criada no Asaas, mas não foi possível salvar aqui. Fale com o suporte.");
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    if (!(e instanceof AsaasError)) throw e;
    back("error", asaasMsg(e));
  }
  back("ok", acc.asaas_subscription_id ? "Plano alterado; vale a partir da próxima mensalidade." : "Assinatura criada. Use o botão Pagar para escolher Pix, boleto ou cartão.");
}

/** Stops renewing: the account keeps working until the end of the period already paid. */
export async function cancelSubscription() {
  const { ctx, client } = await owner();
  const admin = supabaseAdmin();
  const { data: acc } = await admin.from("accounts").select("asaas_subscription_id, status, paid_until").eq("id", ctx.accountId).single();
  if (!acc?.asaas_subscription_id) back("error", "Não há assinatura ativa.");
  try {
    await client.deleteSubscription(acc.asaas_subscription_id);
  } catch (e) {
    back("error", asaasMsg(e));
  }
  const endsNow = !acc.paid_until || acc.paid_until < todayInSaoPaulo();
  await admin
    .from("accounts")
    .update({ cancel_at_period_end: !endsNow, status: endsNow ? "cancelled" : acc.status, asaas_subscription_id: null, updated_at: new Date().toISOString() })
    .eq("id", ctx.accountId);
  back("ok", endsNow ? "Assinatura cancelada." : "Assinatura cancelada. A conta funciona até o fim do período já pago.");
}
