import Link from "next/link";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { formatBRL } from "@/lib/money";
import { INVOICE_STATUS, nfseReady, type NfseSettings } from "@/lib/nfse";
import { InvoiceRows } from "./InvoiceRows";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; situacao?: string; de?: string; ate?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  let q = ctx.sb
    .from("service_invoices")
    .select("id, effective_date, number, status, status_description, value_cents, pdf_url, xml_url, asaas_invoice_id, service_order_id, auto, customers(name), service_orders(number)")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (sp.situacao) q = q.eq("status", sp.situacao);
  if (day(sp.de)) q = q.gte("effective_date", day(sp.de)!);
  if (day(sp.ate)) q = q.lte("effective_date", day(sp.ate)!);
  const [{ data: rows }, { data: org }] = await Promise.all([q, ctx.sb.from("orgs").select("nfse").eq("id", ctx.orgId).single()]);
  const notReady = nfseReady((org?.nfse ?? null) as NfseSettings | null);
  const authorized = (rows ?? []).filter((r) => r.status === "authorized").reduce((a, r) => a + Number(r.value_cents), 0);

  return (
    <Shell>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Notas fiscais de serviço</h1>
        {ctx.can("fiscal.issue") && !notReady ? (
          <Link className="btn btn-primary" href="/notas/nova">
            Emitir nota avulsa
          </Link>
        ) : null}
      </div>
      <Notice error={sp.error} ok={sp.ok} />
      {notReady ? (
        <div className="notice notice-error">
          {notReady} {ctx.isOwner ? <Link href="/notas/configuracao">Abrir configuração fiscal</Link> : "Peça ao Dono da conta."}
        </div>
      ) : null}
      <form className="row" style={{ marginBottom: 12 }}>
        <select name="situacao" defaultValue={sp.situacao ?? ""} style={{ width: 200 }} aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(INVOICE_STATUS).map(([k, [l]]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <label className="muted">de</label>
        <input type="date" name="de" defaultValue={sp.de} style={{ width: 150 }} />
        <label className="muted">até</label>
        <input type="date" name="ate" defaultValue={sp.ate} style={{ width: 150 }} />
        <button className="btn btn-secondary">Filtrar</button>
        <span className="muted" style={{ marginLeft: "auto" }}>
          Emitidas na lista: {formatBRL(authorized)}
        </span>
      </form>
      {(rows ?? []).length === 0 ? (
        <div className="card empty">Nenhuma nota ainda. Emita pela OS (botão Nota fiscal) ou como nota avulsa.</div>
      ) : (
        <InvoiceRows rows={rows ?? []} back="/notas" canIssue={ctx.can("fiscal.issue")} />
      )}
    </Shell>
  );
}
