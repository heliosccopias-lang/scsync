import { Shell } from "@/components/Shell";
import { todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { NewOrderForm } from "./NewOrderForm";

export default async function NewServiceOrderPage() {
  const { sb, orgId, orgName } = await requireOrg();
  const [{ data: customers }, { data: technicians }, { data: catalog }] = await Promise.all([
    sb.from("customers").select("id, name").eq("org_id", orgId).order("name").limit(1000),
    sb.from("technicians").select("id, name").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("catalog_items").select("id, kind, name, price_cents").eq("org_id", orgId).eq("active", true).order("name").limit(2000),
  ]);

  return (
    <Shell orgName={orgName}>
      <h1>Nova ordem de serviço</h1>
      <NewOrderForm customers={customers ?? []} technicians={technicians ?? []} catalog={catalog ?? []} today={todayInSaoPaulo()} />
    </Shell>
  );
}
