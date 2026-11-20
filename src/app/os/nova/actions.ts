"use server";

import { redirect } from "next/navigation";
import { parseItemRows } from "@/lib/items";
import { addMonths, parseBRL, splitInstallments, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { LINES } from "./constants";
import { isValidCnpj, isValidCpf } from "@/lib/br";


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
    if (!s("customer_name")) return fail("Informe o nome do cliente ou escolha um cliente cadastrado.", "customer_name");
    if (doc && !(isValidCpf(doc) || isValidCnpj(doc))) return fail("CPF/CNPJ inválido. Confira os números.", "customer_doc");
  }

  const parsed = parseItemRows(values, LINES);
  if ("error" in parsed) return fail(parsed.error, parsed.field);
  const items = parsed.items;

  const discount = parseBRL(s("discount") || "0");
  if (discount === null || discount < 0) return fail("Desconto inválido. Use, por exemplo, 10,00.", "discount");
  const total = items.reduce((acc, it) => acc + Math.round(it.quantity * it.unit_price_cents), 0) - discount;
  if (total <= 0) return fail("O total da OS precisa ser maior que zero.", "discount");

  const n = Number(s("installments") || "1");
  if (!Number.isInteger(n) || n < 1 || n > 48) return fail("Número de parcelas entre 1 e 48.", "installments");
  const firstDue = s("first_due") || todayInSaoPaulo();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDue)) return fail("Data do 1º vencimento inválida.", "first_due");
  const method = ["pix", "boleto", "credit_card", "other"].includes(s("method")) ? s("method") : "pix";
  const installments = splitInstallments(total, n).map((amount, i) => ({ due_date: addMonths(firstDue, i), amount_cents: amount, method }));

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
      equipment: s("equipment") || null,
      problem: s("problem") || null,
      notes: s("notes") || null,
      internal_notes: s("internal_notes") || null,
      receipt_notes: s("receipt_notes") || null,
      warranty: s("warranty") || null,
      discount_cents: discount,
      items,
      installments,
    },
  });
  if (error || !osId) {
    if (createdCustomer) await sb.from("customers").delete().eq("id", customerId).eq("org_id", orgId);
    return fail("Não foi possível salvar a OS. Tente de novo.");
  }
  redirect(`/os/${osId}`);
}
