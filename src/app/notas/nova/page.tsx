import Link from "next/link";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { describeOrder, invoiceTaxes, nfseReady, serviceValueOfOrder, type NfseSettings } from "@/lib/nfse";
import { issue } from "../actions";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ os?: string; error?: string }> }) {
  const { os: osId, error } = await searchParams;
  const ctx = await requireOrg();
  const [{ data: org }, { data: customers }] = await Promise.all([
    ctx.sb.from("orgs").select("nfse").eq("id", ctx.orgId).single(),
    ctx.sb.from("customers").select("id, name, cpf_cnpj, address").eq("org_id", ctx.orgId).order("name").limit(3000),
  ]);
  const settings = (org?.nfse ?? {}) as NfseSettings;
  const notReady = nfseReady(settings);

  let os: { id: string; number: number; customer_id: string; services_cents: number; products_cents: number; discount_cents: number } | null = null;
  let description = "";
  let value = 0;
  if (osId) {
    const { data } = await ctx.sb.from("service_orders").select("id, number, customer_id, services_cents, products_cents, discount_cents").eq("id", osId).eq("org_id", ctx.orgId).maybeSingle();
    os = data;
    if (os) {
      const { data: items } = await ctx.sb.from("service_order_items").select("kind, description, quantity, catalog_items(unit)").eq("service_order_id", os.id).eq("rejected", false).order("position");
      description = describeOrder(
        os.number,
        (items ?? []).map((i) => ({ kind: i.kind, description: i.description, quantity: Number(i.quantity), unit: (i.catalog_items as unknown as { unit: string } | null)?.unit })),
      );
      value = serviceValueOfOrder(Number(os.services_cents), Number(os.products_cents), Number(os.discount_cents));
    }
  }
  const { data: existing } = os
    ? await ctx.sb.from("service_invoices").select("value_cents, status").eq("service_order_id", os.id).not("status", "in", "(canceled,error)")
    : { data: [] as { value_cents: number; status: string }[] };
  const alreadyCents = (existing ?? []).reduce((a, r) => a + Number(r.value_cents), 0);
  const chosen = (customers ?? []).find((c) => c.id === os?.customer_id);
  const taxes = invoiceTaxes(settings);
  const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

  return (
    <Shell>
      <p className="muted" style={{ margin: "0 0 4px" }}>
        <Link href={os ? `/os/${os.id}` : "/notas"}>← {os ? `OS ${os.number}` : "Notas fiscais"}</Link>
      </p>
      <h1>{os ? `Nota fiscal da OS ${os.number}` : "Nota fiscal avulsa"}</h1>
      <Notice error={error} />
      {notReady ? (
        <div className="notice notice-error">
          {notReady} {ctx.isOwner ? <Link href="/notas/configuracao">Abrir configuração fiscal</Link> : "Peça ao Dono da conta."}
        </div>
      ) : null}
      {os && Number(os.products_cents) > 0 ? (
        <div className="notice">
          A NFS-e cobre só serviços: os produtos desta OS ({formatBRL(Number(os.products_cents))}) ficam fora do valor sugerido.
        </div>
      ) : null}
      {alreadyCents > 0 ? <div className="notice notice-error">Esta OS já tem nota(s) somando {formatBRL(alreadyCents)}. Confira antes de emitir outra.</div> : null}

      <form action={issue} className="card">
        {os ? <input type="hidden" name="service_order_id" value={os.id} /> : null}
        <div className="grid2">
          <div className="field">
            <label htmlFor="customer_id">Tomador do serviço (cliente)</label>
            <select id="customer_id" name="customer_id" defaultValue={os?.customer_id ?? ""} required>
              <option value="">Escolha…</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.cpf_cnpj ? "" : " (sem CPF/CNPJ)"}
                </option>
              ))}
            </select>
            {chosen && (!chosen.cpf_cnpj || !(chosen.address as { cep?: string })?.cep) ? (
              <span style={{ color: "var(--bad)", fontSize: 13 }}>
                Complete CPF/CNPJ, CEP e número de {chosen.name} em <Link href={`/cadastros/clientes?q=${encodeURIComponent(chosen.name)}`}>Clientes</Link>.
              </span>
            ) : null}
          </div>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="value">Valor (R$)</label>
              <input id="value" name="value" defaultValue={value ? brl(value) : ""} inputMode="decimal" required />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="deductions">Deduções (R$)</label>
              <input id="deductions" name="deductions" defaultValue="0,00" inputMode="decimal" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="effective_date">Data de emissão</label>
              <input id="effective_date" name="effective_date" type="date" defaultValue={todayInSaoPaulo()} />
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="description">Descrição do serviço</label>
          <textarea id="description" name="description" rows={3} defaultValue={description} required maxLength={900} />
        </div>
        <div className="field">
          <label htmlFor="observations">Observações (opcional)</label>
          <input id="observations" name="observations" defaultValue={settings.observations ?? ""} maxLength={1000} />
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Serviço municipal: <strong>{settings.service_name ?? "—"}</strong> ({settings.service_id ? `id ${settings.service_id}` : (settings.service_code ?? "—")}) · ISS {taxes.iss}%
          {taxes.retainIss ? " retido pelo tomador" : ""}
          {settings.simples === false ? ` · PIS ${taxes.pis}% · COFINS ${taxes.cofins}% · CSLL ${taxes.csll}%` : " · Simples Nacional"}
          {taxes.ir ? ` · IR ${taxes.ir}%` : ""}
          {taxes.inss ? ` · INSS ${taxes.inss}%` : ""}
        </p>
        <button className="btn btn-primary" disabled={!!notReady}>
          Emitir nota fiscal
        </button>
        <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
          Data de hoje: a nota é enviada à prefeitura na hora. Data futura: fica agendada.
        </span>
      </form>
    </Shell>
  );
}
