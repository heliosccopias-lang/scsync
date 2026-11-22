import { NextResponse } from "next/server";
import { tokenMatchesHash } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { syncPosCharge } from "@/lib/pos-db";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mercado Pago "Order" notifications. The URL carries ?token=…; the order is read again from the API
// before anything is recorded, so the payload is never trusted. Answer fast (MP waits 22 s).
export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(req.url);
  const admin = supabaseAdmin();
  const { data: org } = await admin.from("orgs").select("mp_webhook_token_hash").eq("id", orgId).maybeSingle();
  if (!org?.mp_webhook_token_hash || !tokenMatchesHash(url.searchParams.get("token"), org.mp_webhook_token_hash)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { type?: string; data?: { id?: string } } = {};
  try {
    body = await req.json();
  } catch {
    /* MP may send the id only in the query */
  }
  const orderId = body.data?.id ?? url.searchParams.get("data.id");
  if (!orderId || (body.type && body.type !== "order")) return NextResponse.json({ received: true, ignored: true });
  const { data: pc } = await admin.from("pos_charges").select("id").eq("org_id", orgId).eq("provider", "mercadopago").eq("external_order_id", orderId).maybeSingle();
  if (!pc) return NextResponse.json({ received: true, ignored: "unknown_order" });
  try {
    return NextResponse.json({ received: true, result: await syncPosCharge(orgId, pc.id) });
  } catch (e) {
    console.error("mercadopago webhook failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
