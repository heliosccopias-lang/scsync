import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/print/AutoPrint";
import { PrintButton } from "@/components/print/PrintButton";
import "@/components/print/print.css";
import { METHOD_LABEL, fmtDate, fmtDoc } from "@/lib/format";
import { formatBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));

/** Sale receipt (comprovante de venda): items, total and how it was paid; A4 or 80 mm thermal roll. */
export default async function SaleReceipt({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ formato?: string; auto?: string }>;
}) {
  const { id } = await params;
  const { formato, auto } = await searchParams;
  const roll = formato === "80mm";
  const { sb, orgId, can } = await requireOrg();
  if (!can("prices.view")) notFound();

  const { data: os } = await sb
    .from("service_orders")
    .select("id, number, channel, status, created_at, total_cents, discount_cents, notes, customers(name, cpf_cnpj), technicians!service_orders_technician_id_fkey(name), orgs(name, cnpj)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!os) notFound();

  const [{ data: items }, { data: inst }, { data: recs }] = await Promise.all([
    sb.from("service_order_items").select("id, description, quantity, unit_price_cents, total_cents").eq("service_order_id", id).eq("rejected", false).order("position"),
    sb.from("service_order_installments").select("number, due_date, amount_cents, method").eq("service_order_id", id).order("number"),
    sb.from("receivables").select("id").eq("origin_type", "service_order").eq("origin_id", id),
  ]);
  const recIds = (recs ?? []).map((r) => r.id);
  const { data: paid } = recIds.length
    ? await sb.from("settlements").select("id, paid_on, amount_cents, interest_cents, method, reference, card_installments").in("receivable_id", recIds).is("reversed_at", null).order("paid_on")
    : { data: [] };

  const org = os.orgs as unknown as { name: string; cnpj: string | null };
  const c = os.customers as unknown as { name: string; cpf_cnpj: string | null } | null;
  const tech = os.technicians as unknown as { name: string } | null;
  const subtotal = (items ?? []).reduce((a, i) => a + i.total_cents, 0);
  const paidTotal = (paid ?? []).reduce((a, s) => a + s.amount_cents + s.interest_cents, 0);
  const open = Math.max(0, os.total_cents - paidTotal);
  const when = new Date(os.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const title = os.channel === "counter" ? "COMPROVANTE DE VENDA" : "COMPROVANTE";

  return (
    <div className={`print-page${roll ? " roll" : ""}`}>
      {auto === "1" ? <AutoPrint /> : null}
      {roll ? (
        <style>{`@media print { @page { size: 80mm auto; margin: 0; } } .roll .sheet { width: 80mm; padding: 4mm 3mm; font-size: 11px; } .roll .sheet td, .roll .sheet th { padding: 3px 2px; font-size: 10.5px; } .roll .sheet-head { display: block; text-align: center; } .roll .sheet-brand { justify-content: center; } .roll .sheet-logo { height: 40px; } .roll .doc-id { text-align: center; margin-top: 6px; } .roll .doc-number { font-size: 16px; } .roll .print-toolbar { max-width: 80mm; flex-wrap: wrap; gap: 6px; }`}</style>
      ) : null}
      <div className="print-toolbar no-print">
        <div className="row">
          <Link href={`/os/${id}`} className="btn btn-secondary">
            ← Ver venda
          </Link>
          {os.channel === "counter" ? (
            <Link href="/vendas/nova" className="btn btn-secondary">
              + Nova venda
            </Link>
          ) : null}
        </div>
        <div className="row">
          <Link href={`/os/${id}/cupom${roll ? "" : "?formato=80mm"}`} className="btn btn-secondary">
            {roll ? "Folha A4" : "Bobina 80 mm"}
          </Link>
          <PrintButton />
        </div>
      </div>
      <article className="sheet" style={{ minHeight: "auto" }}>
        <header className="sheet-head">
          <div className="sheet-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sheet-logo" src="/brand/scsync-logo-compact.svg" alt="SCsync" />
            <div>
              <div className="company">{org.name}</div>
              {org.cnpj ? <div className="muted">CNPJ {org.cnpj}</div> : null}
            </div>
          </div>
          <div className="doc-id">
            <div className="doc-title">{title}</div>
            <div className="doc-number">Nº {os.number}</div>
            <div className="muted">{when}</div>
          </div>
        </header>

        <section style={{ fontSize: roll ? 11 : 13 }}>
          <div>
            <strong>Cliente:</strong> {c?.name ?? "Consumidor final"}
            {c?.cpf_cnpj ? ` · ${fmtDoc(c.cpf_cnpj)}` : ""}
          </div>
          {tech ? (
            <div>
              <strong>Atendente:</strong> {tech.name}
            </div>
          ) : null}
        </section>

        <section>
          <table>
            <thead>
              <tr>
                <th>Descrição</th>
                <th className="num">Qtd</th>
                <th className="num">Unit.</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((i) => (
                <tr key={i.id}>
                  <td>{i.description}</td>
                  <td className="num">{qty(Number(i.quantity))}</td>
                  <td className="num">{formatBRL(i.unit_price_cents)}</td>
                  <td className="num">{formatBRL(i.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals" style={{ marginTop: 6 }}>
            {os.discount_cents > 0 ? (
              <>
                <div>
                  <span>Subtotal</span>
                  {formatBRL(subtotal)}
                </div>
                <div>
                  <span>Desconto</span>− {formatBRL(os.discount_cents)}
                </div>
              </>
            ) : null}
            <div className="grand">
              <span>Total</span>
              {formatBRL(os.total_cents)}
            </div>
          </div>
        </section>

        <section>
          <h3>Pagamento</h3>
          {(paid ?? []).length ? (
            <table>
              <tbody>
                {(paid ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>
                      {METHOD_LABEL[s.method] ?? s.method}
                      {s.card_installments && s.card_installments > 1 ? ` em ${s.card_installments}x` : ""}
                      {s.reference ? ` · ${s.reference}` : ""}
                    </td>
                    <td>{fmtDate(s.paid_on)}</td>
                    <td className="num">{formatBRL(s.amount_cents + s.interest_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {open > 0 ? (
            <>
              <p style={{ margin: "6px 0" }}>
                {(paid ?? []).length ? "Saldo a pagar:" : "A pagar:"} <strong>{formatBRL(open)}</strong>
                {(inst ?? []).length > 1 ? ` em ${(inst ?? []).length} parcelas` : ""}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Parcela</th>
                    <th>Vencimento</th>
                    <th>Forma</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {(inst ?? []).map((p) => (
                    <tr key={p.number}>
                      <td>
                        {p.number}/{(inst ?? []).length}
                      </td>
                      <td>{fmtDate(p.due_date)}</td>
                      <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="num">{formatBRL(p.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p style={{ margin: "6px 0" }}>
              <strong>Pago.</strong> Obrigado pela preferência!
            </p>
          )}
        </section>

        {os.notes ? <p className="muted">Obs.: {os.notes}</p> : null}
        {open > 0 && c ? (
          <footer className="signatures" style={{ gridTemplateColumns: "1fr", maxWidth: 320, margin: "32px auto 0" }}>
            <div>
              <div className="line" />
              {c.name}
            </div>
          </footer>
        ) : null}
        <p className="muted" style={{ textAlign: "center", fontSize: 10, marginTop: 16 }}>
          Documento sem valor fiscal.
        </p>
      </article>
    </div>
  );
}
