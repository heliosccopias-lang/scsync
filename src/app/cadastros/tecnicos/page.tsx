import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/cadastros/tecnicos?${key}=${encodeURIComponent(msg)}`);
}

async function save(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("settings")) back("error", "Seu perfil não altera técnicos.");
  const { sb, orgId } = ctx;
  const id = String(form.get("id") ?? "");
  const userId = String(form.get("user_id") ?? "");
  // The login linked must be someone of this company (or its owner).
  const people = await companyPeople(orgId, ctx.accountId);
  if (userId && !people.some((p) => p.id === userId)) back("error", "Escolha um login desta empresa.");
  const name = String(form.get("name") ?? "").trim();
  const pct = Number(String(form.get("commission_pct") ?? "0").replace(",", ".") || 0);
  if (!name) back("error", "Informe o nome do técnico.");
  if (!(pct >= 0 && pct <= 100)) back("error", "Comissão entre 0 e 100%.");
  const row = { org_id: orgId, name, commission_pct: pct, user_id: userId || null, updated_at: new Date().toISOString() };
  const { error } = id ? await sb.from("technicians").update(row).eq("id", id).eq("org_id", orgId) : await sb.from("technicians").insert(row);
  if (error) back("error", "Não foi possível salvar.");
  back("ok", id ? "Técnico atualizado." : "Técnico cadastrado.");
}

/** Logins that work in this company: its members and the account owners. */
async function companyPeople(orgId: string, accountId: string): Promise<{ id: string; name: string }[]> {
  const admin = supabaseAdmin();
  const [{ data: members }, { data: owners }] = await Promise.all([
    admin.from("org_members").select("user_id").eq("org_id", orgId).eq("active", true),
    admin.from("account_members").select("user_id").eq("account_id", accountId),
  ]);
  const ids = [...new Set([...(members ?? []), ...(owners ?? [])].map((m) => m.user_id as string))];
  if (!ids.length) return [];
  const { data: profiles } = await admin.from("user_profiles").select("user_id, name, email").in("user_id", ids);
  return ids
    .map((id) => {
      const p = (profiles ?? []).find((x) => x.user_id === id);
      return { id, name: (p?.name as string) || (p?.email as string) || "Usuário" };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

async function toggle(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("settings")) back("error", "Seu perfil não altera técnicos.");
  const { sb, orgId } = ctx;
  const active = form.get("active") === "true";
  await sb.from("technicians").update({ active: !active }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", active ? "Técnico desativado." : "Técnico reativado.");
}

export default async function TechniciansPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName, accountId } = await requireOrg();
  const people = await companyPeople(orgId, accountId);
  const { data: techs } = await sb.from("technicians").select("id, name, commission_pct, active, user_id").eq("org_id", orgId).order("active", { ascending: false }).order("name");

  return (
    <Shell orgName={orgName}>
      <h1>Técnicos e atendentes</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Quem atende e executa as OS e as vendas no balcão. Ligue cada pessoa ao seu login para a venda no balcão já abrir com o nome dela.
      </p>
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
          <div className="field" style={{ width: 220, marginBottom: 0 }}>
            <label htmlFor="t_user">Login (opcional)</label>
            <select id="t_user" name="user_id" defaultValue="">
              <option value="">— Sem login —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
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
              <th>Nome, comissão e login</th>
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
                    <select name="user_id" defaultValue={t.user_id ?? ""} aria-label="Login" style={{ width: 200 }}>
                      <option value="">— Sem login —</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
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
