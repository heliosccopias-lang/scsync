import { Shell } from "@/components/Shell";
import { todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { NewOrderForm } from "./NewOrderForm";

export default async function NewServiceOrderPage() {
  const { sb, orgId, orgName } = await requireOrg();
  const [{ data: customers }, { data: technicians }, { data: catalog }, { data: conditions }, { data: priceLists }, { data: sectors }] = await Promise.all([
    sb.from("customers").select("id, name").eq("org_id", orgId).order("name").limit(1000),
    sb.from("technicians").select("id, name").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("catalog_items").select("id, kind, name, price_cents").eq("org_id", orgId).eq("active", true).order("name").limit(2000),
    sb.from("payment_conditions").select("id, name").eq("org_id", orgId).order("name"),
    sb.from("price_lists").select("attendance_type, adjust_pct").eq("org_id", orgId).not("attendance_type", "is", null),
    sb.from("sectors").select("id, name").eq("org_id", orgId).eq("active", true).order("position").order("name"),
  ]);
  const adjustments = Object.fromEntries((priceLists ?? []).map((p) => [p.attendance_type as string, Number(p.adjust_pct)]));

  return (
    <Shell orgName={orgName}>
      <h1>Nova ordem de serviço</h1>
      <NewOrderForm customers={customers ?? []} technicians={technicians ?? []} sectors={sectors ?? []} catalog={catalog ?? []} conditions={conditions ?? []} adjustments={adjustments} today={todayInSaoPaulo()} />
    </Shell>
  );
}
