/** SCsync plans (what each gráfica pays the platform). Pure: used by the pages, the webhook and the tests. */
import type { ModuleKey } from "./access";

export type PlanKey = "servicos" | "servicos_produtos" | "completo";
export type Cycle = "monthly" | "yearly";

export const TRIAL_DAYS = 14;
export const YEARLY_DISCOUNT = 0.15;
/** Days the account keeps working after a charge is overdue. */
export const GRACE_DAYS = 7;

export const PLANS: { key: PlanKey; name: string; monthlyCents: number; summary: string; features: string[]; blocked: ModuleKey[] }[] = [
  {
    key: "servicos",
    name: "Serviços",
    monthlyCents: 32000,
    summary: "Para gráficas que vendem só serviços",
    features: ["Ordem de serviço, orçamentos e produção", "Financeiro, cobrança Pix/boleto (Asaas)", "Conciliação bancária e de cartão", "Robô de WhatsApp para despesas", "Usuários com perfis de acesso"],
    blocked: ["stock", "nfse"],
  },
  {
    key: "servicos_produtos",
    name: "Serviços e Produtos",
    monthlyCents: 42000,
    summary: "Serviços, venda de produtos e estoque",
    features: ["Tudo do plano Serviços", "Produtos com estoque e importação de planilha", "Baixa de estoque pelas OS", "Várias empresas (CNPJs) na mesma conta"],
    blocked: ["nfse"],
  },
  {
    key: "completo",
    name: "Completo com nota fiscal",
    monthlyCents: 48000,
    summary: "Tudo, mais emissão de nota fiscal",
    features: ["Tudo do plano Serviços e Produtos", "Nota fiscal de serviço (NFS-e) na OS, avulsa ou automática ao receber", "Suporte prioritário"],
    blocked: [],
  },
];

export const planOf = (key: string | null | undefined) => PLANS.find((p) => p.key === key) ?? null;

/** Yearly = 12 months with 15% off, rounded to the centavo. */
export function priceCents(plan: PlanKey, cycle: Cycle): number {
  const p = planOf(plan)!;
  return cycle === "yearly" ? Math.round(p.monthlyCents * 12 * (1 - YEARLY_DISCOUNT)) : p.monthlyCents;
}

/** Modules the plan does not include are off whatever the company settings say. The trial tries everything. */
export function planAllows(plan: string | null | undefined, status: string, module: string): boolean {
  if (status === "trial" || plan === "founder") return true;
  const p = planOf(plan);
  return !p || !p.blocked.includes(module as ModuleKey);
}

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** A paid charge with this due date covers the account until the next due date. */
export const coveredUntil = (dueDate: string, cycle: Cycle) => addMonthsISO(dueDate, cycle === "yearly" ? 12 : 1);

export function addDaysISO(iso: string, days: number): string {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export type AccountBilling = { status: string; plan: string; trial_ends_at: string | null; paid_until: string | null; cancel_at_period_end?: boolean };

/** null = works; otherwise why it is blocked. `today` is the date in São Paulo. */
export function billingBlock(a: AccountBilling | null, today: string): string | null {
  if (!a || a.plan === "founder") return null;
  if (a.status === "suspended") return "A assinatura desta conta está suspensa por falta de pagamento. O Dono da conta pode regularizar em Conta → Assinatura.";
  if (a.status === "cancelled") return "A assinatura desta conta foi cancelada. O Dono da conta pode assinar de novo em Conta → Assinatura.";
  if (a.status === "trial") {
    if (a.trial_ends_at && a.trial_ends_at < today) return "O período de teste terminou. O Dono da conta pode escolher um plano em Conta → Assinatura.";
    return null;
  }
  if (a.paid_until && addDaysISO(a.paid_until, GRACE_DAYS) < today) {
    return "A mensalidade está em atraso. O Dono da conta pode pagar em Conta → Assinatura.";
  }
  return null;
}
