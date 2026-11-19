import { redirect } from "next/navigation";
import { Notice } from "@/components/Shell";
import { requireUser } from "@/lib/session";

async function createOrg(form: FormData) {
  "use server";
  const { sb } = await requireUser();
  const { error } = await sb.rpc("create_org", {
    p_name: String(form.get("name") ?? ""),
    p_cnpj: String(form.get("cnpj") ?? ""),
  });
  if (error) redirect(`/onboarding?error=${encodeURIComponent("Não foi possível criar a empresa.")}`);
  redirect("/configuracoes/asaas");
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 480, paddingTop: 60 }}>
      <h1>Sua empresa</h1>
      <Notice error={error} />
      <form action={createOrg} className="card">
        <div className="field">
          <label htmlFor="name">Nome da empresa</label>
          <input id="name" name="name" required />
        </div>
        <div className="field">
          <label htmlFor="cnpj">CNPJ (opcional)</label>
          <input id="cnpj" name="cnpj" inputMode="numeric" />
        </div>
        <button className="btn btn-primary">Continuar</button>
      </form>
    </main>
  );
}
