import { redirect } from "next/navigation";
import { Notice } from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

async function changePassword(form: FormData) {
  "use server";
  const { sb, user } = await requireUser();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const back = (k: string, m: string) => redirect(`/minha-senha?${k}=${encodeURIComponent(m)}`);
  if (password.length < 8) back("error", "A senha precisa ter pelo menos 8 caracteres.");
  if (password !== confirm) back("error", "As duas senhas não são iguais.");
  const { error } = await sb.auth.updateUser({ password });
  if (error) back("error", error.message.includes("different") ? "Use uma senha diferente da atual." : "Não foi possível trocar a senha.");
  await supabaseAdmin().from("user_profiles").update({ must_change_password: false }).eq("user_id", user.id);
  redirect("/?ok=" + encodeURIComponent("Senha trocada."));
}

export default async function MyPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; primeiro?: string }> }) {
  const { user } = await requireUser();
  const { error, primeiro } = await searchParams;
  return (
    <main style={{ maxWidth: 440, paddingTop: 80 }}>
      <h1>{primeiro ? "Crie sua senha" : "Trocar minha senha"}</h1>
      <p className="muted">
        {primeiro ? "Você entrou com a senha provisória que recebeu. Escolha uma senha só sua para continuar." : user.email}
      </p>
      <Notice error={error} />
      <form action={changePassword} className="card">
        <div className="field">
          <label htmlFor="password">Nova senha (mínimo 8 caracteres)</label>
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        </div>
        <div className="field">
          <label htmlFor="confirm">Repita a nova senha</label>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        </div>
        <button className="btn btn-primary">Salvar senha</button>
      </form>
    </main>
  );
}
