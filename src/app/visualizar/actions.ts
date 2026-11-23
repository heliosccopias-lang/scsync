"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parsePreview, PREVIEW_COOKIE, previewCookieValue } from "@/lib/access";
import { ORG_COOKIE, requireUser } from "@/lib/session";

/** Owner only: see the system as a profile and/or plan would. Checked here, not through requireOrg (which is look-only in preview). */
export async function startPreview(form: FormData) {
  const { sb, user } = await requireUser();
  const jar = await cookies();
  const role = String(form.get("role") ?? "") || null;
  const plan = String(form.get("plan") ?? "") || null;
  const value = previewCookieValue(role, plan);
  const back = safeBack(String(form.get("back") ?? ""));

  const orgId = jar.get(ORG_COOKIE)?.value;
  const { data: owned } = await sb.from("account_members").select("account_id").eq("user_id", user.id);
  const accounts = (owned ?? []).map((o) => o.account_id as string);
  let ok = accounts.length > 0;
  if (ok && orgId) {
    const { data: org } = await sb.from("orgs").select("account_id").eq("id", orgId).maybeSingle();
    ok = !org || accounts.includes(org.account_id as string);
  }
  if (!ok) redirect(`${back}?error=${encodeURIComponent("Só o Dono da conta usa a visualização.")}`);
  if (!parsePreview(value)) {
    jar.delete(PREVIEW_COOKIE);
    redirect(back);
  }
  jar.set(PREVIEW_COOKIE, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  redirect("/");
}

export async function stopPreview(form: FormData) {
  (await cookies()).delete(PREVIEW_COOKIE);
  const back = safeBack(String(form.get("back") ?? ""));
  redirect(back.startsWith("/sem-acesso") ? "/conta" : back || "/conta");
}

function safeBack(p: string): string {
  return p.startsWith("/") && !p.startsWith("//") ? p : "/";
}
