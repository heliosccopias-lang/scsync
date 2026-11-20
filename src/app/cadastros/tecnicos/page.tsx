import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/cadastros/tecnicos?${key}=${encodeURIComponent(msg)}`);
}

async function save(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const pct = Number(String(form.get("commission_pct") ?? "0").replace(",", ".") || 0);
  if (!name) back("error", "Informe o nome do técnico.");
  if (!(pct >= 0 && pct <= 100)) back("error", "Comissão entre 0 e 100%.");
  const row = { org_id: orgId, name, commission_pct: pct, updated_at: new Date().toISOString() };
  const { error } = id ? await sb.from("technicians").update(row).eq("id", id).eq("org_id", orgId) : await sb.from("technicians").insert(row);
  if (error) back("error", "Não foi possível salvar.");
  back("ok", id ? "Técnico atualizado." : "Técnico cadastrado.");
}

async function toggle(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const active = form.get("active") === "true";
  await sb.from("technicians").update({ active: !active }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", active ? "Técnico desativado." : "Técnico reativado.");
}

export default async function TechniciansPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const { data: techs } = await sb.from("technicians").select("id, name, commission_pct, active").eq("org_id", orgId).order("active", { ascending: false }).order("name");

  return (
    <Shell orgName={orgName}>
      <h1>Técnicos</h1>
      <Notice error={error} ok={ok} />
      <form action={save} className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
          <div className="field" style={{ flex: 3, marginBottom: 0 }}>
            <label htmlFor="t_name">Nome do técnico</label>
            <input id="t_name" name="name" required />
          </div>
          <div className="field" style={{ width: 160, marginBottom: 0 }}>
            <label htmlFor="t_pct">Comissão sobre serviços (%)</label>
            <input id="t_pct" name="commission_pct" inputMode="decimal" defaultValue="0" />
          </div>
          <button className="btn btn-primary">Cadastrar</button>
        </div>
      </form>
      {(techs ?? []).length === 0 ? (
        <div className="card empty">Nenhum técnico cadastrado.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome e comissão</th>
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(techs ?? []).map((t) => (
              <tr key={t.id} style={t.active ? undefined : { opacity: 0.55 }}>
                <td>
                  <form action={save} className="row" style={{ flexWrap: "nowrap" }}>
                    <input type="hidden" name="id" value={t.id} />
                    <input name="name" defaultValue={t.name} aria-label="Nome" style={{ flex: 3 }} required />
                    <input name="commission_pct" defaultValue={String(t.commission_pct).replace(".", ",")} aria-label="Comissão %" inputMode="decimal" style={{ width: 90 }} />
                    <span className="muted">%</span>
                    <button className="btn btn-secondary">Salvar</button>
                  </form>
                </td>
                <td>{t.active ? <span className="pill pill-paid">Ativo</span> : <span className="pill pill-neutral">Inativo</span>}</td>
                <td>
                  <form action={toggle}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="active" value={String(t.active)} />
                    <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                      {t.active ? "Desativar" : "Reativar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
