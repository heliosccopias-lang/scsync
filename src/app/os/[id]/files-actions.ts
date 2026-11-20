"use server";

import type { UploadedFile } from "@/components/Uploader";
import { requireOrg } from "@/lib/session";

const MAX = 5 * 1024 * 1024;

/** Records files the browser already put in Storage, after checking they sit in this org's folder for this owner. */
async function record(ownerType: "service_order" | "checklist_answer", ownerId: string, files: UploadedFile[]) {
  const { sb, orgId } = await requireOrg();
  const prefix = `${orgId}/${ownerType}/${ownerId}/`;
  const ok = files.filter((f) => typeof f.path === "string" && f.path.startsWith(prefix) && !f.path.includes("..") && f.size > 0 && f.size <= MAX);
  if (ok.length !== files.length) return { error: "Arquivo fora da pasta permitida." as string, ids: [] as string[] };
  const { data, error } = await sb
    .from("attachments")
    .insert(ok.map((f) => ({ org_id: orgId, owner_type: ownerType, owner_id: ownerId, storage_path: f.path, file_name: f.name.slice(0, 200), size_bytes: f.size })))
    .select("id");
  if (error) return { error: "Não foi possível registrar os arquivos.", ids: [] };
  return { ids: (data ?? []).map((d) => d.id as string) };
}

export async function registerOsFiles(files: UploadedFile[], extra: Record<string, string>) {
  const { sb, orgId } = await requireOrg();
  const { data: own } = await sb.from("service_orders").select("id").eq("id", extra.os_id).eq("org_id", orgId).maybeSingle();
  if (!own) return { error: "OS não encontrada." };
  const r = await record("service_order", extra.os_id, files);
  return r.error ? { error: r.error } : {};
}

/** Photos for an "upload" checklist question: recorded and appended to that answer. */
export async function registerChecklistFiles(files: UploadedFile[], extra: Record<string, string>) {
  const { sb, orgId, user } = await requireOrg();
  const { run_id: runId, question_id: questionId } = extra;
  const { data: run } = await sb.from("checklist_runs").select("id, status").eq("id", runId).eq("org_id", orgId).maybeSingle();
  if (!run) return { error: "Checklist não encontrado." };
  if (run.status === "done") return { error: "Checklist finalizado: reabra para anexar." };
  const { data: prev } = await sb.from("checklist_answers").select("value").eq("run_id", runId).eq("question_id", questionId).maybeSingle();
  const prevIds: string[] = (prev?.value as { attachment_ids?: string[] } | null)?.attachment_ids ?? [];
  if (prevIds.length + files.length > 10) return { error: "No máximo 10 arquivos nesta pergunta." };
  const r = await record("checklist_answer", runId, files);
  if (r.error) return { error: r.error };
  const { error } = await sb.from("checklist_answers").upsert(
    {
      run_id: runId,
      question_id: questionId,
      org_id: orgId,
      value: { attachment_ids: [...prevIds, ...r.ids] },
      answered_by: user.id,
      answered_at: new Date().toISOString(),
    },
    { onConflict: "run_id,question_id" },
  );
  if (error) return { error: "Não foi possível guardar na resposta." };
  if (run.status === "not_started") await sb.from("checklist_runs").update({ status: "in_progress" }).eq("id", runId);
  return {};
}
