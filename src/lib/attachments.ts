import "server-only";

type UserClient = Awaited<ReturnType<typeof import("./supabase").supabaseUser>>;

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;

function safeName(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(-80) || "arquivo"
  );
}

/** Uploads files to the private bucket under <org>/<owner_type>/<owner_id>/ and records them. Returns ids, or an error. */
export async function uploadAttachments(
  sb: UserClient,
  orgId: string,
  ownerType: "service_order" | "checklist_answer",
  ownerId: string,
  files: File[],
): Promise<{ ids: string[] } | { error: string }> {
  const real = files.filter((f) => f instanceof File && f.size > 0);
  if (real.length === 0) return { ids: [] };
  if (real.length > MAX_FILES_PER_UPLOAD) return { error: `Envie no máximo ${MAX_FILES_PER_UPLOAD} arquivos por vez.` };
  const big = real.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return { error: `"${big.name}" passa de 5 MB.` };

  const ids: string[] = [];
  for (const f of real) {
    const path = `${orgId}/${ownerType}/${ownerId}/${crypto.randomUUID()}-${safeName(f.name)}`;
    const { error: upErr } = await sb.storage.from("attachments").upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
    if (upErr) return { error: `Falha ao enviar "${f.name}".` };
    const { data, error } = await sb
      .from("attachments")
      .insert({ org_id: orgId, owner_type: ownerType, owner_id: ownerId, storage_path: path, file_name: f.name.slice(0, 200), size_bytes: f.size })
      .select("id")
      .single();
    if (error || !data) {
      await sb.storage.from("attachments").remove([path]);
      return { error: `Falha ao registrar "${f.name}".` };
    }
    ids.push(data.id);
  }
  return { ids };
}

export type AttachmentView = { id: string; owner_id: string; file_name: string; size_bytes: number; url: string | null; isImage: boolean; created_at: string };

export async function listAttachments(sb: UserClient, orgId: string, ownerType: string, ownerIds: string[]): Promise<AttachmentView[]> {
  if (ownerIds.length === 0) return [];
  const { data } = await sb
    .from("attachments")
    .select("id, owner_id, storage_path, file_name, size_bytes, created_at")
    .eq("org_id", orgId)
    .eq("owner_type", ownerType)
    .in("owner_id", ownerIds)
    .order("created_at");
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: signed } = await sb.storage.from("attachments").createSignedUrls(
    rows.map((r) => r.storage_path),
    60 * 60,
  );
  const urlBy = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    owner_id: r.owner_id,
    file_name: r.file_name,
    size_bytes: r.size_bytes,
    created_at: r.created_at,
    url: urlBy.get(r.storage_path) ?? null,
    isImage: /\.(png|jpe?g|gif|webp|heic)$/i.test(r.file_name),
  }));
}

export async function deleteAttachment(sb: UserClient, orgId: string, id: string) {
  const { data } = await sb.from("attachments").select("storage_path").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (!data) return false;
  await sb.storage.from("attachments").remove([data.storage_path]);
  const { error } = await sb.from("attachments").delete().eq("id", id).eq("org_id", orgId);
  return !error;
}

export function fmtSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
