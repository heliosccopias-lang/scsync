import Link from "next/link";
import { requireUser } from "@/lib/session";
import { signOut } from "@/app/login/actions";

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  await requireUser();
  const { motivo } = await searchParams;
  return (
    <main style={{ maxWidth: 520, paddingTop: 80 }}>
      <h1>Sem acesso</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>{motivo || "Seu perfil não tem acesso a esta área."}</p>
        <p className="muted">Se precisar, peça ao Dono da conta para ajustar seu perfil ou ligar o módulo.</p>
        <div className="row">
          <Link className="btn btn-primary" href="/">
            Ir para o início
          </Link>
          <form action={signOut}>
            <button className="btn btn-secondary">Sair</button>
          </form>
        </div>
      </div>
    </main>
  );
}
