"use server";

import { redirect } from "next/navigation";
import { supabaseAdmin, supabaseUser } from "@/lib/supabase";

export async function signIn(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const sb = await supabaseUser();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error?.code === "email_not_confirmed") {
    // Signed up before the e-mail link worked: the right password proves it is them.
    const admin = supabaseAdmin();
    let id: string | null = null;
    for (let page = 1; !id && page <= 20; page++) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      id = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
      if (!list || list.users.length < 200) break;
    }
    if (id) {
      await admin.auth.admin.updateUserById(id, { email_confirm: true });
      const again = await sb.auth.signInWithPassword({ email, password });
      if (!again.error) redirect("/");
    }
    redirect(`/login?error=${encodeURIComponent("E-mail ou senha inválidos.")}`);
  }
  if (error) redirect(`/login?error=${encodeURIComponent("E-mail ou senha inválidos. Primeira vez? Preencha e clique em Criar conta.")}`);
  redirect("/");
}

/**
 * Free-trial sign-up. The login is created already confirmed and the person goes straight in:
 * no confirmation e-mail, so it does not depend on the e-mail link settings of Supabase.
 */
export async function signUp(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`/login?cadastro=1&error=${encodeURIComponent("Informe um e-mail válido.")}`);
  if (password.length < 8) redirect(`/login?cadastro=1&error=${encodeURIComponent("A senha precisa ter pelo menos 8 caracteres.")}`);
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    const exists = error.code === "email_exists" || /already|registered/i.test(error.message);
    redirect(`/login?error=${encodeURIComponent(exists ? "Este e-mail já tem conta. Digite a senha e clique em Entrar." : signUpError(error.code, error.message))}`);
  }
  const sb = await supabaseUser();
  const { error: loginError } = await sb.auth.signInWithPassword({ email, password });
  if (loginError) redirect(`/login?ok=${encodeURIComponent("Conta criada. Entre com seu e-mail e senha.")}`);
  redirect("/onboarding");
}

export async function signOut() {
  const sb = await supabaseUser();
  await sb.auth.signOut();
  redirect("/login");
}

export async function resendConfirmation(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const sb = await supabaseUser();
  const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${appUrl()}/auth/callback` } });
  if (error) redirect(`/login?confirmar=${encodeURIComponent(email)}&error=${encodeURIComponent(signUpError(error.code, error.message))}`);
  redirect(`/login?confirmar=${encodeURIComponent(email)}&ok=${encodeURIComponent("E-mail de confirmação reenviado.")}`);
}

function appUrl() {
  return (process.env.APP_URL ?? "https://scsync.vercel.app").replace(/\/$/, "");
}

function signUpError(code: string | undefined, message: string) {
  if (code === "over_email_send_rate_limit") return "Aguarde um minuto antes de pedir outro e-mail.";
  if (code === "weak_password") return "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.";
  if (code === "email_address_invalid") return "E-mail inválido.";
  return message;
}
