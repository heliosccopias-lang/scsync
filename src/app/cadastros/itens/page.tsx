import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { formatBRL, parseBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import type { ImportItem } from "@/lib/catalog-import";
import { catalogMatcher } from "@/lib/catalog-import-db";
import { importCsv } from "./import-actions";
import { ImportPreview } from "./ImportPreview";

function back(key: "error" | "ok", msg: string, tipo?: string): never {
  redirect(`/cadastros/itens?${tipo ? `tipo=${tipo}&` : ""}${key}=${encodeURIComponent(msg)}`);
}

async function save(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("catalog.edit")) back("error", "Seu perfil não altera o cadastro de itens.");
  const { sb, orgId } = ctx;
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

async function toggle(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("catalog.edit")) back("error", "Seu perfil não altera o cadastro de itens.");
  const { sb, orgId } = ctx;
  const active = form.get("active") === "true";
  await sb.from("catalog_items").update({ active: !active }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", active ? "Item desativado: não aparece mais nas novas OS." : "Item reativado.", String(form.get("kind")));
}

async function stockEntry(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("catalog.edit")) back("error", "Seu perfil não altera o estoque.");
  const { sb, orgId, user } = ctx;
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
  const ctx = await requireOrg();
  if (!ctx.can("catalog.edit")) back("error", "Seu perfil não altera o cadastro de itens.");
  const { sb, orgId } = ctx;
  const on = form.get("track") === "true";
  await sb.from("catalog_items").update({ track_stock: !on }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", on ? "Controle de estoque desligado para este produto." : "Controle de estoque ligado.", "product");
}

async function saveAdjustments(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("catalog.edit")) back("error", "Seu perfil não altera o cadastro de itens.");
  const { sb, orgId } = ctx;
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

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ tipo?: string; q?: string; error?: string; ok?: string; importacao?: string }> }) {
  const { tipo, q, error, ok, importacao } = await searchParams;
  const kind = tipo === "product" ? "product" : "service";
  const { sb, orgId, orgName, can, module: hasModule, account } = await requireOrg();
  const canEdit = can("catalog.edit");
  const canPrice = can("prices.view");
  const stockOn = hasModule("stock");
  const { data: acc } = await sb.from("accounts").select("share_catalog").eq("id", account.id).maybeSingle();
  const shared = Boolean(acc?.share_catalog);
  let query = sb.from("catalog_items").select("id, kind, code, name, unit, price_cents, active, track_stock, stock_qty").eq("org_id", orgId).eq("kind", kind).order("active", { ascending: false }).order("name");
  if (q) {
    const term = q.replace(/[%,()]/g, " ").trim();
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  }
  const [{ data: items }, { data: priceLists }] = await Promise.all([
    query.limit(500),
    sb.from("price_lists").select("attendance_type, adjust_pct").eq("org_id", orgId).not("attendance_type", "is", null),
  ]);
  const { data: draft } = importacao
    ? await sb.from("catalog_imports").select("id, kind, file_name, items, errors, total").eq("id", importacao).eq("org_id", orgId).maybeSingle()
    : { data: null };
  const match = draft ? await catalogMatcher(sb, orgId) : null;
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

      {kind === "product" && shared ? (
        <p className="notice" style={{ background: "var(--orange-soft)", color: "var(--ink)" }}>
          Produtos compartilhados entre as empresas da conta: nome, código, preço e situação mudam em todas; o estoque é de cada CNPJ.
        </p>
      ) : null}
      {canEdit ? (
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
      ) : null}

      {draft && match && canEdit ? (
        <ImportPreview
          draft={{ ...draft, items: draft.items as ImportItem[], errors: draft.errors as string[] }}
          match={match}
        />
      ) : null}

      {canEdit ? (
      <details className="card" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Importar planilha (CSV)</summary>
        <form action={importCsv} style={{ marginTop: 12 }}>
          <input type="hidden" name="kind" value={kind} />
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            Colunas, em qualquer ordem: <strong>Código</strong>, <strong>Tipo</strong> (Serviço ou Produto), <strong>Nome</strong> (ou Produto/Descrição),{" "}
            <strong>Unidade</strong> e <strong>Preço</strong> (ou Valor de Venda). Só o nome é obrigatório. Sem a coluna Tipo, entra tudo como{" "}
            {kind === "service" ? "serviço" : "produto"} (a aba aberta agora). Item já cadastrado com o mesmo código ou
            nome é atualizado; célula vazia mantém o que já está. Antes de gravar, o sistema mostra a planilha para você conferir e escolher <strong>Salvar planilha</strong> ou <strong>Deletar planilha</strong>. No Excel, salve como <em>CSV (separado por vírgulas)</em>; no Google Planilhas, <em>Arquivo → Fazer download → CSV</em>.{" "}
            <a href="/cadastros/itens/modelo">Baixar planilha modelo</a>
          </p>
          <div className="row" style={{ alignItems: "center" }}>
            <input type="file" name="file" accept=".csv,text/csv" required style={{ width: "auto" }} />
            <button className="btn btn-primary">Ler planilha</button>
          </div>
        </form>
      </details>
      ) : null}

      {(items ?? []).length === 0 ? (
        <div className="card empty">Nenhum {kind === "service" ? "serviço" : "produto"} cadastrado ainda.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Unidade</th>
              <th className="num">{canPrice ? "Preço" : ""}</th>
              {kind === "product" && stockOn ? <th className="num">Estoque</th> : null}
              <th>Situação</th>
              {canEdit ? <th></th> : null}
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
                      <span style={{ textAlign: "right" }}>{canPrice ? formatBRL(it.price_cents) : ""}</span>
                    </summary>
                    {canEdit ? (
                    <form action={save} className="row" style={{ padding: "0 12px 12px", flexWrap: "nowrap" }}>
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="kind" value={it.kind} />
                      <input name="code" defaultValue={it.code ?? ""} aria-label="Código" placeholder="Código" style={{ width: 100 }} />
                      <input name="name" defaultValue={it.name} aria-label="Nome" style={{ flex: 3 }} required />
                      <input name="unit" defaultValue={it.unit} aria-label="Unidade" style={{ width: 80 }} />
                      <input name="price" defaultValue={(it.price_cents / 100).toFixed(2).replace(".", ",")} aria-label="Preço" inputMode="decimal" style={{ width: 120 }} />
                      <button className="btn btn-secondary">Salvar</button>
                    </form>
                    ) : null}
                  </details>
                </td>
                {kind === "product" && stockOn ? (
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {it.track_stock && !canEdit ? (
                      <span>{Number(it.stock_qty).toLocaleString("pt-BR")} {it.unit}</span>
                    ) : it.track_stock ? (
                      <details className="popover">
                        <summary style={{ cursor: "pointer", color: Number(it.stock_qty) <= 0 ? "var(--bad)" : undefined }}>
                          {Number(it.stock_qty).toLocaleString("pt-BR")} {it.unit}
                        </summary>
                        <form action={stockEntry} className="card popover-panel" style={{ position: "absolute", zIndex: 5, width: 300, textAlign: "left" }}>
                          <button type="button" className="popover-close" data-close aria-label="Fechar">✕</button>
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
                    {canEdit ? (
                    <form action={toggleStock}>
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="track" value={String(it.track_stock)} />
                      <button className="btn btn-secondary" style={{ padding: "1px 6px", fontSize: 11 }}>
                        {it.track_stock ? "Desligar controle" : "Controlar estoque"}
                      </button>
                    </form>
                    ) : null}
                  </td>
                ) : null}
                <td>{it.active ? <span className="pill pill-paid">Ativo</span> : <span className="pill pill-neutral">Inativo</span>}</td>
                {canEdit ? (
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
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit ? (
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
      ) : null}
      <p className="muted" style={{ marginTop: 12 }}>
        {canEdit ? "Clique no nome para editar. " : ""}Na OS, ao digitar o nome de um item cadastrado, o preço é preenchido sozinho.
      </p>
    </Shell>
  );
}
