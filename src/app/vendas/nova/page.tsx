import { Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { CounterSaleForm } from "./CounterSaleForm";

/** Counter sale: products off the shelf, stock out and payment in one go. */
export default async function CounterSalePage() {
  const { sb, orgId, orgName, can, user } = await requireOrg();
  const [{ data: catalog }, { data: customers }, { data: technicians }, { data: conditions }, { data: sectors }] = await Promise.all([
    sb.from("catalog_items").select("id, kind, name, price_cents, code").eq("org_id", orgId).eq("active", true).order("name").limit(3000),
    sb.from("customers").select("id, name").eq("org_id", orgId).order("name").limit(1000),
    sb.from("technicians").select("id, name, user_id").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("payment_conditions").select("id, name").eq("org_id", orgId).order("name"),
    sb.from("sectors").select("id, name").eq("org_id", orgId).eq("active", true).order("position").order("name"),
  ]);
  // Whoever is signed in comes chosen, when they are registered as technician/attendant.
  const me = (technicians ?? []).find((t) => t.user_id === user.id)?.id ?? "";
  // Products first; services can also be sold at the counter (e.g. a quick copy).
  const items = (catalog ?? []).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "product" ? -1 : 1));
  return (
    <Shell orgName={orgName}>
      <div className="page-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/scsync-logo-compact.svg" alt="SCsync" />
        <h1 style={{ margin: 0 }}>Venda no balcão</h1>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        Para vender produtos na hora (papel, tinta, envelope, agenda, caneta…). A venda baixa o estoque, entra em contas a receber e aparece em
        Ordens de serviço com a marca <span className="tag-counter">Balcão</span>.
      </p>
      <CounterSaleForm
        catalog={items.map((c) => ({ id: c.id, kind: c.kind, name: c.name, price_cents: c.price_cents }))}
        customers={(customers ?? []).filter((c) => c.name !== "Consumidor final")}
        canReceive={can("finance.receive")}
        attendants={(technicians ?? []).map((t) => ({ id: t.id, name: t.name }))}
        defaultAttendant={me}
        canManageAttendants={can("settings")}
        canAddCustomer={can("customers.edit")}
        conditions={conditions ?? []}
        sectors={sectors ?? []}
      />
    </Shell>
  );
}
