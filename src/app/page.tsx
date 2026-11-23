import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { supabaseUser } from "@/lib/supabase";
import { requireOrg } from "@/lib/session";
import { homeFor } from "@/lib/access";
import { PLANS, TRIAL_DAYS, YEARLY_DISCOUNT, priceCents } from "@/lib/plans";
import { formatBRL } from "@/lib/money";

export const metadata: Metadata = {
  title: "SCsync — gestão para gráficas rápidas",
  description: `Ordem de serviço, cobrança por Pix e boleto, conciliação bancária e de cartão para gráficas. Teste grátis por ${TRIAL_DAYS} dias.`,
};

const FEATURES: [string, string][] = [
  ["Nota fiscal de serviço", "No plano Completo, emita a NFS-e direto da OS ou avulsa, com PDF e XML, ou deixe sair sozinha quando o cliente pagar."],
  ["Ordem de serviço de gráfica", "Formato, papel, cores, acabamento e arte aprovada na OS. Via do cliente, ordem de produção e recibo prontos para imprimir em A4."],
  ["Cobrança por Pix, boleto e cartão", "Gere o Pix da OS e mande pelo WhatsApp. A baixa é automática quando o cliente paga, pelo Asaas."],
  ["Conciliação bancária", "Importe o extrato OFX e o sistema casa cada entrada e saída com as contas a receber e a pagar."],
  ["Cartão de crédito sem planilha", "A equipe avisa os gastos pelo WhatsApp, o robô categoriza e, no fechamento, confere tudo com a fatura do banco."],
  ["Produtos e estoque", "Importe sua tabela de preços por planilha, controle o estoque e dê baixa direto pelas OS."],
  ["Cada um com seu acesso", "Atendimento, produção, financeiro: cada pessoa com login e perfil próprios. Vários CNPJs na mesma conta."],
];

const FAQ: [string, string][] = [
  ["Preciso de cartão de crédito para testar?", `Não. São ${TRIAL_DAYS} dias grátis com tudo liberado. Só no fim do teste você escolhe o plano.`],
  ["Como pago a mensalidade?", "Por Pix, boleto ou cartão, numa página segura do Asaas. O plano anual tem 15% de desconto."],
  ["Posso trocar de plano depois?", "Pode, a qualquer momento. O novo valor vale a partir da próxima mensalidade."],
  ["E se eu cancelar?", "A conta continua funcionando até o fim do período já pago. Seus dados não são apagados."],
  ["Funciona no celular?", "Sim, pelo navegador do computador, tablet ou celular, sem instalar nada."],
];

function Landing() {
  return (
    <div className="lp">
      <header className="lp-top">
        <div className="lp-wrap lp-top-in">
          <Link href="/" className="lp-brand" aria-label="SCsync">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/scsync-logo-compact-dark.svg" alt="SCsync" height={56} />
          </Link>
          <nav>
            <a href="#recursos">Recursos</a>
            <a href="#planos">Planos</a>
            <a href="#duvidas">Dúvidas</a>
            <Link href="/login">Entrar</Link>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lp-hero-logo" src="/brand/scsync-logo-dark.svg" alt="" aria-hidden="true" />
          <div>
          <p className="lp-kicker">Para gráficas rápidas e digitais</p>
          <h1>Da ordem de serviço ao dinheiro na conta, sem planilha.</h1>
          <p className="lp-lead">
            O SCsync organiza as OS, cobra por Pix e boleto, dá baixa sozinho quando o cliente paga e confere o extrato do banco e a fatura do cartão
            para você.
          </p>
          <div className="lp-cta">
            <Link className="lp-btn" href="/login?cadastro=1">
              Testar grátis por {TRIAL_DAYS} dias
            </Link>
            <a className="lp-btn lp-btn-ghost" href="#planos">
              Ver planos
            </a>
          </div>
          <p className="lp-note">Sem cartão de crédito para começar.</p>
          </div>
        </div>
      </section>

      <section id="recursos" className="lp-section">
        <div className="lp-wrap">
          <h2>Tudo o que a gráfica precisa no dia a dia</h2>
          <div className="lp-grid">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="lp-card">
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="lp-section lp-alt">
        <div className="lp-wrap">
          <h2>Planos</h2>
          <p className="lp-sub">
            {TRIAL_DAYS} dias grátis em qualquer plano. No anual, {Math.round(YEARLY_DISCOUNT * 100)}% de desconto.
          </p>
          <div className="lp-plans">
            {PLANS.map((p) => (
              <div key={p.key} className={`lp-plan${p.key === "servicos_produtos" ? " lp-plan-hi" : ""}`}>
                {p.key === "servicos_produtos" ? <span className="lp-badge">Mais escolhido</span> : null}
                <h3>{p.name}</h3>
                <p className="lp-plan-sum">{p.summary}</p>
                <div className="lp-price">
                  {formatBRL(p.monthlyCents)}
                  <span>/mês</span>
                </div>
                <div className="lp-year">
                  ou {formatBRL(priceCents(p.key, "yearly"))} no plano anual
                  <br />
                  (equivale a {formatBRL(Math.round(priceCents(p.key, "yearly") / 12))}/mês)
                </div>
                <ul>
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <Link className={`lp-btn${p.key === "servicos_produtos" ? "" : " lp-btn-ghost"}`} href="/login?cadastro=1">
                  Começar o teste grátis
                </Link>
              </div>
            ))}
          </div>
          <p className="lp-fine">Valores por conta, já com todas as atualizações. O plano Completo emite nota fiscal de serviço (NFS-e) pela conta Asaas da gráfica; precisa do CNPJ e do cadastro fiscal na prefeitura. Nota de produto (NF-e) não está incluída.</p>
        </div>
      </section>

      <section id="duvidas" className="lp-section">
        <div className="lp-wrap lp-narrow">
          <h2>Dúvidas frequentes</h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className="lp-faq">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-wrap">
          <h2>Comece hoje e veja a diferença no fechamento do mês.</h2>
          <Link className="lp-btn" href="/login?cadastro=1">
            Testar grátis por {TRIAL_DAYS} dias
          </Link>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/scsync-logo-compact.svg" alt="SCsync" height={48} /> · gestão para gráficas
        </div>
      </footer>
    </div>
  );
}

export default async function Home() {
  const sb = await supabaseUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) return <Landing />;
  const ctx = await requireOrg();
  redirect(homeFor(ctx));
}
