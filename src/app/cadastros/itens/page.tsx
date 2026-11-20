import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { formatBRL, parseBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { decodeCsv, parseCsv, planCatalogImport } from "@/lib/catalog-import";

function back(key: "error" | "ok", msg: string, tipo?: string): never {
  redirect(`/cadastros/itens?${tipo ? `tipo=${tipo}&` : ""}${key}=${encodeURIComponent(msg)}`);
}

async function save(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const kind = form.get("kind") === "product" ? "product" : "service";
  const name = String(form.get("name") ?? "").trim();
  const unit = String(form.get("unit") ?? "").trim() || "un";
  const code = String(form.get("code") ?? "").trim().slice(0, 40) || null;
  const price = parseBRL(String(form.get("price") ?? "") || "0");
  if (!name) back("error", "Informe o nome.", kind);
  if (price === null || price < 0) back("error", "Preço inválido. Use, por exemplo, 150,00.", kind);
  const row = { org_id: orgId, kind, code, name, unit, price_cents: price, updated_at: new Date().toISOString() };
  const { error } = id
    ? await sb.from("catalog_items").update(row).eq("id", id).eq("org_id", orgId)
    : await sb.from("catalog_items").insert(row);
  if (error) back("error", error.code === "23505" ? `Já existe um ${kind === "service" ? "serviço" : "produto"} com esse nome ou código.` : "Não foi possível salvar.", kind);
  back("ok", id ? "Item atualizado." : "Item cadastrado.", kind);
}

async function importCsv(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const kind = form.get("kind") === "product" ? "product" : "service";
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back("error", "Escolha o arquivo CSV.", kind);
  if (file.size > 1024 * 1024) back("error", "Arquivo maior que 1 MB. Divida a planilha em partes.", kind);
  if (/\.xlsx?$/i.test(file.name)) back("error", "Esse arquivo é do Excel (.xlsx). No Excel, use Arquivo → Salvar como → CSV (separado por vírgulas) e importe o .csv.", kind);

  const plan = planCatalogImport(parseCsv(decodeCsv(new Uint8Array(await file.arrayBuffer()))), kind);
  const problems = plan.errors.length
    ? ` ${plan.errors.length} linha(s) ignorada(s): ${plan.errors.slice(0, 5).join(" ")}${plan.errors.length > 5 ? " …" : ""}`
    : "";
  if (!plan.items.length) back("error", `Nada para importar.${problems}`, kind);

  const { data: existing, error: readError } = await sb.from("catalog_items").select("id, kind, code, name").eq("org_id", orgId).limit(20000);
  if (readError) back("error", "Não foi possível ler o cadastro atual.", kind);
  const byName = new Map((existing ?? []).map((e) => [`${e.kind}|${String(e.name).toLowerCase()}`, e.id as string]));
  const byCode = new Map((existing ?? []).filter((e) => e.code).map((e) => [`${e.kind}|${String(e.code).toLowerCase()}`, e.id as string]));
  // Same code = same item (the name may have changed); otherwise same name.
  const match = (i: (typeof plan.items)[number]) =>
    (i.code ? byCode.get(`${i.kind}|${i.code.toLowerCase()}`) : undefined) ?? byName.get(`${i.kind}|${i.name.toLowerCase()}`);
  const now = new Date().toISOString();

  const inserts = plan.items
    .filter((i) => !match(i))
    .map((i) => ({ org_id: orgId, kind: i.kind, code: i.code, name: i.name, unit: i.unit ?? "un", price_cents: i.price_cents ?? 0, updated_at: now }));
  const updates = plan.items
    .map((i) => ({ i, id: match(i) }))
    .filter((u): u is { i: (typeof plan.items)[number]; id: string } => !!u.id);

  let failed = 0;
  for (let k = 0; k < inserts.length; k += 500) {
    const chunk = inserts.slice(k, k + 500);
    const { error } = await sb.from("catalog_items").insert(chunk);
    if (error) {
      // One bad row fails the whole batch: retry one by one so only that row is lost.
      for (const row of chunk) if ((await sb.from("catalog_items").insert(row)).error) failed++;
    }
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
  const done = `Importação concluída: ${inserts.length} novo(s), ${updates.length} atualizado(s).`;
  const fail = failed ? ` ${failed} item(ns) não foram salvos; tente importar de novo.` : "";
  back(failed ? "error" : "ok", done + fail + problems, kind);
}

async function toggle(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const active = form.get("active") === "true";
  await sb.from("catalog_items").update({ active: !active }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", active ? "Item desativado: não aparece mais nas novas OS." : "Item reativado.", String(form.get("kind")));
}

async function stockEntry(form: FormData) {
  "use server";
  const { sb, orgId, user } = await requireOrg();
  const qty = Number(String(form.get("qty") ?? "").replace(",", "."));
  const reason = form.get("reason") === "adjust" ? "adjust" : "purchase";
  if (!qty || !Number.isFinite(qty)) back("error", "Informe a quantidade (use negativo para retirar no ajuste).", "product");
  if (reason === "purchase" && qty < 0) back("error", "Entrada de compra deve ser positiva.", "product");
  const { error } = await sb.from("stock_movements").insert({
    org_id: orgId,
    catalog_item_id: String(form.get("id")),
    quantity: qty,
    reason,
    notes: String(form.get("notes") ?? "").trim() || null,
    created_by: user.id,
  });
  if (error) back("error", "Não foi possível lançar no estoque.", "product");
  back("ok", "Estoque atualizado.", "product");
}

async function toggleStock(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const on = form.get("track") === "true";
  await sb.from("catalog_items").update({ track_stock: !on }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", on ? "Controle de estoque desligado para este produto." : "Controle de estoque ligado.", "product");
}

async function saveAdjustments(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const labels: Record<string, string> = { external: "Externo", internal: "Interno", warranty: "Garantia" };
  for (const att of Object.keys(labels)) {
    const pct = Number(String(form.get(att) ?? "0").replace(",", ".") || 0);
    if (!Number.isFinite(pct) || pct < -100 || pct > 500) back("error", "Ajuste entre -100% e 500%.", String(form.get("kind")));
    const { error } = await sb
      .from("price_lists")
      .upsert({ org_id: orgId, name: `Atendimento ${labels[att]}`, attendance_type: att, adjust_pct: pct, updated_at: new Date().toISOString() }, { onConflict: "org_id,attendance_type" });
    if (error) back("error", "Não foi possível salvar os ajustes.", String(form.get("kind")));
  }
  back("ok", "Ajustes de preço por atendimento salvos.", String(form.get("kind")));
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ tipo?: string; q?: string; error?: string; ok?: string }> }) {
  const { tipo, q, error, ok } = await searchParams;
  const kind = tipo === "product" ? "product" : "service";
  const { sb, orgId, orgName } = await requireOrg();
  let query = sb.from("catalog_items").select("id, kind, code, name, unit, price_cents, active, track_stock, stock_qty").eq("org_id", orgId).eq("kind", kind).order("active", { ascending: false }).order("name");
  if (q) {
    const term = q.replace(/[%,()]/g, " ").trim();
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  }
  const [{ data: items }, { data: priceLists }] = await Promise.all([
    query.limit(500),
    sb.from("price_lists").select("attendance_type, adjust_pct").eq("org_id", orgId).not("attendance_type", "is", null),
  ]);
  const adj = Object.fromEntries((priceLists ?? []).map((p) => [p.attendance_type as string, Number(p.adjust_pct)]));

  return (
    <Shell orgName={orgName}>
      <h1>Serviços e produtos</h1>
      <Notice error={error} ok={ok} />
      <div className="row" style={{ marginBottom: 16 }}>
        <a className={`btn ${kind === "service" ? "btn-primary" : "btn-secondary"}`} href="/cadastros/itens?tipo=service">
          Serviços
        </a>
        <a className={`btn ${kind === "product" ? "btn-primary" : "btn-secondary"}`} href="/cadastros/itens?tipo=product">
          Produtos
        </a>
        <form className="row" style={{ marginLeft: "auto" }}>
          <input type="hidden" name="tipo" value={kind} />
          <input name="q" placeholder="Buscar pelo nome ou código" defaultValue={q} style={{ width: 220 }} />
          <button className="btn btn-secondary">Buscar</button>
        </form>
      </div>

      <form action={save} className="card" style={{ marginBottom: 16 }}>
        <input type="hidden" name="kind" value={kind} />
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
          <div className="field" style={{ width: 110, marginBottom: 0 }}>
            <label htmlFor="new_code">Código</label>
            <input id="new_code" name="code" />
          </div>
          <div className="field" style={{ flex: 3, marginBottom: 0 }}>
            <label htmlFor="new_name">Novo {kind === "service" ? "serviço" : "produto"}</label>
            <input id="new_name" name="name" placeholder={kind === "service" ? "Ex.: Troca de tela" : "Ex.: Tela 15 polegadas"} required />
          </div>
          <div className="field" style={{ width: 90, marginBottom: 0 }}>
            <label htmlFor="new_unit">Unidade</label>
            <input id="new_unit" name="unit" defaultValue={kind === "service" ? "un" : "un"} />
          </div>
          <div className="field" style={{ width: 150, marginBottom: 0 }}>
            <label htmlFor="new_price">Preço (R$)</label>
            <input id="new_price" name="price" inputMode="decimal" placeholder="150,00" />
          </div>
          <button className="btn btn-primary">Cadastrar</button>
        </div>
      </form>

      <details className="card" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Importar planilha (CSV)</summary>
        <form action={importCsv} style={{ marginTop: 12 }}>
          <input type="hidden" name="kind" value={kind} />
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            Colunas, em qualquer ordem: <strong>Código</strong>, <strong>Tipo</strong> (Serviço ou Produto), <strong>Nome</strong> (ou Produto/Descrição),{" "}
            <strong>Unidade</strong> e <strong>Preço</strong> (ou Valor de Venda). Só o nome é obrigatório. Sem a coluna Tipo, entra tudo como{" "}
            {kind === "service" ? "serviço" : "produto"} (se a coluna do nome se chamar Produto, entra como produto). Item já cadastrado com o mesmo código ou
            nome é atualizado; célula vazia mantém o que já está. No Excel, salve como <em>CSV (separado por vírgulas)</em>; no Google Planilhas, <em>Arquivo → Fazer download → CSV</em>.{" "}
            <a href="/cadastros/itens/modelo">Baixar planilha modelo</a>
          </p>
          <div className="row" style={{ alignItems: "center" }}>
            <input type="file" name="file" accept=".csv,text/csv" required style={{ width: "auto" }} />
            <button className="btn btn-primary">Importar</button>
          </div>
        </form>
      </details>

      {(items ?? []).length === 0 ? (
        <div className="card empty">Nenhum {kind === "service" ? "serviço" : "produto"} cadastrado ainda.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Unidade</th>
              <th className="num">Preço</th>
              {kind === "product" ? <th className="num">Estoque</th> : null}
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((it) => (
              <tr key={it.id} style={it.active ? undefined : { opacity: 0.55 }}>
                <td colSpan={3} style={{ padding: 0 }}>
                  <details>
                    <summary style={{ display: "grid", gridTemplateColumns: "1fr 90px 140px", padding: "10px 12px", cursor: "pointer" }}>
                      <span>
                        {it.code ? <span className="muted" style={{ marginRight: 8 }}>{it.code}</span> : null}
                        {it.name}
                      </span>
                      <span>{it.unit}</span>
                      <span style={{ textAlign: "right" }}>{formatBRL(it.price_cents)}</span>
                    </summary>
                    <form action={save} className="row" style={{ padding: "0 12px 12px", flexWrap: "nowrap" }}>
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="kind" value={it.kind} />
                      <input name="code" defaultValue={it.code ?? ""} aria-label="Código" placeholder="Código" style={{ width: 100 }} />
                      <input name="name" defaultValue={it.name} aria-label="Nome" style={{ flex: 3 }} required />
                      <input name="unit" defaultValue={it.unit} aria-label="Unidade" style={{ width: 80 }} />
                      <input name="price" defaultValue={(it.price_cents / 100).toFixed(2).replace(".", ",")} aria-label="Preço" inputMode="decimal" style={{ width: 120 }} />
                      <button className="btn btn-secondary">Salvar</button>
                    </form>
                  </details>
                </td>
                {kind === "product" ? (
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {it.track_stock ? (
                      <details>
                        <summary style={{ cursor: "pointer", color: Number(it.stock_qty) <= 0 ? "var(--bad)" : undefined }}>
                          {Number(it.stock_qty).toLocaleString("pt-BR")} {it.unit}
                        </summary>
                        <form action={stockEntry} className="card" style={{ position: "absolute", zIndex: 5, width: 300, textAlign: "left" }}>
                          <input type="hidden" name="id" value={it.id} />
                          <div className="field">
                            <label>Quantidade</label>
                            <input name="qty" inputMode="decimal" placeholder="Ex.: 10" required />
                          </div>
                          <div className="field">
                            <label>Tipo</label>
                            <select name="reason" defaultValue="purchase">
                              <option value="purchase">Entrada (compra)</option>
                              <option value="adjust">Ajuste (use negativo para retirar)</option>
                            </select>
                          </div>
                          <div className="field">
                            <label>Observação</label>
                            <input name="notes" />
                          </div>
                          <button className="btn btn-primary">Lançar</button>
                        </form>
                      </details>
                    ) : (
                      <span className="muted">—</span>
                    )}
                    <form action={toggleStock}>
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="track" value={String(it.track_stock)} />
                      <button className="btn btn-secondary" style={{ padding: "1px 6px", fontSize: 11 }}>
                        {it.track_stock ? "Desligar controle" : "Controlar estoque"}
                      </button>
                    </form>
                  </td>
                ) : null}
                <td>{it.active ? <span className="pill pill-paid">Ativo</span> : <span className="pill pill-neutral">Inativo</span>}</td>
                <td>
                  <form action={toggle}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="kind" value={it.kind} />
                    <input type="hidden" name="active" value={String(it.active)} />
                    <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                      {it.active ? "Desativar" : "Reativar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form action={saveAdjustments} className="card" style={{ marginTop: 16 }}>
        <input type="hidden" name="kind" value={kind} />
        <strong>Lista de preço por tipo de atendimento</strong>
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          Ajusta o preço do catálogo ao escolher o item na OS. Ex.: Interno −20, Garantia 30 (em %). Deixe 0 para usar o preço normal.
        </p>
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
          {[
            ["external", "Externo"],
            ["internal", "Interno"],
            ["warranty", "Garantia"],
          ].map(([k, label]) => (
            <div key={k} className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`adj_${k}`}>{label} (%)</label>
              <input id={`adj_${k}`} name={k} inputMode="decimal" defaultValue={String(adj[k] ?? 0).replace(".", ",")} />
            </div>
          ))}
          <button className="btn btn-secondary">Salvar ajustes</button>
        </div>
      </form>
      <p className="muted" style={{ marginTop: 12 }}>
        Clique no nome para editar. Na OS, ao digitar o nome de um item cadastrado, o preço é preenchido sozinho.
      </p>
    </Shell>
  );
}
