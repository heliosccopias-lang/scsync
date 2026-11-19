"use server";

import { redirect } from "next/navigation";
import { addMonths, parseBRL, parseQuantity, splitInstallments, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { LINES } from "./constants";


export type FormState = { error?: string; field?: string; values?: Record<string, string> };

function isValidCpf(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function isValidCnpj(d: string) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((acc, wi, i) => acc + wi * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

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

  const items: { kind: string; description: string; quantity: number; unit_price_cents: number }[] = [];
  for (let i = 0; i < LINES; i++) {
    const description = s(`item_desc_${i}`);
    const rawPrice = s(`item_price_${i}`);
    if (!description) {
      if (rawPrice) return fail(`Item ${i + 1}: falta a descrição.`, `item_desc_${i}`);
      continue;
    }
    const quantity = parseQuantity(s(`item_qty_${i}`));
    if (quantity === null) return fail(`Item ${i + 1}: quantidade inválida. Use números, por exemplo 1 ou 2,5.`, `item_qty_${i}`);
    if (!rawPrice) return fail(`Item ${i + 1}: informe o valor unitário, por exemplo 150,00.`, `item_price_${i}`);
    const unit = parseBRL(rawPrice);
    if (unit === null || unit < 0) return fail(`Item ${i + 1}: valor "${rawPrice}" não reconhecido. Use, por exemplo, 150,00 ou 1.500,00.`, `item_price_${i}`);
    items.push({ kind: s(`item_kind_${i}`) === "product" ? "product" : "service", description, quantity, unit_price_cents: unit });
  }
  if (items.length === 0) return fail("Inclua pelo menos um serviço ou produto, com descrição e valor.", "item_desc_0");

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
      equipment: s("equipment") || null,
      problem: s("problem") || null,
      notes: s("notes") || null,
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
