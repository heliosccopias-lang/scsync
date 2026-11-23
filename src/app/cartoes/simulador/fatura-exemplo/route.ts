import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { cardCycles } from "@/lib/card";
import { sampleStatement, sampleStatementCsv } from "@/lib/card-sample";
import { todayInSaoPaulo } from "@/lib/money";

/** Sample statement as the CSV a bank exports, to test the file import itself (Importar fatura → arquivo). */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg();
  if (!ctx.can("finance.edit")) return new NextResponse("Sem acesso", { status: 403 });
  const cardId = req.nextUrl.searchParams.get("card") ?? "";
  const { data: card } = await ctx.sb.from("credit_cards").select("id, closing_day, due_day").eq("id", cardId).eq("org_id", ctx.orgId).maybeSingle();
  if (!card) return new NextResponse("Cartão não encontrado", { status: 404 });
  const cycle = cardCycles(todayInSaoPaulo(), card.closing_day ?? 3, card.due_day ?? null).current;
  const { data: exps } = await ctx.sb
    .from("card_expenses")
    .select("spent_on, amount_cents, description")
    .eq("org_id", ctx.orgId)
    .eq("status", "pending")
    .or(`card_id.eq.${card.id},card_id.is.null`);
  const csv = sampleStatementCsv(sampleStatement((exps ?? []).map((e) => ({ spentOn: e.spent_on, amountCents: Number(e.amount_cents), description: e.description })), cycle));
  return new NextResponse("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fatura-exemplo-${cycle.closing}.csv"` },
  });
}
