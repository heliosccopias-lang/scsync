"use server";

import { isValidCpfCnpj, onlyDigits } from "@/lib/br";
import { requireOrg } from "@/lib/session";

export type QuickCustomerResult = {
  id?: string;
  name?: string;
  error?: string;
  /** A customer that looks like the same person: the sale can use it instead. */
  existing?: { id: string; name: string; match: "documento" | "nome" | "telefone" };
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Quick customer sign-up from the counter sale (name required; CPF/CNPJ, phone and e-mail optional).
 * Warns when the customer is already registered (same CPF/CNPJ, same name or same phone) unless force is set;
 * a repeated CPF/CNPJ is never saved twice.
 */
export type QuickCustomerInput = {
  name: string;
  cpf_cnpj?: string;
  phone?: string;
  email?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  force?: boolean;
};

export async function quickCustomer(input: QuickCustomerInput): Promise<QuickCustomerResult> {
  const ctx = await requireOrg();
  if (!ctx.can("customers.edit")) return { error: "Seu perfil não cadastra clientes." };
  const name = (input.name ?? "").trim().slice(0, 200);
  const doc = onlyDigits(input.cpf_cnpj ?? "");
  if (!name) return { error: "Informe o nome do cliente." };
  if (doc && !isValidCpfCnpj(doc)) return { error: "CPF/CNPJ inválido. Confira os números." };
  const email = (input.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "E-mail inválido." };
  const phone = (input.phone ?? "").trim();
  const cep = onlyDigits(input.cep ?? "").slice(0, 8);
  if (cep && cep.length !== 8) return { error: "CEP inválido: use 8 números." };
  const t = (v: string | undefined, n: number) => (v ?? "").trim().slice(0, n) || undefined;
  // Same keys the customer page uses (cep, number, complement feed the Asaas/NFS-e), plus the full address.
  const address = {
    cep: cep || undefined,
    street: t(input.street, 120),
    number: t(input.number, 20),
    complement: t(input.complement, 60),
    district: t(input.district, 80),
    city: t(input.city, 80),
    state: t(input.state, 2)?.toUpperCase(),
  };

  // Already registered?
  const { data: all } = await ctx.sb.from("customers").select("id, name, cpf_cnpj, phone").eq("org_id", ctx.orgId).limit(10000);
  const list = all ?? [];
  const byDoc = doc ? list.find((c) => digits(c.cpf_cnpj) === doc) : undefined;
  if (byDoc) return { existing: { id: byDoc.id, name: byDoc.name, match: "documento" } };
  if (!input.force) {
    const byName = list.find((c) => norm(c.name) === norm(name));
    if (byName) return { existing: { id: byName.id, name: byName.name, match: "nome" } };
    const p = digits(phone);
    const byPhone = p.length >= 8 ? list.find((c) => digits(c.phone).length >= 8 && digits(c.phone).slice(-8) === p.slice(-8)) : undefined;
    if (byPhone) return { existing: { id: byPhone.id, name: byPhone.name, match: "telefone" } };
  }

  const { data, error } = await ctx.sb
    .from("customers")
    .insert({ org_id: ctx.orgId, name, cpf_cnpj: doc || null, phone: phone || null, email: email || null, address })
    .select("id, name")
    .single();
  if (error || !data) return { error: error?.code === "23505" ? "Já existe um cliente com este CPF/CNPJ." : "Não foi possível cadastrar o cliente." };
  return { id: data.id, name: data.name };
}
