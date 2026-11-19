import { Notice } from "@/components/Shell";
import { signIn, signUp } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  return (
    <main style={{ maxWidth: 400, paddingTop: 80 }}>
      <h1>
        SC<span style={{ color: "var(--orange-ink)" }}>sync</span>
      </h1>
      <Notice error={error} ok={ok} />
      <form className="card">
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <div className="row">
          <button className="btn btn-primary" formAction={signIn}>
            Entrar
          </button>
          <button className="btn btn-secondary" formAction={signUp}>
            Criar conta
          </button>
        </div>
      </form>
    </main>
  );
}
