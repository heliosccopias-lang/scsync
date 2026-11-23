import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print/PrintButton";
import "@/components/print/print.css";
import { METHOD_LABEL, centsInWords, fmtDate, fmtDoc } from "@/lib/format";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, orgId } = await requireOrg();

  const { data: os } = await sb
    .from("service_orders")
    .select("id, number, total_cents, customers(name, cpf_cnpj), orgs(name, cnpj)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!os) notFound();

  const { data: recs } = await sb.from("receivables").select("id, name").eq("origin_type", "service_order").eq("origin_id", id);
  const recIds = (recs ?? []).map((r) => r.id);
  const { data: settlements } = recIds.length
    ? await sb
        .from("settlements")
        .select("id, receivable_id, paid_on, amount_cents, interest_cents, method, reference, card_installments")
        .in("receivable_id", recIds)
        .is("reversed_at", null)
        .order("paid_on")
    : { data: [] };

  const org = os.orgs as unknown as { name: string; cnpj: string | null };
  const c = os.customers as unknown as { name: string; cpf_cnpj: string | null };
  const recName = new Map((recs ?? []).map((r) => [r.id, r.name]));
  const total = (settlements ?? []).reduce((a, s) => a + s.amount_cents + s.interest_cents, 0);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link href={`/os/${id}`} className="btn btn-secondary">
          ← Voltar
        </Link>
        <PrintButton />
      </div>
      <article className="sheet" style={{ minHeight: "auto" }}>
        <header className="sheet-head">
          <div>
            <div className="company">{org.name}</div>
            {org.cnpj ? <div className="muted">CNPJ {org.cnpj}</div> : null}
          </div>
          <div className="doc-id">
            <div className="doc-title">RECIBO</div>
            <div className="doc-number">{formatBRL(total)}</div>
            <div className="muted">OS nº {os.number}</div>
          </div>
        </header>

        {total === 0 ? (
          <p>Nenhum pagamento registrado nesta OS ainda.</p>
        ) : (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.7 }}>
              Recebemos de <strong>{c?.name}</strong>
              {c?.cpf_cnpj ? <> (CPF/CNPJ {fmtDoc(c.cpf_cnpj)})</> : null} a importância de <strong>{formatBRL(total)}</strong> ({centsInWords(total)}), referente
              à ordem de serviço nº {os.number}
              , conforme os pagamentos abaixo.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Referência</th>
                  <th>Forma</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(settlements ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>{fmtDate(s.paid_on)}</td>
                    <td>{recName.get(s.receivable_id)}</td>
                    <td>
                      {METHOD_LABEL[s.method] ?? s.method}
                      {s.card_installments && s.card_installments > 1 ? ` em ${s.card_installments}x` : ""}
                      {s.reference ? ` · NSU ${s.reference}` : ""}
                    </td>
                    <td className="num">{formatBRL(s.amount_cents + s.interest_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total < os.total_cents ? (
              <p className="muted">Saldo em aberto da OS: {formatBRL(os.total_cents - total)}.</p>
            ) : (
              <p className="muted">OS quitada.</p>
            )}
          </>
        )}

        <p style={{ marginTop: 32 }}>Emitido em {fmtDate(todayInSaoPaulo())}.</p>
        <footer className="signatures" style={{ gridTemplateColumns: "1fr", maxWidth: 320, margin: "40px auto 0" }}>
          <div>
            <div className="line" />
            {org.name}
          </div>
        </footer>
        <div className="made-with">
          Emitido com {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/scsync-mono.svg" alt="SCsync" />
        </div>
      </article>
    </div>
  );
}
