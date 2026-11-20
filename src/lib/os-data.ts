import "server-only";
import type { SheetData } from "@/components/print/ServiceOrderSheet";

type Client = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Loads everything the OS sheet needs. `filter` picks the OS (by id+org for staff, by share token for the public link). */
export async function loadSheet(sb: Client, filter: { column: "id" | "share_token"; value: string; orgId?: string }) {
  let q = sb
    .from("service_orders")
    .select("*, customers(name, cpf_cnpj, email, phone), orgs(name, cnpj), technicians!service_orders_technician_id_fkey(name), vehicles(plate, model)")
    .eq(filter.column, filter.value);
  if (filter.orgId) q = q.eq("org_id", filter.orgId);
  const { data: os } = await q.maybeSingle();
  if (!os) return null;

  const [{ data: items }, { data: installments }] = await Promise.all([
    sb.from("service_order_items").select("id, kind, description, quantity, unit_price_cents, total_cents, rejected").eq("service_order_id", os.id).order("position"),
    sb.from("service_order_installments").select("id, number, due_date, method, amount_cents").eq("service_order_id", os.id).order("number"),
  ]);

  const data: SheetData = {
    os,
    org: os.orgs,
    customer: os.customers,
    technician: os.technicians?.name ?? null,
    vehicle: os.vehicles ? `${os.vehicles.plate}${os.vehicles.model ? ` · ${os.vehicles.model}` : ""}${os.km_at_open != null ? ` · ${Number(os.km_at_open).toLocaleString("pt-BR")} km` : ""}` : null,
    items: items ?? [],
    installments: installments ?? [],
  };
  return { id: os.id as string, orgId: os.org_id as string, shareToken: os.share_token as string, data };
}
