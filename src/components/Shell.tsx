import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { MenuCloser } from "./MenuCloser";
import { requireOrg } from "@/lib/session";
import { canOpen } from "@/lib/access";
import { GRACE_DAYS } from "@/lib/plans";
import { switchOrg } from "@/app/empresa/actions";

/** Top bar: menu filtered by the user's profile and the company's modules, company switcher, account links. */
export async function Shell({ children }: { orgName?: string; children: React.ReactNode }) {
  const ctx = await requireOrg();
  const ok = (path: string) => canOpen(path, ctx);
  const group = (label: string, links: [string, string][]) => {
    const visible = links.filter(([href]) => ok(href));
    if (!visible.length) return null;
    return (
      <details className="menu">
        <summary>{label}</summary>
        <div className="menu-list">
          {visible.map(([href, text]) => (
            <Link key={href} href={href}>
              {text}
            </Link>
          ))}
        </div>
      </details>
    );
  };
  const trialDays =
    ctx.account?.status === "trial" && ctx.account.trial_ends_at
      ? Math.ceil((Date.parse(`${ctx.account.trial_ends_at}T23:59:59-03:00`) - Date.now()) / 86_400_000)
      : null;
  return (
    <>
      <MenuCloser />
      <header className="topbar">
        <div className="brand">
          SC<span>sync</span>
        </div>
        <nav>
          {ok("/os") ? <Link href="/os">Ordens de serviço</Link> : null}
          {group("Financeiro", [
            ["/receber", "Contas a receber"],
            ["/pagar", "Contas a pagar"],
            ["/conciliacao", "Conciliação bancária"],
            ["/cartoes", "Conciliação de cartão de crédito"],
          ])}
          {ok("/relatorios") ? <Link href="/relatorios">Relatórios</Link> : null}
          {group("Cadastros", [
            ["/cadastros/clientes", "Clientes"],
            ["/cadastros/itens", "Serviços e produtos"],
            ["/cadastros/tecnicos", "Técnicos"],
            ["/cadastros/checklists", "Checklists"],
          ])}
          {group("Configurações", [
            ["/configuracoes/asaas", "Conexão Asaas"],
            ["/configuracoes/contas", "Contas bancárias"],
            ["/configuracoes/financeiro", "Juros, categorias e condições"],
            ["/configuracoes/cartoes", "Cartões de crédito"],
            ["/configuracoes/whatsapp", "Robô de WhatsApp"],
          ])}
          {ctx.isOwner ? <Link href="/conta">Conta</Link> : null}
        </nav>
        {ctx.orgs.length > 1 ? (
          <form action={switchOrg} className="org" style={{ display: "flex", gap: 4 }}>
            <select name="org_id" defaultValue={ctx.orgId} aria-label="Empresa atual" style={{ padding: "4px 6px", fontSize: 13, width: "auto" }}>
              {ctx.orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: 12 }}>
              Trocar
            </button>
          </form>
        ) : (
          <span className="org">{ctx.orgName}</span>
        )}
        <details className="menu">
          <summary style={{ fontSize: 13 }}>{ctx.userName.split("@")[0]}</summary>
          <div className="menu-list" style={{ right: 0, left: "auto" }}>
            <Link href="/minha-senha">Trocar minha senha</Link>
            <form action={signOut}>
              <button className="btn btn-secondary" style={{ width: "100%", marginTop: 4 }}>
                Sair
              </button>
            </form>
          </div>
        </details>
      </header>
      {ctx.account?.status === "past_due" ? (
        <div className="notice notice-error" style={{ margin: 0, borderRadius: 0, textAlign: "center" }}>
          A mensalidade do SCsync está em atraso; o acesso é bloqueado {GRACE_DAYS} dias após o vencimento.
          {ctx.isOwner ? (
            <>
              {" "}
              <Link href="/conta/assinatura">Pagar agora</Link>
            </>
          ) : null}
        </div>
      ) : null}
      {trialDays !== null && trialDays >= 0 ? (
        <div className="notice" style={{ margin: 0, borderRadius: 0, textAlign: "center", background: "var(--orange-soft)", color: "var(--orange-ink)" }}>
          Período de teste: {trialDays === 0 ? "termina hoje" : `${trialDays} dia(s) restante(s)`}.
          {ctx.isOwner ? (
            <>
              {" "}
              <Link href="/conta/assinatura">Escolher plano</Link>
            </>
          ) : null}
        </div>
      ) : null}
      <main>{children}</main>
    </>
  );
}

const PAYMENT_LABEL: Record<string, [string, string]> = {
  not_billed: ["Não faturada", "pill-neutral"],
  open: ["A receber", "pill-open"],
  partial: ["Parcial", "pill-partial"],
  paid: ["Paga", "pill-paid"],
  overdue: ["Em atraso", "pill-overdue"],
  cancelled: ["Cancelada", "pill-neutral"],
};

export function PaymentPill({ status }: { status: string }) {
  const [label, cls] = PAYMENT_LABEL[status] ?? [status, "pill-neutral"];
  return <span className={`pill ${cls}`}>{label}</span>;
}

const OS_STATUS: Record<string, string> = {
  open: "Aberta",
  approved: "Aprovada",
  in_progress: "Em execução",
  waiting_parts: "Aguardando peças",
  done: "Concluída",
  delivered: "Entregue",
  cancelled: "Cancelada",
};

export function osStatusLabel(s: string) {
  return OS_STATUS[s] ?? s;
}

export function Notice({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="notice notice-error">{error}</div>;
  if (ok) return <div className="notice notice-ok">{ok}</div>;
  return null;
}
