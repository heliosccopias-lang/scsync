import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { fmtDate } from "@/lib/format";
import { requireOrg } from "@/lib/session";

async function create(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const name = String(form.get("name") ?? "").trim();
  if (!name) redirect(`/cadastros/checklists?error=${encodeURIComponent("Dê um nome ao checklist.")}`);
  const mode = form.get("mode") === "all_at_once" ? "all_at_once" : "by_steps";
  const { data, error } = await sb.from("checklists").insert({ org_id: orgId, name, mode }).select("id").single();
  if (error || !data) redirect(`/cadastros/checklists?error=${encodeURIComponent("Não foi possível criar o checklist.")}`);
  redirect(`/cadastros/checklists/${data.id}`);
}

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<{ situacao?: string; error?: string; ok?: string }> }) {
  const { situacao = "ativos", error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const { data: lists } = await sb
    .from("checklists")
    .select("id, name, mode, active, locked, created_at, updated_at, checklist_questions(count), checklist_runs(count)")
    .eq("org_id", orgId)
    .eq("active", situacao !== "inativos")
    .order("name");

  return (
    <Shell orgName={orgName}>
      <h1>Checklists</h1>
      <Notice error={error} ok={ok} />
      <p className="muted" style={{ marginTop: 0 }}>
        Padronize o atendimento: o técnico preenche o checklist dentro da OS (ou imprime em branco e lança depois).
      </p>
      <form action={create} className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
          <div className="field" style={{ flex: 2, marginBottom: 0 }}>
            <label htmlFor="c_name">Novo checklist</label>
            <input id="c_name" name="name" placeholder="Ex.: Entrada de notebook" required />
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="c_mode">Preenchimento</label>
            <select id="c_mode" name="mode" defaultValue="by_steps">
              <option value="by_steps">Por etapas (pode pausar e continuar)</option>
              <option value="all_at_once">De uma vez (tudo obrigatório ao salvar)</option>
            </select>
          </div>
          <button className="btn btn-primary">Criar e montar perguntas</button>
        </div>
      </form>
      <div className="row" style={{ marginBottom: 12 }}>
        <Link className={`btn ${situacao !== "inativos" ? "btn-primary" : "btn-secondary"}`} href="/cadastros/checklists">
          Ativos
        </Link>
        <Link className={`btn ${situacao === "inativos" ? "btn-primary" : "btn-secondary"}`} href="/cadastros/checklists?situacao=inativos">
          Inativos
        </Link>
      </div>
      {(lists ?? []).length === 0 ? (
        <div className="card empty">Nenhum checklist {situacao === "inativos" ? "inativo" : "ainda"}.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th className="num">Perguntas</th>
              <th className="num">Usado em OS</th>
              <th>Criado</th>
              <th>Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {(lists ?? []).map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/cadastros/checklists/${l.id}`}>{l.name}</Link>
                  {l.locked ? <span className="muted"> · em uso (para mudar, duplique)</span> : null}
                </td>
                <td className="num">{(l.checklist_questions as unknown as { count: number }[])?.[0]?.count ?? 0}</td>
                <td className="num">{(l.checklist_runs as unknown as { count: number }[])?.[0]?.count ?? 0}</td>
                <td>{fmtDate(l.created_at)}</td>
                <td>{fmtDate(l.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
