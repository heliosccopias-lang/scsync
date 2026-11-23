import { redirect } from "next/navigation";
import { Notice } from "@/components/Shell";
import { requireUser } from "@/lib/session";

async function createAccount(form: FormData) {
  "use server";
  const { sb } = await requireUser();
  const model = ["services", "products", "both"].includes(String(form.get("model"))) ? String(form.get("model")) : "both";
  const { error } = await sb.rpc("create_account", {
    p_account: String(form.get("company") ?? ""),
    p_company: String(form.get("company") ?? ""),
    p_cnpj: String(form.get("cnpj") ?? "").replace(/\D/g, ""),
    p_model: model,
    p_name: String(form.get("name") ?? "").trim(),
  });
  if (error?.message === "already_has_account") redirect("/");
  if (error) redirect(`/onboarding?error=${encodeURIComponent("Não foi possível criar a conta.")}`);
  redirect("/");
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 520, paddingTop: 60 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/scsync-logo.svg" alt="SCsync" height={96} style={{ display: "block", margin: "0 auto 12px" }} />
      <h1>Bem-vindo ao SCsync</h1>
      <p className="muted">Teste grátis por 14 dias. Você será o Dono da conta: cria as empresas, liga os módulos e cadastra a equipe.</p>
      <Notice error={error} />
      <form action={createAccount} className="card">
        <div className="field">
          <label htmlFor="name">Seu nome</label>
          <input id="name" name="name" required />
        </div>
        <div className="field">
          <label htmlFor="company">Nome da gráfica</label>
          <input id="company" name="company" required />
        </div>
        <div className="field">
          <label htmlFor="cnpj">CNPJ (opcional)</label>
          <input id="cnpj" name="cnpj" inputMode="numeric" />
        </div>
        <div className="field">
          <label htmlFor="model">O que a empresa vende?</label>
          <select id="model" name="model" defaultValue="both">
            <option value="both">Serviços e produtos</option>
            <option value="services">Só serviços</option>
            <option value="products">Só produtos</option>
          </select>
        </div>
        <button className="btn btn-primary">Começar o teste</button>
      </form>
    </main>
  );
}
