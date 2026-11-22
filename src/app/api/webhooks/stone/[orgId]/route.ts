import { NextResponse } from "next/server";
import { tokenMatchesHash } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { syncStoneCharge } from "@/lib/pos-db";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stone/Pagar.me postbacks (charge.paid, charge.refunded, order.*). The URL carries ?token=…; the payload is never
// trusted: the order is read again from the Stone API before anything is recorded.
export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const admin = supabaseAdmin();
  const { data: org } = await admin.from("orgs").select("stone_webhook_token_hash").eq("id", orgId).maybeSingle();
  if (!org?.stone_webhook_token_hash || !tokenMatchesHash(new URL(req.url).searchParams.get("token"), org.stone_webhook_token_hash)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { type?: string; data?: { id?: string; order?: { id?: string }; metadata?: Record<string, string> } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const orderId = body.data?.order?.id ?? (String(body.type ?? "").startsWith("order.") ? body.data?.id : undefined);
  if (!orderId) return NextResponse.json({ received: true, ignored: true });
  const { data: pc } = await admin.from("pos_charges").select("id").eq("org_id", orgId).eq("provider", "stone").eq("external_order_id", orderId).maybeSingle();
  if (!pc) return NextResponse.json({ received: true, ignored: "unknown_order" });
  try {
    const result = await syncStoneCharge(orgId, pc.id);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    console.error("stone webhook failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
