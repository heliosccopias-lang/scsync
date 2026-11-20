"use server";

import { redirect } from "next/navigation";
import { asaasFor } from "@/lib/charges";
import { decodeOfx, parseOfx } from "@/lib/ofx";
import { todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";

function back(conta: string, key: "error" | "ok", msg: string): never {
  redirect(`/conciliacao?conta=${conta}&${key}=${encodeURIComponent(msg)}`);
}

const ERRORS: Record<string, string> = {
  line_not_pending: "Esta linha já foi conciliada ou ignorada.",
  sign_mismatch: "Entrada de dinheiro só concilia com conta a receber, e saída com conta a pagar.",
  target_not_open: "O título escolhido já está quitado.",
  amount_exceeds_open: "O valor do extrato é maior que o saldo do título. Escolha \"Diferença é juros\".",
  amount_below_open: "O valor do extrato é menor que o saldo do título. Escolha pagamento parcial ou desconto.",
  amount_differs: "O valor do extrato é diferente do recebimento. Escolha \"Diferença é tarifa\" se o banco descontou taxa.",
  already_reconciled: "Esse recebimento já foi conciliado com outra linha.",
  same_account: "Escolha a outra conta da transferência.",
  not_reconciled: "Esta linha não está conciliada.",
};

function errMsg(e: { message: string } | null, fallback: string) {
  return e ? (ERRORS[e.message.split(":")[0]] ?? fallback) : fallback;
}

async function accountOf(conta: string) {
  const ctx = await requireOrg();
  const { data: acc } = await ctx.sb.from("bank_accounts").select("id, kind, name").eq("id", conta).eq("org_id", ctx.orgId).maybeSingle();
  if (!acc) back(conta, "error", "Conta não encontrada.");
  return { ...ctx, acc };
}

type LineRow = {
  org_id: string;
  import_id: string;
  bank_account_id: string;
  external_id: string;
  posted_on: string;
  amount_cents: number;
  description: string | null;
  counterpart_doc: string | null;
  provider_payment_id?: string | null;
  kind?: string | null;
};

async function insertLines(sb: Awaited<ReturnType<typeof requireOrg>>["sb"], rows: LineRow[]) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await sb
      .from("statement_lines")
      .upsert(rows.slice(i, i + 500), { onConflict: "bank_account_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

export async function importOfx(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb, orgId, user, acc } = await accountOf(conta);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back(conta, "error", "Escolha o arquivo OFX exportado do site do banco.");
  if (file.size > 5 * 1024 * 1024) back(conta, "error", "Arquivo grande demais (máximo 5 MB). Exporte um período menor.");
  const invert = form.get("invert") === "on";

  const st = parseOfx(decodeOfx(new Uint8Array(await file.arrayBuffer())));
  if (st.transactions.length === 0) back(conta, "error", "Não encontrei lançamentos nesse arquivo. Confira se é um extrato OFX (às vezes chamado Money).");

  const { data: imp, error } = await sb
    .from("statement_imports")
    .insert({
      org_id: orgId,
      bank_account_id: acc.id,
      source: "ofx",
      file_name: file.name.slice(0, 200),
      invert_signs: invert,
      period_start: st.start,
      period_end: st.end,
      lines_total: st.transactions.length,
      imported_by: user.id,
    })
    .select("id")
    .single();
  if (error || !imp) back(conta, "error", "Não foi possível registrar a importação.");

  let inserted = 0;
  try {
    inserted = await insertLines(
      sb,
      st.transactions.map((t) => ({
        org_id: orgId,
        import_id: imp.id,
        bank_account_id: acc.id,
        external_id: t.fitId,
        posted_on: t.postedOn,
        amount_cents: invert ? -t.amountCents : t.amountCents,
        description: t.description,
        counterpart_doc: t.counterpartDoc,
        kind: t.type || null,
      })),
    );
  } catch {
    back(conta, "error", "Falha ao gravar as linhas do extrato.");
  }
  const dup = st.transactions.length - inserted;
  await sb.from("statement_imports").update({ lines_duplicate: dup }).eq("id", imp.id);
  back(conta, "ok", `${inserted} lançamento(s) importado(s)${dup ? `, ${dup} já existiam e foram ignorados` : ""}.`);
}

export async function importAsaas(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb, orgId, user, acc } = await accountOf(conta);
  if (acc.kind !== "asaas") back(conta, "error", "O extrato do Asaas só pode ser importado na conta Asaas.");
  const asaas = await asaasFor(orgId);
  if (!asaas) back(conta, "error", "Conecte o Asaas em Configurações.");
  const finish = String(form.get("finish") || todayInSaoPaulo());
  const start = String(form.get("start") || finish);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(finish) || start > finish) back(conta, "error", "Período inválido.");

  const items: { id: string; value: number; date: string; description?: string; paymentId?: string | null; type?: string }[] = [];
  try {
    for (let offset = 0; offset < 5000; offset += 100) {
      const page = await asaas.financialTransactions(start, finish, offset, 100);
      items.push(...(page.data ?? []));
      if (!page.hasMore || (page.data ?? []).length === 0) break;
    }
  } catch (e) {
    back(conta, "error", `O Asaas recusou a consulta do extrato: ${e instanceof Error ? e.message : "erro"}`);
  }

  const { data: imp, error } = await sb
    .from("statement_imports")
    .insert({ org_id: orgId, bank_account_id: acc.id, source: "asaas_api", period_start: start, period_end: finish, lines_total: items.length, imported_by: user.id })
    .select("id")
    .single();
  if (error || !imp) back(conta, "error", "Não foi possível registrar a importação.");

  const rows = items
    .filter((t) => t.id && t.date && Number(t.value) !== 0)
    .map((t) => ({
      org_id: orgId,
      import_id: imp.id,
      bank_account_id: acc.id,
      external_id: `asaas_${t.id}`,
      posted_on: String(t.date).slice(0, 10),
      amount_cents: Math.round(Number(t.value) * 100),
      description: t.description ?? t.type ?? "Asaas",
      counterpart_doc: null,
      provider_payment_id: t.paymentId ?? null,
      kind: t.type ?? null,
    }));
  let inserted = 0;
  try {
    inserted = await insertLines(sb, rows);
  } catch {
    back(conta, "error", "Falha ao gravar as linhas do extrato do Asaas.");
  }
  await sb.from("statement_imports").update({ lines_duplicate: rows.length - inserted }).eq("id", imp.id);
  const { data: auto } = await sb.rpc("auto_reconcile_provider_lines", { p_org: orgId });
  back(conta, "ok", `${inserted} lançamento(s) do Asaas importado(s); ${auto ?? 0} conciliado(s) automaticamente com os recebimentos já registrados.`);
}

export async function reconcile(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb } = await requireOrg();
  const action = String(form.get("diff_action") ?? "") || null;
  const { error } = await sb.rpc("reconcile_line", {
    p_line: String(form.get("line")),
    p_target_type: String(form.get("target_type")),
    p_target_id: String(form.get("target_id")),
    p_action: action,
  });
  if (error) back(conta, "error", errMsg(error, "Não foi possível conciliar."));
  back(conta, "ok", "Linha conciliada.");
}

/** Reconciles every pending line whose best suggestion is unambiguous (score ≥ 0.95 and same value). */
export async function reconcileSure(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb, orgId } = await requireOrg();
  const { data: lines } = await sb
    .from("statement_lines")
    .select("id, amount_cents")
    .eq("org_id", orgId)
    .eq("bank_account_id", conta)
    .in("status", ["pending", "suggested"])
    .limit(500);
  let done = 0;
  for (const l of lines ?? []) {
    const { data: sug } = await sb.rpc("suggest_matches", { p_line: l.id });
    const list = ((sug ?? []) as { target_type: string; target_id: string; amount_cents: number; score: number }[]).sort((a, b) => b.score - a.score);
    const best = list[0];
    if (!best || Number(best.score) < 0.95 || best.amount_cents !== Math.abs(l.amount_cents)) continue;
    if (list[1] && Number(list[1].score) >= Number(best.score) - 0.05) continue; // ambiguous: leave it for a person
    const { error } = await sb.rpc("reconcile_line", { p_line: l.id, p_target_type: best.target_type, p_target_id: best.target_id, p_action: null });
    if (!error) done++;
  }
  back(conta, "ok", done ? `${done} linha(s) conciliada(s) automaticamente.` : "Nenhuma linha com correspondência certa o suficiente. Confira as sugestões uma a uma.");
}

export async function expense(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb } = await requireOrg();
  const { error } = await sb.rpc("expense_from_line", {
    p_line: String(form.get("line")),
    p_name: String(form.get("name") ?? ""),
    p_category: String(form.get("category") || "") || null,
    p_cost_center: String(form.get("cost_center") || "") || null,
    p_supplier: String(form.get("supplier") ?? ""),
  });
  if (error) back(conta, "error", errMsg(error, "Não foi possível lançar a despesa."));
  back(conta, "ok", "Despesa lançada como paga e conciliada.");
}

export async function income(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb } = await requireOrg();
  const { error } = await sb.rpc("income_from_line", {
    p_line: String(form.get("line")),
    p_name: String(form.get("name") ?? ""),
    p_category: String(form.get("category") || "") || null,
    p_customer: null,
  });
  if (error) back(conta, "error", errMsg(error, "Não foi possível lançar a receita."));
  back(conta, "ok", "Receita lançada como recebida e conciliada.");
}

export async function transfer(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb } = await requireOrg();
  const { error } = await sb.rpc("transfer_from_line", { p_line: String(form.get("line")), p_other_account: String(form.get("other_account")) });
  if (error) back(conta, "error", errMsg(error, "Não foi possível registrar a transferência."));
  back(conta, "ok", "Transferência registrada e conciliada.");
}

export async function undo(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb } = await requireOrg();
  const { error } = await sb.rpc("undo_reconciliation", { p_line: String(form.get("line")) });
  if (error) back(conta, "error", errMsg(error, "Não foi possível desfazer."));
  back(conta, "ok", "Conciliação desfeita; a linha voltou para pendente.");
}

export async function setIgnored(form: FormData) {
  const conta = String(form.get("conta"));
  const { sb, orgId } = await requireOrg();
  const ignore = form.get("ignore") === "1";
  const { error } = await sb
    .from("statement_lines")
    .update({ status: ignore ? "ignored" : "pending" })
    .eq("id", String(form.get("line")))
    .eq("org_id", orgId)
    .in("status", ignore ? ["pending", "suggested"] : ["ignored"]);
  if (error) back(conta, "error", "Não foi possível alterar a linha.");
  back(conta, "ok", ignore ? "Linha ignorada." : "Linha voltou para pendente.");
}
