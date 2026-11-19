import { redirect } from "next/navigation";
import { supabaseUser } from "./supabase";

export async function requireUser() {
  const sb = await supabaseUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");
  return { sb, user: data.user };
}

/** The signed-in user's company. Redirects to onboarding if they have none yet. */
export async function requireOrg() {
  const { sb, user } = await requireUser();
  const { data } = await sb
    .from("org_members")
    .select("org_id, role, orgs(name)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) redirect("/onboarding");
  const orgName = (data.orgs as unknown as { name: string } | null)?.name ?? "";
  return { sb, user, orgId: data.org_id as string, role: data.role as string, orgName };
}
