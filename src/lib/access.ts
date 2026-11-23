/** Who may open which screen. Pure: used by the route guard, the menu and the tests. The database enforces the same rules. */

export type Perm =
  | "os.view" | "os.edit" | "os.status" | "os.cancel" | "customers.edit" | "catalog.edit" | "prices.view"
  | "finance.view" | "finance.receive" | "finance.edit" | "finance.reverse" | "reports" | "reports.commissions" | "settings" | "fiscal.issue" | "owner";

export type ModuleKey = "os" | "stock" | "commissions" | "finance" | "asaas" | "bank_reconciliation" | "cards" | "nfse";

export const MODULES: { key: ModuleKey; label: string; help: string }[] = [
  { key: "os", label: "Ordem de serviço", help: "OS, orçamentos, checklists, produção, impressão e link do cliente" },
  { key: "stock", label: "Estoque de produtos", help: "Controle de estoque e baixa pelas OS" },
  { key: "commissions", label: "Comissão de técnicos", help: "Técnicos na OS e relatório de comissões" },
  { key: "finance", label: "Financeiro", help: "Contas a receber e a pagar, baixas e estornos" },
  { key: "asaas", label: "Cobrança Asaas", help: "Pix, boleto e baixa automática" },
  { key: "bank_reconciliation", label: "Conciliação bancária", help: "Extrato OFX e do Asaas" },
  { key: "cards", label: "Cartão de crédito e robô de WhatsApp", help: "Fatura por arquivo ou Pluggy e despesas pelo WhatsApp" },
  { key: "nfse", label: "Nota fiscal de serviço (NFS-e)", help: "Emissão pela conta Asaas da empresa; plano Completo" },
];

export const ROLES: { key: string; label: string; help: string }[] = [
  { key: "admin", label: "Administrador", help: "Tudo nesta empresa, menos criar empresas, usuários e integrações" },
  { key: "attendance", label: "Atendimento", help: "OS, orçamentos, clientes e recebimento; não vê contas a pagar" },
  { key: "production", label: "Produção", help: "Vê as OS e muda o andamento; não vê valores nem financeiro" },
  { key: "products", label: "Produtos e estoque", help: "Cadastro de itens, preços, planilhas e estoque" },
  { key: "finance", label: "Financeiro", help: "Receber, pagar, conciliações, cartão e relatórios" },
  { key: "viewer", label: "Somente consulta", help: "Vê OS, financeiro e relatórios sem alterar nada" },
  { key: "custom", label: "Personalizado", help: "Você escolhe as permissões" },
];

export const PERMS: { key: Perm; label: string }[] = [
  { key: "os.view", label: "Ver ordens de serviço" },
  { key: "os.edit", label: "Criar e editar OS, orçamentos, lançar contas" },
  { key: "os.status", label: "Mudar andamento da OS (produção)" },
  { key: "os.cancel", label: "Cancelar OS" },
  { key: "customers.edit", label: "Cadastrar e editar clientes" },
  { key: "catalog.edit", label: "Cadastro de itens, preços e estoque" },
  { key: "prices.view", label: "Ver valores e preços" },
  { key: "finance.receive", label: "Receber (baixa, Pix, maquininha)" },
  { key: "finance.view", label: "Ver financeiro completo" },
  { key: "finance.edit", label: "Lançar contas a pagar, conciliar, cartão" },
  { key: "finance.reverse", label: "Estornar recebimentos" },
  { key: "reports", label: "Relatórios" },
  { key: "reports.commissions", label: "Relatório de comissões" },
  { key: "settings", label: "Configurações da empresa (contas, juros, técnicos, checklists)" },
  { key: "fiscal.issue", label: "Emitir e cancelar notas fiscais" },
];

const ROLE_PERMS: Record<string, Perm[]> = {
  admin: ["os.view", "os.edit", "os.status", "os.cancel", "customers.edit", "catalog.edit", "prices.view", "finance.view", "finance.receive", "finance.edit", "finance.reverse", "reports", "reports.commissions", "settings", "fiscal.issue"],
  attendance: ["os.view", "os.edit", "os.status", "customers.edit", "prices.view", "finance.receive", "fiscal.issue"],
  production: ["os.view", "os.status"],
  products: ["catalog.edit", "prices.view", "os.view", "reports"],
  finance: ["os.view", "customers.edit", "prices.view", "finance.view", "finance.receive", "finance.edit", "finance.reverse", "reports", "reports.commissions", "fiscal.issue"],
  viewer: ["os.view", "prices.view", "finance.view", "reports"],
};
/** Same table as role_perms() in the database (migration 0020). */
export const rolePerms = (role: string): Perm[] => ROLE_PERMS[role] ?? [];

type Rule = { prefix: string; module?: ModuleKey; any?: Perm[]; owner?: boolean };

// Most specific first.
const RULES: Rule[] = [
  { prefix: "/conta", owner: true },
  { prefix: "/configuracoes/asaas", owner: true, module: "asaas" },
  { prefix: "/configuracoes/conexoes", owner: true },
  { prefix: "/configuracoes/maquininhas", owner: true },
  { prefix: "/configuracoes/cartoes", owner: true, module: "cards" },
  { prefix: "/configuracoes/whatsapp", owner: true, module: "cards" },
  { prefix: "/configuracoes", any: ["settings"] },
  { prefix: "/cadastros/tecnicos", any: ["settings"] },
  { prefix: "/cadastros/checklists", module: "os", any: ["settings", "os.edit"] },
  { prefix: "/cadastros/itens", any: ["catalog.edit", "os.view"] },
  { prefix: "/cadastros/clientes", any: ["customers.edit", "os.view", "finance.view"] },
  { prefix: "/os/nova", module: "os", any: ["os.edit"] },
  { prefix: "/os", module: "os", any: ["os.view"] },
  { prefix: "/vendas", module: "finance", any: ["os.edit"] },
  { prefix: "/receber", module: "finance", any: ["finance.view", "finance.receive"] },
  { prefix: "/pagar", module: "finance", any: ["finance.view"] },
  { prefix: "/conciliacao", module: "bank_reconciliation", any: ["finance.edit"] },
  { prefix: "/cartoes", module: "cards", any: ["finance.edit"] },
  { prefix: "/relatorios", any: ["reports"] },
  { prefix: "/notas/configuracao", owner: true, module: "nfse" },
  { prefix: "/notas/nova", module: "nfse", any: ["fiscal.issue"] },
  { prefix: "/notas", module: "nfse", any: ["fiscal.issue", "finance.view"] },
];

export type AccessCtx = { perms: ReadonlySet<string>; modules: Record<string, boolean | undefined>; isOwner: boolean };

/** null = allowed; otherwise the reason shown to the user. */
export function denyReason(path: string, c: AccessCtx): string | null {
  const rule = RULES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`));
  if (!rule) return null;
  if (rule.module && c.modules[rule.module] === false) return "Este módulo está desligado para esta empresa.";
  if (rule.owner && !c.isOwner) return "Só o Dono da conta acessa esta área.";
  if (rule.any && !c.isOwner && !rule.any.some((p) => c.perms.has(p))) return "Seu perfil não tem acesso a esta área.";
  return null;
}

export const canOpen = (path: string, c: AccessCtx) => denyReason(path, c) === null;

/** First screen the user can open, for the landing page. */
export function homeFor(c: AccessCtx): string {
  return ["/os", "/receber", "/cadastros/itens", "/relatorios", "/cadastros/clientes"].find((p) => canOpen(p, c)) ?? "/sem-acesso";
}

// ---------------------------------------------------------------- "Visualizar como" (owner only)
/** Cookie holding what the owner is previewing: a profile and/or a plan. */
export const PREVIEW_COOKIE = "scsync_preview";
export const PREVIEW_PLANS = ["trial", "servicos", "servicos_produtos", "completo"] as const;
export type Preview = { role: string | null; plan: (typeof PREVIEW_PLANS)[number] | null };

/** Reads the cookie; anything unknown is ignored. A custom profile has no fixed permissions, so it cannot be previewed. */
export function parsePreview(raw: string | null | undefined): Preview | null {
  if (!raw) return null;
  const [role, plan] = raw.split("|");
  const r = ROLES.some((x) => x.key === role && x.key !== "custom") ? role : null;
  const p = (PREVIEW_PLANS as readonly string[]).includes(plan) ? (plan as Preview["plan"]) : null;
  return r || p ? { role: r, plan: p } : null;
}
export const previewCookieValue = (role: string | null, plan: string | null) => `${role ?? ""}|${plan ?? ""}`;
export const roleLabel = (key: string) => ROLES.find((r) => r.key === key)?.label ?? key;
