import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { Uploader } from "@/components/Uploader";
import { listAttachments } from "@/lib/attachments";
import { registerChecklistFiles } from "../../files-actions";
import { isAnswered, readAnswer, type AnswerValue, type Question } from "@/lib/checklist";
import { requireOrg } from "@/lib/session";

const STATUS: Record<string, [string, string]> = {
  not_started: ["Não iniciado", "pill-neutral"],
  in_progress: ["Iniciado, com pendências", "pill-partial"],
  done: ["Finalizado", "pill-paid"],
};

async function save(form: FormData) {
  "use server";
  const osId = String(form.get("os_id"));
  const runId = String(form.get("run_id"));
  const finish = form.get("intent") === "finish";
  const back = (key: "error" | "ok", msg: string): never => redirect(`/os/${osId}/checklist/${runId}?${key}=${encodeURIComponent(msg)}`);
  const { sb, orgId, user } = await requireOrg();

  const { data: run } = await sb.from("checklist_runs").select("id, checklist_id, status, checklists(mode)").eq("id", runId).eq("org_id", orgId).maybeSingle();
  if (!run) back("error", "Checklist não encontrado.");
  const mode = (run.checklists as unknown as { mode: string } | null)?.mode ?? "by_steps";
  const { data: qrows } = await sb.from("checklist_questions").select("*").eq("checklist_id", run.checklist_id).order("position");
  const questions = (qrows ?? []) as Question[];
  const { data: prev } = await sb.from("checklist_answers").select("question_id, value").eq("run_id", runId);
  const answers = new Map<string, AnswerValue>((prev ?? []).map((a) => [a.question_id, a.value as AnswerValue]));

  const upserts: { run_id: string; question_id: string; org_id: string; value: AnswerValue; comment: string | null; answered_by: string; answered_at: string }[] = [];
  for (const q of questions) {
    const comment = String(form.get(`q_${q.id}_comment`) ?? "").trim() || null;
    let value: AnswerValue | null = readAnswer(q, form);
    if (q.type === "upload") {
      // photos are sent by the uploader as they are picked; keep what is there
      const prevIds = answers.get(q.id)?.attachment_ids ?? [];
      value = prevIds.length ? { attachment_ids: prevIds } : null;
    }
    if (value) {
      if (q.comment_required === "always" && !comment && finish) back("error", `"${q.prompt}": o comentário é obrigatório.`);
      answers.set(q.id, value);
      upserts.push({ run_id: runId, question_id: q.id, org_id: orgId, value, comment, answered_by: user.id, answered_at: new Date().toISOString() });
    }
  }

  const missing = questions.filter((q) => q.required && !isAnswered(q, answers.get(q.id)));
  if ((finish || mode === "all_at_once") && missing.length) {
    back("error", `Faltam respostas obrigatórias: ${missing.map((q) => `"${q.prompt}"`).join(", ")}.`);
  }
  if (upserts.length) {
    const { error } = await sb.from("checklist_answers").upsert(upserts, { onConflict: "run_id,question_id" });
    if (error) back("error", "Não foi possível salvar as respostas.");
  }
  const status = finish || mode === "all_at_once" ? "done" : answers.size ? "in_progress" : "not_started";
  await sb.from("checklist_runs").update({ status, updated_at: new Date().toISOString() }).eq("id", runId).eq("org_id", orgId);
  if (status === "done") redirect(`/os/${osId}?ok=${encodeURIComponent("Checklist finalizado.")}`);
  back("ok", "Respostas salvas. Você pode continuar depois.");
}

async function reopen(form: FormData) {
  "use server";
  const osId = String(form.get("os_id"));
  const runId = String(form.get("run_id"));
  const { sb, orgId } = await requireOrg();
  await sb.from("checklist_runs").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", runId).eq("org_id", orgId);
  redirect(`/os/${osId}/checklist/${runId}`);
}

export default async function FillChecklist({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; runId: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id, runId } = await params;
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const { data: run } = await sb
    .from("checklist_runs")
    .select("id, status, service_order_id, checklist_id, checklists(name, mode), service_orders(number)")
    .eq("id", runId)
    .eq("org_id", orgId)
    .eq("service_order_id", id)
    .maybeSingle();
  if (!run) notFound();
  const checklist = run.checklists as unknown as { name: string; mode: string };
  const osNumber = (run.service_orders as unknown as { number: number }).number;
  const [{ data: qrows }, { data: arows }] = await Promise.all([
    sb.from("checklist_questions").select("*").eq("checklist_id", run.checklist_id).order("position"),
    sb.from("checklist_answers").select("question_id, value, comment").eq("run_id", runId),
  ]);
  const questions = (qrows ?? []) as Question[];
  const answers = new Map((arows ?? []).map((a) => [a.question_id, a as { value: AnswerValue; comment: string | null }]));
  const files = await listAttachments(sb, orgId, "checklist_answer", [runId]);
  const fileById = new Map(files.map((f) => [f.id, f]));
  const done = run.status === "done";
  const [label, cls] = STATUS[run.status] ?? STATUS.not_started;

  return (
    <Shell orgName={orgName}>
      <Link href={`/os/${id}`} className="muted">
        ← OS #{osNumber}
      </Link>
      <div className="spread" style={{ marginTop: 6 }}>
        <h1 style={{ margin: 0 }}>
          {checklist.name} <span className={`pill ${cls}`}>{label}</span>
        </h1>
        <div className="row">
          <Link className="btn btn-secondary" href={`/os/${id}/checklist/${runId}/imprimir`}>
            Gerar PDF em branco
          </Link>
          {done ? (
            <form action={reopen}>
              <input type="hidden" name="os_id" value={id} />
              <input type="hidden" name="run_id" value={runId} />
              <button className="btn btn-secondary">Reabrir para editar</button>
            </form>
          ) : null}
        </div>
      </div>
      <Notice error={error} ok={ok} />

      <form action={save}>
        <input type="hidden" name="os_id" value={id} />
        <input type="hidden" name="run_id" value={runId} />
        <fieldset disabled={done} style={{ border: 0, padding: 0, margin: 0 }}>
          {questions.map((q, i) => {
            const a = answers.get(q.id);
            const v = a?.value;
            return (
              <div key={q.id} className="card" style={{ marginBottom: 10 }}>
                <strong>
                  {i + 1}. {q.prompt}
                  {q.required ? <span style={{ color: "var(--bad)" }}> *</span> : null}
                </strong>
                <div style={{ margin: "8px 0" }}>
                  {q.type === "single"
                    ? q.options.map((o) => (
                        <label key={o} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15, color: "var(--ink)" }}>
                          <input type="radio" name={`q_${q.id}`} value={o} defaultChecked={v?.choice === o} style={{ width: "auto" }} /> {o}
                        </label>
                      ))
                    : null}
                  {q.type === "multi"
                    ? q.options.map((o) => (
                        <label key={o} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15, color: "var(--ink)" }}>
                          <input type="checkbox" name={`q_${q.id}`} value={o} defaultChecked={v?.choices?.includes(o)} style={{ width: "auto" }} /> {o}
                        </label>
                      ))
                    : null}
                  {q.type === "rating" ? (
                    <div className="row">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <label key={n} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 15, color: "var(--ink)" }}>
                          <input type="radio" name={`q_${q.id}`} value={n} defaultChecked={v?.rating === n} style={{ width: "auto" }} /> {"★".repeat(n)}
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {q.type === "upload" ? (
                    <>
                      <div className="row" style={{ marginBottom: 6 }}>
                        {(v?.attachment_ids ?? []).map((fid) => {
                          const f = fileById.get(fid);
                          if (!f) return null;
                          return f.isImage && f.url ? (
                            <a key={fid} href={f.url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={f.url} alt={f.file_name} width={96} height={96} style={{ objectFit: "cover", borderRadius: 6 }} />
                            </a>
                          ) : (
                            <a key={fid} href={f.url ?? "#"} target="_blank" rel="noreferrer">
                              {f.file_name}
                            </a>
                          );
                        })}
                      </div>
                      {!done ? (
                        <Uploader
                          orgId={orgId}
                          folder={`checklist_answer/${runId}`}
                          register={registerChecklistFiles}
                          extra={{ run_id: runId, question_id: q.id }}
                          label="Enviar fotos"
                          capture
                        />
                      ) : null}
                    </>
                  ) : null}
                </div>
                <input
                  name={`q_${q.id}_comment`}
                  defaultValue={a?.comment ?? ""}
                  placeholder={q.comment_required === "always" ? "Comentário (obrigatório)" : "Comentário (opcional)"}
                  aria-label={`Comentário da pergunta ${i + 1}`}
                />
              </div>
            );
          })}
          {!done ? (
            <div className="row">
              {checklist.mode === "by_steps" ? (
                <button className="btn btn-secondary" name="intent" value="save">
                  Salvar e continuar depois
                </button>
              ) : null}
              <button className="btn btn-primary" name="intent" value="finish">
                Finalizar checklist
              </button>
            </div>
          ) : null}
        </fieldset>
      </form>
    </Shell>
  );
}
