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
  searchParams: Promise<{ situacao?: string; q?: string; cliente?: string; de?: string; ate?: string; error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const { situacao = "aberto", cliente, error, ok } = sp;
  const q = (sp.q ?? "").trim();
  const isDay = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const de = isDay(sp.de);
  const ate = isDay(sp.ate);
  const { sb, orgId, orgName } = await requireOrg();
  const today = todayInSaoPaulo();

  const { data: customers } = await sb.from("customers").select("id, name, cpf_cnpj").eq("org_id", orgId).order("name").limit(5000);
  const customerName = new Map((customers ?? []).map((c) => [c.id as string, c.name as string]));

  let query = sb
    .from("receivables_view")
    .select("id, name, customer_id, due_date, amount_cents, paid_cents, open_cents, status, overdue, origin_type, origin_id, method")
    .eq("org_id", orgId)
    .order("due_date")
    .limit(500);
  if (situacao === "aberto") query = query.in("status", ["open", "partial"]);
  // Overdue by the date in São Paulo, the same rule the view uses.
  if (situacao === "atraso") query = query.in("status", ["open", "partial"]).lt("due_date", today);
  if (situacao === "hoje") query = query.in("status", ["open", "partial"]).eq("due_date", today);
  if (situacao === "pago") query = query.eq("status", "paid");
  if (situacao === "cancelado") query = query.eq("status", "cancelled");
  if (cliente) query = query.eq("customer_id", cliente);
  if (q) {
    // The search box finds the customer's name or CPF/CNPJ, the description or the document number.
    const term = q.replace(/[,()*%\\"]/g, " ").trim();
    const digits = q.replace(/\D/g, "");
    const low = term.toLowerCase();
    const ids = (customers ?? [])
      .filter((c) => String(c.name).toLowerCase().includes(low) || (digits.length >= 3 && String(c.cpf_cnpj ?? "").includes(digits)))
      .map((c) => c.id as string)
      .slice(0, 200);
    query = query.or([`name.ilike."*${term}*"`, `document_number.ilike."*${term}*"`, ...(ids.length ? [`customer_id.in.(${ids.join(",")})`] : [])].join(","));
  }
  if (de) query = query.gte("due_date", de);
  if (ate) query = query.lte("due_date", ate);

  const [{ data, error: listError }, { data: cats }, { data: centers }, { data: accounts }] = await Promise.all([
    query,
    sb.from("financial_categories").select("id, name").eq("org_id", orgId).eq("direction", "in").order("name"),
    sb.from("cost_centers").select("id, name").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("bank_accounts").select("id, name").eq("org_id", orgId).eq("active", true).order("created_at"),
  ]);
  if (listError) console.error("receivables list", listError);
  const rows = data ?? [];
  // Who owes: open balance per customer in the current list.
  const debtors = [...rows
    .filter((r) => ["open", "partial"].includes(r.status) && Number(r.open_cents) > 0)
    .reduce((m, r) => {
      const k = (r.customer_id as string | null) ?? "";
      const d = m.get(k) ?? { id: k, name: customerName.get(k) ?? "Sem cliente", open: 0, overdue: 0, count: 0 };
      d.open += Number(r.open_cents);
      if (r.due_date < today) d.overdue += Number(r.open_cents);
      d.count++;
      return m.set(k, d);
    }, new Map<string, { id: string; name: string; open: number; overdue: number; count: number }>())
    .values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ situacao, q: q || undefined, cliente, de, ate, ...extra })) if (v) p.set(k, v);
    return `/receber?${p.toString()}`;
  };
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
          <option value="atraso">Em atraso (vencidas)</option>
          <option value="hoje">Vencem hoje</option>
          <option value="pago">Pagas</option>
          <option value="cancelado">Canceladas</option>
          <option value="todas">Todas</option>
        </select>
        <select name="cliente" defaultValue={cliente ?? ""} aria-label="Cliente" style={{ width: 220 }}>
          <option value="">Todos os clientes</option>
          {(customers ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input name="q" placeholder="Buscar cliente, CPF/CNPJ ou descrição" defaultValue={q} style={{ width: 260 }} />
        <label className="muted" style={{ margin: 0 }}>
          Vencimento de
        </label>
        <input type="date" name="de" defaultValue={de} style={{ width: 150 }} />
        <label className="muted" style={{ margin: 0 }}>
          até
        </label>
        <input type="date" name="ate" defaultValue={ate} style={{ width: 150 }} />
        <button className="btn btn-secondary">Filtrar</button>
        {q || cliente || de || ate || situacao !== "aberto" ? (
          <a className="btn btn-secondary" href="/receber">
            Limpar
          </a>
        ) : null}
      </form>

      {listError ? <div className="notice notice-error">Não foi possível carregar as contas. Atualize a página; se continuar, me avise.</div> : null}

      {debtors.length > 1 || (debtors.length === 1 && !cliente) ? (
        <details className="card" style={{ marginBottom: 12 }} open={situacao === "atraso"}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Devedores na lista ({debtors.length}) — em aberto {formatBRL(debtors.reduce((a, d) => a + d.open, 0))}, vencido{" "}
            <span style={{ color: "var(--bad)" }}>{formatBRL(debtors.reduce((a, d) => a + d.overdue, 0))}</span>
          </summary>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="num">Contas</th>
                <th className="num">Vencido</th>
                <th className="num">Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {debtors.slice(0, 50).map((d) => (
                <tr key={d.id || "none"}>
                  <td>{d.id ? <Link href={qs({ cliente: d.id })}>{d.name}</Link> : d.name}</td>
                  <td className="num">{d.count}</td>
                  <td className="num" style={{ color: d.overdue ? "var(--bad)" : undefined }}>{formatBRL(d.overdue)}</td>
                  <td className="num">{formatBRL(d.open)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {rows.length === 0 ? (
        <div className="card empty">Nenhuma conta com esses filtros.{situacao === "aberto" ? "" : " Experimente a situação \u201cTodas\u201d."}</div>
      ) : (
        <form action={settleSelected}>
          <input type="hidden" name="kind" value="receivable" />
          <input type="hidden" name="return_to" value={qs({})} />
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
                  <td>{r.customer_id ? <Link href={qs({ cliente: r.customer_id })}>{customerName.get(r.customer_id) ?? "—"}</Link> : "—"}</td>
                  <td>{fmtDate(r.due_date)}</td>
                  <td>
                    <PaymentPill status={["open", "partial"].includes(r.status) && r.due_date < today ? "overdue" : r.status} />
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
