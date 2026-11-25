import Link from "next/link";
import { PaymentPill, Shell, osStatusLabel } from "@/components/Shell";
import { formatBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

type Row = {
  id: string;
  number: number;
  status: string;
  contact_name: string | null;
  contact_phone: string | null;
  os_date: string;
  total_cents: number;
  channel: string;
  customers: { name: string; phone: string | null } | null;
};

export default async function ServiceOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; cliente?: string; tel?: string }> }) {
  const { sb, orgId, orgName, can } = await requireOrg();
  const canEdit = can("os.edit");
  const canPrice = can("prices.view");
  const { q, status, cliente, tel } = await searchParams;
  // Phone search: digits only, so (11) 99999-0000, 11999990000 and 99999-0000 all match.
  const telDigits = (tel ?? "").replace(/\D/g, "");
  const digitsOf = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");

  let query = sb
    .from("service_orders")
    .select("id, number, status, os_date, total_cents, channel, contact_name, contact_phone, customers(name, phone)")
    .eq("org_id", orgId)
    .order("number", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  if (cliente) query = query.eq("customer_id", cliente);
  if (q && /^\d+$/.test(q)) query = query.eq("number", Number(q));
  let telError = "";
  if (telDigits) {
    if (telDigits.length < 4) telError = "Digite pelo menos 4 números do telefone.";
    else {
      // Customers whose phone has these digits, plus counter sales whose walk-in phone has them (all OS, not just the latest 100).
      const { data: custs } = await sb.from("customers").select("id, phone").eq("org_id", orgId).not("phone", "is", null).limit(20000);
      const custIds = (custs ?? []).filter((c) => digitsOf(c.phone).includes(telDigits)).map((c) => c.id as string).slice(0, 400);
      const { data: walkIns } = await sb.from("service_orders").select("id, contact_phone").eq("org_id", orgId).not("contact_phone", "is", null).limit(20000);
      const osIds = (walkIns ?? []).filter((o) => digitsOf(o.contact_phone).includes(telDigits)).map((o) => o.id as string).slice(0, 400);
      const ors = [custIds.length ? `customer_id.in.(${custIds.join(",")})` : "", osIds.length ? `id.in.(${osIds.join(",")})` : ""].filter(Boolean);
      query = ors.length ? query.or(ors.join(",")).limit(300) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }
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
        <input name="tel" type="search" inputMode="tel" placeholder="Telefone do cliente" defaultValue={tel} style={{ maxWidth: 200 }} aria-label="Buscar por telefone" />
        <select name="status" defaultValue={status ?? ""} style={{ maxWidth: 200 }}>
          <option value="">Todos os status</option>
          {["open", "approved", "in_progress", "waiting_parts", "done", "paid", "cancelled"].map((s) => (
            <option key={s} value={s}>
              {osStatusLabel(s)}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary">Filtrar</button>
        {q || tel || status ? (
          <Link href="/os" className="btn btn-secondary">
            Limpar
          </Link>
        ) : null}
      </form>
      {telError ? <div className="notice notice-error">{telError}</div> : null}
      {telDigits.length >= 4 ? (
        <p className="muted" style={{ marginTop: -8 }}>
          {rows.length} ordem(ns) com telefone contendo {tel}.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="card empty">
          {tel || q || status ? "Nenhuma ordem de serviço encontrada com esse filtro." : "Nenhuma ordem de serviço ainda."}{!(tel || q || status) && canEdit ? <> <Link href="/os/nova">Crie a primeira</Link>.</> : null}
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
                  {r.contact_phone || r.customers?.phone ? (
                    <span className="muted" style={{ fontSize: 12 }}> · {r.contact_phone || r.customers?.phone}</span>
                  ) : null}
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
