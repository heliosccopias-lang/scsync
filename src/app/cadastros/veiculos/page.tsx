import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { normalizePlate } from "@/lib/br";
import { requireOrg } from "@/lib/session";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/cadastros/veiculos?${key}=${encodeURIComponent(msg)}`);
}

async function save(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const plate = normalizePlate(String(form.get("plate") ?? ""));
  const customer = String(form.get("customer_id") ?? "");
  const km = String(form.get("km") ?? "").replace(/\D/g, "");
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)) back("error", "Placa inválida. Use o padrão ABC1234 ou ABC1D23.");
  if (!id && !customer) back("error", "Escolha o cliente dono do veículo.");
  const row = { org_id: orgId, plate, model: String(form.get("model") ?? "").trim() || null, km: km ? Number(km) : null, updated_at: new Date().toISOString() };
  const { error } = id
    ? await sb.from("vehicles").update(row).eq("id", id).eq("org_id", orgId)
    : await sb.from("vehicles").insert({ ...row, customer_id: customer });
  if (error) back("error", error.code === "23505" ? "Essa placa já está cadastrada." : "Não foi possível salvar.");
  back("ok", id ? "Veículo atualizado." : "Veículo cadastrado.");
}

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; ok?: string }> }) {
  const { q, error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  let query = sb.from("vehicles").select("id, plate, model, km, customers(id, name)").eq("org_id", orgId).order("plate").limit(500);
  if (q) query = query.ilike("plate", `%${normalizePlate(q)}%`);
  const [{ data: vehicles }, { data: customers }] = await Promise.all([
    query,
    sb.from("customers").select("id, name").eq("org_id", orgId).order("name").limit(1000),
  ]);

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Veículos</h1>
        <form className="row">
          <input name="q" placeholder="Placa" defaultValue={q} style={{ width: 160 }} />
          <button className="btn btn-secondary">Buscar</button>
        </form>
      </div>
      <Notice error={error} ok={ok} />
      <p className="muted" style={{ marginTop: 0 }}>Para oficinas: a OS busca o veículo pela placa e registra o KM de entrada.</p>
      <form action={save} className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
          <div className="field" style={{ width: 130, marginBottom: 0 }}>
            <label htmlFor="v_plate">Placa</label>
            <input id="v_plate" name="plate" placeholder="ABC1D23" required />
          </div>
          <div className="field" style={{ flex: 2, marginBottom: 0 }}>
            <label htmlFor="v_model">Modelo</label>
            <input id="v_model" name="model" placeholder="Ex.: Gol 1.0 2015" />
          </div>
          <div className="field" style={{ width: 120, marginBottom: 0 }}>
            <label htmlFor="v_km">KM</label>
            <input id="v_km" name="km" inputMode="numeric" />
          </div>
          <div className="field" style={{ flex: 2, marginBottom: 0 }}>
            <label htmlFor="v_customer">Cliente</label>
            <select id="v_customer" name="customer_id" defaultValue="" required>
              <option value="" disabled>
                Escolha…
              </option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary">Cadastrar</button>
        </div>
      </form>
      {(vehicles ?? []).length === 0 ? (
        <div className="card empty">Nenhum veículo cadastrado.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Placa / modelo / KM</th>
              <th>Cliente</th>
            </tr>
          </thead>
          <tbody>
            {(vehicles ?? []).map((v) => {
              const c = v.customers as unknown as { id: string; name: string } | null;
              return (
                <tr key={v.id}>
                  <td>
                    <form action={save} className="row" style={{ flexWrap: "nowrap" }}>
                      <input type="hidden" name="id" value={v.id} />
                      <input name="plate" defaultValue={v.plate} aria-label="Placa" style={{ width: 110 }} />
                      <input name="model" defaultValue={v.model ?? ""} aria-label="Modelo" style={{ flex: 1 }} />
                      <input name="km" defaultValue={v.km ?? ""} aria-label="KM" style={{ width: 100 }} />
                      <button className="btn btn-secondary">Salvar</button>
                    </form>
                  </td>
                  <td>{c ? <Link href={`/os?cliente=${c.id}`}>{c.name}</Link> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
