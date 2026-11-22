"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { grantSudo, hasSudo, verifyPassword } from "@/lib/sudo";
import { MODULES, PERMS, ROLES } from "@/lib/access";
import { isValidCnpj } from "@/lib/br";

function back(key: "error" | "ok", msg: string, extra = ""): never {
  redirect(`/conta?${key}=${encodeURIComponent(msg)}${extra}`);
}

/** Every change here needs the Dono with the password confirmed in the last 15 minutes. */
async function owner() {
  const ctx = await requireOrg();
  if (!ctx.isOwner) back("error", "Só o Dono da conta.");
  if (!(await hasSudo(ctx.user.id))) back("error", "Confirme sua senha para continuar.");
  return ctx;
}

/** Company ids the form sent, kept only if they belong to the Dono's account. */
async function accountOrgs(accountId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await supabaseAdmin().from("orgs").select("id").eq("account_id", accountId).in("id", ids);
  return (data ?? []).map((o) => o.id as string);
}

export async function confirmSudo(form: FormData) {
  const ctx = await requireOrg();
  if (!ctx.isOwner) back("error", "Só o Dono da conta.");
  const ok = await verifyPassword(ctx.user.email ?? "", String(form.get("password") ?? ""));
  if (!ok) back("error", "Senha incorreta.");
  await grantSudo(ctx.user.id);
  back("ok", "Senha confirmada por 15 minutos.");
}

export async function saveCompany(form: FormData) {
  const ctx = await owner();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const cnpj = String(form.get("cnpj") ?? "").replace(/\D/g, "");
  const model = ["services", "products", "both"].includes(String(form.get("model"))) ? String(form.get("model")) : "both";
  if (!name) back("error", "Informe o nome da empresa.");
  if (cnpj && !isValidCnpj(cnpj)) back("error", "CNPJ inválido.");
  if (!id) {
    const { error } = await ctx.sb.rpc("create_company", { p_account: ctx.accountId, p_name: name, p_cnpj: cnpj, p_model: model });
    if (error) back("error", error.message === "company_limit" ? `Seu plano permite até ${ctx.account.max_companies} empresas.` : "Não foi possível criar a empresa.");
    back("ok", `Empresa ${name} criada. Para usá-la, troque a empresa no topo da tela.`);
  }
  const [mine] = await accountOrgs(ctx.accountId, [id]);
  if (!mine) back("error", "Empresa não encontrada.");
  const modules = Object.fromEntries(MODULES.map((m) => [m.key, form.get(`mod_${m.key}`) === "on"]));
  const { error } = await supabaseAdmin().from("orgs").update({ name, cnpj: cnpj || null, business_model: model, modules, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) back("error", "Não foi possível salvar a empresa.");
  back("ok", `Empresa ${name} atualizada.`);
}

function tempPassword(): string {
  // Easy to dictate: no 0/O, 1/l.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
}

function readRole(form: FormData, prefix = ""): { role: string; permissions: string[] | null } {
  const role = ROLES.some((r) => r.key === form.get(`${prefix}role`)) ? String(form.get(`${prefix}role`)) : "attendance";
  const permissions = role === "custom" ? PERMS.map((p) => p.key).filter((k) => form.get(`${prefix}perm_${k}`) === "on") : null;
  return { role, permissions };
}

export async function createUser(form: FormData) {
  const ctx = await owner();
  const admin = supabaseAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const orgIds = await accountOrgs(ctx.accountId, form.getAll("org_id").map(String));
  const { role, permissions } = readRole(form);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back("error", "Informe nome e e-mail válidos.");
  if (!orgIds.length) back("error", "Marque pelo menos uma empresa.");

  const { data: allOrgs } = await admin.from("orgs").select("id").eq("account_id", ctx.accountId);
  const { data: members } = await admin.from("org_members").select("user_id").in("org_id", (allOrgs ?? []).map((o) => o.id));
  const users = new Set((members ?? []).map((m) => m.user_id as string));

  const password = tempPassword();
  let userId: string;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (created.data.user) {
    userId = created.data.user.id;
    await admin.from("user_profiles").upsert({ user_id: userId, name, email, must_change_password: true });
  } else {
    // Already has a login (e.g. works for another company): just give access, keep their password.
    const { data: prof } = await admin.from("user_profiles").select("user_id").eq("email", email).maybeSingle();
    if (!prof) back("error", "Não foi possível criar o login para esse e-mail.");
    userId = prof.user_id as string;
  }
  if (!users.has(userId) && users.size >= ctx.account.max_users) back("error", `Seu plano permite até ${ctx.account.max_users} usuários.`);

  const rows = orgIds.map((org_id) => ({ org_id, user_id: userId, role, permissions, active: true }));
  const { error } = await admin.from("org_members").upsert(rows, { onConflict: "org_id,user_id" });
  if (error) back("error", "Login criado, mas não foi possível dar acesso às empresas.");
  if (created.data.user) {
    back("ok", `Usuário criado. Passe para ${name}: e-mail ${email} e senha provisória abaixo (ele vai criar a própria senha no primeiro acesso).`, `&senha=${encodeURIComponent(password)}`);
  }
  back("ok", `${email} já tinha login no SCsync: o acesso foi liberado com a senha que ele já usa.`);
}

export async function updateMember(form: FormData) {
  const ctx = await owner();
  const admin = supabaseAdmin();
  const userId = String(form.get("user_id") ?? "");
  const [orgId] = await accountOrgs(ctx.accountId, [String(form.get("org_id") ?? "")]);
  if (!orgId || !userId) back("error", "Acesso não encontrado.");
  const op = String(form.get("op") ?? "save");
  if (op === "remove") {
    await admin.from("org_members").delete().eq("org_id", orgId).eq("user_id", userId);
    back("ok", "Acesso removido desta empresa.");
  }
  if (op === "toggle") {
    const active = form.get("active") === "true";
    await admin.from("org_members").update({ active: !active }).eq("org_id", orgId).eq("user_id", userId);
    back("ok", active ? "Acesso bloqueado." : "Acesso liberado.");
  }
  const { role, permissions } = readRole(form);
  await admin.from("org_members").update({ role, permissions }).eq("org_id", orgId).eq("user_id", userId);
  back("ok", "Perfil atualizado.");
}

export async function addAccess(form: FormData) {
  const ctx = await owner();
  const userId = String(form.get("user_id") ?? "");
  const [orgId] = await accountOrgs(ctx.accountId, [String(form.get("org_id") ?? "")]);
  if (!orgId || !userId) back("error", "Escolha a empresa.");
  const { role, permissions } = readRole(form);
  const { error } = await supabaseAdmin().from("org_members").upsert({ org_id: orgId, user_id: userId, role, permissions, active: true }, { onConflict: "org_id,user_id" });
  if (error) back("error", "Não foi possível dar acesso.");
  back("ok", "Acesso liberado na empresa.");
}

export async function resetPassword(form: FormData) {
  const ctx = await owner();
  const admin = supabaseAdmin();
  const userId = String(form.get("user_id") ?? "");
  const { data: orgs } = await admin.from("orgs").select("id").eq("account_id", ctx.accountId);
  const { data: m } = await admin.from("org_members").select("user_id").eq("user_id", userId).in("org_id", (orgs ?? []).map((o) => o.id)).limit(1);
  if (!m?.length) back("error", "Usuário não encontrado nesta conta.");
  const { data: isOwner } = await admin.from("account_members").select("user_id").eq("user_id", userId).limit(1);
  if (isOwner?.length && userId !== ctx.user.id) back("error", "A senha de outro Dono só pode ser trocada por ele mesmo.");
  const password = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) back("error", "Não foi possível gerar a senha.");
  await admin.from("user_profiles").update({ must_change_password: true }).eq("user_id", userId);
  back("ok", "Senha provisória gerada. Passe para a pessoa; ela cria a própria senha no próximo acesso.", `&senha=${encodeURIComponent(password)}`);
}
