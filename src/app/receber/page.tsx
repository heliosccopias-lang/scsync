import Link from "next/link";
import { PaymentPill, Shell } from "@/components/Shell";
import { formatBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ situacao?: string }> }) {
  const { sb, orgId, orgName } = await requireOrg();
  const { situacao } = await searchParams;

  let q = sb
    .from("receivables_view")
    .select("id, name, due_date, amount_cents, paid_cents, open_cents, status, overdue, origin_type, origin_id, customers(name)")
    .eq("org_id", orgId)
    .order("due_date")
    .limit(200);
  if (situacao === "aberto") q = q.in("status", ["open", "partial"]);
  if (situacao === "atraso") q = q.eq("overdue", true);
  if (situacao === "pago") q = q.eq("status", "paid");
  const { data } = await q;
  const rows = data ?? [];
  const totalOpen = rows.reduce((a, r) => a + (r.status === "paid" ? 0 : Number(r.open_cents)), 0);

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Contas a receber</h1>
        <span className="muted">Em aberto na lista: {formatBRL(totalOpen)}</span>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        {[
          ["", "Todas"],
          ["aberto", "Em aberto"],
          ["atraso", "Em atraso"],
          ["pago", "Pagas"],
        ].map(([v, label]) => (
          <Link key={v} href={v ? `/receber?situacao=${v}` : "/receber"} className={`btn ${situacao === v || (!situacao && !v) ? "btn-primary" : "btn-secondary"}`}>
            {label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="card empty">Nenhum título aqui.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Título</th>
              <th>Cliente</th>
              <th>Vencimento</th>
              <th>Situação</th>
              <th className="num">Valor</th>
              <th className="num">Recebido</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.origin_type === "service_order" ? <Link href={`/os/${r.origin_id}`}>{r.name}</Link> : r.name}</td>
                <td>{(r.customers as unknown as { name: string } | null)?.name ?? "—"}</td>
                <td>{new Date(r.due_date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                <td>
                  <PaymentPill status={r.overdue ? "overdue" : r.status} />
                </td>
                <td className="num">{formatBRL(r.amount_cents)}</td>
                <td className="num">{formatBRL(r.paid_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
