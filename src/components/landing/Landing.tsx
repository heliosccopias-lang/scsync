import Link from "next/link";
import { TRIAL_DAYS } from "@/lib/plans";

const WHATSAPP_URL =
  "https://wa.me/5511999679058?text=" +
  encodeURIComponent("Olá! Quero contratar o SCsync completo (12x de R$ 420,00) para a minha gráfica.");

/* Simple line icons (24×24, stroke = currentColor) */
const I = {
  os: "M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6",
  pix: "M12 3l9 9-9 9-9-9zM8.5 12h7",
  bank: "M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  chat: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  box: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 15c1.8.6 3 2.2 3.5 5",
  pos: "M7 2h10v20H7zM10 6h4M10 10h4M10 14h1M13 14h1M10 17h1M13 17h1",
  screen: "M3 4h18v12H3zM8 20h8M12 16v4",
  check: "M5 12.5l4.5 4.5L19 7",
  dash: "M7 12h10",
};
function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: I.os, title: "OS feita para gráfica", text: "Formato, papel, cores, acabamento e arte aprovada. Via do cliente, ordem de produção e recibo em A4, com o seu logo." },
  { icon: I.pix, title: "Pix com baixa automática", text: "Gere o Pix da OS e mande pelo WhatsApp. Quando o cliente paga, a conta é baixada e a OS vira Paga sozinha." },
  { icon: I.pos, title: "Maquininha com baixa automática", text: "Envie o valor da OS direto para a maquininha Stone ou Mercado Pago. Quando o cartão é aprovado, a conta e a ordem de serviço recebem baixa automática." },
  { icon: I.box, title: "Venda no balcão e estoque", text: "Papel, tinta, envelope, agenda e caneta vendidos em segundos, com baixa de estoque e tabela de preços por planilha." },
  { icon: I.bank, title: "Conciliação bancária", text: "Extrato do banco por arquivo ou automático (Open Finance). O sistema casa cada entrada e saída com as contas." },
  { icon: I.chat, title: "Cartão de crédito pelo WhatsApp", text: "A equipe avisa os gastos para o robô e, no fechamento, tudo é conferido com a fatura do banco." },
  { icon: I.screen, title: "Funciona em qualquer tela", text: "Computador, tablet ou celular, pelo navegador, sem instalar nada." },
  { icon: I.users, title: "Cada um com seu acesso", text: "Atendimento, produção e financeiro com login e perfil próprios. Vários CNPJs na mesma conta." },
];

const STEPS: [string, string][] = [
  ["Abra a OS", "Cliente, trabalho gráfico e valores em uma tela. Mande o orçamento pelo WhatsApp."],
  ["Receba do jeito do cliente", "Pix, boleto, cartão na maquininha ou dinheiro. A baixa é automática."],
  ["Feche o mês sem planilha", "Banco e cartão conferidos, contas em dia e relatórios prontos."],
];

const PROJECT_ITEMS: string[] = [
  "Sistema completo instalado na conta da sua gráfica",
  "Personalizado com a marca e os dados da sua gráfica",
  "Contas bancárias conectadas e conciliação funcionando",
  "Pix e boleto com baixa automática",
  "Maquininhas Stone e Mercado Pago integradas",
  "Robô de WhatsApp ligado ao número da gráfica",
];

const FAQ: [string, string][] = [
  ["O que está incluído no projeto completo?", "O sistema instalado, configurado e personalizado com a marca da sua gráfica, com bancos, Pix, boleto, maquininhas e WhatsApp integrados e funcionando."],
  ["Depois das 12 parcelas, eu pago mensalidade?", "Não há mensalidade do sistema. Ele fica na conta da sua gráfica, e você paga só a hospedagem, direto ao provedor. As taxas de Pix, boleto e maquininha continuam sendo as de cada serviço."],
  ["O que eu preciso fornecer?", "Só o acesso às contas bancárias e ao WhatsApp da gráfica. Com isso, nossa equipe faz as conexões e a configuração."],
  ["Como funciona o teste grátis?", `São ${TRIAL_DAYS} dias para conhecer o sistema, sem cartão de crédito. No teste, as integrações com bancos, maquininhas e WhatsApp ficam desligadas: elas são configuradas na contratação.`],
  ["Meus dados ficam seguros?", "Cada gráfica só enxerga os próprios dados, com login individual, perfis de acesso e histórico de alterações."],
  ["Funciona no celular?", "Sim, pelo navegador do computador, tablet ou celular, sem instalar nada."],
];

export function Landing() {
  return (
    <div className="lp">
      <header className="lp-top">
        <div className="lp-wrap lp-top-in">
          <Link href="/" className="lp-brand" aria-label="SCsync">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/scsync-logo-compact-dark.svg" alt="SCsync" height={64} />
          </Link>
          <nav className="lp-nav">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#investimento">Investimento</a>
            <a href="#duvidas">Dúvidas</a>
          </nav>
          <div className="lp-top-cta">
            <Link className="lp-link" href="/login">
              Entrar
            </Link>
            <Link className="lp-btn lp-btn-sm" href="/login?cadastro=1">
              Testar grátis
            </Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div>
            <span className="lp-pill">Feito para gráficas rápidas e digitais</span>
            <h1>
              Da ordem de serviço ao <em>dinheiro na conta</em>, sem planilha.
            </h1>
            <p className="lp-lead">
              O SCsync organiza as OS, cobra por Pix, boleto e maquininha, dá baixa sozinho quando o cliente paga e confere o banco e o cartão para
              você.
            </p>
            <p
              style={{
                display: "inline-block",
                margin: "0 0 26px",
                padding: "10px 18px",
                borderRadius: 12,
                background: "var(--orange)",
                color: "var(--ink)",
                fontSize: "clamp(20px, 2.4vw, 26px)",
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              Pagou as 12x, o sistema é seu.
            </p>
            <div className="lp-cta">
              <Link className="lp-btn" href="/login?cadastro=1">
                Testar grátis por {TRIAL_DAYS} dias
              </Link>
              <a className="lp-btn lp-btn-ghost" href="#investimento">
                Ver o projeto completo
              </a>
            </div>
            <ul className="lp-trust">
              <li>
                <Icon d={I.check} size={16} /> Sem cartão de crédito
              </li>
              <li>
                <Icon d={I.check} size={16} /> Teste sem as integrações
              </li>
              <li>
                <Icon d={I.check} size={16} /> 12x de R$ 420,00, sem mensalidade
              </li>
            </ul>
          </div>

          {/* Product glimpse, drawn in HTML */}
          <div className="lp-mock" aria-hidden="true">
            <div className="lp-mock-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="lp-mock-body">
              <div className="lp-mock-head">
                <div>
                  <div className="lp-mock-title">OS #128 · Cartões de visita</div>
                  <div className="lp-mock-sub">Couchê 300 g · 4x4 · laminação fosca · arte aprovada</div>
                </div>
                <span className="lp-tag lp-tag-ok">Paga</span>
              </div>
              <div className="lp-mock-rows">
                <div>
                  <span>1.000 cartões de visita</span>
                  <strong>R$ 180,00</strong>
                </div>
                <div>
                  <span>Laminação fosca</span>
                  <strong>R$ 45,00</strong>
                </div>
                <div className="lp-mock-total">
                  <span>Total</span>
                  <strong>R$ 225,00</strong>
                </div>
              </div>
              <div className="lp-mock-pay">
                <div className="lp-mock-qr" />
                <div>
                  <strong>Pix recebido</strong>
                  <span>Baixa automática às 14:32 · conciliado com o extrato</span>
                </div>
              </div>
              <div className="lp-mock-stats">
                <div>
                  <span>Recebido hoje</span>
                  <strong>R$ 3.840</strong>
                </div>
                <div>
                  <span>OS em produção</span>
                  <strong>12</strong>
                </div>
                <div>
                  <span>Em atraso</span>
                  <strong className="bad">R$ 0</strong>
                </div>
              </div>
            </div>
            <div className="lp-float">
              <Icon d={I.chat} size={18} />
              <span>
                <strong>Robô:</strong> ✅ Anotado: papel couchê R$ 1.250,00
              </span>
            </div>
          </div>
        </div>
        <div className="lp-wrap">
          <div className="lp-integr">
            <span>Funciona com</span>
            <b>Pix</b>
            <b>Asaas</b>
            <b>Stone</b>
            <b>Mercado Pago</b>
            <b>WhatsApp</b>
            <b>Open Finance</b>
          </div>
        </div>
      </section>

      <section id="recursos" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-head">
            <span className="lp-eyebrow">Recursos</span>
            <h2>Tudo o que a gráfica precisa no dia a dia</h2>
            <p>Do balcão ao fechamento do mês, num sistema só.</p>
          </div>
          <div className="lp-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-feature">
                <div className="lp-ico">
                  <Icon d={f.icon} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="lp-section lp-soft">
        <div className="lp-wrap">
          <div className="lp-head">
            <span className="lp-eyebrow">Como funciona</span>
            <h2>Três passos, todo dia</h2>
          </div>
          <ol className="lp-steps">
            {STEPS.map(([t, d], i) => (
              <li key={t}>
                <span className="lp-step-n">{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="investimento" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-head">
            <span className="lp-eyebrow">Investimento</span>
            <h2>Um projeto completo, entregue pronto</h2>
            <p>Pagou as 12x, o sistema é seu: ele fica na conta da sua gráfica, sem mensalidade. Você só disponibiliza as contas bancárias e o WhatsApp para as conexões.</p>
          </div>

          <div className="lp-plan lp-plan-hi" style={{ maxWidth: 560, margin: "24px auto 0" }}>
            <span className="lp-badge">Projeto completo</span>
            <h3>SCsync completo</h3>
            <p className="lp-plan-sum">Configurado, personalizado e com as integrações funcionando</p>
            <div className="lp-price">
              <small>12x R$</small>
              420,00
            </div>
            <div className="lp-price-note">Sem mensalidade do sistema</div>
            <p style={{ margin: "0 0 22px", fontSize: "clamp(22px, 2.6vw, 28px)", fontWeight: 800, lineHeight: 1.15, color: "var(--orange)" }}>
              Pagou as 12x, o sistema é seu.
            </p>
            <ul>
              {PROJECT_ITEMS.map((f) => (
                <li key={f}>
                  <Icon d={I.check} size={16} />
                  {f}
                </li>
              ))}
            </ul>
            <div style={{ display: "grid", gap: 12 }}>
              <a className="lp-btn" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                Quero contratar pelo WhatsApp
              </a>
              <Link className="lp-btn lp-btn-ghost" href="/login?cadastro=1">
                Testar grátis por {TRIAL_DAYS} dias (sem integrações)
              </Link>
            </div>
          </div>
          <p className="lp-fine">
            O teste grátis mostra o sistema completo, mas sem as integrações com bancos, maquininhas e WhatsApp: elas são configuradas na contratação.
            O sistema fica na conta da sua gráfica: a hospedagem é paga direto ao provedor. Taxas de Pix, boleto e maquininha são as do seu provedor.
          </p>
        </div>
      </section>

      <section id="duvidas" className="lp-section lp-soft">
        <div className="lp-wrap lp-narrow">
          <div className="lp-head">
            <span className="lp-eyebrow">Dúvidas</span>
            <h2>Perguntas frequentes</h2>
          </div>
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
          <p>Teste grátis por {TRIAL_DAYS} dias, sem cartão de crédito e sem as integrações.</p>
          <Link className="lp-btn lp-btn-light" href="/login?cadastro=1">
            Criar minha conta grátis
          </Link>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/scsync-logo-compact.svg" alt="SCsync" height={52} />
          <nav>
            <a href="#recursos">Recursos</a>
            <a href="#investimento">Investimento</a>
            <a href="#duvidas">Dúvidas</a>
            <Link href="/login">Entrar</Link>
          </nav>
          <span>© {new Date().getFullYear()} SCsync · gestão para gráficas</span>
        </div>
      </footer>
    </div>
  );
}
