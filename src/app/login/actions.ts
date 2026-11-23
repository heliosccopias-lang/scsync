"use server";

import { redirect } from "next/navigation";
import { supabaseUser } from "@/lib/supabase";

export async function signIn(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const sb = await supabaseUser();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error?.code === "email_not_confirmed") {
    redirect(`/login?confirmar=${encodeURIComponent(email)}&error=${encodeURIComponent("Falta confirmar o e-mail: abra o link que enviamos (veja também o spam).")}`);
  }
  if (error) redirect(`/login?error=${encodeURIComponent("E-mail ou senha inválidos. Primeira vez? Preencha e clique em Criar conta.")}`);
  redirect("/");
}

export async function signUp(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (password.length < 8) redirect(`/login?error=${encodeURIComponent("A senha precisa ter pelo menos 8 caracteres.")}`);
  const sb = await supabaseUser();
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${appUrl()}/auth/callback` } });
  if (error) redirect(`/login?error=${encodeURIComponent(signUpError(error.code, error.message))}`);
  // Already registered: Supabase answers without error and without identities.
  if (data.user && !data.user.identities?.length) redirect(`/login?error=${encodeURIComponent("Este e-mail já tem conta. Clique em Entrar.")}`);
  if (!data.session) redirect(`/login?confirmar=${encodeURIComponent(email)}&ok=${encodeURIComponent("Conta criada. Abra o link enviado ao seu e-mail (veja também o spam) e depois entre com e-mail e senha.")}`);
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
