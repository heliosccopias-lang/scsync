import Link from "next/link";
import { Notice, Shell } from "@/components/Shell";
import { fmtDate } from "@/lib/format";
import { formatBRL, todayInSaoPaulo, addMonths } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { expense, importAsaas, importOfx, income, reconcile, reconcileSure, setIgnored, transfer, undo } from "./actions";

type Suggestion = { target_type: string; target_id: string; label: string; amount_cents: number; ref_date: string; score: number };

const TARGET_LABEL: Record<string, string> = {
  receivable: "Conta a receber",
  payable: "Conta a pagar",
  settlement: "Recebimento/pagamento já registrado",
  transfer: "Transferência",
};

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ conta?: string; ver?: string; error?: string; ok?: string }>;
}) {
  const { conta, ver = "pendentes", error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();

  const { data: accounts } = await sb.from("bank_accounts").select("id, name, kind").eq("org_id", orgId).eq("active", true).order("created_at");
  const account = (accounts ?? []).find((a) => a.id === conta) ?? (accounts ?? [])[0];
  if (!account) {
    return (
      <Shell orgName={orgName}>
        <h1>Conciliação bancária</h1>
        <div className="card empty">
          Nenhuma conta cadastrada. <Link href="/configuracoes/contas">Cadastre uma conta</Link>.
        </div>
      </Shell>
    );
  }

  const statuses = ver === "conciliadas" ? ["reconciled"] : ver === "ignoradas" ? ["ignored"] : ["pending", "suggested"];
  const [{ data: lines }, { data: counts }, { data: catsOut }, { data: catsIn }] = await Promise.all([
    sb
      .from("statement_lines")
      .select("id, posted_on, amount_cents, description, counterpart_doc, provider_payment_id, status")
      .eq("org_id", orgId)
      .eq("bank_account_id", account.id)
      .in("status", statuses)
      .order("posted_on", { ascending: ver !== "conciliadas" })
      .limit(60),
    sb.from("statement_lines").select("status").eq("org_id", orgId).eq("bank_account_id", account.id),
    sb.from("financial_categories").select("id, name").eq("org_id", orgId).eq("direction", "out").order("name"),
    sb.from("financial_categories").select("id, name").eq("org_id", orgId).eq("direction", "in").order("name"),
  ]);
  const n = { pending: 0, reconciled: 0, ignored: 0 };
  for (const c of counts ?? []) {
    if (c.status === "reconciled") n.reconciled++;
    else if (c.status === "ignored") n.ignored++;
    else n.pending++;
  }

  // suggestions for pending lines; what each reconciled line was matched to
  const sugBy = new Map<string, Suggestion[]>();
  const recBy = new Map<string, { target_type: string; amount_cents: number; difference_cents: number; difference_action: string | null; created_at: string }>();
  if (ver === "pendentes") {
    await Promise.all(
      (lines ?? []).map(async (l) => {
        const { data } = await sb.rpc("suggest_matches", { p_line: l.id });
        sugBy.set(
          l.id,
          ((data ?? []) as Suggestion[]).sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 3),
        );
      }),
    );
  } else if (ver === "conciliadas" && (lines ?? []).length) {
    const { data: recs } = await sb
      .from("reconciliations")
      .select("statement_line_id, target_type, amount_cents, difference_cents, difference_action, created_at")
      .in(
        "statement_line_id",
        (lines ?? []).map((l) => l.id),
      )
      .is("undone_at", null);
    for (const r of recs ?? []) recBy.set(r.statement_line_id, r);
  }

  const today = todayInSaoPaulo();
  const others = (accounts ?? []).filter((a) => a.id !== account.id);

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Conciliação bancária</h1>
        <form className="row">
          <select name="conta" defaultValue={account.id} aria-label="Conta" style={{ width: 220 }}>
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary">Trocar conta</button>
          <Link href="/configuracoes/contas" className="muted" style={{ fontSize: 13 }}>
            Contas
          </Link>
        </form>
      </div>
      <Notice error={error} ok={ok} />

      <div className="grid2" style={{ marginBottom: 16 }}>
        {account.kind === "asaas" ? (
          <form action={importAsaas} className="card">
            <strong>Buscar extrato do Asaas</strong>
            <p className="muted" style={{ margin: "4px 0 10px" }}>
              Os recebimentos já baixados pelo Asaas são conciliados sozinhos; a tarifa vira despesa.
            </p>
            <input type="hidden" name="conta" value={account.id} />
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input name="start" type="date" defaultValue={addMonths(today, -1)} aria-label="De" />
              <input name="finish" type="date" defaultValue={today} aria-label="Até" />
              <button className="btn btn-primary">Buscar</button>
            </div>
          </form>
        ) : null}
        <form action={importOfx} className="card">
          <strong>Importar extrato OFX</strong>
          <p className="muted" style={{ margin: "4px 0 10px" }}>
            No site do banco, exporte o extrato em OFX (às vezes chamado &ldquo;Money&rdquo;). Lançamentos já importados são ignorados.
          </p>
          <input type="hidden" name="conta" value={account.id} />
          <input type="file" name="file" accept=".ofx,.OFX,application/x-ofx" required />
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <input type="checkbox" name="invert" style={{ width: "auto" }} /> Inverter sinais (extrato de cartão de crédito)
          </label>
          <button className="btn btn-primary" style={{ marginTop: 8 }}>
            Importar
          </button>
        </form>
      </div>

      <div className="spread">
        <div className="row">
          {[
            ["pendentes", `Pendentes (${n.pending})`],
            ["conciliadas", `Conciliadas (${n.reconciled})`],
            ["ignoradas", `Ignoradas (${n.ignored})`],
          ].map(([v, label]) => (
            <Link key={v} href={`/conciliacao?conta=${account.id}&ver=${v}`} className={`btn ${ver === v ? "btn-primary" : "btn-secondary"}`}>
              {label}
            </Link>
          ))}
        </div>
        {ver === "pendentes" && n.pending > 0 ? (
          <form action={reconcileSure}>
            <input type="hidden" name="conta" value={account.id} />
            <button className="btn btn-secondary">Conciliar as correspondências certas</button>
          </form>
        ) : null}
      </div>

      {(lines ?? []).length === 0 ? (
        <div className="card empty">
          {ver === "pendentes" ? "Nada pendente nesta conta. Importe um extrato para começar." : "Nenhuma linha aqui."}
        </div>
      ) : (
        (lines ?? []).map((l) => {
          const credit = l.amount_cents > 0;
          const sug = sugBy.get(l.id) ?? [];
          const rec = recBy.get(l.id);
          return (
            <div key={l.id} className="card" style={{ marginBottom: 10, padding: 14 }}>
              <div className="spread" style={{ marginBottom: ver === "pendentes" ? 8 : 0 }}>
                <div>
                  <span className="muted">{fmtDate(l.posted_on)}</span> · {l.description ?? "—"}
                  {l.provider_payment_id ? <span className="muted"> · cobrança {l.provider_payment_id}</span> : null}
                </div>
                <strong style={{ color: credit ? "var(--ok)" : "var(--bad)", whiteSpace: "nowrap" }}>
                  {credit ? "+" : "−"} {formatBRL(Math.abs(l.amount_cents))}
                </strong>
              </div>

              {ver === "conciliadas" ? (
                <div className="spread" style={{ marginTop: 6 }}>
                  <span className="muted">
                    {rec ? TARGET_LABEL[rec.target_type] : "Conciliada"}
                    {rec?.difference_action === "interest" ? ` · juros de ${formatBRL(rec.difference_cents)}` : ""}
                    {rec?.difference_action === "fee" ? ` · tarifa de ${formatBRL(-rec.difference_cents)}` : ""}
                    {rec?.difference_action === "partial" ? " · pagamento parcial" : ""}
                    {rec?.difference_action === "discount" ? ` · desconto de ${formatBRL(-rec.difference_cents)}` : ""}
                  </span>
                  <form action={undo}>
                    <input type="hidden" name="conta" value={account.id} />
                    <input type="hidden" name="line" value={l.id} />
                    <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                      Desfazer
                    </button>
                  </form>
                </div>
              ) : null}

              {ver === "ignoradas" ? (
                <form action={setIgnored} style={{ marginTop: 6 }}>
                  <input type="hidden" name="conta" value={account.id} />
                  <input type="hidden" name="line" value={l.id} />
                  <input type="hidden" name="ignore" value="0" />
                  <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                    Voltar para pendente
                  </button>
                </form>
              ) : null}

              {ver === "pendentes" ? (
                <>
                  {sug.length ? (
                    <table style={{ marginBottom: 8 }}>
                      <tbody>
                        {sug.map((s) => {
                          const diff = Math.abs(l.amount_cents) - Number(s.amount_cents);
                          return (
                            <tr key={s.target_type + s.target_id}>
                              <td style={{ width: 70 }}>
                                <span className={`pill ${Number(s.score) >= 0.9 ? "pill-paid" : Number(s.score) >= 0.6 ? "pill-partial" : "pill-neutral"}`}>
                                  {Math.round(Number(s.score) * 100)}%
                                </span>
                              </td>
                              <td>
                                {s.label}
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {TARGET_LABEL[s.target_type]} · {fmtDate(s.ref_date)} · {formatBRL(Number(s.amount_cents))}
                                  {diff !== 0 ? ` · diferença de ${formatBRL(Math.abs(diff))}` : ""}
                                </div>
                              </td>
                              <td style={{ width: 330 }}>
                                <form action={reconcile} className="row" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
                                  <input type="hidden" name="conta" value={account.id} />
                                  <input type="hidden" name="line" value={l.id} />
                                  <input type="hidden" name="target_type" value={s.target_type} />
                                  <input type="hidden" name="target_id" value={s.target_id} />
                                  {diff !== 0 ? (
                                    <select name="diff_action" aria-label="O que é a diferença" style={{ width: 190 }}>
                                      {s.target_type === "settlement" ? (
                                        diff < 0 ? <option value="fee">Diferença é tarifa</option> : <option value="">Valor diferente</option>
                                      ) : diff > 0 ? (
                                        <option value="interest">Diferença é juros/multa</option>
                                      ) : (
                                        <>
                                          <option value="partial">Pagamento parcial</option>
                                          <option value="discount">Diferença é desconto</option>
                                        </>
                                      )}
                                    </select>
                                  ) : null}
                                  <button className="btn btn-primary" style={{ padding: "5px 10px", fontSize: 13 }}>
                                    Conciliar
                                  </button>
                                </form>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted" style={{ margin: "0 0 8px" }}>
                      Nenhuma correspondência encontrada no sistema.
                    </p>
                  )}

                  <details>
                    <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
                      Outras opções: {credit ? "lançar receita" : "lançar despesa (tarifa, conta paga direto)"}, transferência, ignorar
                    </summary>
                    <div className="row" style={{ alignItems: "flex-start", marginTop: 10 }}>
                      <form action={credit ? income : expense} className="row" style={{ flexWrap: "nowrap" }}>
                        <input type="hidden" name="conta" value={account.id} />
                        <input type="hidden" name="line" value={l.id} />
                        <input name="name" defaultValue={l.description ?? ""} aria-label="Descrição" style={{ width: 220 }} />
                        <select name="category" aria-label="Categoria" style={{ width: 170 }}>
                          {(credit ? catsIn : catsOut)?.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <button className="btn btn-secondary">{credit ? "Lançar receita" : "Lançar despesa"}</button>
                      </form>
                      {others.length ? (
                        <form action={transfer} className="row" style={{ flexWrap: "nowrap" }}>
                          <input type="hidden" name="conta" value={account.id} />
                          <input type="hidden" name="line" value={l.id} />
                          <select name="other_account" aria-label="Outra conta" style={{ width: 170 }}>
                            {others.map((a) => (
                              <option key={a.id} value={a.id}>
                                {credit ? "veio de " : "foi para "}
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn-secondary">Transferência</button>
                        </form>
                      ) : null}
                      <form action={setIgnored}>
                        <input type="hidden" name="conta" value={account.id} />
                        <input type="hidden" name="line" value={l.id} />
                        <input type="hidden" name="ignore" value="1" />
                        <button className="btn btn-secondary">Ignorar</button>
                      </form>
                    </div>
                  </details>
                </>
              ) : null}
            </div>
          );
        })
      )}
    </Shell>
  );
}
