import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/cadastros/setores?${key}=${encodeURIComponent(msg)}`);
}

async function save(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("settings")) back("error", "Seu perfil não altera os setores.");
  const { sb, orgId } = ctx;
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  if (!name) back("error", "Informe o nome do setor.");
  const position = Number(form.get("position") || 0);
  const row = { org_id: orgId, name, position: Number.isFinite(position) ? Math.round(position) : 0, updated_at: new Date().toISOString() };
  const { error } = id ? await sb.from("sectors").update(row).eq("id", id).eq("org_id", orgId) : await sb.from("sectors").insert(row);
  if (error) back("error", error.code === "23505" ? "Já existe um setor com esse nome." : "Não foi possível salvar.");
  back("ok", id ? "Setor atualizado." : "Setor cadastrado.");
}

async function toggle(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("settings")) back("error", "Seu perfil não altera os setores.");
  const active = form.get("active") === "true";
  await ctx.sb.from("sectors").update({ active: !active, updated_at: new Date().toISOString() }).eq("id", String(form.get("id"))).eq("org_id", ctx.orgId);
  back("ok", active ? "Setor desativado: ele some das listas, mas as OS antigas continuam com ele." : "Setor reativado.");
}

export default async function SectorsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName, can } = await requireOrg();
  const canEdit = can("settings");
  const { data: sectors } = await sb.from("sectors").select("id, name, position, active").eq("org_id", orgId).order("active", { ascending: false }).order("position").order("name");
  const { data: used } = await sb.from("service_orders").select("sector_id").eq("org_id", orgId).not("sector_id", "is", null).limit(20000);
  const count = new Map<string, number>();
  for (const u of used ?? []) count.set(u.sector_id as string, (count.get(u.sector_id as string) ?? 0) + 1);
  const next = Math.max(0, ...(sectors ?? []).map((s) => Number(s.position))) + 1;

  return (
    <Shell orgName={orgName}>
      <h1>Setores</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        As áreas da gráfica que recebem os trabalhos. Aparecem no campo <strong>Setor</strong> da ordem de serviço e da venda no balcão. Quem atende e
        recebe comissão fica em Cadastros → Técnicos e atendentes.
      </p>
      <Notice error={error} ok={ok} />
      {canEdit ? (
        <form action={save} className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
            <div className="field" style={{ flex: 3, marginBottom: 0 }}>
              <label htmlFor="s_name">Nome do setor</label>
              <input id="s_name" name="name" placeholder="Ex.: Acabamento, Impressão digital" required maxLength={60} />
            </div>
            <div className="field" style={{ width: 110, marginBottom: 0 }}>
              <label htmlFor="s_pos">Ordem</label>
              <input id="s_pos" name="position" type="number" defaultValue={next} />
            </div>
            <button className="btn btn-primary">Cadastrar</button>
          </div>
        </form>
      ) : null}
      {(sectors ?? []).length === 0 ? (
        <div className="card empty">Nenhum setor cadastrado.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Setor e ordem na lista</th>
              <th className="num">OS</th>
              <th>Situação</th>
              {canEdit ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {(sectors ?? []).map((s) => (
              <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
                <td>
                  {canEdit ? (
                    <form action={save} className="row" style={{ flexWrap: "nowrap" }}>
                      <input type="hidden" name="id" value={s.id} />
                      <input name="name" defaultValue={s.name} aria-label="Nome" style={{ flex: 3 }} required maxLength={60} />
                      <input name="position" type="number" defaultValue={s.position} aria-label="Ordem" style={{ width: 80 }} />
                      <button className="btn btn-secondary">Salvar</button>
                    </form>
                  ) : (
                    s.name
                  )}
                </td>
                <td className="num">{count.get(s.id) ?? 0}</td>
                <td>{s.active ? <span className="pill pill-paid">Ativo</span> : <span className="pill pill-neutral">Inativo</span>}</td>
                {canEdit ? (
                  <td>
                    <form action={toggle}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="active" value={String(s.active)} />
                      <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                        {s.active ? "Desativar" : "Reativar"}
                      </button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
