import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { homeFor } from "@/lib/access";

export default async function Home() {
  const ctx = await requireOrg();
  redirect(homeFor(ctx));
}
