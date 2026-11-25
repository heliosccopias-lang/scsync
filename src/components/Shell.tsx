import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { MenuCloser } from "./MenuCloser";
import { requireOrg } from "@/lib/session";
import { canOpen } from "@/lib/access";
import { GRACE_DAYS } from "@/lib/plans";
import { switchOrg } from "@/app/empresa/actions";
import { PreviewBanner, PreviewForm } from "./PreviewControls";

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
        <Link href="/" className="brand" aria-label="SCsync — início">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/scsync-logo-compact-dark.svg" alt="SCsync" height={64} />
        </Link>
        {/* Mobile: the menu button toggles the nav (pure CSS, no script). */}
        <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
        <label htmlFor="nav-toggle" className="nav-burger" aria-label="Abrir menu">
          <span />
          <span />
          <span />
        </label>
        <nav className="topnav">
          {group("Ordens de serviço", [
            ["/os", "Todas as ordens de serviço"],
            ["/os/nova", "Nova ordem de serviço"],
            ["/os/pagas", "Ordens de serviço pagas"],
          ])}
          {ok("/vendas/nova") ? <Link href="/vendas/nova">Venda no balcão</Link> : null}
          {group("Financeiro", [
            ["/receber", "Contas a receber"],
            ["/avisos", "Avisos por WhatsApp (cobrança e OS pronta)"],
            ["/pagar", "Contas a pagar"],
            ["/conciliacao", "Conciliação bancária"],
            ["/cartoes", "Conciliação de cartão de crédito"],
            ["/configuracoes/conexoes", "Conexões bancárias (importação e API)"],
          ])}
          {group("Notas fiscais", [
            ["/notas/nova", "Emitir nota avulsa"],
            ["/notas", "Notas emitidas"],
            ["/notas/configuracao", "Configuração fiscal"],
          ])}
          {ok("/relatorios") ? <Link href="/relatorios">Relatórios</Link> : null}
          {group("Cadastros", [
            ["/cadastros/clientes", "Clientes"],
            ["/cadastros/itens", "Serviços e produtos"],
            ["/cadastros/tecnicos", "Técnicos e atendentes"],
            ["/cadastros/checklists", "Checklists"],
          ])}
          {group("Configurações", [
            ["/configuracoes/asaas", "Conexão Asaas"],
            ["/configuracoes/contas", "Contas bancárias"],
            ["/configuracoes/conexoes", "Conexões bancárias (importação e API)"],
            ["/configuracoes/maquininhas", "Maquininhas (Stone, Mercado Pago, PagBank)"],
            ["/configuracoes/financeiro", "Juros, categorias e condições"],
            ["/configuracoes/cartoes", "Cartões de crédito"],
            ["/configuracoes/whatsapp", "WhatsApp da empresa (robô e avisos)"],
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
        <details className="menu usermenu">
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
      {ctx.preview ? <PreviewBanner label={ctx.preview.label} role={ctx.preview.role} plan={ctx.preview.plan} /> : null}
      {!ctx.preview && ctx.realOwner ? (
        <div className="preview-cta">
          <details className="menu-inline">
            <summary className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }}>
              👁 Visualizar como cliente
            </summary>
            <div className="menu-list" style={{ right: 0, left: "auto", minWidth: 300 }}>
              <div className="muted" style={{ fontSize: 12, margin: "2px 4px 8px" }}>
                Escolha o perfil do usuário e o plano da gráfica para ver como as telas ficam depois das suas configurações. Nada é gravado enquanto
                estiver visualizando.
              </div>
              <PreviewForm compact />
            </div>
          </details>
        </div>
      ) : null}
      {ctx.account?.status === "past_due" && !ctx.preview ? (
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
      {trialDays !== null && trialDays >= 0 && !ctx.preview ? (
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
  grouped: ["Agrupada", "pill-open"],
};

export function PaymentPill({ status }: { status: string }) {
  const [label, cls] = PAYMENT_LABEL[status] ?? [status, "pill-neutral"];
  return <span className={`pill ${cls}`}>{label}</span>;
}

const OS_STATUS: Record<string, string> = {
  open: "Aberta",
  approved: "Aprovada",
  in_progress: "Em execução",
  waiting_parts: "Aguardando material",
  paid: "Paga",
  done: "Concluída (aguardando pagamento)",
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
