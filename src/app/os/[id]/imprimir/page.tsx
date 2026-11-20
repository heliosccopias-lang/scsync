import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print/PrintButton";
import { ServiceOrderSheet } from "@/components/print/ServiceOrderSheet";
import "@/components/print/print.css";
import { loadSheet } from "@/lib/os-data";
import { requireOrg } from "@/lib/session";

export default async function PrintServiceOrder({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ modo?: string }>;
}) {
  const { id } = await params;
  const { modo } = await searchParams;
  const { sb, orgId } = await requireOrg();
  const sheet = await loadSheet(sb, { column: "id", value: id, orgId });
  if (!sheet) notFound();
  const production = modo === "producao";

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link href={`/os/${id}`} className="btn btn-secondary">
          ← Voltar
        </Link>
        <div className="row">
          <Link href={production ? `/os/${id}/imprimir` : `/os/${id}/imprimir?modo=producao`} className="btn btn-secondary">
            {production ? "Ver via do cliente" : "Ver ordem de produção"}
          </Link>
          <PrintButton />
        </div>
      </div>
      <ServiceOrderSheet data={sheet.data} mode={production ? "production" : "customer"} />
    </div>
  );
}
