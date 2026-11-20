import Link from "next/link";
import { Notice, PaymentPill, Shell } from "@/components/Shell";
import { TitleForm } from "@/components/TitleForm";
import { METHOD_LABEL, fmtDate } from "@/lib/format";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { settleSelected } from "./actions";

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string; q?: string; de?: string; ate?: string; error?: string; ok?: string }>;
}) {
  const { situacao = "aberto", q, de, ate, error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();

  let query = sb
    .from("receivables_view")
    .select("id, name, due_date, amount_cents, paid_cents, open_cents, status, overdue, origin_type, origin_id, method, customers(name)")
    .eq("org_id", orgId)
    .order("due_date")
    .limit(300);
  if (situacao === "aberto") query = query.in("status", ["open", "partial"]);
  if (situacao === "atraso") query = query.eq("overdue", true);
  if (situacao === "pago") query = query.eq("status", "paid");
  if (situacao === "cancelado") query = query.eq("status", "cancelled");
  if (q) query = query.ilike("name", `%${q}%`);
  if (de) query = query.gte("due_date", de);
  if (ate) query = query.lte("due_date", ate);

  const [{ data }, { data: customers }, { data: cats }, { data: centers }, { data: accounts }] = await Promise.all([
    query,
    sb.from("customers").select("id, name").eq("org_id", orgId).order("name").limit(1000),
    sb.from("financial_categories").select("id, name").eq("org_id", orgId).eq("direction", "in").order("name"),
    sb.from("cost_centers").select("id, name").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("bank_accounts").select("id, name").eq("org_id", orgId).eq("active", true).order("created_at"),
  ]);
  const rows = data ?? [];
  const totalOpen = rows.reduce((a, r) => a + (["open", "partial"].includes(r.status) ? Number(r.open_cents) : 0), 0);
  const selectable = situacao !== "pago" && situacao !== "cancelado";

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Contas a receber</h1>
        <span className="muted">Em aberto na lista: {formatBRL(totalOpen)}</span>
      </div>
      <Notice error={error} ok={ok} />
      <TitleForm kind="receivable" customers={customers ?? []} categories={cats ?? []} costCenters={centers ?? []} accounts={accounts ?? []} />

      <form className="row" style={{ marginBottom: 12 }}>
        <select name="situacao" defaultValue={situacao} aria-label="Situação" style={{ width: 150 }}>
          <option value="aberto">Em aberto</option>
          <option value="atraso">Em atraso</option>
          <option value="pago">Pagas</option>
          <option value="cancelado">Canceladas</option>
          <option value="todas">Todas</option>
        </select>
        <input name="q" placeholder="Descrição" defaultValue={q} style={{ width: 200 }} />
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
          <input type="hidden" name="kind" value="receivable" />
          <input type="hidden" name="return_to" value={`/receber?situacao=${situacao}`} />
          <table>
            <thead>
              <tr>
                {selectable ? <th style={{ width: 30 }}></th> : null}
                <th>Descrição</th>
                <th>Cliente</th>
                <th>Vencimento</th>
                <th>Situação</th>
                <th className="num">Valor</th>
                <th className="num">Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {selectable ? (
                    <td>
                      {["open", "partial"].includes(r.status) ? (
                        <input type="checkbox" name="ids" value={r.id} aria-label={`Selecionar ${r.name}`} style={{ width: "auto" }} />
                      ) : null}
                    </td>
                  ) : null}
                  <td>
                    <Link href={`/receber/${r.id}`}>{r.name}</Link>
                    {r.origin_type === "service_order" ? (
                      <>
                        {" "}
                        <Link href={`/os/${r.origin_id}`} className="muted" style={{ fontSize: 12 }}>
                          (ver OS)
                        </Link>
                      </>
                    ) : null}
                  </td>
                  <td>{(r.customers as unknown as { name: string } | null)?.name ?? "—"}</td>
                  <td>{fmtDate(r.due_date)}</td>
                  <td>
                    <PaymentPill status={r.overdue ? "overdue" : r.status} />
                  </td>
                  <td className="num">{formatBRL(r.amount_cents)}</td>
                  <td className="num">{formatBRL(["open", "partial"].includes(r.status) ? Number(r.open_cents) : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectable ? (
            <div className="row card" style={{ marginTop: 10 }}>
              <strong>Baixar as marcadas</strong>
              <select name="method" defaultValue="cash" aria-label="Forma" style={{ width: 190 }}>
                {Object.entries(METHOD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input type="date" name="paid_on" defaultValue={todayInSaoPaulo()} aria-label="Data" style={{ width: 160 }} />
              <button className="btn btn-primary">Dar baixa pelo valor em aberto</button>
            </div>
          ) : null}
        </form>
      )}
    </Shell>
  );
}
