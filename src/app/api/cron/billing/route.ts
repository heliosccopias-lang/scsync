import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { platformAsaas, applySubscriptionPayment } from "@/lib/platform-billing";
import { addDaysISO, GRACE_DAYS } from "@/lib/plans";
import { todayInSaoPaulo } from "@/lib/money";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily: re-reads open subscriptions from Asaas (lost webhooks), suspends accounts overdue past the
// grace days, and ends subscriptions cancelled at the end of the paid period.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const today = todayInSaoPaulo();
  const out = { synced: 0, suspended: 0, cancelled: 0, errors: 0 };

  const client = platformAsaas();
  if (client) {
    const { data: subs } = await admin.from("accounts").select("id, asaas_subscription_id").not("asaas_subscription_id", "is", null).in("status", ["trial", "active", "past_due", "suspended"]).limit(500);
    for (const a of subs ?? []) {
      try {
        const { data } = await client.subscriptionPayments(a.asaas_subscription_id!);
        for (const p of data ?? []) {
          if (["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(p.status)) await applySubscriptionPayment("PAYMENT_RECEIVED", { ...p, subscription: a.asaas_subscription_id });
          else if (p.status === "OVERDUE") await applySubscriptionPayment("PAYMENT_OVERDUE", { ...p, subscription: a.asaas_subscription_id });
        }
        out.synced++;
      } catch {
        out.errors++;
      }
    }
  }

  const limit = addDaysISO(today, -GRACE_DAYS);
  const { data: late } = await admin.from("accounts").update({ status: "suspended" }).in("status", ["active", "past_due"]).neq("plan", "founder").lt("paid_until", limit).eq("cancel_at_period_end", false).select("id");
  out.suspended = late?.length ?? 0;
  const { data: ended } = await admin.from("accounts").update({ status: "cancelled" }).eq("cancel_at_period_end", true).lt("paid_until", today).neq("status", "cancelled").select("id");
  out.cancelled = ended?.length ?? 0;
  return NextResponse.json(out);
}
