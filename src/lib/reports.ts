import "server-only";
import { osStatusLabel } from "@/components/Shell";
import { METHOD_LABEL, fmtDate } from "./format";
import { formatBRL } from "./money";

type Client = Awaited<ReturnType<typeof import("./supabase").supabaseUser>>;

import type { ReportTable } from "./csv";
export type { ReportTable };


const SOURCE: Record<string, string> = { asaas_webhook: "Asaas (automático)", manual: "Manual", batch: "Baixa em lote", reconciliation: "Conciliação" };

/** Runs every report for the period. `raw` keeps plain numbers (reais with dot) for CSV. */
export async function runReports(sb: Client, orgId: string, from: string, to: string): Promise<ReportTable[]> {
  const args = { p_org: orgId, p_from: from, p_to: to };
  const [os, receipts, aging, commissions, top, cash] = await Promise.all([
    sb.rpc("report_service_orders", args),
    sb.rpc("report_receipts", args),
    sb.rpc("report_aging", { p_org: orgId }),
    sb.rpc("report_commissions", args),
    sb.rpc("report_top_items", args),
    sb.rpc("report_cashflow", args),
  ]);
  const reais = (c: number) => (Number(c) / 100).toFixed(2);
  type Row = Record<string, string | number>;
  const rowsOf = (r: { data: unknown }) => (r.data ?? []) as Row[];

  return [
    {
      key: "fluxo",
      title: "Fluxo de caixa (recebido e pago no período)",
      columns: ["Mês", "Entradas", "Saídas", "Saldo"],
      numeric: [false, true, true, true],
      rows: rowsOf(cash).map((r) => [fmtDate(String(r.month)).slice(3), formatBRL(Number(r.in_cents)), formatBRL(Number(r.out_cents)), formatBRL(Number(r.in_cents) - Number(r.out_cents))]),
      raw: rowsOf(cash).map((r) => [String(r.month).slice(0, 7), reais(Number(r.in_cents)), reais(Number(r.out_cents)), reais(Number(r.in_cents) - Number(r.out_cents))]),
    },
    {
      key: "recebimentos",
      title: "Recebimentos por forma",
      columns: ["Forma", "Origem", "Quantidade", "Valor", "Juros"],
      numeric: [false, false, true, true, true],
      rows: rowsOf(receipts).map((r) => [METHOD_LABEL[String(r.method)] ?? String(r.method), SOURCE[String(r.source)] ?? String(r.source), Number(r.receipts), formatBRL(Number(r.amount_cents)), formatBRL(Number(r.interest_cents))]),
      raw: rowsOf(receipts).map((r) => [String(r.method), String(r.source), Number(r.receipts), reais(Number(r.amount_cents)), reais(Number(r.interest_cents))]),
    },
    {
      key: "atraso",
      title: "Contas a receber em aberto por atraso (hoje)",
      note: "Não depende do período escolhido.",
      columns: ["Faixa", "Títulos", "Em aberto"],
      numeric: [false, true, true],
      rows: rowsOf(aging).map((r) => [String(r.bucket), Number(r.titles), formatBRL(Number(r.open_cents))]),
      raw: rowsOf(aging).map((r) => [String(r.bucket), Number(r.titles), reais(Number(r.open_cents))]),
    },
    {
      key: "os",
      title: "Ordens de serviço e orçamentos por status",
      columns: ["Status", "Tipo", "Quantidade", "Total"],
      numeric: [false, false, true, true],
      rows: rowsOf(os).map((r) => [osStatusLabel(String(r.status)), r.kind === "quote" ? "Orçamento" : "OS", Number(r.os_count), formatBRL(Number(r.total_cents))]),
      raw: rowsOf(os).map((r) => [String(r.status), String(r.kind), Number(r.os_count), reais(Number(r.total_cents))]),
    },
    {
      key: "comissoes",
      title: "Comissão de técnicos (OS concluídas ou entregues)",
      note: "Calculada sobre o valor dos serviços da OS, pelo técnico responsável.",
      columns: ["Técnico", "Comissão", "OS", "Serviços", "A pagar"],
      numeric: [false, true, true, true, true],
      rows: rowsOf(commissions).map((r) => [String(r.technician), `${String(r.commission_pct).replace(".", ",")}%`, Number(r.os_count), formatBRL(Number(r.services_cents)), formatBRL(Number(r.commission_cents))]),
      raw: rowsOf(commissions).map((r) => [String(r.technician), Number(r.commission_pct), Number(r.os_count), reais(Number(r.services_cents)), reais(Number(r.commission_cents))]),
    },
    {
      key: "mais-vendidos",
      title: "Serviços e produtos mais vendidos",
      columns: ["Tipo", "Descrição", "Quantidade", "OS", "Total"],
      numeric: [false, false, true, true, true],
      rows: rowsOf(top).map((r) => [r.kind === "service" ? "Serviço" : "Produto", String(r.description), Number(r.quantity).toLocaleString("pt-BR"), Number(r.os_count), formatBRL(Number(r.total_cents))]),
      raw: rowsOf(top).map((r) => [String(r.kind), String(r.description), Number(r.quantity), Number(r.os_count), reais(Number(r.total_cents))]),
    },
  ];
}

