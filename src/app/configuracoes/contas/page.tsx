import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { formatBRL, parseBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/configuracoes/contas?${key}=${encodeURIComponent(msg)}`);
}

async function save(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const kind = form.get("kind") === "cash" ? "cash" : "bank";
  const opening = parseBRL(String(form.get("opening") ?? "") || "0");
  if (!name) back("error", "Dê um nome à conta, por exemplo \"Banco do Brasil\".");
  if (opening === null) back("error", "Saldo inicial inválido.");
  const row = {
    org_id: orgId,
    name,
    bank_code: String(form.get("bank_code") ?? "").trim() || null,
    agency: String(form.get("agency") ?? "").trim() || null,
    account_number: String(form.get("account_number") ?? "").trim() || null,
    opening_balance_cents: opening,
    updated_at: new Date().toISOString(),
  };
  const { error } = id
    ? await sb.from("bank_accounts").update(row).eq("id", id).eq("org_id", orgId)
    : await sb.from("bank_accounts").insert({ ...row, kind });
  if (error) back("error", "Não foi possível salvar a conta.");
  back("ok", id ? "Conta atualizada." : "Conta cadastrada.");
}

const KIND: Record<string, string> = { asaas: "Asaas", bank: "Banco", cash: "Caixa (dinheiro)" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const { data: accounts } = await sb.from("bank_accounts").select("*").eq("org_id", orgId).order("created_at");

  return (
    <Shell orgName={orgName}>
      <h1>Contas bancárias e caixa</h1>
      <Notice error={error} ok={ok} />
      <p className="muted" style={{ marginTop: 0 }}>
        Cadastre cada conta de onde você vai importar extrato para a conciliação. A conta Asaas já vem criada.
      </p>
      <details className="card" style={{ marginBottom: 16 }}>
        <summary className="btn btn-primary" style={{ display: "inline-flex" }}>
          Nova conta
        </summary>
        <form action={save} style={{ marginTop: 12 }}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="a_name">Nome</label>
              <input id="a_name" name="name" placeholder="Ex.: Itaú PJ" required />
            </div>
            <div className="field">
              <label htmlFor="a_kind">Tipo</label>
              <select id="a_kind" name="kind" defaultValue="bank">
                <option value="bank">Conta bancária</option>
                <option value="cash">Caixa (dinheiro)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="a_bank">Código do banco</label>
              <input id="a_bank" name="bank_code" placeholder="Ex.: 341" />
            </div>
            <div className="field">
              <label htmlFor="a_agency">Agência</label>
              <input id="a_agency" name="agency" />
            </div>
            <div className="field">
              <label htmlFor="a_number">Conta</label>
              <input id="a_number" name="account_number" />
            </div>
            <div className="field">
              <label htmlFor="a_open">Saldo inicial (R$)</label>
              <input id="a_open" name="opening" inputMode="decimal" placeholder="0,00" />
            </div>
          </div>
          <button className="btn btn-primary">Salvar conta</button>
        </form>
      </details>
      <table>
        <thead>
          <tr>
            <th>Conta</th>
            <th>Tipo</th>
            <th>Banco / agência / conta</th>
            <th className="num">Saldo inicial</th>
          </tr>
        </thead>
        <tbody>
          {(accounts ?? []).map((a) => (
            <tr key={a.id}>
              <td colSpan={4} style={{ padding: 0 }}>
                <details>
                  <summary style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.5fr 1fr", padding: "10px 12px", cursor: "pointer" }}>
                    <span>{a.name}</span>
                    <span>{KIND[a.kind] ?? a.kind}</span>
                    <span>{[a.bank_code, a.agency, a.account_number].filter(Boolean).join(" / ") || "—"}</span>
                    <span style={{ textAlign: "right" }}>{formatBRL(a.opening_balance_cents)}</span>
                  </summary>
                  <form action={save} className="row" style={{ padding: "0 12px 12px", flexWrap: "nowrap" }}>
                    <input type="hidden" name="id" value={a.id} />
                    <input name="name" defaultValue={a.name} aria-label="Nome" style={{ flex: 2 }} required />
                    <input name="bank_code" defaultValue={a.bank_code ?? ""} aria-label="Banco" style={{ width: 70 }} />
                    <input name="agency" defaultValue={a.agency ?? ""} aria-label="Agência" style={{ width: 90 }} />
                    <input name="account_number" defaultValue={a.account_number ?? ""} aria-label="Conta" style={{ width: 120 }} />
                    <input name="opening" defaultValue={(a.opening_balance_cents / 100).toFixed(2).replace(".", ",")} aria-label="Saldo inicial" style={{ width: 110 }} />
                    <button className="btn btn-secondary">Salvar</button>
                  </form>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}
