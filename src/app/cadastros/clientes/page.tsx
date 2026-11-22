import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { isValidCpfCnpj, onlyDigits } from "@/lib/br";
import { fmtDoc } from "@/lib/format";
import { requireOrg } from "@/lib/session";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/cadastros/clientes?${key}=${encodeURIComponent(msg)}`);
}

async function save(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const doc = onlyDigits(String(form.get("cpf_cnpj") ?? ""));
  if (!name) back("error", "Informe o nome do cliente.");
  if (doc && !isValidCpfCnpj(doc)) back("error", "CPF/CNPJ inválido. Confira os números.");
  const row = {
    org_id: orgId,
    name,
    cpf_cnpj: doc || null,
    phone: String(form.get("phone") ?? "").trim() || null,
    email: String(form.get("email") ?? "").trim() || null,
    // Address for the NFS-e (tomador): Asaas completes street and city from the CEP.
    address: {
      cep: onlyDigits(String(form.get("cep") ?? "")).slice(0, 8) || undefined,
      number: String(form.get("addr_number") ?? "").trim().slice(0, 20) || undefined,
      complement: String(form.get("addr_complement") ?? "").trim().slice(0, 60) || undefined,
    },
    updated_at: new Date().toISOString(),
  };
  const cep = (row.address.cep ?? "") as string;
  if (cep && cep.length !== 8) back("error", "CEP inválido: use 8 números.");
  const { error } = id ? await sb.from("customers").update(row).eq("id", id).eq("org_id", orgId) : await sb.from("customers").insert(row);
  if (error) back("error", error.code === "23505" ? "Já existe um cliente com este CPF/CNPJ." : "Não foi possível salvar.");
  back("ok", id ? "Cliente atualizado." : "Cliente cadastrado.");
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; ok?: string }> }) {
  const { q, error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  let query = sb.from("customers").select("id, name, cpf_cnpj, phone, email, address").eq("org_id", orgId).order("name").limit(300);
  if (q) query = /^\d+$/.test(onlyDigits(q)) && onlyDigits(q).length >= 3 ? query.ilike("cpf_cnpj", `%${onlyDigits(q)}%`) : query.ilike("name", `%${q}%`);
  const { data: customers } = await query;

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Clientes</h1>
        <form className="row">
          <input name="q" placeholder="Nome ou CPF/CNPJ" defaultValue={q} style={{ width: 240 }} />
          <button className="btn btn-secondary">Buscar</button>
        </form>
      </div>
      <Notice error={error} ok={ok} />
      <details className="card" style={{ marginBottom: 16 }}>
        <summary className="btn btn-primary" style={{ display: "inline-flex" }}>
          Novo cliente
        </summary>
        <form action={save} style={{ marginTop: 12 }}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="n_name">Nome</label>
              <input id="n_name" name="name" required />
            </div>
            <div className="field">
              <label htmlFor="n_doc">CPF/CNPJ</label>
              <input id="n_doc" name="cpf_cnpj" inputMode="numeric" />
            </div>
            <div className="field">
              <label htmlFor="n_phone">Celular com DDD</label>
              <input id="n_phone" name="phone" inputMode="tel" />
            </div>
            <div className="field">
              <label htmlFor="n_email">E-mail</label>
              <input id="n_email" name="email" type="email" />
            </div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="n_cep">CEP</label>
                <input id="n_cep" name="cep" inputMode="numeric" />
              </div>
              <div className="field" style={{ width: 90 }}>
                <label htmlFor="n_num">Número</label>
                <input id="n_num" name="addr_number" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="n_comp">Complemento</label>
                <input id="n_comp" name="addr_complement" />
              </div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>CEP e número são pedidos pela prefeitura na nota fiscal.</p>
          <button className="btn btn-primary">Salvar cliente</button>
        </form>
      </details>
      {(customers ?? []).length === 0 ? (
        <div className="card empty">Nenhum cliente encontrado.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>CPF/CNPJ</th>
              <th>Celular</th>
              <th>E-mail</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(customers ?? []).map((c) => (
              <tr key={c.id}>
                <td colSpan={4} style={{ padding: 0 }}>
                  <details>
                    <summary style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 1.5fr", padding: "10px 12px", cursor: "pointer", gap: 8 }}>
                      <span>{c.name}</span>
                      <span>{c.cpf_cnpj ? fmtDoc(c.cpf_cnpj) : <span className="pill pill-overdue">sem CPF</span>}</span>
                      <span>{c.phone ?? "—"}</span>
                      <span>{c.email ?? "—"}</span>
                    </summary>
                    <form action={save} className="row" style={{ padding: "0 12px 12px", flexWrap: "nowrap" }}>
                      <input type="hidden" name="id" value={c.id} />
                      <input name="name" defaultValue={c.name} aria-label="Nome" style={{ flex: 2 }} required />
                      <input name="cpf_cnpj" defaultValue={c.cpf_cnpj ?? ""} aria-label="CPF/CNPJ" style={{ flex: 1.2 }} />
                      <input name="phone" defaultValue={c.phone ?? ""} aria-label="Celular" style={{ flex: 1 }} />
                      <input name="email" defaultValue={c.email ?? ""} aria-label="E-mail" style={{ flex: 1.5 }} />
                      <input name="cep" defaultValue={(c.address as { cep?: string })?.cep ?? ""} aria-label="CEP" placeholder="CEP" style={{ width: 100 }} />
                      <input name="addr_number" defaultValue={(c.address as { number?: string })?.number ?? ""} aria-label="Número" placeholder="Nº" style={{ width: 60 }} />
                      <input name="addr_complement" defaultValue={(c.address as { complement?: string })?.complement ?? ""} aria-label="Complemento" placeholder="Compl." style={{ width: 90 }} />
                      <button className="btn btn-secondary">Salvar</button>
                    </form>
                  </details>
                </td>
                <td>
                  <Link href={`/os?cliente=${c.id}`}>Ver OS</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
