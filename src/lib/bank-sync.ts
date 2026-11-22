import "server-only";
import { asaasFor } from "./charges";
import { decryptSecret } from "./crypto";
import { PluggyError, pluggyApiKey, pluggyBankLines, pluggyCardLines } from "./pluggy";
import { supabaseAdmin } from "./supabase";
import { addDays, todayInSaoPaulo } from "./money";
import { cardCycles } from "./card";
import { autoMatchStatement, ingestStatement } from "./card-db";

/** Works with the signed-in user's client (screens) or the service role (daily job). */
type Db = ReturnType<typeof supabaseAdmin>;

export type SyncResult = { inserted: number; duplicates: number; matched: number };

async function pluggyKeyFor(db: Db, orgId: string): Promise<string> {
  const { data: org } = await db.from("orgs").select("pluggy_client_id, pluggy_secret_encrypted").eq("id", orgId).single();
  if (!org?.pluggy_client_id || !org.pluggy_secret_encrypted) throw new Error("Conecte o Pluggy em Configurações → Conexões bancárias.");
  return pluggyApiKey(org.pluggy_client_id, decryptSecret(org.pluggy_secret_encrypted));
}

async function saveLines(
  db: Db,
  orgId: string,
  accountId: string,
  source: "asaas_api" | "pluggy_api",
  start: string,
  finish: string,
  userId: string | null,
  rows: { external_id: string; posted_on: string; amount_cents: number; description: string | null; counterpart_doc: string | null; provider_payment_id?: string | null; kind?: string | null }[],
): Promise<{ inserted: number; duplicates: number }> {
  const { data: imp, error } = await db
    .from("statement_imports")
    .insert({ org_id: orgId, bank_account_id: accountId, source, period_start: start, period_end: finish, lines_total: rows.length, imported_by: userId })
    .select("id")
    .single();
  if (error || !imp) throw new Error("Não foi possível registrar a importação.");
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error: e } = await db
      .from("statement_lines")
      .upsert(
        rows.slice(i, i + 500).map((r) => ({ ...r, org_id: orgId, import_id: imp.id, bank_account_id: accountId })),
        { onConflict: "bank_account_id,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (e) throw new Error("Falha ao gravar as linhas do extrato.");
    inserted += data?.length ?? 0;
  }
  await db.from("statement_imports").update({ lines_duplicate: rows.length - inserted }).eq("id", imp.id);
  return { inserted, duplicates: rows.length - inserted };
}

/** Bank account statement through the API: Asaas account → Asaas statement; other banks → Pluggy (Open Finance). */
export async function syncBankAccount(db: Db, orgId: string, accountId: string, opts: { start?: string; finish?: string; userId?: string | null } = {}): Promise<SyncResult> {
  const { data: acc } = await db.from("bank_accounts").select("id, kind, pluggy_account_id, last_synced_at").eq("id", accountId).eq("org_id", orgId).single();
  if (!acc) throw new Error("Conta não encontrada.");
  const finish = opts.finish ?? todayInSaoPaulo();
  // Automatic runs re-read the last days too: banks post some entries late. Duplicates are ignored.
  const start = opts.start ?? (acc.last_synced_at ? addDays(String(acc.last_synced_at).slice(0, 10), -5) : addDays(finish, -30));
  let res: { inserted: number; duplicates: number };
  try {
    if (acc.kind === "asaas") {
      const asaas = await asaasFor(orgId);
      if (!asaas) throw new Error("Conecte o Asaas em Configurações.");
      const items: { id: string; value: number; date: string; description?: string; paymentId?: string | null; type?: string }[] = [];
      for (let offset = 0; offset < 5000; offset += 100) {
        const page = await asaas.financialTransactions(start, finish, offset, 100);
        items.push(...(page.data ?? []));
        if (!page.hasMore || (page.data ?? []).length === 0) break;
      }
      res = await saveLines(
        db,
        orgId,
        acc.id,
        "asaas_api",
        start,
        finish,
        opts.userId ?? null,
        items
          .filter((t) => t.id && t.date && Number(t.value) !== 0)
          .map((t) => ({
            external_id: `asaas_${t.id}`,
            posted_on: String(t.date).slice(0, 10),
            amount_cents: Math.round(Number(t.value) * 100),
            description: t.description ?? t.type ?? "Asaas",
            counterpart_doc: null,
            provider_payment_id: t.paymentId ?? null,
            kind: t.type ?? null,
          })),
      );
    } else {
      if (!acc.pluggy_account_id) throw new Error("Esta conta não está ligada ao Pluggy (Configurações → Conexões bancárias).");
      const key = await pluggyKeyFor(db, orgId);
      const lines = await pluggyBankLines(key, acc.pluggy_account_id, start, finish);
      res = await saveLines(
        db,
        orgId,
        acc.id,
        "pluggy_api",
        start,
        finish,
        opts.userId ?? null,
        lines.map((l) => ({ external_id: l.externalId, posted_on: l.postedOn, amount_cents: l.amountCents, description: l.description, counterpart_doc: l.counterpartDoc, kind: l.kind })),
      );
    }
  } catch (e) {
    const msg = e instanceof PluggyError ? `Pluggy: ${e.message}` : e instanceof Error ? e.message : "Erro na importação";
    await db.from("bank_accounts").update({ last_sync_error: msg.slice(0, 300) }).eq("id", acc.id);
    throw new Error(msg);
  }
  const { data: matched } = await db.rpc("auto_reconcile_provider_lines", { p_org: orgId });
  await db.from("bank_accounts").update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", acc.id);
  return { ...res, matched: Number(matched ?? 0) };
}

/** Card statement through Pluggy: the open cycle and the previous one (late postings), then pairs with the robot expenses. */
export async function syncCard(db: Db, orgId: string, cardId: string): Promise<SyncResult> {
  const { data: card } = await db.from("credit_cards").select("id, pluggy_account_id, closing_day, due_day").eq("id", cardId).eq("org_id", orgId).single();
  if (!card) throw new Error("Cartão não encontrado.");
  try {
    if (!card.pluggy_account_id) throw new Error("Cartão não ligado ao Pluggy.");
    if (!card.closing_day) throw new Error("Informe o dia de fechamento do cartão.");
    const key = await pluggyKeyFor(db, orgId);
    const { current, previous } = cardCycles(todayInSaoPaulo(), card.closing_day, card.due_day);
    const out: SyncResult = { inserted: 0, duplicates: 0, matched: 0 };
    for (const c of [previous, current]) {
      const lines = await pluggyCardLines(key, card.pluggy_account_id, c.from, c.closing);
      if (!lines.length) continue;
      const sb = db as unknown as Parameters<typeof ingestStatement>[0];
      const r = await ingestStatement(sb, orgId, { cardId: card.id, closing: c.closing, due: c.due, source: "api", start: c.from, lines });
      if ("error" in r) continue; // closed statement: left alone
      out.inserted += r.added;
      out.duplicates += r.skipped;
      out.matched += await autoMatchStatement(sb, orgId, r.statementId);
    }
    await db.from("credit_cards").update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", card.id);
    return out;
  } catch (e) {
    const msg = e instanceof PluggyError ? `Pluggy: ${e.message}` : e instanceof Error ? e.message : "Erro na importação";
    await db.from("credit_cards").update({ last_sync_error: msg.slice(0, 300) }).eq("id", card.id);
    throw new Error(msg);
  }
}
