import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { HELP_TEXT, phoneKey, type Inbound } from "@/lib/whatsapp";
import { parseExpenseMessage } from "@/lib/card";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { fmtDate } from "@/lib/format";

type Admin = ReturnType<typeof supabaseAdmin>;
export type RobotResult = { handled: boolean; result: "saved" | "ignored" | "unauthorized" | "error"; reply: string | null; inboxId: string | null; expenseId: string | null };

/** Authorized numbers, cards and expense categories of the company: loaded once per batch of messages. */
export async function loadRobotContext(admin: Admin, orgId: string) {
  const [{ data: senders }, { data: cards }, { data: cats }] = await Promise.all([
    admin.from("whatsapp_senders").select("phone, name, active").eq("org_id", orgId),
    admin.from("credit_cards").select("id, name, last4, aliases").eq("org_id", orgId).eq("active", true),
    admin.from("financial_categories").select("id, name, keywords").eq("org_id", orgId).eq("direction", "out"),
  ]);
  return { senders: senders ?? [], cards: cards ?? [], cats: cats ?? [], today: todayInSaoPaulo() };
}
export type RobotContext = Awaited<ReturnType<typeof loadRobotContext>>;

/**
 * One message to the robot, the same for the real WhatsApp and for the simulator: idempotent by message id,
 * ignores numbers that are not authorized (and does not keep their text), understands ajuda/cancelar,
 * registers the expense and writes the reply. Sending the reply back is up to the caller.
 */
export async function handleRobotMessage(admin: Admin, orgId: string, provider: string, m: Inbound, c: RobotContext): Promise<RobotResult> {
  const { data: inbox, error: dup } = await admin
    .from("whatsapp_inbox")
    .insert({ org_id: orgId, provider, message_id: m.id.slice(0, 200), from_phone: m.from, text: m.text.slice(0, 2000), result: "ignored" })
    .select("id")
    .single();
  if (dup) {
    if (dup.code === "23505") return { handled: false, result: "ignored", reply: null, inboxId: null, expenseId: null };
    throw new Error(`whatsapp inbox insert: ${dup.message}`);
  }

  const sender = c.senders.find((s) => s.active && phoneKey(s.phone) === phoneKey(m.from));
  if (!sender) {
    // The connected number may be the company's own: never answer people who are not authorized.
    await admin.from("whatsapp_inbox").update({ result: "unauthorized", text: null }).eq("id", inbox.id);
    return { handled: true, result: "unauthorized", reply: null, inboxId: inbox.id, expenseId: null };
  }

  let result: RobotResult["result"] = "ignored";
  let reply: string;
  let expenseId: string | null = null;
  const cmd = m.text.trim().toLowerCase();

  if (["ajuda", "help", "menu", "oi", "olá", "ola"].includes(cmd)) {
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
      c.today,
      c.cards.map((x) => ({ id: x.id, name: x.name, last4: x.last4, aliases: x.aliases ?? [] })),
      c.cats.map((x) => ({ id: x.id, name: x.name, keywords: x.keywords ?? [] })),
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
        const card = c.cards.find((x) => x.id === parsed.cardId)?.name;
        const cat = c.cats.find((x) => x.id === parsed.categoryId)?.name;
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
  return { handled: true, result, reply, inboxId: inbox.id, expenseId };
}
