import { Notice, PaymentPill, Shell } from "@/components/Shell";
import { TitleForm } from "@/components/TitleForm";
import { METHOD_LABEL, fmtDate } from "@/lib/format";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { cancelTitle, payOne, settleSelected } from "../receber/actions";

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string; q?: string; de?: string; ate?: string; error?: string; ok?: string }>;
}) {
  const { situacao = "aberto", q, de, ate, error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const today = todayInSaoPaulo();

  let query = sb
    .from("payables")
    .select("id, name, supplier_name, due_date, amount_cents, paid_cents, status, financial_categories(name)")
    .eq("org_id", orgId)
    .order("due_date")
    .limit(300);
  if (situacao === "aberto") query = query.in("status", ["open", "partial"]);
  if (situacao === "atraso") query = query.in("status", ["open", "partial"]).lt("due_date", today);
  if (situacao === "pago") query = query.eq("status", "paid");
  if (situacao === "cancelado") query = query.eq("status", "cancelled");
  if (q) query = query.or(`name.ilike.%${q.replace(/[,()]/g, " ")}%,supplier_name.ilike.%${q.replace(/[,()]/g, " ")}%`);
  if (de) query = query.gte("due_date", de);
  if (ate) query = query.lte("due_date", ate);

  const [{ data }, { data: cats }, { data: centers }, { data: accounts }] = await Promise.all([
    query,
    sb.from("financial_categories").select("id, name").eq("org_id", orgId).eq("direction", "out").order("name"),
    sb.from("cost_centers").select("id, name").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("bank_accounts").select("id, name").eq("org_id", orgId).eq("active", true).order("created_at"),
  ]);
  const rows = data ?? [];
  const totalOpen = rows.reduce((a, r) => a + (["open", "partial"].includes(r.status) ? r.amount_cents - r.paid_cents : 0), 0);
  const selectable = situacao !== "pago" && situacao !== "cancelado";

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Contas a pagar</h1>
        <span className="muted">Em aberto na lista: {formatBRL(totalOpen)}</span>
      </div>
      <Notice error={error} ok={ok} />
      <TitleForm kind="payable" categories={cats ?? []} costCenters={centers ?? []} accounts={accounts ?? []} />

      <form className="row" style={{ marginBottom: 12 }}>
        <select name="situacao" defaultValue={situacao} aria-label="Situação" style={{ width: 150 }}>
          <option value="aberto">Em aberto</option>
          <option value="atraso">Em atraso</option>
          <option value="pago">Pagas</option>
          <option value="cancelado">Canceladas</option>
          <option value="todas">Todas</option>
        </select>
        <input name="q" placeholder="Descrição ou fornecedor" defaultValue={q} style={{ width: 220 }} />
        <label className="muted" style={{ margin: 0 }}>
          Vencimento de
        </label>
        <input type="date" name="de" defaultValue={de} style={{ width: 150 }} />
        <label className="muted" style={{ margin: 0 }}>
          até
        </label>
        <input type="date" name="ate" defaultValue={ate} style={{ width: 150 }} />
        <button className="btn btn-secondary">Filtrar</button>
      </form>

      {rows.length === 0 ? (
        <div className="card empty">Nenhuma conta aqui.</div>
      ) : (
        <form action={settleSelected}>
          <input type="hidden" name="kind" value="payable" />
          <input type="hidden" name="return_to" value={`/pagar?situacao=${situacao}`} />
          <table>
            <thead>
              <tr>
                {selectable ? <th style={{ width: 30 }}></th> : null}
                <th>Descrição</th>
                <th>Fornecedor</th>
                <th>Categoria</th>
                <th>Vencimento</th>
                <th>Situação</th>
                <th className="num">Em aberto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = ["open", "partial"].includes(r.status);
                const late = isOpen && r.due_date < today;
                return (
                  <tr key={r.id}>
                    {selectable ? (
                      <td>{isOpen ? <input type="checkbox" name="ids" value={r.id} aria-label={`Selecionar ${r.name}`} style={{ width: "auto" }} /> : null}</td>
                    ) : null}
                    <td>{r.name}</td>
                    <td>{r.supplier_name ?? "—"}</td>
                    <td>{(r.financial_categories as unknown as { name: string } | null)?.name ?? "—"}</td>
                    <td>{fmtDate(r.due_date)}</td>
                    <td>
                      <PaymentPill status={late ? "overdue" : r.status} />
                    </td>
                    <td className="num">{formatBRL(isOpen ? r.amount_cents - r.paid_cents : 0)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {isOpen ? (
                        <details>
                          <summary className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                            Pagar…
                          </summary>
                          <div className="card" style={{ position: "absolute", zIndex: 5, marginTop: 4, width: 330 }}>
                            <input type="hidden" form={`pay-${r.id}`} name="id" value={r.id} />
                            <div className="field">
                              <label>Valor pago (R$)</label>
                              <input form={`pay-${r.id}`} name="amount" defaultValue={((r.amount_cents - r.paid_cents) / 100).toFixed(2).replace(".", ",")} />
                            </div>
                            <div className="field">
                              <label>Data</label>
                              <input form={`pay-${r.id}`} type="date" name="paid_on" defaultValue={today} />
                            </div>
                            <div className="field">
                              <label>Forma</label>
                              <select form={`pay-${r.id}`} name="method" defaultValue="transfer">
                                {Object.entries(METHOD_LABEL).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="row">
                              <button className="btn btn-primary" form={`pay-${r.id}`}>
                                Registrar pagamento
                              </button>
                              {r.paid_cents === 0 ? (
                                <button className="btn btn-secondary" form={`cancel-${r.id}`}>
                                  Cancelar conta
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {selectable ? (
            <div className="row card" style={{ marginTop: 10 }}>
              <strong>Pagar as marcadas</strong>
              <select name="method" defaultValue="transfer" aria-label="Forma" style={{ width: 190 }}>
                {Object.entries(METHOD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input type="date" name="paid_on" defaultValue={today} aria-label="Data" style={{ width: 160 }} />
              <button className="btn btn-primary">Dar baixa pelo valor em aberto</button>
            </div>
          ) : null}
        </form>
      )}
      {/* Separate forms (HTML forms cannot be nested): the inputs above point at them with form="..." */}
      {rows
        .filter((r) => ["open", "partial"].includes(r.status))
        .map((r) => (
          <div key={r.id} hidden>
            <form id={`pay-${r.id}`} action={payOne}>
              <input type="hidden" name="return_to" value={`/pagar?situacao=${situacao}`} />
            </form>
            <form id={`cancel-${r.id}`} action={cancelTitle}>
              <input type="hidden" name="kind" value="payable" />
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="return_to" value={`/pagar?situacao=${situacao}`} />
            </form>
          </div>
        ))}
    </Shell>
  );
}
