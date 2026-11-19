import { NextResponse } from "next/server";
import { tokenMatchesHash } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Asaas posts payment events here. Contract:
// - 401 if the asaas-access-token header does not match this org's token (Asaas will not retry forever)
// - 200 once the event is stored and applied (or recognised as a duplicate)
// - 500 on our own failure, so Asaas retries
export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = supabaseAdmin();
  const { data: conn } = await admin.from("asaas_connections").select("webhook_token_hash").eq("org_id", orgId).maybeSingle();
  if (!conn || !tokenMatchesHash(req.headers.get("asaas-access-token"), conn.webhook_token_hash)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!event || typeof event !== "object" || !("id" in event) || !("event" in event)) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const { data, error } = await admin.rpc("apply_asaas_event", { p_org: orgId, p_event: event });
  if (error) {
    console.error("asaas webhook failed", { orgId, error: error.message });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true, result: data });
}
