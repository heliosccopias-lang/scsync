import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { applySubscriptionPayment } from "@/lib/platform-billing";

export const dynamic = "force-dynamic";

function sameToken(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Platform Asaas account (SCsync charging the gráficas). Same contract as the companies' webhook:
// 401 wrong token, 200 handled or duplicate, 500 on our failure (Asaas retries).
export async function POST(req: Request) {
  if (!sameToken(req.headers.get("asaas-access-token"), process.env.ASAAS_PLATFORM_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { id?: string; event?: string; payment?: { id: string; status: string; dueDate: string; subscription?: string | null; value?: number } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body?.id || !body.event) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  const admin = supabaseAdmin();
  const { error: dup } = await admin
    .from("platform_billing_events")
    .insert({ id: body.id, event: body.event, payment_id: body.payment?.id ?? null, payload: body });
  if (dup) {
    if (dup.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    console.error("billing webhook insert", dup.message);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  try {
    const result = body.payment ? await applySubscriptionPayment(body.event, body.payment) : null;
    if (body.payment?.subscription) {
      const { data: acc } = await admin.from("accounts").select("id").eq("asaas_subscription_id", body.payment.subscription).maybeSingle();
      if (acc) await admin.from("platform_billing_events").update({ account_id: acc.id }).eq("id", body.id);
    }
    return NextResponse.json({ received: true, result });
  } catch (e) {
    // Let Asaas retry: drop the idempotency row so the retry is processed.
    await admin.from("platform_billing_events").delete().eq("id", body.id);
    console.error("billing webhook failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
