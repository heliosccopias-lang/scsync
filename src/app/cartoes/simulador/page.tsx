import Link from "next/link";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { cardCycles } from "@/lib/card";
import { fmtDate } from "@/lib/format";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { cleanupTest, importSample, prepareTest, simulateMessage } from "./actions";
import { SIM_PROVIDER, STRANGER_PHONE, TEST_CARD } from "./constants";

const EXAMPLES = ["ajuda", "gasolina 150,00", "almoço 45,90 ontem", "papel couchê 1.250,00 teste", "estacionamento 12", "cancelar", "oi tudo bem?"];

export default async function RobotSimulatorPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; de?: string }> }) {
  const { error, ok, de } = await searchParams;
  const { sb, orgId, orgName, isOwner } = await requireOrg();
  const [{ data: senders }, { data: cards }, { data: inbox }, { data: pending }, { data: cats }] = await Promise.all([
    sb.from("whatsapp_senders").select("phone, name").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("credit_cards").select("id, name, last4, closing_day, due_day").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("whatsapp_inbox").select("id, from_phone, text, reply, result, created_at").eq("org_id", orgId).eq("provider", SIM_PROVIDER).order("created_at", { ascending: false }).limit(30),
    sb.from("card_expenses").select("id, spent_on, amount_cents, description, card_id, status").eq("org_id", orgId).eq("status", "pending").order("spent_on", { ascending: false }).limit(50),
    sb.from("financial_categories").select("name, keywords").eq("org_id", orgId).eq("direction", "out").order("name"),
  ]);
  const ready = (cards ?? []).length > 0 && (senders ?? []).length > 0;
  const hasKeywords = (cats ?? []).some((c) => (c.keywords ?? []).length);
  const chosen = de ?? (senders ?? [])[0]?.phone ?? "";
  const name = (phone: string) => (phone === STRANGER_PHONE ? "Número não autorizado" : ((senders ?? []).find((s) => s.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""))?.name ?? phone));
  const today = todayInSaoPaulo();

  return (
    <Shell orgName={orgName}>
      <Link href="/cartoes" className="muted">
        ← Conciliação de cartão
      </Link>
      <h1 style={{ margin: "6px 0 4px" }}>Testar o robô de WhatsApp</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Simula as mensagens que a equipe mandaria pelo WhatsApp, sem precisar da Z-API. O sistema trata cada mensagem exatamente como trataria uma
        vinda do WhatsApp: confere se o número é autorizado, entende a despesa, responde e lança em &ldquo;despesas aguardando a fatura&rdquo;. Depois,
        importe a fatura de exemplo para testar a conciliação até o fechamento.
      </p>
      <Notice error={error} ok={ok} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>1. Preparar</h2>
        <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          <li>{(cards ?? []).length ? `Cartões: ${(cards ?? []).map((c) => `${c.name}${c.last4 ? ` (final ${c.last4})` : ""}`).join(", ")}` : "Nenhum cartão cadastrado."}</li>
          <li>{(senders ?? []).length ? `Números autorizados: ${(senders ?? []).map((s) => s.name || s.phone).join(", ")}` : "Nenhum número autorizado."}</li>
          <li>{hasKeywords ? "Categorias com palavras-chave: o robô já sabe categorizar." : "As categorias não têm palavras-chave: o robô não vai categorizar sozinho."}</li>
        </ul>
        {isOwner ? (
          <form action={prepareTest}>
            <button className={ready && hasKeywords ? "btn btn-secondary" : "btn btn-primary"}>
              {ready && hasKeywords ? "Completar dados de teste" : "Preparar dados de teste"}
            </button>{" "}
            <span className="muted" style={{ fontSize: 13 }}>
              Cria o &ldquo;{TEST_CARD}&rdquo; (final 9999, fecha dia 3, vence dia 10), um número de teste autorizado e palavras-chave nas categorias
              (combustível, alimentação, estacionamento, tarifas, material gráfico).
            </span>
          </form>
        ) : (
          <p className="muted">Peça ao Dono da conta para preparar os dados de teste.</p>
        )}
      </section>

      <section id="conversa" className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>2. Conversar com o robô</h2>
        <form action={simulateMessage} className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, width: 230 }}>
            <label htmlFor="from">Quem manda</label>
            <select id="from" name="from" defaultValue={chosen}>
              {(senders ?? []).map((s) => (
                <option key={s.phone} value={s.phone.replace(/\D/g, "")}>
                  {s.name || s.phone}
                </option>
              ))}
              <option value="stranger">Número não autorizado</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
            <label htmlFor="text">Mensagem</label>
            <input id="text" name="text" placeholder="Ex.: gasolina 150,00" autoComplete="off" autoFocus />
          </div>
          <button className="btn btn-primary">Enviar</button>
        </form>
        <div className="row" style={{ marginTop: 8, gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>Exemplos:</span>
          {EXAMPLES.map((t) => (
            <form key={t} action={simulateMessage}>
              <input type="hidden" name="from" value={chosen.replace(/\D/g, "") || "stranger"} />
              <input type="hidden" name="text" value={t} />
              <button className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: 12 }}>
                {t}
              </button>
            </form>
          ))}
        </div>

        <div className="wa-chat">
          {(inbox ?? []).length === 0 ? <p className="muted" style={{ textAlign: "center" }}>Nenhuma mensagem ainda.</p> : null}
          {(inbox ?? []).map((m) => (
            <div key={m.id}>
              <div className="wa-row wa-in">
                <div className="wa-bubble wa-bubble-in">
                  <div className="wa-who">{name(m.from_phone)}</div>
                  {m.text ?? <em className="muted">(texto não guardado)</em>}
                  <div className="wa-time">{new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</div>
                </div>
              </div>
              <div className="wa-row wa-out">
                <div className={`wa-bubble ${m.result === "unauthorized" ? "wa-bubble-muted" : "wa-bubble-out"}`}>
                  {m.result === "unauthorized" ? (
                    <em>O robô não respondeu: número não autorizado. A mensagem foi ignorada e o texto não foi guardado.</em>
                  ) : (
                    <span style={{ whiteSpace: "pre-wrap" }}>{(m.reply ?? "").replace(/\*/g, "")}</span>
                  )}
                  {m.result === "saved" ? <div className="wa-tag">lançada</div> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>3. Despesas aguardando a fatura ({(pending ?? []).length})</h2>
        {(pending ?? []).length ? (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Despesa</th>
                <th>Cartão</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {(pending ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.spent_on)}</td>
                  <td>{e.description}</td>
                  <td>{(cards ?? []).find((c) => c.id === e.card_id)?.name ?? <span className="muted">não informado</span>}</td>
                  <td className="num">{formatBRL(Number(e.amount_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Nenhuma. Mande algumas despesas no simulador acima.</p>
        )}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>4. Fatura de exemplo e conciliação</h2>
        <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
          Monta a fatura do ciclo atual do cartão com as despesas acima (como o banco escreve: nome da loja, às vezes um dia depois) e os casos que
          toda fatura traz: uma compra que ninguém avisou, uma parcela, uma anuidade, um estorno e o pagamento da fatura anterior (que a importação
          descarta). Depois de importar: confira o que casou sozinho, case ou categorize o resto, ignore o que não for despesa e feche a fatura — a
          conta a pagar aparece em Contas a pagar.
        </p>
        {(cards ?? []).length ? (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <form action={importSample} className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="card_id">Cartão</label>
                <select id="card_id" name="card_id">
                  {(cards ?? []).map((c) => {
                    const cy = cardCycles(today, c.closing_day ?? 3, c.due_day ?? null).current;
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name} — fatura que fecha em {fmtDate(cy.closing)}
                      </option>
                    );
                  })}
                </select>
              </div>
              <button className="btn btn-primary">Importar fatura de exemplo</button>
            </form>
            {(cards ?? []).map((c) => (
              <a key={c.id} className="btn btn-secondary" href={`/cartoes/simulador/fatura-exemplo?card=${c.id}`}>
                Baixar CSV ({c.name})
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">Prepare os dados de teste primeiro.</p>
        )}
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          &ldquo;Baixar CSV&rdquo; serve para testar também o caminho do arquivo: em Conciliação de cartão → Importar fatura, escolha o arquivo baixado.
        </p>
      </section>

      {isOwner ? (
        <section className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>
          <h2 style={{ marginTop: 0 }}>Limpar os testes</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Apaga só o que os testes criaram: mensagens do simulador e as despesas lançadas por elas, faturas de exemplo (as fechadas são reabertas e
            a conta a pagar delas é cancelada), o &ldquo;{TEST_CARD}&rdquo; e o número de teste. Despesas e faturas reais não são tocadas; categorias e
            palavras-chave ficam. Não dá para desfazer.
          </p>
          <form action={cleanupTest}>
            <button className="btn btn-secondary">Limpar dados de teste</button>
          </form>
        </section>
      ) : null}
    </Shell>
  );
}
