import { NextResponse } from "next/server";
import { asaasFor, syncChargeFromAsaas } from "@/lib/charges";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshInvoice } from "@/lib/nfse-db";
import { syncBankAccount, syncCard } from "@/lib/bank-sync";
import { syncPosCharge } from "@/lib/pos-db";
import { runAllReminders } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily safety net: re-reads open charges from Asaas in case a webhook was lost
// or the Asaas webhook queue was paused.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const { data: open, error } = await admin
    .from("charges")
    .select("org_id, asaas_payment_id")
    .in("status", ["pending", "overdue", "confirmed"])
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Record<string, number> = {};
  const clients = new Map<string, Awaited<ReturnType<typeof asaasFor>>>();
  for (const c of open ?? []) {
    if (!clients.has(c.org_id)) clients.set(c.org_id, await asaasFor(c.org_id));
    const client = clients.get(c.org_id);
    if (!client) continue;
    try {
      const r = await syncChargeFromAsaas(c.org_id, client, c.asaas_payment_id);
      results[r] = (results[r] ?? 0) + 1;
    } catch {
      results.error = (results.error ?? 0) + 1;
    }
  }
  // Invoices (NFS-e) still in progress: re-read from Asaas in case an invoice webhook was lost.
  const { data: pending } = await admin
    .from("service_invoices")
    .select("id, org_id")
    .in("status", ["scheduled", "synchronized", "processing_cancellation"])
    .not("asaas_invoice_id", "is", null)
    .limit(500);
  let invoices = 0;
  for (const inv of pending ?? []) {
    try {
      await refreshInvoice(inv.org_id, inv.id);
      invoices++;
    } catch {
      results.invoice_error = (results.invoice_error ?? 0) + 1;
    }
  }
  // Bank accounts and cards with automatic import on (Asaas statement / Pluggy).
  const sync = { banks: 0, cards: 0, errors: 0 };
  const { data: banks } = await admin.from("bank_accounts").select("id, org_id").eq("auto_sync", true).eq("active", true).limit(500);
  for (const b of banks ?? []) {
    try {
      await syncBankAccount(admin, b.org_id, b.id);
      sync.banks++;
    } catch {
      sync.errors++;
    }
  }
  const { data: cards } = await admin.from("credit_cards").select("id, org_id").eq("auto_sync", true).eq("active", true).limit(500);
  for (const c of cards ?? []) {
    try {
      await syncCard(admin, c.org_id, c.id);
      sync.cards++;
    } catch {
      sync.errors++;
    }
  }
  // Terminal charges still waiting (lost webhook): read again from Stone.
  const { data: pos } = await admin
    .from("pos_charges")
    .select("id, org_id")
    .eq("status", "pending")
    .in("provider", ["stone", "mercadopago"])
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .limit(500);
  let posSynced = 0;
  for (const p of pos ?? []) {
    try {
      await syncPosCharge(p.org_id, p.id);
      posSynced++;
    } catch {
      /* next run */
    }
  }
  // Payment reminders by WhatsApp, after the payments above are up to date (who already paid gets nothing).
  let reminders: Record<string, number> = {};
  try {
    reminders = await runAllReminders(admin);
  } catch {
    reminders = { error: 1 };
  }
  return NextResponse.json({ checked: open?.length ?? 0, invoices, sync, pos: posSynced, results, reminders });
}
