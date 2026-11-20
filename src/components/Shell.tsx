import Link from "next/link";
import { signOut } from "@/app/login/actions";

export function Shell({ orgName, children }: { orgName: string; children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          SC<span>sync</span>
        </div>
        <nav>
          <Link href="/os">Ordens de serviço</Link>
          <Link href="/receber">Contas a receber</Link>
          <details className="menu">
            <summary>Cadastros</summary>
            <div className="menu-list">
              <Link href="/cadastros/clientes">Clientes</Link>
              <Link href="/cadastros/itens">Serviços e produtos</Link>
              <Link href="/cadastros/tecnicos">Técnicos</Link>
            </div>
          </details>
          <details className="menu">
            <summary>Configurações</summary>
            <div className="menu-list">
              <Link href="/configuracoes/asaas">Conexão Asaas</Link>
            </div>
          </details>
        </nav>
        <span className="org">{orgName}</span>
        <form action={signOut}>
          <button className="btn btn-secondary" style={{ padding: "5px 10px", fontSize: 13 }}>
            Sair
          </button>
        </form>
      </header>
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
