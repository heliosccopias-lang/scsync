import { Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { CounterSaleForm } from "./CounterSaleForm";

/** Counter sale: products off the shelf, stock out and payment in one go. */
export default async function CounterSalePage() {
  const { sb, orgId, orgName, can } = await requireOrg();
  const [{ data: catalog }, { data: customers }] = await Promise.all([
    sb.from("catalog_items").select("id, kind, name, price_cents, code").eq("org_id", orgId).eq("active", true).order("name").limit(3000),
    sb.from("customers").select("id, name").eq("org_id", orgId).order("name").limit(1000),
  ]);
  // Products first; services can also be sold at the counter (e.g. a quick copy).
  const items = (catalog ?? []).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "product" ? -1 : 1));
  return (
    <Shell orgName={orgName}>
      <h1>Venda no balcão</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Para vender produtos na hora (papel, tinta, envelope, agenda, caneta…). A venda baixa o estoque, entra em contas a receber e aparece em
        Ordens de serviço com a marca <span className="tag-counter">Balcão</span>.
      </p>
      <CounterSaleForm
        catalog={items.map((c) => ({ id: c.id, kind: c.kind, name: c.name, price_cents: c.price_cents }))}
        customers={(customers ?? []).filter((c) => c.name !== "Consumidor final")}
        canReceive={can("finance.receive")}
      />
    </Shell>
  );
}
