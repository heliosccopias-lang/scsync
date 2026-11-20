import "server-only";
import type { requireOrg } from "@/lib/session";
import { pairCardLines, referenceOf, type CardLine } from "@/lib/card";
import { addDays } from "@/lib/money";

type Sb = Awaited<ReturnType<typeof requireOrg>>["sb"];

/** Creates (or reuses) the statement of the card for that closing month and adds the lines it does not have yet. */
export async function ingestStatement(
  sb: Sb,
  orgId: string,
  p: { cardId: string; closing: string; due: string; source: "file" | "api"; fileName?: string; start?: string | null; lines: CardLine[] },
): Promise<{ statementId: string; added: number; skipped: number } | { error: string }> {
  const reference = referenceOf(p.closing);
  let { data: st } = await sb.from("card_statements").select("id, status").eq("org_id", orgId).eq("card_id", p.cardId).eq("reference", reference).maybeSingle();
  if (st?.status === "closed") return { error: `A fatura ${reference} desse cartão já foi fechada. Reabra a fatura para importar de novo.` };
  if (!st) {
    const { data, error } = await sb
      .from("card_statements")
      .insert({ org_id: orgId, card_id: p.cardId, reference, closing_date: p.closing, due_date: p.due, period_start: p.start ?? null, source: p.source, file_name: p.fileName ?? null })
      .select("id, status")
      .single();
    if (error || !data) return { error: "Não foi possível criar a fatura." };
    st = data;
  } else {
    await sb.from("card_statements").update({ due_date: p.due, closing_date: p.closing, ...(p.start ? { period_start: p.start } : {}) }).eq("id", st.id);
  }
  const statementId: string = st.id;
  // Lines already imported for this card (any statement) are skipped: re-importing the same file is harmless.
  const ids = p.lines.map((l) => l.externalId);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("card_transactions").select("external_id").eq("card_id", p.cardId).in("external_id", ids.slice(i, i + 200));
    for (const r of data ?? []) existing.add(r.external_id as string);
  }
  const rows = p.lines
    .filter((l) => !existing.has(l.externalId))
    .map((l) => ({
      org_id: orgId,
      card_id: p.cardId,
      statement_id: statementId,
      posted_on: l.postedOn,
      description: l.description.slice(0, 300),
      amount_cents: l.amountCents,
      installment: l.installment,
      external_id: l.externalId.slice(0, 300),
    }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("card_transactions").insert(rows.slice(i, i + 500));
    if (error) return { error: "Não foi possível gravar os lançamentos da fatura." };
  }
  return { statementId, added: rows.length, skipped: p.lines.length - rows.length };
}

/** Pairs pending lines of the statement with pending expenses (same card or no card informed). Returns how many. */
export async function autoMatchStatement(sb: Sb, orgId: string, statementId: string): Promise<number> {
  const { data: st } = await sb.from("card_statements").select("id, card_id, closing_date, status").eq("id", statementId).eq("org_id", orgId).single();
  if (!st || st.status === "closed") return 0;
  const [{ data: txs }, { data: exps }] = await Promise.all([
    sb.from("card_transactions").select("id, posted_on, amount_cents, description, installment").eq("statement_id", st.id).in("status", ["pending", "categorized"]).is("expense_id", null),
    sb
      .from("card_expenses")
      .select("id, spent_on, amount_cents, description, card_id")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .or(`card_id.eq.${st.card_id},card_id.is.null`)
      .gte("spent_on", addDays(st.closing_date, -400))
      .lte("spent_on", addDays(st.closing_date, 3)),
  ]);
  const pairs = pairCardLines(
    (txs ?? []).map((t) => ({ id: t.id, postedOn: t.posted_on, amountCents: Number(t.amount_cents), description: t.description, installment: t.installment })),
    (exps ?? []).map((e) => ({ id: e.id, spentOn: e.spent_on, amountCents: Number(e.amount_cents), description: e.description })),
  );
  let n = 0;
  for (const pr of pairs) {
    const { error } = await sb.rpc("card_match", { p_tx: pr.txId, p_expense: pr.expenseId });
    if (!error) n++;
  }
  return n;
}
