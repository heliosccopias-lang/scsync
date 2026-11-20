import "server-only";
import type { requireOrg } from "@/lib/session";
import type { ImportItem } from "@/lib/catalog-import";

type Sb = Awaited<ReturnType<typeof requireOrg>>["sb"];
export type Existing = { id: string; kind: string; code: string | null; name: string; unit: string; price_cents: number; active: boolean };

/** Reads the org's catalog and returns a matcher: same code = same item (name may have changed); otherwise same name. */
export async function catalogMatcher(sb: Sb, orgId: string) {
  const { data, error } = await sb.from("catalog_items").select("id, kind, code, name, unit, price_cents, active").eq("org_id", orgId).limit(20000);
  if (error) return null;
  const rows = (data ?? []) as Existing[];
  const byName = new Map(rows.map((e) => [`${e.kind}|${e.name.toLowerCase()}`, e]));
  const byCode = new Map(rows.filter((e) => e.code).map((e) => [`${e.kind}|${String(e.code).toLowerCase()}`, e]));
  return (i: ImportItem): Existing | undefined =>
    (i.code ? byCode.get(`${i.kind}|${i.code.toLowerCase()}`) : undefined) ?? byName.get(`${i.kind}|${i.name.toLowerCase()}`);
}

/** Saves the items: inserts the new ones, updates the matched ones. Returns counts. */
export async function applyCatalogImport(sb: Sb, orgId: string, items: ImportItem[]) {
  const match = await catalogMatcher(sb, orgId);
  if (!match) return null;
  const now = new Date().toISOString();
  const inserts = items
    .filter((i) => !match(i))
    .map((i) => ({ org_id: orgId, kind: i.kind, code: i.code, name: i.name, unit: i.unit ?? "un", price_cents: i.price_cents ?? 0, updated_at: now }));
  const updates = items.map((i) => ({ i, id: match(i)?.id })).filter((u): u is { i: ImportItem; id: string } => !!u.id);

  let failed = 0;
  for (let k = 0; k < inserts.length; k += 500) {
    const chunk = inserts.slice(k, k + 500);
    const { error } = await sb.from("catalog_items").insert(chunk);
    // One bad row fails the whole batch: retry one by one so only that row is lost.
    if (error) for (const row of chunk) if ((await sb.from("catalog_items").insert(row)).error) failed++;
  }
  for (let k = 0; k < updates.length; k += 25) {
    const results = await Promise.all(
      updates.slice(k, k + 25).map(({ i, id }) =>
        sb
          .from("catalog_items")
          .update({
            active: true,
            updated_at: now,
            name: i.name,
            ...(i.code !== null ? { code: i.code } : {}),
            ...(i.unit !== null ? { unit: i.unit } : {}),
            ...(i.price_cents !== null ? { price_cents: i.price_cents } : {}),
          })
          .eq("id", id)
          .eq("org_id", orgId),
      ),
    );
    failed += results.filter((r) => r.error).length;
  }
  return { inserted: inserts.length, updated: updates.length, failed };
}
