import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { METHOD_LABEL } from "@/lib/format";
import { requireOrg } from "@/lib/session";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/configuracoes/financeiro?${key}=${encodeURIComponent(msg)}`);
}

function pct(v: FormDataEntryValue | null) {
  const n = Number(String(v ?? "0").replace(",", ".") || 0);
  return Number.isFinite(n) ? n : NaN;
}

async function saveFees(form: FormData) {
  "use server";
  const { sb, orgId, role } = await requireOrg();
  if (!["owner", "admin"].includes(role)) back("error", "Só o administrador altera juros e multa.");
  const fine = pct(form.get("fine_pct"));
  const interest = pct(form.get("interest_month_pct"));
  if (!(fine >= 0 && fine <= 2)) back("error", "Multa entre 0% e 2% (limite do Código de Defesa do Consumidor).");
  if (!(interest >= 0 && interest <= 10)) back("error", "Juros ao mês entre 0% e 10%.");
  const { error } = await sb.from("orgs").update({ fine_pct: fine, interest_month_pct: interest, updated_at: new Date().toISOString() }).eq("id", orgId);
  if (error) back("error", "Não foi possível salvar.");
  back("ok", "Juros e multa salvos: valem para as próximas cobranças geradas no Asaas.");
}

async function saveCategory(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const name = String(form.get("name") ?? "").trim();
  const direction = form.get("direction") === "out" ? "out" : "in";
  if (!name) back("error", "Informe o nome da categoria.");
  const { error } = await sb.from("financial_categories").insert({ org_id: orgId, name, direction });
  if (error) back("error", "Não foi possível criar a categoria.");
  back("ok", "Categoria criada.");
}

async function renameCategory(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const name = String(form.get("name") ?? "").trim();
  if (!name) back("error", "Informe o nome.");
  await sb.from("financial_categories").update({ name }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", "Categoria atualizada.");
}

async function saveCostCenter(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!name) back("error", "Informe o nome do centro de custo.");
  const { error } = id
    ? await sb.from("cost_centers").update({ name, active: form.get("active") !== "false" }).eq("id", id).eq("org_id", orgId)
    : await sb.from("cost_centers").insert({ org_id: orgId, name });
  if (error) back("error", "Não foi possível salvar.");
  back("ok", id ? "Centro de custo atualizado." : "Centro de custo criado.");
}

async function saveCondition(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const days = String(form.get("days") ?? "")
    .split(/[\s,;/]+/)
    .filter(Boolean)
    .map(Number);
  const method = String(form.get("method") ?? "pix");
  if (!name) back("error", "Informe o nome da condição, por exemplo \"30/60/90\".");
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 720) || days.length > 48) {
    back("error", "Dias inválidos. Use números separados por vírgula, por exemplo 0 ou 30,60,90.");
  }
  if (!METHOD_LABEL[method]) back("error", "Forma de pagamento inválida.");
  const sorted = [...days].sort((a, b) => a - b);
  const row = { org_id: orgId, name, installment_days: sorted, default_method: method };
  const { error } = id ? await sb.from("payment_conditions").update(row).eq("id", id).eq("org_id", orgId) : await sb.from("payment_conditions").insert(row);
  if (error) back("error", "Não foi possível salvar a condição.");
  back("ok", id ? "Condição atualizada." : "Condição criada.");
}

async function deleteCondition(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  await sb.from("payment_conditions").delete().eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", "Condição removida.");
}

export default async function FinanceSettings({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const [{ data: org }, { data: cats }, { data: centers }, { data: conds }] = await Promise.all([
    sb.from("orgs").select("fine_pct, interest_month_pct").eq("id", orgId).single(),
    sb.from("financial_categories").select("id, name, direction").eq("org_id", orgId).order("direction").order("name"),
    sb.from("cost_centers").select("id, name, active").eq("org_id", orgId).order("name"),
    sb.from("payment_conditions").select("id, name, installment_days, default_method").eq("org_id", orgId).order("name"),
  ]);

  return (
    <Shell orgName={orgName}>
      <h1>Configurações financeiras</h1>
      <Notice error={error} ok={ok} />

      <div className="grid2">
        <form action={saveFees} className="card">
          <strong>Juros e multa por atraso</strong>
          <p className="muted" style={{ margin: "4px 0 10px" }}>
            Aplicados pelo Asaas nas cobranças vencidas (Pix e boleto). Multa máxima de 2% para consumidor.
          </p>
          <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="fine">Multa (%)</label>
              <input id="fine" name="fine_pct" inputMode="decimal" defaultValue={String(org?.fine_pct ?? 0).replace(".", ",")} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="interest">Juros ao mês (%)</label>
              <input id="interest" name="interest_month_pct" inputMode="decimal" defaultValue={String(org?.interest_month_pct ?? 0).replace(".", ",")} />
            </div>
            <button className="btn btn-primary">Salvar</button>
          </div>
        </form>

        <div className="card">
          <strong>Condições de pagamento</strong>
          <p className="muted" style={{ margin: "4px 0 10px" }}>
            Escolha na OS para gerar as parcelas sozinho. Dias contados da data da OS: 0 = à vista; 30,60,90 = três parcelas.
          </p>
          {(conds ?? []).map((c) => (
            <form key={c.id} action={saveCondition} className="row" style={{ flexWrap: "nowrap", marginBottom: 6 }}>
              <input type="hidden" name="id" value={c.id} />
              <input name="name" defaultValue={c.name} aria-label="Nome" style={{ flex: 2 }} />
              <input name="days" defaultValue={(c.installment_days as number[]).join(",")} aria-label="Dias" style={{ flex: 2 }} />
              <select name="method" defaultValue={c.default_method} aria-label="Forma" style={{ flex: 2 }}>
                {Object.entries(METHOD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary">Salvar</button>
              <button className="btn btn-secondary" formAction={deleteCondition}>
                Remover
              </button>
            </form>
          ))}
          <form action={saveCondition} className="row" style={{ flexWrap: "nowrap", marginTop: 8 }}>
            <input name="name" placeholder="Ex.: 30/60/90" aria-label="Nome da nova condição" style={{ flex: 2 }} />
            <input name="days" placeholder="30,60,90" aria-label="Dias" style={{ flex: 2 }} />
            <select name="method" defaultValue="pix" aria-label="Forma" style={{ flex: 2 }}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button className="btn btn-primary">Criar</button>
          </form>
        </div>

        <div className="card">
          <strong>Categorias financeiras</strong>
          {(["in", "out"] as const).map((dir) => (
            <div key={dir} style={{ marginTop: 10 }}>
              <div className="muted" style={{ fontSize: 13 }}>{dir === "in" ? "Receitas" : "Despesas"}</div>
              {(cats ?? [])
                .filter((c) => c.direction === dir)
                .map((c) => (
                  <form key={c.id} action={renameCategory} className="row" style={{ flexWrap: "nowrap", marginTop: 4 }}>
                    <input type="hidden" name="id" value={c.id} />
                    <input name="name" defaultValue={c.name} aria-label="Categoria" />
                    <button className="btn btn-secondary">Salvar</button>
                  </form>
                ))}
              <form action={saveCategory} className="row" style={{ flexWrap: "nowrap", marginTop: 4 }}>
                <input type="hidden" name="direction" value={dir} />
                <input name="name" placeholder={dir === "in" ? "Nova categoria de receita" : "Nova categoria de despesa"} aria-label="Nova categoria" />
                <button className="btn btn-primary">Criar</button>
              </form>
            </div>
          ))}
        </div>

        <div className="card">
          <strong>Centros de custo</strong>
          <p className="muted" style={{ margin: "4px 0 10px" }}>
            Opcional: separe despesas e receitas por área (ex.: Oficina, Loja, Administrativo).
          </p>
          {(centers ?? []).map((c) => (
            <form key={c.id} action={saveCostCenter} className="row" style={{ flexWrap: "nowrap", marginBottom: 6 }}>
              <input type="hidden" name="id" value={c.id} />
              <input name="name" defaultValue={c.name} aria-label="Centro de custo" />
              <select name="active" defaultValue={String(c.active)} aria-label="Situação" style={{ width: 110 }}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
              <button className="btn btn-secondary">Salvar</button>
            </form>
          ))}
          <form action={saveCostCenter} className="row" style={{ flexWrap: "nowrap" }}>
            <input name="name" placeholder="Novo centro de custo" aria-label="Novo centro de custo" />
            <button className="btn btn-primary">Criar</button>
          </form>
        </div>
      </div>
    </Shell>
  );
}
