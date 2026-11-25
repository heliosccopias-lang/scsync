"use server";

import { redirect } from "next/navigation";
import { parseItemRows } from "@/lib/items";
import { addDays, addMonths, parseBRL, splitInstallments, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { LINES } from "./constants";
import { isValidCnpj, isValidCpf } from "@/lib/br";
import { readPrintSpec } from "@/lib/grafica";


export type FormState = { error?: string; field?: string; values?: Record<string, string> };

export async function createOrder(_prev: FormState, form: FormData): Promise<FormState> {
  const values: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string") values[k] = v;
  });
  const s = (k: string) => (values[k] ?? "").trim();
  const fail = (error: string, field?: string): FormState => ({ error, field, values });

  // 1. Validate everything first; nothing is saved until the whole form is valid.
  const existingCustomer = s("customer_id");
  const doc = s("customer_doc").replace(/\D/g, "");
  if (!existingCustomer) {
    if (!s("customer_name")) return fail("Escolha o cliente ou cadastre um novo em \"+ Novo cliente\".", "customer_name");
    if (doc && !(isValidCpf(doc) || isValidCnpj(doc))) return fail("CPF/CNPJ inválido. Confira os números.", "customer_doc");
  }

  const parsed = parseItemRows(values, LINES);
  if ("error" in parsed) return fail(parsed.error, parsed.field);
  const items = parsed.items;

  const discount = parseBRL(s("discount") || "0");
  if (discount === null || discount < 0) return fail("Desconto inválido. Use, por exemplo, 10,00.", "discount");
  const total = items.reduce((acc, it) => acc + Math.round(it.quantity * it.unit_price_cents), 0) - discount;
  if (total <= 0) return fail("O total da OS precisa ser maior que zero.", "discount");

  // A saved payment condition (e.g. 30/60/90) overrides the manual fields.
  let conditionDays: number[] | null = null;
  let conditionMethod: string | null = null;
  if (s("condition_id")) {
    const { sb: csb } = await requireOrg();
    const { data: cond } = await csb.from("payment_conditions").select("installment_days, default_method").eq("id", s("condition_id")).maybeSingle();
    if (!cond) return fail("Condição de pagamento não encontrada.", "condition_id");
    conditionDays = cond.installment_days as number[];
    conditionMethod = cond.default_method as string;
  }
  const n = conditionDays ? conditionDays.length : Number(s("installments") || "1");
  if (!Number.isInteger(n) || n < 1 || n > 48) return fail("Número de parcelas entre 1 e 48.", "installments");
  const firstDue = s("first_due") || todayInSaoPaulo();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDue)) return fail("Data do 1º vencimento inválida.", "first_due");
  const method = ["pix", "boleto", "credit_card", "other"].includes(s("method")) ? s("method") : "pix";
  const installments = splitInstallments(total, n).map((amount, i) => ({
    due_date: conditionDays ? addDays(todayInSaoPaulo(), conditionDays[i]) : addMonths(firstDue, i),
    amount_cents: amount,
    method: conditionMethod ?? method,
  }));

  // 2. Save: customer (if new), then the OS in one database call.
  const { sb, orgId } = await requireOrg();
  let customerId = existingCustomer;
  let createdCustomer = false;
  if (!customerId) {
    const { data, error } = await sb
      .from("customers")
      .insert({ org_id: orgId, name: s("customer_name"), cpf_cnpj: doc || null, email: s("customer_email") || null, phone: s("customer_phone") || null })
      .select("id")
      .single();
    if (error || !data) {
      return fail(error?.code === "23505" ? "Já existe um cliente com este CPF/CNPJ. Escolha-o em \"Cliente cadastrado\"." : "Não foi possível salvar o cliente.", "customer_doc");
    }
    customerId = data.id;
    createdCustomer = true;
  }

  const { data: osId, error } = await sb.rpc("create_service_order", {
    p_org: orgId,
    p: {
      customer_id: customerId,
      kind: s("kind") === "quote" ? "quote" : "order",
      attendance_type: ["internal", "external", "warranty"].includes(s("attendance_type")) ? s("attendance_type") : "external",
      technician_id: s("technician_id") || null,
      delivery_date: /^\d{4}-\d{2}-\d{2}$/.test(s("delivery_date")) ? s("delivery_date") : null,
      notes: s("notes") || null,
      internal_notes: s("internal_notes") || null,
      discount_cents: discount,
      items,
      installments,
    },
  });
  if (error || !osId) {
    if (createdCustomer) await sb.from("customers").delete().eq("id", customerId).eq("org_id", orgId);
    return fail("Não foi possível salvar a OS. Tente de novo.");
  }
  // Extras the creation function does not take: print-shop job specs and the second technician.
  const extra: Record<string, unknown> = { ...readPrintSpec(s, todayInSaoPaulo()) };
  if (s("second_technician_id")) extra.second_technician_id = s("second_technician_id");
  if (Object.keys(extra).length) await sb.from("service_orders").update(extra).eq("id", osId).eq("org_id", orgId);
  redirect(`/os/${osId}`);
}
