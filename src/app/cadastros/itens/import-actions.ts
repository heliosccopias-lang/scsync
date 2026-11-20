"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { decodeCsv, parseCsv, planCatalogImport, type ImportItem } from "@/lib/catalog-import";
import { applyCatalogImport } from "@/lib/catalog-import-db";

function back(kind: string, key: "error" | "ok", msg: string, importId?: string): never {
  redirect(`/cadastros/itens?tipo=${kind}${importId ? `&importacao=${importId}` : ""}&${key}=${encodeURIComponent(msg)}`);
}

/** Step 1: read the file and keep it as a draft; nothing goes into the catalog yet. */
export async function importCsv(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const kind = form.get("kind") === "product" ? "product" : "service";
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back(kind, "error", "Escolha o arquivo CSV.");
  if (file.size > 1024 * 1024) back(kind, "error", "Arquivo maior que 1 MB. Divida a planilha em partes.");
  if (/\.xlsx?$/i.test(file.name)) back(kind, "error", "Esse arquivo é do Excel (.xlsx). No Excel, use Arquivo → Salvar como → CSV (separado por vírgulas) e importe o .csv.");

  const plan = planCatalogImport(parseCsv(decodeCsv(new Uint8Array(await file.arrayBuffer()))), kind);
  if (!plan.items.length) back(kind, "error", `Nada para importar. ${plan.errors.slice(0, 5).join(" ")}`);

  // Drafts nobody saved or deleted are dropped after a day.
  await sb.from("catalog_imports").delete().eq("org_id", orgId).lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  const { data, error } = await sb
    .from("catalog_imports")
    .insert({ org_id: orgId, kind, file_name: file.name.slice(0, 200), items: plan.items, errors: plan.errors, total: plan.total })
    .select("id")
    .single();
  if (error || !data) back(kind, "error", "Não foi possível ler a planilha. Tente de novo.");
  back(kind, "ok", "Confira a planilha abaixo e clique em Salvar planilha ou Deletar planilha.", data.id);
}

/** Step 2a: save the draft into the catalog. */
export async function saveImport(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const kind = form.get("kind") === "product" ? "product" : "service";
  const { data: draft } = await sb.from("catalog_imports").select("id, items").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (!draft) back(kind, "error", "Essa planilha já foi salva ou deletada.");
  const result = await applyCatalogImport(sb, orgId, draft.items as ImportItem[]);
  if (!result) back(kind, "error", "Não foi possível ler o cadastro atual. Tente de novo.", id);
  await sb.from("catalog_imports").delete().eq("id", id).eq("org_id", orgId);
  const msg = `Planilha salva: ${result.inserted} novo(s), ${result.updated} atualizado(s).`;
  if (result.failed) back(kind, "error", `${msg} ${result.failed} item(ns) não foram salvos; confira e importe de novo.`);
  back(kind, "ok", msg);
}

/** Step 2b: throw the draft away; the catalog is untouched. */
export async function discardImport(form: FormData) {
  const { sb, orgId } = await requireOrg();
  const kind = form.get("kind") === "product" ? "product" : "service";
  await sb.from("catalog_imports").delete().eq("id", String(form.get("id") ?? "")).eq("org_id", orgId);
  back(kind, "ok", "Planilha deletada. Nada foi gravado no cadastro.");
}
