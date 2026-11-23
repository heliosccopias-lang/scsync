import Link from "next/link";
import { requireUser } from "@/lib/session";
import { cookies } from "next/headers";
import { signOut } from "@/app/login/actions";
import { stopPreview } from "@/app/visualizar/actions";
import { parsePreview, PREVIEW_COOKIE } from "@/lib/access";

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  await requireUser();
  const { motivo } = await searchParams;
  const previewing = parsePreview((await cookies()).get(PREVIEW_COOKIE)?.value);
  return (
    <main style={{ maxWidth: 520, paddingTop: 80 }}>
      <h1>Sem acesso</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>{motivo || "Seu perfil não tem acesso a esta área."}</p>
        {previewing ? (
          <p className="muted">Modo visualização: é isto que esse perfil ou plano vê ao abrir esta tela.</p>
        ) : (
          <p className="muted">Se precisar, peça ao Dono da conta para ajustar seu perfil ou ligar o módulo.</p>
        )}
        <div className="row">
          <Link className="btn btn-primary" href="/">
            Ir para o início
          </Link>
          {previewing ? (
            <form action={stopPreview}>
              <input type="hidden" name="back" value="/conta" />
              <button className="btn btn-secondary">Sair da visualização</button>
            </form>
          ) : null}
          <form action={signOut}>
            <button className="btn btn-secondary">Sair</button>
          </form>
        </div>
      </div>
    </main>
  );
}
