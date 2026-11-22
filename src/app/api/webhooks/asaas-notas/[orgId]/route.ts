import { NextResponse } from "next/server";
import { tokenMatchesHash } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { saveInvoiceState } from "@/lib/nfse-db";
import type { AsaasInvoice } from "@/lib/asaas";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Asaas invoice (NFS-e) events: { id, event, invoice }. 401 wrong token, 200 handled/duplicate, 500 our failure.
export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const admin = supabaseAdmin();
  const { data: conn } = await admin.from("asaas_connections").select("invoice_webhook_token_hash").eq("org_id", orgId).maybeSingle();
  if (!conn?.invoice_webhook_token_hash || !tokenMatchesHash(req.headers.get("asaas-access-token"), conn.invoice_webhook_token_hash)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { id?: string; event?: string; invoice?: AsaasInvoice };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body?.id || !body.event || !body.invoice?.id) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  const { error: dup } = await admin.from("invoice_events").insert({ id: body.id, org_id: orgId, event: body.event, payload: body });
  if (dup) {
    if (dup.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  try {
    // Prefer our id (externalReference) so an invoice created elsewhere is not mixed up.
    const ref = body.invoice.externalReference && UUID.test(body.invoice.externalReference) ? body.invoice.externalReference : null;
    await saveInvoiceState(orgId, ref, body.invoice);
    return NextResponse.json({ received: true });
  } catch (e) {
    await admin.from("invoice_events").delete().eq("org_id", orgId).eq("id", body.id);
    console.error("invoice webhook failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
