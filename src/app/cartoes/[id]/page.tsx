import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { addDays, formatBRL } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { matchScore } from "@/lib/card";
import { autoMatch, categorizeLines, closeStatement, deleteStatement, ignoreLine, matchLine, reopenStatement, unmatchLine } from "../actions";

const STATUS: Record<string, [string, string]> = {
  pending: ["A conciliar", "pill-overdue"],
  matched: ["Conciliado", "pill-paid"],
  categorized: ["Categorizado", "pill-open"],
  ignored: ["Ignorado", "pill-neutral"],
};

export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const { data: st } = await sb.from("card_statements").select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (!st) notFound();
  const [{ data: card }, { data: txs }, { data: cats }, { data: accounts }, { data: payable }] = await Promise.all([
    sb.from("credit_cards").select("id, name, last4, bank_account_id, category_id").eq("id", st.card_id).single(),
    sb.from("card_transactions").select("*").eq("statement_id", id).order("posted_on").order("created_at"),
    sb.from("financial_categories").select("id, name").eq("org_id", orgId).eq("direction", "out").order("name"),
    sb.from("bank_accounts").select("id, name").eq("org_id", orgId).eq("active", true).order("created_at"),
    st.payable_id ? sb.from("payables").select("id, status, amount_cents").eq("id", st.payable_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const lines = txs ?? [];
  const expIds = lines.map((t) => t.expense_id).filter(Boolean) as string[];
  const start = st.period_start ?? addDays(st.closing_date, -35);
  const [{ data: matchedExps }, { data: openExps }] = await Promise.all([
    expIds.length ? sb.from("card_expenses").select("id, description, spent_on, sender_name, source").in("id", expIds) : Promise.resolve({ data: [] as { id: string; description: string; spent_on: string; sender_name: string | null; source: string }[] }),
    sb
      .from("card_expenses")
      .select("id, description, spent_on, amount_cents, sender_name, source, card_id")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .or(`card_id.eq.${st.card_id},card_id.is.null`)
      .gte("spent_on", addDays(st.closing_date, -400))
      .lte("spent_on", addDays(st.closing_date, 3))
      .order("spent_on"),
  ]);
  const expById = new Map((matchedExps ?? []).map((e) => [e.id, e]));
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const open = st.status === "open";

  const total = lines.filter((t) => t.status !== "ignored").reduce((a, t) => a + Number(t.amount_cents), 0);
  const count = (s: string) => lines.filter((t) => t.status === s).length;
  const pending = count("pending");
  const byCategory = [...lines
    .filter((t) => t.status !== "ignored")
    .reduce((m, t) => m.set(t.category_id ?? "", (m.get(t.category_id ?? "") ?? 0) + Number(t.amount_cents)), new Map<string, number>())
    .entries()].sort((a, b) => b[1] - a[1]);
  // Robot expenses of this period that the bank did not charge (yet).
  const notOnBill = (openExps ?? []).filter((e) => e.spent_on >= start && e.spent_on <= st.closing_date);

  return (
    <Shell orgName={orgName}>
      <p className="muted" style={{ margin: "0 0 4px" }}>
        <Link href="/cartoes">← Conciliação de cartão</Link>
      </p>
      <div className="spread">
        <h1 style={{ margin: 0 }}>
          Fatura {st.reference.split("-").reverse().join("/")} · {card?.name}
          {card?.last4 ? ` •••• ${card.last4}` : ""}
        </h1>
        <span>
          {open ? <span className="pill pill-open">Aberta</span> : <span className="pill pill-paid">Fechada</span>}
        </span>
      </div>
      <p className="muted">
        Fechamento {fmtDate(st.closing_date)} · vencimento {fmtDate(st.due_date)} · {lines.length} lançamento(s): {count("matched")} conciliado(s), {count("categorized")}{" "}
        só categorizado(s), {count("ignored")} ignorado(s), <strong style={{ color: pending ? "var(--bad)" : undefined }}>{pending} a conciliar</strong>
      </p>
      <Notice error={error} ok={ok} />

      <div className="grid2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="muted">Total da fatura (sem ignorados)</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{formatBRL(total)}</div>
          <table style={{ marginTop: 8 }}>
            <tbody>
              {byCategory.map(([cat, v]) => (
                <tr key={cat || "none"}>
                  <td>{cat ? catName.get(cat) : <span style={{ color: "var(--bad)" }}>Sem categoria</span>}</td>
                  <td className="num">{formatBRL(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          {open ? (
            <>
              <form action={autoMatch} style={{ marginBottom: 12 }}>
                <input type="hidden" name="statement_id" value={id} />
                <button className="btn btn-secondary">Conciliar automaticamente com o robô</button>
              </form>
              <form action={closeStatement}>
                <input type="hidden" name="statement_id" value={id} />
                <strong>Fechar a fatura</strong>
                <p className="muted" style={{ margin: "4px 0 8px", fontSize: 13 }}>
                  Todos os lançamentos precisam estar conciliados, categorizados ou ignorados. Gera a conta a pagar da fatura.
                </p>
                <div className="row">
                  <select name="bank_account_id" defaultValue={card?.bank_account_id ?? ""} aria-label="Conta que paga" style={{ width: 200 }} required>
                    <option value="">Conta que paga</option>
                    {(accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select name="category_id" defaultValue={card?.category_id ?? ""} aria-label="Categoria da fatura" style={{ width: 200 }}>
                    <option value="">Categoria da fatura</option>
                    {(cats ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary" disabled={pending > 0}>
                    Fechar fatura
                  </button>
                </div>
              </form>
              <form action={deleteStatement} style={{ marginTop: 12 }}>
                <input type="hidden" name="statement_id" value={id} />
                <button className="btn btn-secondary" style={{ color: "var(--bad)" }}>
                  Apagar esta fatura importada
                </button>
              </form>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                Fechada em {fmtDate(String(st.closed_at).slice(0, 10))}.{" "}
                {payable ? (
                  <>
                    Conta a pagar: <Link href="/pagar">{formatBRL(payable.amount_cents)}</Link> ({payable.status === "paid" ? "paga" : payable.status === "cancelled" ? "cancelada" : "em aberto"}).
                  </>
                ) : (
                  "Sem valor a pagar."
                )}
              </p>
              <form action={reopenStatement}>
                <input type="hidden" name="statement_id" value={id} />
                <button className="btn btn-secondary">Reabrir fatura</button>
              </form>
            </>
          )}
        </div>
      </div>

      <form action={categorizeLines} id="cats" />
      <input type="hidden" name="statement_id" value={id} form="cats" />
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Lançamento da fatura</th>
            <th>Despesa do robô</th>
            <th>Categoria</th>
            <th>Situação</th>
            <th className="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((t) => {
            const exp = t.expense_id ? expById.get(t.expense_id) : null;
            const candidates = (openExps ?? [])
              .map((e) => ({ e, s: matchScore({ id: t.id, postedOn: t.posted_on, amountCents: Number(t.amount_cents), description: t.description, installment: t.installment }, { id: e.id, spentOn: e.spent_on, amountCents: Number(e.amount_cents), description: e.description }) }))
              .filter((c) => Number(c.e.amount_cents) === Number(t.amount_cents))
              .sort((a, b) => b.s - a.s);
            const [label, cls] = STATUS[t.status] ?? [t.status, "pill-neutral"];
            return (
              <tr key={t.id} style={{ opacity: t.status === "ignored" ? 0.55 : 1 }}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(t.posted_on)}</td>
                <td>
                  {t.description}
                  {t.installment ? <span className="muted"> · parcela {t.installment}</span> : null}
                </td>
                <td>
                  {exp ? (
                    <>
                      {exp.description} <span className="muted">({fmtDate(exp.spent_on)}{exp.sender_name ? ` · ${exp.sender_name}` : ""})</span>
                      {open ? (
                        <form action={unmatchLine} style={{ display: "inline", marginLeft: 6 }}>
                          <input type="hidden" name="statement_id" value={id} />
                          <input type="hidden" name="tx_id" value={t.id} />
                          <button className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: 12 }}>
                            Desfazer
                          </button>
                        </form>
                      ) : null}
                    </>
                  ) : open && t.status !== "ignored" && Number(t.amount_cents) > 0 ? (
                    candidates.length ? (
                      <form action={matchLine} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                        <input type="hidden" name="statement_id" value={id} />
                        <input type="hidden" name="tx_id" value={t.id} />
                        <select name="expense_id" aria-label="Despesa do robô" style={{ width: 200 }}>
                          {candidates.map(({ e }) => (
                            <option key={e.id} value={e.id}>
                              {fmtDate(e.spent_on)} · {e.description}
                            </option>
                          ))}
                        </select>
                        <button className="btn btn-secondary" style={{ padding: "4px 10px" }}>
                          Casar
                        </button>
                      </form>
                    ) : (
                      <span className="muted">Ninguém avisou essa despesa</span>
                    )
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {open && t.status !== "ignored" ? (
                    <>
                      <input type="hidden" name="tx_id" value={t.id} form="cats" />
                      <input type="hidden" name={`st_${t.id}`} value={t.status} form="cats" />
                      <select name={`cat_${t.id}`} defaultValue={t.category_id ?? ""} form="cats" aria-label="Categoria" style={{ width: 170 }}>
                        <option value="">Escolher…</option>
                        {(cats ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    (catName.get(t.category_id ?? "") ?? "—")
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className={`pill ${cls}`}>{label}</span>
                  {open && !t.expense_id ? (
                    <form action={ignoreLine} style={{ display: "inline", marginLeft: 6 }}>
                      <input type="hidden" name="statement_id" value={id} />
                      <input type="hidden" name="tx_id" value={t.id} />
                      <input type="hidden" name="ignore" value={String(t.status !== "ignored")} />
                      <button className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: 12 }} title="Ignorar: não entra no total (ex.: lançamento duplicado do banco)">
                        {t.status === "ignored" ? "Voltar" : "Ignorar"}
                      </button>
                    </form>
                  ) : null}
                </td>
                <td className="num" style={{ color: Number(t.amount_cents) < 0 ? "var(--ok)" : undefined }}>
                  {formatBRL(t.amount_cents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {open && lines.length ? (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" form="cats">
            Salvar categorias
          </button>
          <span className="muted">Lançamento com categoria e sem despesa do robô fica como “categorizado” e pode ser fechado.</span>
        </div>
      ) : null}

      {open && notOnBill.length ? (
        <section className="card" style={{ marginTop: 16, borderColor: "var(--warn)" }}>
          <h2 style={{ marginTop: 0 }}>Avisadas ao robô e que não estão nesta fatura ({notOnBill.length})</h2>
          <p className="muted" style={{ marginTop: 0 }}>Podem cair na próxima fatura, ter sido pagas com outro cartão ou estar com valor diferente.</p>
          <table>
            <tbody>
              {notOnBill.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.spent_on)}</td>
                  <td>{e.description}</td>
                  <td className="muted">{e.source === "whatsapp" ? `WhatsApp${e.sender_name ? ` · ${e.sender_name}` : ""}` : "Manual"}</td>
                  <td className="num">{formatBRL(e.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </Shell>
  );
}
