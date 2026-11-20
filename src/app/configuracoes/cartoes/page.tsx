import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { PluggyError, pluggyApiKey, pluggyCreditAccounts } from "@/lib/pluggy";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/configuracoes/cartoes?${key}=${encodeURIComponent(msg)}`);
}

const day = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};

async function saveCard(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const last4 = String(form.get("last4") ?? "").replace(/\D/g, "");
  if (!name) back("error", "Dê um nome ao cartão, por exemplo \"Itaú empresa\".");
  if (last4 && last4.length !== 4) back("error", "Final do cartão: informe os 4 últimos dígitos.");
  const row = {
    org_id: orgId,
    name,
    last4: last4 || null,
    aliases: String(form.get("aliases") ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a.length >= 3)
      .slice(0, 10),
    closing_day: day(form.get("closing_day")),
    due_day: day(form.get("due_day")),
    bank_account_id: String(form.get("bank_account_id") ?? "") || null,
    category_id: String(form.get("category_id") ?? "") || null,
    pluggy_item_id: String(form.get("pluggy_item_id") ?? "").trim() || null,
    pluggy_account_id: String(form.get("pluggy_account_id") ?? "").trim() || null,
  };
  const { error } = id ? await sb.from("credit_cards").update(row).eq("id", id).eq("org_id", orgId) : await sb.from("credit_cards").insert(row);
  if (error) back("error", "Não foi possível salvar o cartão.");
  back("ok", id ? "Cartão atualizado." : "Cartão cadastrado.");
}

async function toggleCard(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const active = form.get("active") === "true";
  await sb.from("credit_cards").update({ active: !active }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", active ? "Cartão desativado." : "Cartão reativado.");
}

async function savePluggy(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const clientId = String(form.get("client_id") ?? "").trim();
  const secret = String(form.get("client_secret") ?? "").trim();
  if (!clientId || !secret) back("error", "Informe o Client ID e o Client Secret do Pluggy.");
  try {
    await pluggyApiKey(clientId, secret);
  } catch (e) {
    back("error", e instanceof PluggyError && e.status < 500 ? "O Pluggy recusou essas credenciais. Confira o Client ID e o Client Secret." : "Não foi possível falar com o Pluggy agora.");
  }
  const { error } = await sb.from("orgs").update({ pluggy_client_id: clientId, pluggy_secret_encrypted: encryptSecret(secret) }).eq("id", orgId);
  if (error) back("error", "Não foi possível salvar.");
  back("ok", "Pluggy conectado.");
}

/** Finds the credit card account inside a Pluggy item (the bank connection) and stores its id on the card. */
async function findPluggyAccount(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const id = String(form.get("id") ?? "");
  const { data: org } = await sb.from("orgs").select("pluggy_client_id, pluggy_secret_encrypted").eq("id", orgId).single();
  const { data: card } = await sb.from("credit_cards").select("pluggy_item_id, last4").eq("id", id).eq("org_id", orgId).single();
  if (!org?.pluggy_client_id || !org.pluggy_secret_encrypted) back("error", "Conecte o Pluggy primeiro (quadro abaixo).");
  if (!card?.pluggy_item_id) back("error", "Informe o Item ID do Pluggy no cartão e salve antes.");
  try {
    const key = await pluggyApiKey(org.pluggy_client_id, decryptSecret(org.pluggy_secret_encrypted));
    const accounts = await pluggyCreditAccounts(key, card.pluggy_item_id);
    if (!accounts.length) back("error", "Nenhum cartão de crédito nessa conexão do Pluggy.");
    const pick = accounts.find((a) => card.last4 && (a.number ?? "").endsWith(card.last4)) ?? accounts[0];
    await sb.from("credit_cards").update({ pluggy_account_id: pick.id }).eq("id", id).eq("org_id", orgId);
    back("ok", `Cartão ligado ao Pluggy: ${pick.marketingName ?? pick.name}${pick.number ? ` (${pick.number})` : ""}.`);
  } catch (e) {
    if (e instanceof PluggyError) back("error", `O Pluggy respondeu: ${e.message}`);
    throw e;
  }
}

export default async function CardsSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const [{ data: cards }, { data: accounts }, { data: cats }, { data: org }] = await Promise.all([
    sb.from("credit_cards").select("*").eq("org_id", orgId).order("active", { ascending: false }).order("name"),
    sb.from("bank_accounts").select("id, name").eq("org_id", orgId).eq("active", true).order("created_at"),
    sb.from("financial_categories").select("id, name").eq("org_id", orgId).eq("direction", "out").order("name"),
    sb.from("orgs").select("pluggy_client_id").eq("id", orgId).single(),
  ]);

  const cardFields = (c?: Record<string, unknown>) => (
    <>
      <div className="grid2">
        <div className="field">
          <label>Nome do cartão</label>
          <input name="name" defaultValue={(c?.name as string) ?? ""} placeholder="Ex.: Itaú empresa" required />
        </div>
        <div className="field">
          <label>4 últimos dígitos</label>
          <input name="last4" defaultValue={(c?.last4 as string) ?? ""} inputMode="numeric" maxLength={4} placeholder="1234" />
        </div>
        <div className="field">
          <label>Apelidos para o robô (separados por vírgula)</label>
          <input name="aliases" defaultValue={((c?.aliases as string[]) ?? []).join(", ")} placeholder="itau, cartão azul" />
        </div>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Dia do fechamento</label>
            <input name="closing_day" defaultValue={(c?.closing_day as number) ?? ""} inputMode="numeric" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Dia do vencimento</label>
            <input name="due_day" defaultValue={(c?.due_day as number) ?? ""} inputMode="numeric" />
          </div>
        </div>
        <div className="field">
          <label>Fatura é paga pela conta</label>
          <select name="bank_account_id" defaultValue={(c?.bank_account_id as string) ?? ""}>
            <option value="">—</option>
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Categoria da fatura em Contas a pagar</label>
          <select name="category_id" defaultValue={(c?.category_id as string) ?? ""}>
            <option value="">—</option>
            {(cats ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Pluggy — Item ID (conexão do banco)</label>
          <input name="pluggy_item_id" defaultValue={(c?.pluggy_item_id as string) ?? ""} placeholder="opcional" />
        </div>
        <div className="field">
          <label>Pluggy — Account ID do cartão</label>
          <input name="pluggy_account_id" defaultValue={(c?.pluggy_account_id as string) ?? ""} placeholder="preenchido pelo botão Buscar no Pluggy" />
        </div>
      </div>
    </>
  );

  return (
    <Shell orgName={orgName}>
      <h1>Cartões de crédito</h1>
      <Notice error={error} ok={ok} />

      {(cards ?? []).map((c) => (
        <details key={c.id} className="card" style={{ marginBottom: 10, opacity: c.active ? 1 : 0.6 }}>
          <summary style={{ cursor: "pointer" }}>
            <strong>{c.name}</strong> {c.last4 ? <span className="muted">•••• {c.last4}</span> : null}
            {c.closing_day ? <span className="muted"> · fecha dia {c.closing_day}</span> : null}
            {c.due_day ? <span className="muted"> · vence dia {c.due_day}</span> : null}
            {c.pluggy_account_id ? <span className="muted"> · Pluggy ligado</span> : null}
            {!c.active ? <span className="muted"> · desativado</span> : null}
          </summary>
          <form action={saveCard} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={c.id} />
            {cardFields(c)}
            <div className="row">
              <button className="btn btn-primary">Salvar</button>
            </div>
          </form>
          <div className="row" style={{ marginTop: 8 }}>
            {c.pluggy_item_id ? (
              <form action={findPluggyAccount}>
                <input type="hidden" name="id" value={c.id} />
                <button className="btn btn-secondary">Buscar cartão no Pluggy</button>
              </form>
            ) : null}
            <form action={toggleCard}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="active" value={String(c.active)} />
              <button className="btn btn-secondary">{c.active ? "Desativar" : "Reativar"}</button>
            </form>
          </div>
        </details>
      ))}

      <form action={saveCard} className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Novo cartão</h2>
        {cardFields()}
        <button className="btn btn-primary">Cadastrar cartão</button>
      </form>

      <form action={savePluggy} className="card">
        <h2 style={{ marginTop: 0 }}>Pluggy (fatura por API — Open Finance)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {org?.pluggy_client_id ? (
            <>
              Conectado (Client ID {String(org.pluggy_client_id).slice(0, 8)}…). Para trocar, informe de novo abaixo.
            </>
          ) : (
            <>Crie a conta em pluggy.ai, gere o Client ID e o Client Secret no painel e cole aqui.</>
          )}{" "}
          Depois conecte o banco do cartão no Pluggy, copie o <strong>Item ID</strong> da conexão para o cartão acima e clique em{" "}
          <em>Buscar cartão no Pluggy</em>.
        </p>
        <div className="grid2">
          <div className="field">
            <label htmlFor="pc">Client ID</label>
            <input id="pc" name="client_id" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="ps">Client Secret</label>
            <input id="ps" name="client_secret" type="password" autoComplete="off" />
          </div>
        </div>
        <button className="btn btn-primary">Salvar e testar</button>
      </form>
    </Shell>
  );
}
