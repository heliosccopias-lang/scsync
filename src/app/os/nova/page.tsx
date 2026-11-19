import { Shell } from "@/components/Shell";
import { todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { NewOrderForm } from "./NewOrderForm";

export default async function NewServiceOrderPage() {
  const { sb, orgId, orgName } = await requireOrg();
  const { data: customers } = await sb.from("customers").select("id, name").eq("org_id", orgId).order("name").limit(500);

  return (
    <Shell orgName={orgName}>
      <h1>Nova ordem de serviço</h1>
      <NewOrderForm customers={customers ?? []} today={todayInSaoPaulo()} />
    </Shell>
  );
}
