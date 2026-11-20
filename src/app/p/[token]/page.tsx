import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print/PrintButton";
import { ServiceOrderSheet } from "@/components/print/ServiceOrderSheet";
import "@/components/print/print.css";
import { loadSheet } from "@/lib/os-data";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ordem de serviço",
  robots: { index: false, follow: false },
};

// Public page behind an unguessable token: what the customer sees from the WhatsApp link.
// Never shows internal notes.
export default async function PublicServiceOrder({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const sheet = await loadSheet(supabaseAdmin(), { column: "share_token", value: token });
  if (!sheet) notFound();
  const data = { ...sheet.data, os: { ...sheet.data.os, internal_notes: null } };

  return (
    <div className="print-page">
      <div className="print-toolbar no-print" style={{ justifyContent: "flex-end" }}>
        <PrintButton />
      </div>
      <ServiceOrderSheet data={data} mode="customer" />
    </div>
  );
}
