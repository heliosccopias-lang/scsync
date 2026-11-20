import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { TYPE_LABEL, parseOptions, type QuestionType } from "@/lib/checklist";
import { requireOrg } from "@/lib/session";

const BLANK_ROWS = 3;

function back(id: string, key: "error" | "ok", msg: string): never {
  redirect(`/cadastros/checklists/${id}?${key}=${encodeURIComponent(msg)}`);
}

async function saveQuestions(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  const { sb, orgId } = await requireOrg();
  const rows = Number(form.get("rows") || 0);
  const name = String(form.get("name") ?? "").trim();
  const mode = form.get("mode") === "all_at_once" ? "all_at_once" : "by_steps";
  if (!name) back(id, "error", "Dê um nome ao checklist.");

  const questions: { org_id: string; checklist_id: string; position: number; prompt: string; type: QuestionType; options: string[]; required: boolean; comment_required: string }[] = [];
  for (let i = 0; i < rows; i++) {
    const prompt = String(form.get(`prompt_${i}`) ?? "").trim();
    if (!prompt) continue;
    const type = String(form.get(`type_${i}`)) as QuestionType;
    if (!["single", "multi", "rating", "upload"].includes(type)) back(id, "error", `Pergunta ${i + 1}: tipo inválido.`);
    const options = type === "single" || type === "multi" ? parseOptions(String(form.get(`options_${i}`) ?? "")) : [];
    if ((type === "single" || type === "multi") && options.length < 2) back(id, "error", `Pergunta ${i + 1}: informe pelo menos duas opções, uma por linha.`);
    questions.push({
      org_id: orgId,
      checklist_id: id,
      position: questions.length + 1,
      prompt,
      type,
      options,
      required: form.get(`required_${i}`) === "on",
      comment_required: form.get(`comment_${i}`) === "always" ? "always" : "never",
    });
  }
  if (questions.length === 0) back(id, "error", "Inclua pelo menos uma pergunta.");

  const { error: e1 } = await sb.from("checklists").update({ name, mode, updated_at: new Date().toISOString() }).eq("id", id).eq("org_id", orgId);
  const { error: e2 } = await sb.from("checklist_questions").delete().eq("checklist_id", id).eq("org_id", orgId);
  const { error: e3 } = e2 ? { error: e2 } : await sb.from("checklist_questions").insert(questions);
  const err = e1 ?? e2 ?? e3;
  if (err) back(id, "error", err.message.includes("checklist_locked") ? "Este checklist já foi usado em OS: duplique para alterar." : "Não foi possível salvar.");
  back(id, "ok", "Checklist salvo.");
}

async function duplicate(form: FormData) {
  "use server";
  const { sb } = await requireOrg();
  const { data, error } = await sb.rpc("duplicate_checklist", { p_checklist: String(form.get("id")) });
  if (error || !data) back(String(form.get("id")), "error", "Não foi possível duplicar.");
  redirect(`/cadastros/checklists/${data}?ok=${encodeURIComponent("Cópia criada: altere e salve.")}`);
}

async function toggleActive(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  const { sb, orgId } = await requireOrg();
  const active = form.get("active") === "true";
  await sb.from("checklists").update({ active: !active, updated_at: new Date().toISOString() }).eq("id", id).eq("org_id", orgId);
  back(id, "ok", active ? "Checklist desativado: não aparece mais para novas OS." : "Checklist reativado.");
}

export default async function ChecklistEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const { data: list } = await sb.from("checklists").select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (!list) notFound();
  const { data: questions } = await sb.from("checklist_questions").select("*").eq("checklist_id", id).order("position");
  const qs = questions ?? [];
  const rows = list.locked ? qs.length : qs.length + BLANK_ROWS;

  return (
    <Shell orgName={orgName}>
      <Link href="/cadastros/checklists" className="muted">
        ← Checklists
      </Link>
      <div className="spread" style={{ marginTop: 6 }}>
        <h1 style={{ margin: 0 }}>{list.name}</h1>
        <div className="row">
          <form action={duplicate}>
            <input type="hidden" name="id" value={id} />
            <button className="btn btn-secondary">Duplicar</button>
          </form>
          <form action={toggleActive}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="active" value={String(list.active)} />
            <button className="btn btn-secondary">{list.active ? "Desativar" : "Reativar"}</button>
          </form>
        </div>
      </div>
      <Notice error={error} ok={ok} />
      {list.locked ? (
        <div className="notice" style={{ background: "var(--orange-soft)", color: "var(--ink)" }}>
          Este checklist já foi usado em ordens de serviço, então não pode ser alterado (as respostas dadas mudariam de sentido). Use <strong>Duplicar</strong>{" "}
          para criar uma versão nova.
        </div>
      ) : null}

      <form action={saveQuestions}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="rows" value={rows} />
        <fieldset disabled={list.locked} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="grid2">
              <div className="field">
                <label htmlFor="e_name">Nome</label>
                <input id="e_name" name="name" defaultValue={list.name} required />
              </div>
              <div className="field">
                <label htmlFor="e_mode">Preenchimento</label>
                <select id="e_mode" name="mode" defaultValue={list.mode}>
                  <option value="by_steps">Por etapas (pode pausar e continuar)</option>
                  <option value="all_at_once">De uma vez (tudo obrigatório ao salvar)</option>
                </select>
              </div>
            </div>
          </div>
          {Array.from({ length: rows }, (_, i) => {
            const q = qs[i];
            return (
              <div key={i} className="card" style={{ marginBottom: 10 }}>
                <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <strong style={{ width: 24, paddingTop: 8 }}>{i + 1}.</strong>
                  <div style={{ flex: 1 }}>
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <input name={`prompt_${i}`} defaultValue={q?.prompt ?? ""} placeholder={q ? "" : "Nova pergunta (deixe vazio para não incluir)"} aria-label={`Pergunta ${i + 1}`} style={{ flex: 3 }} />
                      <select name={`type_${i}`} defaultValue={q?.type ?? "single"} aria-label={`Tipo da pergunta ${i + 1}`} style={{ width: 170 }}>
                        {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="row" style={{ marginTop: 8, alignItems: "flex-start", flexWrap: "nowrap" }}>
                      <textarea
                        name={`options_${i}`}
                        defaultValue={((q?.options as string[] | undefined) ?? []).join("\n")}
                        placeholder={"Opções, uma por linha (escolha única ou várias)\nEx.: Sim\nNão"}
                        aria-label={`Opções da pergunta ${i + 1}`}
                        style={{ flex: 3, minHeight: 60 }}
                      />
                      <div style={{ width: 170 }}>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="checkbox" name={`required_${i}`} defaultChecked={q?.required ?? false} style={{ width: "auto" }} /> Obrigatória
                        </label>
                        <select name={`comment_${i}`} defaultValue={q?.comment_required === "always" ? "always" : "never"} aria-label="Comentário" style={{ marginTop: 6 }}>
                          <option value="never">Comentário opcional</option>
                          <option value="always">Comentário obrigatório</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {!list.locked ? (
            <button className="btn btn-primary">Salvar checklist</button>
          ) : null}
        </fieldset>
      </form>
      {!list.locked ? (
        <p className="muted">Para mais perguntas, salve: aparecem mais 3 linhas vazias. Fotos/arquivos: até 10 por pergunta, 5 MB cada.</p>
      ) : null}
    </Shell>
  );
}
