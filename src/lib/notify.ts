import "server-only";
import { whatsappNumber } from "@/lib/br";
import { fmtDate } from "@/lib/format";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { supabaseAdmin } from "@/lib/supabase";
import { canSend, sendWhatsApp, type WaDevice } from "@/lib/whatsapp-send";
import {
  DEFAULT_TPL_READY,
  DEFAULT_TPL_REMINDER,
  SITUATION,
  firstName,
  paymentLines,
  reminderKind,
  render,
  type NoticeKind,
} from "@/lib/notify-text";

type Admin = ReturnType<typeof supabaseAdmin>;

type OrgRow = WaDevice & {
  id: string;
  name: string;
  notify_reminders: boolean;
  notify_ready: boolean;
  reminder_days_before: number;
  reminder_days_after: number;
  tpl_reminder: string | null;
  tpl_ready: string | null;
};

const ORG_COLS =
  "id, name, notify_reminders, notify_ready, reminder_days_before, reminder_days_after, tpl_reminder, tpl_ready, wa_provider, wa_api_url, wa_instance, wa_api_token_encrypted, wa_client_token_encrypted";
const LIVE = ["pending", "overdue", "confirmed"];
const appUrl = () => process.env.APP_URL ?? "https://scsync.vercel.app";

export type NoticeResult = "sent" | "failed" | "manual" | "no_phone" | "duplicate";

/**
 * Records the notice (once per installment and kind, or per OS for "OS pronta") and sends it from the
 * connected WhatsApp. Without a connection it waits as "manual" on the WhatsApp notices page.
 */
async function deliver(
  admin: Admin,
  org: OrgRow,
  n: { kind: NoticeKind; receivableId?: string | null; serviceOrderId?: string | null; customerName: string | null; phone: string | null; text: string },
): Promise<NoticeResult> {
  const number = whatsappNumber(n.phone);
  const status = !number ? "no_phone" : canSend(org) ? "failed" : "manual";
  const { data: row, error } = await admin
    .from("whatsapp_outbox")
    .insert({
      org_id: org.id,
      kind: n.kind,
      receivable_id: n.receivableId ?? null,
      service_order_id: n.serviceOrderId ?? null,
      customer_name: n.customerName,
      phone: number ?? n.phone,
      text: n.text,
      status,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? "duplicate" : "failed";
  if (status !== "failed") return status;
  try {
    await sendWhatsApp(org, number!, n.text);
    await admin.from("whatsapp_outbox").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", row.id);
    return "sent";
  } catch (e) {
    await admin.from("whatsapp_outbox").update({ error: String((e as Error).message).slice(0, 300) }).eq("id", row.id);
    return "failed";
  }
}

/** Payment reminders due today for one company. Returns a count per result. */
export async function runReminders(admin: Admin, orgId: string, opts: { force?: boolean } = {}): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const { data: org } = await admin.from("orgs").select(ORG_COLS).eq("id", orgId).maybeSingle();
  if (!org || (!org.notify_reminders && !opts.force)) return counts;
  const o = org as unknown as OrgRow;
  const today = todayInSaoPaulo();
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${today}T12:00:00Z`) + Math.max(0, o.reminder_days_before) * 86_400_000).toISOString().slice(0, 10);

  const { data: recs } = await admin
    .from("receivables")
    .select("id, name, due_date, amount_cents, paid_cents, origin_type, origin_id, customers(name, phone)")
    .eq("org_id", orgId)
    .in("status", ["open", "partial"])
    .gte("due_date", from)
    .lte("due_date", to)
    .limit(1000);
  const rows = (recs ?? []).map((r) => ({ ...r, kind: reminderKind(r.due_date as string, today, o.reminder_days_before, o.reminder_days_after) })).filter((r) => r.kind);
  if (!rows.length) return counts;

  // OS data (number, public link, walk-in contact) and live Asaas charges (payment link, Pix).
  const osIds = [...new Set(rows.filter((r) => r.origin_type === "service_order").map((r) => r.origin_id as string))];
  const { data: oss } = osIds.length
    ? await admin.from("service_orders").select("id, number, share_token, contact_name, contact_phone").in("id", osIds)
    : { data: [] };
  const osBy = new Map((oss ?? []).map((x) => [x.id as string, x]));
  const { data: charges } = await admin
    .from("charges")
    .select("receivable_id, invoice_url, pix_payload, status")
    .in("receivable_id", rows.map((r) => r.id as string))
    .in("status", LIVE);
  const chargeBy = new Map((charges ?? []).map((c) => [c.receivable_id as string, c]));

  for (const r of rows) {
    const cust = r.customers as unknown as { name: string; phone: string | null } | null;
    const os = r.origin_type === "service_order" ? osBy.get(r.origin_id as string) : undefined;
    const walkIn = cust?.name === "Consumidor final";
    const name = walkIn ? (os?.contact_name as string | null) : cust?.name;
    const phone = walkIn ? (os?.contact_phone as string | null) : cust?.phone;
    const ch = chargeBy.get(r.id as string);
    const parcel = /parcela (\d+\/\d+)/.exec(r.name as string)?.[1];
    const text = render(o.tpl_reminder || DEFAULT_TPL_REMINDER, {
      cliente: firstName(name),
      empresa: o.name,
      os: os ? String(os.number) : "",
      referencia: os ? `OS nº ${os.number}${parcel && parcel !== "1/1" ? ` (parcela ${parcel})` : ""}` : (r.name as string),
      valor: formatBRL(Number(r.amount_cents) - Number(r.paid_cents)),
      vencimento: fmtDate(r.due_date as string),
      situacao: SITUATION[r.kind!],
      link: ch?.invoice_url ?? (os ? `${appUrl()}/p/${os.share_token}` : ""),
      pagamento: paymentLines({ invoiceUrl: ch?.invoice_url, pixPayload: ch?.pix_payload, osUrl: os ? `${appUrl()}/p/${os.share_token}` : null, open: true }),
    });
    const res = await deliver(admin, o, { kind: r.kind!, receivableId: r.id as string, serviceOrderId: os?.id as string | undefined, customerName: name ?? null, phone: phone ?? null, text });
    counts[res] = (counts[res] ?? 0) + 1;
  }
  return counts;
}

/** Daily job: reminders for every company that turned them on. */
export async function runAllReminders(admin: Admin): Promise<Record<string, number>> {
  const total: Record<string, number> = {};
  const { data: orgs } = await admin.from("orgs").select("id").eq("notify_reminders", true).limit(2000);
  for (const o of orgs ?? []) {
    try {
      const c = await runReminders(admin, o.id as string);
      for (const [k, v] of Object.entries(c)) total[k] = (total[k] ?? 0) + v;
    } catch {
      total.error = (total.error ?? 0) + 1;
    }
  }
  return total;
}

/** The "OS pronta" message for an OS (who, which phone, the text), without sending it. */
export async function readyMessage(admin: Admin, orgId: string, osId: string): Promise<{ org: OrgRow; name: string | null; phone: string | null; text: string } | null> {
  const { data: org } = await admin.from("orgs").select(ORG_COLS).eq("id", orgId).maybeSingle();
  if (!org) return null;
  const o = org as unknown as OrgRow;
  const { data: os } = await admin
    .from("service_orders")
    .select("id, number, share_token, total_cents, contact_name, contact_phone, kind, customers(name, phone)")
    .eq("id", osId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!os || os.kind === "quote") return null;
  const cust = os.customers as unknown as { name: string; phone: string | null } | null;
  const walkIn = cust?.name === "Consumidor final";
  const name = (walkIn ? os.contact_name : cust?.name) ?? null;
  const phone = (walkIn ? os.contact_phone : cust?.phone) ?? null;

  // What is still open on this OS, with the Asaas link when a charge is live.
  const { data: recs } = await admin
    .from("receivables")
    .select("id, amount_cents, paid_cents, status")
    .eq("origin_type", "service_order")
    .eq("origin_id", osId)
    .in("status", ["open", "partial"]);
  const open = (recs ?? []).reduce((a, r) => a + Number(r.amount_cents) - Number(r.paid_cents), 0);
  const { data: ch } = (recs ?? []).length
    ? await admin.from("charges").select("invoice_url, pix_payload").in("receivable_id", (recs ?? []).map((r) => r.id as string)).in("status", LIVE).limit(1).maybeSingle()
    : { data: null };
  const osUrl = `${appUrl()}/p/${os.share_token}`;
  const pagamento =
    open > 0
      ? [`Valor em aberto: ${formatBRL(open)}.`, paymentLines({ invoiceUrl: ch?.invoice_url, pixPayload: ch?.pix_payload, osUrl, open: true })].join("\n")
      : "Pagamento já recebido. Obrigado!";
  const text = render(o.tpl_ready || DEFAULT_TPL_READY, {
    cliente: firstName(name),
    empresa: o.name,
    os: String(os.number),
    referencia: `OS nº ${os.number}`,
    valor: formatBRL(open),
    vencimento: "",
    situacao: "",
    link: ch?.invoice_url ?? osUrl,
    pagamento,
  });
  return { org: o, name, phone, text };
}

/** "OS pronta": the OS became Concluída. Sent once per OS; does nothing when the company turned it off (unless forced). */
export async function notifyOsReady(admin: Admin, orgId: string, osId: string, opts: { force?: boolean } = {}): Promise<NoticeResult | "off"> {
  const m = await readyMessage(admin, orgId, osId);
  if (!m || (!m.org.notify_ready && !opts.force)) return "off";
  return deliver(admin, m.org, { kind: "os_ready", serviceOrderId: osId, customerName: m.name, phone: m.phone, text: m.text });
}

/** True when the company has a WhatsApp number connected for automatic sending. */
export async function whatsappConnected(admin: Admin, orgId: string): Promise<boolean> {
  const { data } = await admin.from("orgs").select(ORG_COLS).eq("id", orgId).maybeSingle();
  return canSend(data as unknown as OrgRow);
}
