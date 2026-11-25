import Link from "next/link";
import { PaymentPill, Shell, osStatusLabel } from "@/components/Shell";
import { formatBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

type Row = {
  id: string;
  number: number;
  status: string;
  os_date: string;
  total_cents: number;
  channel: string;
  customers: { name: string } | null;
};

export default async function ServiceOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; cliente?: string }> }) {
  const { sb, orgId, orgName, can } = await requireOrg();
  const canEdit = can("os.edit");
  const canPrice = can("prices.view");
  const { q, status, cliente } = await searchParams;

  let query = sb
    .from("service_orders")
    .select("id, number, status, os_date, total_cents, channel, contact_name, contact_phone, customers(name)")
    .eq("org_id", orgId)
    .order("number", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  if (cliente) query = query.eq("customer_id", cliente);
  if (q && /^\d+$/.test(q)) query = query.eq("number", Number(q));
  const { data: orders } = await query;
  const rows = ((orders ?? []) as unknown as Row[]).filter(
    (r) => !q || /^\d+$/.test(q) || [r.customers?.name, r.contact_name, r.contact_phone].some((t) => t?.toLowerCase().includes(q.toLowerCase())),
  );

  const ids = rows.map((r) => r.id);
  const { data: pay } = ids.length
    ? await sb.from("service_order_payment_view").select("service_order_id, payment_status").in("service_order_id", ids)
    : { data: [] };
  const payBy = new Map((pay ?? []).map((p) => [p.service_order_id as string, p.payment_status as string]));

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Ordens de serviço</h1>
        {canEdit ? (
          <Link className="btn btn-primary" href="/os/nova">
            Nova ordem de serviço
          </Link>
        ) : null}
      </div>
      <form className="row" style={{ marginBottom: 16 }}>
        <input name="q" placeholder="Nº da OS ou cliente" defaultValue={q} style={{ maxWidth: 280 }} />
        <select name="status" defaultValue={status ?? ""} style={{ maxWidth: 200 }}>
          <option value="">Todos os status</option>
          {["open", "approved", "in_progress", "waiting_parts", "done", "paid", "cancelled"].map((s) => (
            <option key={s} value={s}>
              {osStatusLabel(s)}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary">Filtrar</button>
      </form>
      {rows.length === 0 ? (
        <div className="card empty">
          Nenhuma ordem de serviço ainda.{canEdit ? <> <Link href="/os/nova">Crie a primeira</Link>.</> : null}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nº</th>
              <th>Cliente</th>
              <th>Data</th>
              <th>Status</th>
              <th>Pagamento</th>
              <th className="num">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/os/${r.id}`}>#{r.number}</Link>
                  {r.channel === "counter" ? <span className="tag-counter">Balcão</span> : null}
                </td>
                <td>
                  {r.contact_name && r.customers?.name === "Consumidor final" ? r.contact_name : r.customers?.name}
                  {r.contact_phone ? <span className="muted" style={{ fontSize: 12 }}> · {r.contact_phone}</span> : null}
                </td>
                <td>{new Date(r.os_date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                <td>{osStatusLabel(r.status)}</td>
                <td>{canPrice ? <PaymentPill status={payBy.get(r.id) ?? "not_billed"} /> : null}</td>
                <td className="num">{canPrice ? formatBRL(r.total_cents) : ""}</td>
                <td>
                  <Link href={`/os/${r.id}/imprimir`} aria-label={`Imprimir OS ${r.number}`}>
                    Imprimir
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
