"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { handleRobotMessage, loadRobotContext } from "@/lib/whatsapp-robot";
import { cardCycles, parseCardCsv } from "@/lib/card";
import { sampleStatement, sampleStatementCsv } from "@/lib/card-sample";
import { autoMatchStatement, ingestStatement } from "@/lib/card-db";
import { todayInSaoPaulo } from "@/lib/money";

import { SAMPLE_FILE, SIM_PROVIDER, STRANGER_PHONE, TEST_CARD, TEST_PHONE } from "./constants";

const BACK = "/cartoes/simulador";

function go(key: "error" | "ok", msg: string, path = BACK): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}

async function guard(ownerOnly = false) {
  const ctx = await requireOrg();
  if (!ctx.can("finance.edit")) go("error", "Seu perfil não usa a conciliação de cartão.");
  if (ownerOnly && !ctx.isOwner) go("error", "Só o Dono da conta prepara ou limpa os dados de teste.");
  return ctx;
}

/** A message typed in the simulator goes through exactly the same handling as one coming from WhatsApp. */
export async function simulateMessage(form: FormData) {
  const ctx = await guard();
  const text = String(form.get("text") ?? "").trim();
  if (!text) go("error", "Digite a mensagem.");
  const from = form.get("from") === "stranger" ? STRANGER_PHONE : String(form.get("from") ?? "").replace(/\D/g, "");
  if (!from) go("error", "Escolha quem está mandando.");
  const admin = supabaseAdmin();
  const context = await loadRobotContext(admin, ctx.orgId);
  await handleRobotMessage(admin, ctx.orgId, SIM_PROVIDER, { id: `sim:${randomUUID()}`, from, name: "Simulador", text: text.slice(0, 500) }, context);
  redirect(`${BACK}?de=${encodeURIComponent(form.get("from") === "stranger" ? "stranger" : from)}#conversa`);
}

/** Test card, a test sender and keywords on the expense categories, so the robot understands the examples. */
export async function prepareTest() {
  const ctx = await guard(true);
  const admin = supabaseAdmin();
  const orgId = ctx.orgId;

  const { data: cat } = await admin.from("financial_categories").select("id").eq("org_id", orgId).eq("direction", "out").eq("name", "Cartão de crédito").maybeSingle();
  const cardCat = cat?.id ?? (await admin.from("financial_categories").insert({ org_id: orgId, name: "Cartão de crédito", direction: "out" }).select("id").single()).data?.id ?? null;
  const KEYWORDS: Record<string, string[]> = {
    "Combustível": ["gasolina", "posto", "etanol", "alcool", "diesel", "combustivel"],
    "Alimentação": ["almoço", "almoco", "lanche", "restaurante", "jantar", "padaria", "café", "cafe", "marmita"],
    "Estacionamento": ["estacionamento", "zona azul", "parking", "estapar"],
    "Tarifas bancárias": ["anuidade", "tarifa", "iof", "juros"],
    "Material gráfico": ["papel", "couchê", "couche", "tinta", "toner", "envelope", "lona", "vinil", "laminação"],
  };
  for (const [name, words] of Object.entries(KEYWORDS)) {
    const { data: c } = await admin.from("financial_categories").select("id, keywords").eq("org_id", orgId).eq("direction", "out").eq("name", name).maybeSingle();
    if (!c) await admin.from("financial_categories").insert({ org_id: orgId, name, direction: "out", keywords: words });
    else if (!(c.keywords ?? []).length) await admin.from("financial_categories").update({ keywords: words }).eq("id", c.id);
  }

  const { data: card } = await admin.from("credit_cards").select("id").eq("org_id", orgId).eq("name", TEST_CARD).maybeSingle();
  if (!card) {
    const { data: bank } = await admin.from("bank_accounts").select("id").eq("org_id", orgId).order("created_at").limit(1).maybeSingle();
    const { error } = await admin.from("credit_cards").insert({
      org_id: orgId,
      name: TEST_CARD,
      last4: "9999",
      aliases: ["teste"],
      closing_day: 3,
      due_day: 10,
      bank_account_id: bank?.id ?? null,
      category_id: cardCat,
    });
    if (error) go("error", "Não foi possível criar o cartão de teste.");
  }
  const { data: sender } = await admin.from("whatsapp_senders").select("id").eq("org_id", orgId).eq("phone", TEST_PHONE).maybeSingle();
  if (!sender) await admin.from("whatsapp_senders").insert({ org_id: orgId, phone: TEST_PHONE, name: "Teste (simulador)" });
  go("ok", "Pronto: cartão de teste (final 9999), número de teste autorizado e palavras-chave nas categorias. Agora mande mensagens no simulador.");
}

/** Builds the sample statement for the card's current cycle and imports it through the same path as a file. */
export async function importSample(form: FormData) {
  const ctx = await guard();
  const cardId = String(form.get("card_id") ?? "");
  const { data: card } = await ctx.sb.from("credit_cards").select("id, name, closing_day, due_day").eq("id", cardId).eq("org_id", ctx.orgId).maybeSingle();
  if (!card) go("error", "Escolha o cartão.");
  const cycle = cardCycles(todayInSaoPaulo(), card.closing_day ?? 3, card.due_day ?? null).current;
  const { data: exps } = await ctx.sb
    .from("card_expenses")
    .select("spent_on, amount_cents, description")
    .eq("org_id", ctx.orgId)
    .eq("status", "pending")
    .or(`card_id.eq.${card.id},card_id.is.null`)
    .order("spent_on");
  const csv = sampleStatementCsv(sampleStatement((exps ?? []).map((e) => ({ spentOn: e.spent_on, amountCents: Number(e.amount_cents), description: e.description })), cycle));
  const parsed = parseCardCsv(csv);
  const r = await ingestStatement(ctx.sb, ctx.orgId, { cardId: card.id, closing: cycle.closing, due: cycle.due, source: "file", fileName: SAMPLE_FILE, start: parsed.start, lines: parsed.lines });
  if ("error" in r) go("error", r.error);
  const matched = await autoMatchStatement(ctx.sb, ctx.orgId, r.statementId);
  go(
    "ok",
    `Fatura de exemplo importada: ${r.added} lançamento(s)${r.skipped ? ` (${r.skipped} já estavam)` : ""}, ${matched} conciliado(s) sozinhos com o robô. Trate os demais e feche a fatura.`,
    `/cartoes/${r.statementId}`,
  );
}

/** Removes only what the tests created: simulator messages and expenses, sample statements and the test card. */
export async function cleanupTest() {
  const ctx = await guard(true);
  const admin = supabaseAdmin();
  const orgId = ctx.orgId;
  let kept = 0;

  const { data: testCard } = await admin.from("credit_cards").select("id").eq("org_id", orgId).eq("name", TEST_CARD).maybeSingle();
  const { data: samples } = await admin
    .from("card_statements")
    .select("id, status, card_id")
    .eq("org_id", orgId)
    .or(`file_name.eq.${SAMPLE_FILE}${testCard ? `,card_id.eq.${testCard.id}` : ""}`);
  // Closed test statements are reopened first: that cancels their bill (unless it was paid).
  for (const s of (samples ?? []).filter((x) => x.status === "closed")) {
    const { error } = await ctx.sb.rpc("reopen_card_statement", { p_statement: s.id });
    if (error) kept++;
  }
  const sampleIds = (samples ?? []).map((s) => s.id as string);

  const { data: simRows } = await admin.from("whatsapp_inbox").select("expense_id").eq("org_id", orgId).eq("provider", SIM_PROVIDER).not("expense_id", "is", null);
  const simExpenses = (simRows ?? []).map((r) => r.expense_id as string);
  // A simulated expense matched to a real statement: undo the match so the real line goes back to pending.
  if (simExpenses.length) {
    const { data: matched } = await admin.from("card_transactions").select("id, statement_id").in("expense_id", simExpenses);
    for (const t of matched ?? []) {
      if (sampleIds.includes(t.statement_id as string)) continue;
      const { error } = await ctx.sb.rpc("card_unmatch", { p_tx: t.id });
      if (error) kept++;
    }
  }
  // Expenses still tied to a real (closed) statement stay; the rest goes.
  const protectedIds = new Set<string>();
  if (simExpenses.length) {
    const { data: still } = await admin.from("card_transactions").select("expense_id, statement_id").in("expense_id", simExpenses);
    for (const t of still ?? []) if (!sampleIds.includes(t.statement_id as string)) protectedIds.add(t.expense_id as string);
    kept += protectedIds.size;
  }
  const openSamples = sampleIds.length
    ? ((await admin.from("card_statements").select("id").in("id", sampleIds).eq("status", "open")).data ?? []).map((s) => s.id as string)
    : [];
  if (openSamples.length) await admin.from("card_statements").delete().in("id", openSamples).eq("org_id", orgId);
  const removable = simExpenses.filter((id) => !protectedIds.has(id));
  if (removable.length) await admin.from("card_expenses").delete().in("id", removable).eq("org_id", orgId);
  await admin.from("whatsapp_inbox").delete().eq("org_id", orgId).eq("provider", SIM_PROVIDER);
  if (testCard) {
    const { count } = await admin.from("card_statements").select("id", { count: "exact", head: true }).eq("card_id", testCard.id);
    if (!count) await admin.from("credit_cards").delete().eq("id", testCard.id).eq("org_id", orgId);
    else kept++;
  }
  await admin.from("whatsapp_senders").delete().eq("org_id", orgId).eq("phone", TEST_PHONE);
  go(
    kept ? "error" : "ok",
    kept
      ? "Dados de teste removidos, menos o que já tinha pagamento registrado (estorne o pagamento da fatura de teste em Contas a pagar e limpe de novo)."
      : "Dados de teste removidos: mensagens do simulador, despesas, faturas de exemplo e cartão de teste. Categorias e palavras-chave foram mantidas.",
  );
}
