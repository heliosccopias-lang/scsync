"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { decodeCsv } from "@/lib/catalog-import";
import { parseCardFile, parseDateBR, type CardLine } from "@/lib/card";
import { autoMatchStatement, ingestStatement } from "@/lib/card-db";
import { decryptSecret } from "@/lib/crypto";
import { PluggyError, pluggyApiKey, pluggyCardLines } from "@/lib/pluggy";
import { addDays, addMonths, parseBRL, todayInSaoPaulo } from "@/lib/money";

/** path may carry a query already. */
function go(path: string, key: "error" | "ok", msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ERR: Record<string, string> = {
  already_matched: "Essa linha ou essa despesa já está conciliada.",
  statement_closed: "A fatura já foi fechada. Reabra para mudar.",
  pending_lines: "Ainda há lançamentos sem conciliar, sem categoria ou não ignorados.",
  already_closed: "Essa fatura já está fechada.",
  bill_paid: "A conta a pagar da fatura já tem pagamento; estorne o pagamento antes de reabrir.",
};
const errMsg = (m?: string) => (m && ERR[m]) || "Não foi possível concluir. Atualize a página e tente de novo.";

function periodFields(form: FormData, back: string) {
  const cardId = String(form.get("card_id") ?? "");
  const closing = String(form.get("closing_date") ?? "");
  const due = String(form.get("due_date") ?? "");
  if (!cardId) go(back, "error", "Escolha o cartão.");
  if (!ISO.test(closing) || !ISO.test(due)) go(back, "error", "Informe a data de fechamento e a de vencimento da fatura.");
  if (due < closing) go(back, "error", "O vencimento não pode ser antes do fechamento.");
  return { cardId, closing, due };
}

export async function importStatementFile(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const { cardId, closing, due } = periodFields(form, "/cartoes");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) go("/cartoes", "error", "Escolha o arquivo da fatura (OFX ou CSV).");
  if (file.size > 4 * 1024 * 1024) go("/cartoes", "error", "Arquivo maior que 4 MB.");
  if (/\.(xlsx?|pdf)$/i.test(file.name)) go("/cartoes", "error", "Use o arquivo OFX ou CSV da fatura (no internet banking: Fatura → Exportar/Salvar como OFX ou CSV). PDF e Excel não são lidos.");
  const parsed = parseCardFile(file.name, decodeCsv(new Uint8Array(await file.arrayBuffer())));
  if (!parsed.lines.length) go("/cartoes", "error", parsed.errors[0] ?? "Nenhum lançamento encontrado no arquivo.");
  const r = await ingestStatement(sb, orgId, { cardId, closing, due, source: "file", fileName: file.name.slice(0, 200), start: parsed.start, lines: parsed.lines });
  if ("error" in r) go("/cartoes", "error", r.error);
  const matched = await autoMatchStatement(sb, orgId, r.statementId);
  go(
    `/cartoes/${r.statementId}`,
    "ok",
    `${r.added} lançamento(s) importado(s)${r.skipped ? `, ${r.skipped} já existiam` : ""}${parsed.errors.length ? `, ${parsed.errors.length} linha(s) ignorada(s)` : ""}. ${matched} conciliado(s) automaticamente com as despesas do robô.`,
  );
}

export async function pullStatementPluggy(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const { cardId, closing, due } = periodFields(form, "/cartoes");
  const [{ data: org }, { data: card }] = await Promise.all([
    sb.from("orgs").select("pluggy_client_id, pluggy_secret_encrypted").eq("id", orgId).single(),
    sb.from("credit_cards").select("pluggy_account_id").eq("id", cardId).eq("org_id", orgId).single(),
  ]);
  if (!org?.pluggy_client_id || !org.pluggy_secret_encrypted) go("/cartoes", "error", "Conecte o Pluggy em Configurações → Cartões de crédito.");
  if (!card?.pluggy_account_id) go("/cartoes", "error", "Esse cartão não está ligado ao Pluggy (Configurações → Cartões de crédito → Buscar cartão no Pluggy).");
  const from = addDays(addMonths(closing, -1), 1);
  let lines: CardLine[] = [];
  try {
    const key = await pluggyApiKey(org.pluggy_client_id, decryptSecret(org.pluggy_secret_encrypted));
    lines = await pluggyCardLines(key, card.pluggy_account_id, from, closing);
  } catch (e) {
    if (e instanceof PluggyError) go("/cartoes", "error", `O Pluggy respondeu: ${e.message}`);
    throw e;
  }
  if (!lines.length) go("/cartoes", "error", `O Pluggy não trouxe lançamentos entre ${from} e ${closing}.`);
  const r = await ingestStatement(sb, orgId, { cardId, closing, due, source: "api", start: from, lines });
  if ("error" in r) go("/cartoes", "error", r.error);
  const matched = await autoMatchStatement(sb, orgId, r.statementId);
  go(`/cartoes/${r.statementId}`, "ok", `${r.added} lançamento(s) trazido(s) do Pluggy${r.skipped ? `, ${r.skipped} já existiam` : ""}. ${matched} conciliado(s) automaticamente.`);
}

export async function autoMatch(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("statement_id"));
  const n = await autoMatchStatement(sb, orgId, id);
  go(`/cartoes/${id}`, "ok", n ? `${n} lançamento(s) conciliado(s) automaticamente.` : "Nenhuma correspondência nova (mesmo valor e data próxima).");
}

export async function matchLine(form: FormData) {
  const { sb } = await requireOrg();
  const back = `/cartoes/${String(form.get("statement_id"))}`;
  const exp = String(form.get("expense_id") ?? "");
  if (!exp) go(back, "error", "Escolha a despesa do robô.");
  const { error } = await sb.rpc("card_match", { p_tx: String(form.get("tx_id")), p_expense: exp });
  if (error) go(back, "error", errMsg(error.message));
  go(back, "ok", "Lançamento conciliado.");
}

export async function unmatchLine(form: FormData) {
  const { sb } = await requireOrg();
  const back = `/cartoes/${String(form.get("statement_id"))}`;
  const { error } = await sb.rpc("card_unmatch", { p_tx: String(form.get("tx_id")) });
  if (error) go(back, "error", errMsg(error.message));
  go(back, "ok", "Conciliação desfeita.");
}

/** Category for a line (also for lines matched with an expense that came without one). */
export async function categorizeLines(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("statement_id"));
  const back = `/cartoes/${id}`;
  const { data: st } = await sb.from("card_statements").select("status").eq("id", id).eq("org_id", orgId).single();
  if (st?.status !== "open") go(back, "error", errMsg("statement_closed"));
  const changes = form
    .getAll("tx_id")
    .map(String)
    .map((tx) => ({ tx, cat: String(form.get(`cat_${tx}`) ?? ""), status: String(form.get(`st_${tx}`) ?? "") }))
    .filter((c) => c.cat);
  await Promise.all(
    changes.map((c) =>
      sb
        .from("card_transactions")
        .update({ category_id: c.cat, ...(c.status === "pending" ? { status: "categorized" } : {}) })
        .eq("id", c.tx)
        .eq("statement_id", id)
        .eq("org_id", orgId),
    ),
  );
  go(back, "ok", `${changes.length} categoria(s) salva(s).`);
}

export async function ignoreLine(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("statement_id"));
  const back = `/cartoes/${id}`;
  const ignore = form.get("ignore") === "true";
  const { data: st } = await sb.from("card_statements").select("status").eq("id", id).eq("org_id", orgId).single();
  if (st?.status !== "open") go(back, "error", errMsg("statement_closed"));
  const { data: tx } = await sb.from("card_transactions").select("category_id, expense_id").eq("id", String(form.get("tx_id"))).eq("org_id", orgId).single();
  if (tx?.expense_id) go(back, "error", "Desfaça a conciliação antes de ignorar.");
  await sb
    .from("card_transactions")
    .update({ status: ignore ? "ignored" : tx?.category_id ? "categorized" : "pending" })
    .eq("id", String(form.get("tx_id")))
    .eq("org_id", orgId);
  go(back, "ok", ignore ? "Lançamento ignorado (não entra no total da fatura)." : "Lançamento voltou para a conciliação.");
}

export async function closeStatement(form: FormData) {
  const { sb } = await requireOrg();
  const id = String(form.get("statement_id"));
  const back = `/cartoes/${id}`;
  const bank = String(form.get("bank_account_id") ?? "");
  if (!bank) go(back, "error", "Escolha a conta que paga a fatura.");
  const { data, error } = await sb.rpc("close_card_statement", { p_statement: id, p_bank_account: bank, p_category: String(form.get("category_id") ?? "") || null });
  if (error) go(back, "error", errMsg(error.message));
  go(back, "ok", data ? "Fatura fechada. A conta a pagar da fatura foi criada em Contas a pagar." : "Fatura fechada (sem valor a pagar).");
}

export async function reopenStatement(form: FormData) {
  const { sb } = await requireOrg();
  const id = String(form.get("statement_id"));
  const { error } = await sb.rpc("reopen_card_statement", { p_statement: id });
  if (error) go(`/cartoes/${id}`, "error", errMsg(error.message));
  go(`/cartoes/${id}`, "ok", "Fatura reaberta; a conta a pagar dela foi cancelada.");
}

export async function deleteStatement(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("statement_id"));
  const { data: st } = await sb.from("card_statements").select("status").eq("id", id).eq("org_id", orgId).single();
  if (st?.status !== "open") go(`/cartoes/${id}`, "error", "Só dá para apagar fatura aberta.");
  const { data: txs } = await sb.from("card_transactions").select("id").eq("statement_id", id).not("expense_id", "is", null);
  for (const t of txs ?? []) await sb.rpc("card_unmatch", { p_tx: t.id });
  const { error } = await sb.from("card_statements").delete().eq("id", id).eq("org_id", orgId);
  if (error) go(`/cartoes/${id}`, "error", "Não foi possível apagar a fatura.");
  go("/cartoes", "ok", "Fatura apagada. As despesas do robô voltaram para pendentes.");
}

export async function addExpense(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const amount = parseBRL(String(form.get("amount") ?? ""));
  const description = String(form.get("description") ?? "").trim().slice(0, 120);
  const spentOn = parseDateBR(String(form.get("spent_on") ?? "")) ?? todayInSaoPaulo();
  if (!amount || amount <= 0) go("/cartoes", "error", "Valor da despesa inválido.");
  if (!description) go("/cartoes", "error", "Descreva a despesa.");
  const { error } = await sb.from("card_expenses").insert({
    org_id: orgId,
    card_id: String(form.get("card_id") ?? "") || null,
    category_id: String(form.get("category_id") ?? "") || null,
    spent_on: spentOn,
    amount_cents: amount,
    description,
    source: "manual",
  });
  if (error) go("/cartoes", "error", "Não foi possível lançar a despesa.");
  go("/cartoes", "ok", "Despesa lançada; ela será casada com a fatura na conciliação.");
}

export async function updateExpense(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id"));
  const cancel = form.get("cancel") === "true";
  const back = String(form.get("back") ?? "/cartoes");
  const { error } = await sb
    .from("card_expenses")
    .update(
      cancel
        ? { status: "cancelled" }
        : { card_id: String(form.get("card_id") ?? "") || null, category_id: String(form.get("category_id") ?? "") || null },
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("status", "pending");
  if (error) go(back, "error", "Não foi possível alterar a despesa.");
  go(back, "ok", cancel ? "Despesa cancelada." : "Despesa atualizada.");
}
