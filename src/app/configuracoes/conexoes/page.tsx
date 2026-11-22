import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { PluggyError, pluggyAccounts, pluggyApiKey } from "@/lib/pluggy";
import { syncBankAccount, syncCard } from "@/lib/bank-sync";
import { supabaseAdmin } from "@/lib/supabase";
import { asaasFor } from "@/lib/charges";

const PATH = "/configuracoes/conexoes";
function back(key: "error" | "ok", msg: string): never {
  redirect(`${PATH}?${key}=${encodeURIComponent(msg)}`);
}
type Db = ReturnType<typeof supabaseAdmin>;

async function owner() {
  const ctx = await requireOrg();
  if (!ctx.isOwner) back("error", "Só o Dono da conta mexe nas conexões bancárias.");
  return ctx;
}

async function savePluggy(form: FormData) {
  "use server";
  const ctx = await owner();
  const clientId = String(form.get("client_id") ?? "").trim();
  const secret = String(form.get("client_secret") ?? "").trim();
  if (!clientId || !secret) back("error", "Informe o Client ID e o Client Secret do Pluggy.");
  try {
    await pluggyApiKey(clientId, secret);
  } catch (e) {
    back("error", e instanceof PluggyError && e.status < 500 ? "O Pluggy recusou essas credenciais." : "Não foi possível falar com o Pluggy agora.");
  }
  await ctx.sb.from("orgs").update({ pluggy_client_id: clientId, pluggy_secret_encrypted: encryptSecret(secret) }).eq("id", ctx.orgId);
  back("ok", "Pluggy conectado. Agora ligue as contas e os cartões abaixo.");
}

/** Saves the Pluggy connection (Item ID) and finds the matching account inside it. */
async function link(form: FormData) {
  "use server";
  const ctx = await owner();
  const kind = form.get("kind") === "card" ? "card" : "bank";
  const id = String(form.get("id"));
  const itemId = String(form.get("pluggy_item_id") ?? "").trim();
  if (!itemId) back("error", "Cole o Item ID da conexão do banco no Pluggy.");
  const { data: org } = await ctx.sb.from("orgs").select("pluggy_client_id, pluggy_secret_encrypted").eq("id", ctx.orgId).single();
  if (!org?.pluggy_client_id || !org.pluggy_secret_encrypted) back("error", "Conecte o Pluggy primeiro (quadro 1).");
  const table = kind === "card" ? "credit_cards" : "bank_accounts";
  const { data: row } = await ctx.sb.from(table).select("*").eq("id", id).eq("org_id", ctx.orgId).single();
  if (!row) back("error", "Não encontrado.");
  try {
    const key = await pluggyApiKey(org.pluggy_client_id, decryptSecret(org.pluggy_secret_encrypted));
    const all = await pluggyAccounts(key, itemId);
    const list = all.filter((a) => (kind === "card" ? a.type === "CREDIT" : a.type === "BANK"));
    if (!list.length) back("error", kind === "card" ? "Essa conexão do Pluggy não tem cartão de crédito." : "Essa conexão do Pluggy não tem conta corrente/poupança.");
    const hint = String((kind === "card" ? row.last4 : row.account_number) ?? "").replace(/\D/g, "");
    const pick = list.find((a) => hint && (a.number ?? "").replace(/\D/g, "").endsWith(hint.slice(-4))) ?? list[0];
    await ctx.sb.from(table).update({ pluggy_item_id: itemId, pluggy_account_id: pick.id }).eq("id", id).eq("org_id", ctx.orgId);
    back("ok", `Ligado ao Pluggy: ${pick.marketingName ?? pick.name}${pick.number ? ` (${pick.number})` : ""}.`);
  } catch (e) {
    if (e instanceof PluggyError) back("error", `O Pluggy respondeu: ${e.message}`);
    throw e;
  }
}

async function toggleAuto(form: FormData) {
  "use server";
  const ctx = await owner();
  const table = form.get("kind") === "card" ? "credit_cards" : "bank_accounts";
  const on = form.get("on") === "true";
  await ctx.sb.from(table).update({ auto_sync: !on }).eq("id", String(form.get("id"))).eq("org_id", ctx.orgId);
  back("ok", on ? "Importação automática desligada." : "Importação automática ligada: todo dia de manhã o sistema importa e concilia o que puder.");
}

async function syncNow(form: FormData) {
  "use server";
  const ctx = await owner();
  const id = String(form.get("id"));
  const db = ctx.sb as unknown as Db;
  try {
    const r = form.get("kind") === "card" ? await syncCard(db, ctx.orgId, id) : await syncBankAccount(db, ctx.orgId, id, { userId: ctx.user.id });
    back("ok", `${r.inserted} lançamento(s) importado(s)${r.duplicates ? `, ${r.duplicates} já existiam` : ""}; ${r.matched} conciliado(s) automaticamente.`);
  } catch (e) {
    if (e instanceof Error && !e.message.startsWith("NEXT_")) back("error", e.message);
    throw e;
  }
}

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const ctx = await requireOrg();
  const [{ data: org }, { data: accounts }, { data: cards }, asaas] = await Promise.all([
    ctx.sb.from("orgs").select("pluggy_client_id").eq("id", ctx.orgId).single(),
    ctx.sb.from("bank_accounts").select("*").eq("org_id", ctx.orgId).eq("active", true).order("created_at"),
    ctx.sb.from("credit_cards").select("*").eq("org_id", ctx.orgId).eq("active", true).order("name"),
    asaasFor(ctx.orgId),
  ]);
  const pluggyOn = !!org?.pluggy_client_id;
  const bankOn = ctx.module("bank_reconciliation");
  const cardsOn = ctx.module("cards");

  const autoForm = (kind: "bank" | "card", id: string, on: boolean, can: boolean) => (
    <form action={toggleAuto} style={{ display: "inline" }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="on" value={String(on)} />
      <button className={`btn ${on ? "btn-primary" : "btn-secondary"}`} disabled={!can} title={can ? "" : "Ligue a conta à API primeiro"}>
        Automático: {on ? "ligado" : "desligado"}
      </button>
    </form>
  );
  const syncForm = (kind: "bank" | "card", id: string, can: boolean) => (
    <form action={syncNow} style={{ display: "inline" }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-secondary" disabled={!can}>
        Importar agora pela API
      </button>
    </form>
  );

  return (
    <Shell>
      <h1>Conexões bancárias</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Cada conta e cada cartão podem entrar de dois jeitos: <strong>importação manual</strong> de arquivo (OFX/CSV baixado do banco) ou <strong>conexão automática pela API</strong>{" "}
        (Asaas para a conta Asaas; Pluggy/Open Finance para os outros bancos e cartões). Com o automático ligado, todo dia de manhã o sistema importa e concilia o que for
        possível.
      </p>
      <Notice error={error} ok={ok} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>1. Pluggy (Open Finance) {pluggyOn ? <span className="pill pill-paid">conectado</span> : <span className="pill pill-neutral">não conectado</span>}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Crie a conta em pluggy.ai, gere o Client ID e o Client Secret no painel e cole aqui. Depois conecte cada banco no Pluggy e copie o <strong>Item ID</strong> da
          conexão para a conta ou cartão abaixo.
        </p>
        <form action={savePluggy} className="row">
          <input name="client_id" placeholder="Client ID" autoComplete="off" style={{ width: 260 }} />
          <input name="client_secret" type="password" placeholder="Client Secret" autoComplete="off" style={{ width: 260 }} />
          <button className="btn btn-primary">{pluggyOn ? "Trocar credenciais" : "Salvar e testar"}</button>
        </form>
      </section>

      {bankOn ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>2. Contas bancárias (conciliação bancária)</h2>
          {(accounts ?? []).length === 0 ? (
            <p className="muted">
              Nenhuma conta. Cadastre em <Link href="/configuracoes/contas">Contas bancárias</Link>.
            </p>
          ) : (
            <table>
              <tbody>
                {(accounts ?? []).map((a) => {
                  const isAsaas = a.kind === "asaas";
                  const apiReady = isAsaas ? !!asaas : !!a.pluggy_account_id && pluggyOn;
                  return (
                    <tr key={a.id}>
                      <td style={{ width: "28%" }}>
                        <strong>{a.name}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {isAsaas ? "API do Asaas" : a.pluggy_account_id ? "API Pluggy ligada" : "sem API"} · última importação: {when(a.last_synced_at)}
                        </div>
                        {a.last_sync_error ? <div style={{ color: "var(--bad)", fontSize: 12 }}>{a.last_sync_error}</div> : null}
                      </td>
                      <td>
                        {a.kind === "cash" ? (
                          <span className="muted">Caixa (dinheiro): não tem extrato.</span>
                        ) : (
                          <div className="row" style={{ gap: 6 }}>
                            <Link className="btn btn-secondary" href={`/conciliacao?conta=${a.id}`}>
                              Importar arquivo (manual)
                            </Link>
                            {syncForm("bank", a.id, apiReady)}
                            {autoForm("bank", a.id, a.auto_sync, apiReady)}
                            {!isAsaas ? (
                              <form action={link} className="row" style={{ gap: 6 }}>
                                <input type="hidden" name="kind" value="bank" />
                                <input type="hidden" name="id" value={a.id} />
                                <input name="pluggy_item_id" defaultValue={a.pluggy_item_id ?? ""} placeholder="Item ID do Pluggy" style={{ width: 200 }} disabled={!pluggyOn} />
                                <button className="btn btn-secondary" disabled={!pluggyOn}>
                                  Ligar à API
                                </button>
                              </form>
                            ) : !asaas ? (
                              <Link href="/configuracoes/asaas">Conectar o Asaas</Link>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {cardsOn ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>3. Cartões de crédito (conciliação de cartão)</h2>
          {(cards ?? []).length === 0 ? (
            <p className="muted">
              Nenhum cartão. Cadastre em <Link href="/configuracoes/cartoes">Cartões de crédito</Link>.
            </p>
          ) : (
            <table>
              <tbody>
                {(cards ?? []).map((c) => {
                  const apiReady = !!c.pluggy_account_id && pluggyOn && !!c.closing_day;
                  return (
                    <tr key={c.id}>
                      <td style={{ width: "28%" }}>
                        <strong>{c.name}</strong> {c.last4 ? <span className="muted">•••• {c.last4}</span> : null}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {c.pluggy_account_id ? "API Pluggy ligada" : "sem API"} · última importação: {when(c.last_synced_at)}
                          {!c.closing_day ? " · falta o dia de fechamento" : ""}
                        </div>
                        {c.last_sync_error ? <div style={{ color: "var(--bad)", fontSize: 12 }}>{c.last_sync_error}</div> : null}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <Link className="btn btn-secondary" href={`/cartoes?cartao=${c.id}`}>
                            Importar fatura (manual)
                          </Link>
                          {syncForm("card", c.id, apiReady)}
                          {autoForm("card", c.id, c.auto_sync, apiReady)}
                          <form action={link} className="row" style={{ gap: 6 }}>
                            <input type="hidden" name="kind" value="card" />
                            <input type="hidden" name="id" value={c.id} />
                            <input name="pluggy_item_id" defaultValue={c.pluggy_item_id ?? ""} placeholder="Item ID do Pluggy" style={{ width: 200 }} disabled={!pluggyOn} />
                            <button className="btn btn-secondary" disabled={!pluggyOn}>
                              Ligar à API
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </Shell>
  );
}
