import Link from "next/link";
import { formatBRL } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/nfse";
import { cancel, refresh } from "./actions";

/** Invoices table, used by the Notas fiscais tab and the OS page. */
export function InvoiceRows({ rows, back, canIssue }: { rows: Record<string, unknown>[]; back: string; canIssue: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Número</th>
          <th>Tomador</th>
          <th>Origem</th>
          <th>Situação</th>
          <th className="num">Valor</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((n) => {
          const [label, cls] = INVOICE_STATUS[n.status as string] ?? [String(n.status), "pill-neutral"];
          const os = n.service_orders as { number: number } | null;
          return (
            <tr key={n.id as string}>
              <td>{fmtDate(n.effective_date as string)}</td>
              <td>{(n.number as string) ?? "—"}</td>
              <td>{(n.customers as { name: string } | null)?.name ?? "—"}</td>
              <td>
                {os ? <Link href={`/os/${n.service_order_id}`}>OS {os.number}</Link> : "Avulsa"}
                {n.auto ? <span className="muted"> · automática</span> : null}
              </td>
              <td>
                <span className={`pill ${cls}`}>{label}</span>
                {n.status_description && n.status !== "authorized" ? (
                  <div className="muted" style={{ fontSize: 12, maxWidth: 280 }}>
                    {String(n.status_description)}
                  </div>
                ) : null}
              </td>
              <td className="num">{formatBRL(n.value_cents as number)}</td>
              <td className="num" style={{ whiteSpace: "nowrap" }}>
                {n.pdf_url ? (
                  <a href={n.pdf_url as string} target="_blank" rel="noopener noreferrer">
                    PDF
                  </a>
                ) : null}{" "}
                {n.xml_url ? (
                  <a href={n.xml_url as string} target="_blank" rel="noopener noreferrer">
                    XML
                  </a>
                ) : null}{" "}
                {n.asaas_invoice_id && !["authorized", "canceled", "error"].includes(n.status as string) ? (
                  <form action={refresh} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={n.id as string} />
                    <input type="hidden" name="back" value={back} />
                    <button className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: 12 }}>
                      Atualizar
                    </button>
                  </form>
                ) : null}{" "}
                {canIssue && ["authorized", "scheduled", "cancellation_denied"].includes(n.status as string) ? (
                  <form action={cancel} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={n.id as string} />
                    <input type="hidden" name="back" value={back} />
                    <button className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: 12, color: "var(--bad)" }}>
                      Cancelar
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

