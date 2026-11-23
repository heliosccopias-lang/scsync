import { Notice } from "@/components/Shell";
import { resendConfirmation, signIn, signUp } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; cadastro?: string; confirmar?: string }> }) {
  const { error, ok, cadastro, confirmar } = await searchParams;
  return (
    <main style={{ maxWidth: 400, paddingTop: 80 }}>
      <h1 style={{ margin: "0 0 18px", display: "flex", justifyContent: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/scsync-logo.svg" alt="SCsync" height={120} />
      </h1>
      {cadastro ? <p className="muted">Crie sua conta com e-mail e senha para começar o teste grátis de 14 dias.</p> : null}
      <Notice error={error} ok={ok} />
      <form className="card">
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" required autoComplete="email" defaultValue={confirmar ?? ""} />
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
      {confirmar ? (
        <form action={resendConfirmation} style={{ marginTop: 12 }}>
          <input type="hidden" name="email" value={confirmar} />
          <button className="btn btn-secondary">Reenviar e-mail de confirmação</button>
        </form>
      ) : null}
    </main>
  );
}
