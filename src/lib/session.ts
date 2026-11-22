import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseUser } from "./supabase";
import { denyReason, type AccessCtx } from "./access";
import { billingBlock, planAllows } from "./plans";
import { todayInSaoPaulo } from "./money";

export const ORG_COOKIE = "scsync_org";

export async function requireUser() {
  const sb = await supabaseUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");
  return { sb, user: data.user };
}

type OrgRow = { id: string; name: string; cnpj: string | null; account_id: string; modules: Record<string, boolean> | null; business_model: string };

/**
 * The signed-in user, the company being used (cookie, else the first one), their permissions in it,
 * and the account. Also the central guard: blocked screens, suspended account, password to change.
 * Cached per request.
 */
export const requireOrg = cache(async () => {
  const { sb, user } = await requireUser();
  const [{ data: memberships }, { data: owned }] = await Promise.all([
    sb.from("org_members").select("org_id, role, orgs(id, name, cnpj, account_id, modules, business_model)").eq("user_id", user.id).eq("active", true),
    sb.from("account_members").select("account_id").eq("user_id", user.id),
  ]);
  const ownerAccounts = new Set((owned ?? []).map((o) => o.account_id as string));
  const byId = new Map<string, { org: OrgRow; role: string }>();
  for (const m of memberships ?? []) {
    const org = m.orgs as unknown as OrgRow | null;
    if (org) byId.set(org.id, { org, role: m.role as string });
  }
  if (ownerAccounts.size) {
    const { data: ownerOrgs } = await sb.from("orgs").select("id, name, cnpj, account_id, modules, business_model").in("account_id", [...ownerAccounts]);
    for (const org of (ownerOrgs ?? []) as OrgRow[]) if (!byId.has(org.id)) byId.set(org.id, { org, role: "admin" });
  }
  if (!byId.size) redirect(ownerAccounts.size ? "/conta" : "/onboarding");

  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const orgs = [...byId.values()].map((v) => v.org).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const current = byId.get(wanted ?? "") ?? byId.get(orgs[0].id)!;
  const org = current.org;
  const isOwner = ownerAccounts.has(org.account_id);

  const [{ data: permList }, { data: account }, { data: profile }] = await Promise.all([
    sb.rpc("my_perms", { p_org: org.id }),
    sb.from("accounts").select("id, name, status, plan, billing_cycle, price_cents, trial_ends_at, paid_until, cancel_at_period_end, max_companies, max_users").eq("id", org.account_id).single(),
    sb.from("user_profiles").select("name, must_change_password").eq("user_id", user.id).maybeSingle(),
  ]);
  const perms = new Set<string>((permList as string[] | null) ?? []);
  // A module is on when the company turned it on and the plan includes it.
  const acc = account as { plan: string; status: string } | null;
  const modules: Record<string, boolean> = {};
  for (const k of ["os", "stock", "commissions", "finance", "asaas", "bank_reconciliation", "cards"]) {
    modules[k] = (org.modules ?? {})[k] !== false && planAllows(acc?.plan, acc?.status ?? "trial", k);
  }
  const ctx = {
    sb,
    user,
    orgId: org.id,
    orgName: org.name,
    orgCnpj: org.cnpj,
    role: isOwner ? "owner" : current.role,
    isOwner,
    perms,
    can: (p: string) => isOwner || perms.has(p),
    modules,
    module: (k: string) => modules[k] !== false,
    account: account as {
      id: string;
      name: string;
      status: string;
      plan: string;
      billing_cycle: string | null;
      price_cents: number | null;
      trial_ends_at: string | null;
      paid_until: string | null;
      cancel_at_period_end: boolean;
      max_companies: number;
      max_users: number;
    },
    accountId: org.account_id,
    orgs: orgs.map((o) => ({ id: o.id, name: o.name })),
    userName: (profile?.name as string) || user.email || "",
  };

  // Central guard (the proxy passes the path). Server actions post to the page they belong to.
  const path = (await headers()).get("x-pathname") ?? "";
  if (profile?.must_change_password && !path.startsWith("/minha-senha")) redirect("/minha-senha?primeiro=1");
  const blocked = billingBlock(ctx.account, todayInSaoPaulo());
  if (blocked && !["/conta", "/minha-senha", "/sem-acesso"].some((p) => path.startsWith(p))) redirect(`/sem-acesso?motivo=${encodeURIComponent(blocked)}`);
  const why = denyReason(path, ctx satisfies AccessCtx);
  if (why) redirect(`/sem-acesso?motivo=${encodeURIComponent(why)}`);
  return ctx;
});

export type Ctx = Awaited<ReturnType<typeof requireOrg>>;

/** Server-action guard for one permission. */
export function requirePerm(ctx: Ctx, perm: string, back: string) {
  if (!ctx.can(perm)) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Seu perfil não permite esta ação.")}`);
}
