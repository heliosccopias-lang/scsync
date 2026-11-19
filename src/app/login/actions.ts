"use server";

import { redirect } from "next/navigation";
import { supabaseUser } from "@/lib/supabase";

export async function signIn(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const sb = await supabaseUser();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent("E-mail ou senha inválidos.")}`);
  redirect("/os");
}

export async function signUp(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (password.length < 8) redirect(`/login?error=${encodeURIComponent("A senha precisa ter pelo menos 8 caracteres.")}`);
  const sb = await supabaseUser();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  if (!data.session) redirect(`/login?ok=${encodeURIComponent("Conta criada. Confirme pelo link enviado ao seu e-mail.")}`);
  redirect("/onboarding");
}

export async function signOut() {
  const sb = await supabaseUser();
  await sb.auth.signOut();
  redirect("/login");
}
