import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { formatBRL, parseBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

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
  const price = parseBRL(String(form.get("price") ?? "") || "0");
  if (!name) back("error", "Informe o nome.", kind);
  if (price === null || price < 0) back("error", "Preço inválido. Use, por exemplo, 150,00.", kind);
  const row = { org_id: orgId, kind, name, unit, price_cents: price, updated_at: new Date().toISOString() };
  const { error } = id
    ? await sb.from("catalog_items").update(row).eq("id", id).eq("org_id", orgId)
    : await sb.from("catalog_items").insert(row);
  if (error) back("error", error.code === "23505" ? `Já existe um ${kind === "service" ? "serviço" : "produto"} com esse nome.` : "Não foi possível salvar.", kind);
  back("ok", id ? "Item atualizado." : "Item cadastrado.", kind);
}

async function toggle(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const active = form.get("active") === "true";
  await sb.from("catalog_items").update({ active: !active }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", active ? "Item desativado: não aparece mais nas novas OS." : "Item reativado.", String(form.get("kind")));
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ tipo?: string; q?: string; error?: string; ok?: string }> }) {
  const { tipo, q, error, ok } = await searchParams;
  const kind = tipo === "product" ? "product" : "service";
  const { sb, orgId, orgName } = await requireOrg();
  let query = sb.from("catalog_items").select("id, kind, name, unit, price_cents, active").eq("org_id", orgId).eq("kind", kind).order("active", { ascending: false }).order("name");
  if (q) query = query.ilike("name", `%${q}%`);
  const { data: items } = await query.limit(500);

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
          <input name="q" placeholder="Buscar pelo nome" defaultValue={q} style={{ width: 220 }} />
          <button className="btn btn-secondary">Buscar</button>
        </form>
      </div>

      <form action={save} className="card" style={{ marginBottom: 16 }}>
        <input type="hidden" name="kind" value={kind} />
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
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

      {(items ?? []).length === 0 ? (
        <div className="card empty">Nenhum {kind === "service" ? "serviço" : "produto"} cadastrado ainda.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Unidade</th>
              <th className="num">Preço</th>
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
                      <span>{it.name}</span>
                      <span>{it.unit}</span>
                      <span style={{ textAlign: "right" }}>{formatBRL(it.price_cents)}</span>
                    </summary>
                    <form action={save} className="row" style={{ padding: "0 12px 12px", flexWrap: "nowrap" }}>
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="kind" value={it.kind} />
                      <input name="name" defaultValue={it.name} aria-label="Nome" style={{ flex: 3 }} required />
                      <input name="unit" defaultValue={it.unit} aria-label="Unidade" style={{ width: 80 }} />
                      <input name="price" defaultValue={(it.price_cents / 100).toFixed(2).replace(".", ",")} aria-label="Preço" inputMode="decimal" style={{ width: 120 }} />
                      <button className="btn btn-secondary">Salvar</button>
                    </form>
                  </details>
                </td>
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
      <p className="muted" style={{ marginTop: 12 }}>
        Clique no nome para editar. Na OS, ao digitar o nome de um item cadastrado, o preço é preenchido sozinho.
      </p>
    </Shell>
  );
}
