import { NextResponse } from "next/server";
import { tokenMatchesHash } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { HELP_TEXT, phoneKey, readInbound } from "@/lib/whatsapp";
import { parseExpenseMessage } from "@/lib/card";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Meta checks the callback URL with a GET carrying hub.verify_token and expects hub.challenge back.
export async function GET(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const url = new URL(req.url);
  if (!UUID.test(orgId)) return new NextResponse("not found", { status: 404 });
  const { data: org } = await supabaseAdmin().from("orgs").select("wa_verify_token").eq("id", orgId).maybeSingle();
  if (url.searchParams.get("hub.mode") === "subscribe" && org?.wa_verify_token && url.searchParams.get("hub.verify_token") === org.wa_verify_token) {
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// Messages from the provider. The URL carries ?token=… (shown in Configurações → Robô de WhatsApp).
// Always 200 once handled (also for ignored/unauthorized), so providers do not retry; 500 only on our failure.
// The reply text comes back as { replies: [{ to, text }] } for providers/automations that send it back.
export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const admin = supabaseAdmin();
  const { data: org } = await admin.from("orgs").select("id, wa_token_hash").eq("id", orgId).maybeSingle();
  const token = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-scsync-token");
  if (!org?.wa_token_hash || !tokenMatchesHash(token, org.wa_token_hash)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { provider, messages } = readInbound(body);
  if (!messages.length) return NextResponse.json({ received: true, messages: 0 });

  const [{ data: senders }, { data: cards }, { data: cats }] = await Promise.all([
    admin.from("whatsapp_senders").select("phone, name, active").eq("org_id", orgId),
    admin.from("credit_cards").select("id, name, last4, aliases").eq("org_id", orgId).eq("active", true),
    admin.from("financial_categories").select("id, name, keywords").eq("org_id", orgId).eq("direction", "out"),
  ]);
  const today = todayInSaoPaulo();
  const replies: { to: string; text: string }[] = [];

  for (const m of messages) {
    // Idempotency: the same message id is handled once.
    const { data: inbox, error: dup } = await admin
      .from("whatsapp_inbox")
      .insert({ org_id: orgId, provider, message_id: m.id.slice(0, 200), from_phone: m.from, text: m.text.slice(0, 2000), result: "ignored" })
      .select("id")
      .single();
    if (dup) {
      if (dup.code === "23505") continue;
      console.error("whatsapp inbox insert", dup.message);
      return NextResponse.json({ error: "processing_failed" }, { status: 500 });
    }

    const sender = (senders ?? []).find((s) => s.active && phoneKey(s.phone) === phoneKey(m.from));
    let result: "saved" | "ignored" | "unauthorized" | "error" = "ignored";
    let reply: string;
    let expenseId: string | null = null;
    const cmd = m.text.trim().toLowerCase();

    if (!sender) {
      result = "unauthorized";
      reply = "Este número não está autorizado a lançar despesas. Peça para cadastrarem você no SCsync.";
    } else if (["ajuda", "help", "menu", "oi", "olá", "ola"].includes(cmd)) {
      reply = HELP_TEXT;
    } else if (cmd === "cancelar") {
      const { data: last } = await admin
        .from("card_expenses")
        .select("id, description, amount_cents")
        .eq("org_id", orgId)
        .eq("source", "whatsapp")
        .eq("status", "pending")
        .in("sender_phone", [m.from, sender.phone])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last) {
        await admin.from("card_expenses").update({ status: "cancelled" }).eq("id", last.id).eq("org_id", orgId);
        reply = `Cancelado: ${last.description} ${formatBRL(last.amount_cents)}.`;
      } else reply = "Não há despesa sua pendente para cancelar (as já conciliadas só podem ser mudadas no sistema).";
    } else {
      const parsed = parseExpenseMessage(
        m.text,
        today,
        (cards ?? []).map((c) => ({ id: c.id, name: c.name, last4: c.last4, aliases: c.aliases ?? [] })),
        (cats ?? []).map((c) => ({ id: c.id, name: c.name, keywords: c.keywords ?? [] })),
      );
      if (!parsed.ok) {
        reply = `${parsed.reason}\nMande *ajuda* para ver exemplos.`;
      } else {
        const { data: exp, error } = await admin
          .from("card_expenses")
          .insert({
            org_id: orgId,
            card_id: parsed.cardId,
            spent_on: parsed.spentOn,
            amount_cents: parsed.amountCents,
            description: parsed.description,
            category_id: parsed.categoryId,
            source: "whatsapp",
            sender_phone: m.from,
            sender_name: sender.name ?? m.name,
            raw_text: m.text.slice(0, 2000),
          })
          .select("id")
          .single();
        if (error || !exp) {
          result = "error";
          reply = "Não consegui registrar agora. Tente de novo em instantes.";
        } else {
          result = "saved";
          expenseId = exp.id;
          const card = (cards ?? []).find((c) => c.id === parsed.cardId)?.name;
          const cat = (cats ?? []).find((c) => c.id === parsed.categoryId)?.name;
          reply = [
            `✅ Anotado: ${parsed.description} — ${formatBRL(parsed.amountCents)} em ${fmtDate(parsed.spentOn)}.`,
            `Cartão: ${card ?? "não informado (escreva o nome ou os 4 últimos dígitos)"}.`,
            `Categoria: ${cat ?? "sem categoria (dá para escolher na conciliação)"}.`,
            "Mande *cancelar* se estiver errado.",
          ].join("\n");
        }
      }
    }
    await admin.from("whatsapp_inbox").update({ result, reply, expense_id: expenseId }).eq("id", inbox.id);
    replies.push({ to: m.from, text: reply });
  }
  return NextResponse.json({ received: true, replies });
}
