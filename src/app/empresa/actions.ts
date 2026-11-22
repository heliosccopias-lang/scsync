"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ORG_COOKIE } from "@/lib/session";

/** Changes the company being used. The session checks the user really belongs to it on every request. */
export async function switchOrg(form: FormData) {
  const id = String(form.get("org_id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    (await cookies()).set(ORG_COOKIE, id, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect("/");
}
