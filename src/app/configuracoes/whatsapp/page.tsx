import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { CopyButton } from "@/components/CopyButton";
import { requireOrg } from "@/lib/session";
import { encryptSecret, newWebhookToken, sha256 } from "@/lib/crypto";
import { WaSendError, canSend, sendWhatsApp, setWhatsAppWebhook } from "@/lib/whatsapp-send";
import { HELP_TEXT } from "@/lib/whatsapp";
import { fmtDate } from "@/lib/format";

function back(key: "error" | "ok", msg: string, extra = ""): never {
  redirect(`/configuracoes/whatsapp?${key}=${encodeURIComponent(msg)}${extra}`);
}

async function generateToken(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const appUrl = process.env.APP_URL;
  if (!appUrl) back("error", "APP_URL não está configurada no servidor.");
  const provider = ["generic", "meta", "zapi", "evolution"].includes(String(form.get("provider"))) ? String(form.get("provider")) : "generic";
  const token = newWebhookToken();
  const verify = newWebhookToken().slice(0, 24);
  const { error } = await sb.from("orgs").update({ wa_token_hash: sha256(token), wa_verify_token: verify, wa_provider: provider }).eq("id", orgId);
  if (error) back("error", "Não foi possível gerar o endereço.");
  const url = new URL(`/api/webhooks/whatsapp/${orgId}`, appUrl);
  url.searchParams.set("token", token);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);
  back("ok", "Endereço gerado. Copie agora: por segurança ele só aparece desta vez.", `&url=${encodeURIComponent(url.toString())}`);
}

function webhookUrlFor(orgId: string, token: string): string {
  const url = new URL(`/api/webhooks/whatsapp/${orgId}`, process.env.APP_URL);
  url.searchParams.set("token", token);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);
  return url.toString();
}

/** WhatsApp connected as a device (Z-API or Evolution): saves the credentials and points its webhook here. */
async function connectDevice(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  if (!process.env.APP_URL) back("error", "APP_URL não está configurada no servidor.");
  const provider = form.get("provider") === "evolution" ? "evolution" : "zapi";
  const instance = String(form.get("instance") ?? "").trim();
  const apiToken = String(form.get("api_token") ?? "").trim();
  const clientToken = String(form.get("client_token") ?? "").trim();
  let apiUrl = String(form.get("api_url") ?? "").trim().replace(/\/+$/, "");
  if (provider === "evolution" && apiUrl && !/^https?:\/\//i.test(apiUrl)) apiUrl = `https://${apiUrl}`;
  if (!instance || !apiToken) back("error", provider === "zapi" ? "Informe o ID da instância e o Token da Z-API." : "Informe o nome da instância e a API key da Evolution.");
  if (provider === "evolution" && !apiUrl) back("error", "Informe o endereço do servidor da Evolution API.");
  const token = newWebhookToken();
  const url = webhookUrlFor(orgId, token);
  const { error } = await sb
    .from("orgs")
    .update({
      wa_provider: provider,
      wa_token_hash: sha256(token),
      wa_instance: instance,
      wa_api_url: provider === "evolution" ? apiUrl : null,
      wa_api_token_encrypted: encryptSecret(apiToken),
      wa_client_token_encrypted: clientToken ? encryptSecret(clientToken) : null,
    })
    .eq("id", orgId);
  if (error) back("error", "Não foi possível salvar.");
  try {
    await setWhatsAppWebhook({ provider, apiUrl, instance, token: apiToken, clientToken }, url);
  } catch (e) {
    const why = e instanceof WaSendError ? e.message : "sem resposta";
    back("error", `Credenciais salvas, mas o ${provider === "zapi" ? "Z-API" : "Evolution"} não aceitou configurar o webhook (${why}). Confira os dados, ou cole o endereço abaixo no painel em "Ao receber".`, `&url=${encodeURIComponent(url)}`);
  }
  back("ok", "WhatsApp conectado: as mensagens recebidas já chegam ao robô. Mande um teste abaixo.");
}

async function sendTest(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const { data: org } = await sb.from("orgs").select("wa_provider, wa_api_url, wa_instance, wa_api_token_encrypted, wa_client_token_encrypted").eq("id", orgId).single();
  if (!canSend(org)) back("error", "Conecte o WhatsApp primeiro.");
  const phone = String(form.get("phone") ?? "");
  try {
    await sendWhatsApp(org!, phone, `Olá! Sou o robô de despesas do SCsync.\n\n${HELP_TEXT}`);
  } catch (e) {
    back("error", `Não consegui enviar: ${e instanceof WaSendError ? e.message : "sem resposta"}. Confira se o celular está conectado (QR Code) no painel.`);
  }
  back("ok", "Mensagem de teste enviada. Responda no WhatsApp com uma despesa, por exemplo: gasolina 150,00");
}

async function saveSender(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  let phone = String(form.get("phone") ?? "").replace(/\D/g, "");
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  if (phone.length < 12 || phone.length > 13) back("error", "Celular inválido. Use DDD + número, por exemplo 11 98765-4321.");
  if (!name) back("error", "Informe o nome de quem vai mandar as despesas.");
  const { error } = await sb.from("whatsapp_senders").insert({ org_id: orgId, phone, name });
  if (error) back("error", error.code === "23505" ? "Esse número já está cadastrado." : "Não foi possível salvar.");
  back("ok", "Número autorizado.");
}

async function toggleSender(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const active = form.get("active") === "true";
  await sb.from("whatsapp_senders").update({ active: !active }).eq("id", String(form.get("id"))).eq("org_id", orgId);
  back("ok", active ? "Número bloqueado." : "Número liberado.");
}

async function saveKeywords(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const ids = form.getAll("cat_id").map(String);
  await Promise.all(
    ids.map((id) =>
      sb
        .from("financial_categories")
        .update({
          keywords: String(form.get(`kw_${id}`) ?? "")
            .split(",")
            .map((k) => k.trim().toLowerCase())
            .filter((k) => k.length >= 2)
            .slice(0, 40),
        })
        .eq("id", id)
        .eq("org_id", orgId),
    ),
  );
  back("ok", "Palavras-chave salvas.");
}

async function addCategory(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  if (!name) back("error", "Informe o nome da categoria.");
  const keywords = String(form.get("keywords") ?? "").split(",").map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2);
  const { error } = await sb.from("financial_categories").insert({ org_id: orgId, name, direction: "out", keywords });
  if (error) back("error", "Não foi possível criar a categoria.");
  back("ok", "Categoria de despesa criada.");
}

const RESULT: Record<string, string> = { saved: "Registrada", ignored: "Respondida", unauthorized: "Número não autorizado", error: "Erro" };
const PROVIDER: Record<string, string> = { generic: "Outro / automação (n8n, Make)", meta: "WhatsApp Cloud API (Meta)", zapi: "Z-API (dispositivo conectado)", evolution: "Evolution API (dispositivo conectado)" };

export default async function WhatsAppSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; url?: string }> }) {
  const { error, ok, url } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const [{ data: org }, { data: senders }, { data: cats }, { data: inbox }] = await Promise.all([
    sb.from("orgs").select("wa_token_hash, wa_verify_token, wa_provider, wa_api_url, wa_instance, wa_api_token_encrypted, wa_client_token_encrypted").eq("id", orgId).single(),
    sb.from("whatsapp_senders").select("*").eq("org_id", orgId).order("name"),
    sb.from("financial_categories").select("id, name, keywords").eq("org_id", orgId).eq("direction", "out").order("name"),
    sb.from("whatsapp_inbox").select("id, from_phone, text, result, reply, reply_sent, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(20),
  ]);

  const connected = canSend(org) && !!org?.wa_token_hash;
  // Messages from numbers that are not authorized are kept out of the list (they may be customers).
  const shown = (inbox ?? []).filter((m) => m.result !== "unauthorized");

  return (
    <Shell orgName={orgName}>
      <h1>Robô de WhatsApp (despesas do cartão)</h1>
      <Notice error={error} ok={ok} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>1. Conectar o WhatsApp (dispositivo conectado)</h2>
        {connected ? (
          <div className="notice notice-ok">
            Conectado pela {org?.wa_provider === "zapi" ? "Z-API" : "Evolution API"} (instância {org?.wa_instance}). O robô recebe as mensagens e responde pelo próprio número.
          </div>
        ) : null}
        {url ? (
          <div className={`notice ${error ? "notice-error" : "notice-ok"}`} style={{ wordBreak: "break-all" }}>
            <strong>Endereço do webhook (cole no serviço, em &ldquo;Ao receber&rdquo;; só aparece agora):</strong>
            <div style={{ margin: "6px 0" }}>{url}</div>
            <CopyButton text={url} label="Copiar endereço" />
          </div>
        ) : null}
        <p className="muted" style={{ marginTop: 0 }}>
          O número fica conectado como um aparelho (igual ao WhatsApp Web, pelo QR Code). Use de preferência um <strong>número só para o robô</strong>: ele
          responde apenas aos números autorizados abaixo e ignora os outros em silêncio. Por não ser a API oficial, o WhatsApp pode bloquear números que mandam
          muitas mensagens; para despesas internas o risco é baixo.
        </p>
        <details open={!connected}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Z-API</summary>
          <form action={connectDevice} style={{ marginTop: 10 }}>
            <input type="hidden" name="provider" value="zapi" />
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              No painel da Z-API: crie a instância, leia o QR Code com o celular do robô e copie o <em>ID da instância</em>, o <em>Token da instância</em> e o{" "}
              <em>Client-Token</em> (aba Segurança).
            </p>
            <div className="grid2">
              <div className="field">
                <label htmlFor="z_inst">ID da instância</label>
                <input id="z_inst" name="instance" defaultValue={org?.wa_provider === "zapi" ? (org?.wa_instance ?? "") : ""} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="z_tok">Token da instância</label>
                <input id="z_tok" name="api_token" type="password" autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="z_cli">Client-Token (segurança da conta)</label>
                <input id="z_cli" name="client_token" type="password" autoComplete="off" />
              </div>
            </div>
            <button className="btn btn-primary">Salvar e conectar</button>
          </form>
        </details>
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Evolution API (servidor próprio)</summary>
          <form action={connectDevice} style={{ marginTop: 10 }}>
            <input type="hidden" name="provider" value="evolution" />
            <div className="grid2">
              <div className="field">
                <label htmlFor="e_url">Endereço do servidor</label>
                <input id="e_url" name="api_url" defaultValue={org?.wa_api_url ?? ""} placeholder="https://evolution.suaempresa.com.br" />
              </div>
              <div className="field">
                <label htmlFor="e_inst">Nome da instância</label>
                <input id="e_inst" name="instance" defaultValue={org?.wa_provider === "evolution" ? (org?.wa_instance ?? "") : ""} />
              </div>
              <div className="field">
                <label htmlFor="e_key">API key</label>
                <input id="e_key" name="api_token" type="password" autoComplete="off" />
              </div>
            </div>
            <button className="btn btn-primary">Salvar e conectar</button>
          </form>
        </details>
        {connected && (senders ?? []).some((x) => x.active) ? (
          <form action={sendTest} className="row" style={{ marginTop: 12 }}>
            <select name="phone" aria-label="Enviar teste para" style={{ width: 260 }}>
              {(senders ?? [])
                .filter((x) => x.active)
                .map((x) => (
                  <option key={x.id} value={x.phone}>
                    {x.name} (+{x.phone})
                  </option>
                ))}
            </select>
            <button className="btn btn-secondary">Enviar mensagem de teste</button>
          </form>
        ) : null}
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>Outros serviços (API oficial da Meta, n8n, Make)</summary>
          <form action={generateToken} className="row" style={{ marginTop: 10 }}>
            <select name="provider" defaultValue="generic" style={{ width: 300 }} aria-label="Serviço">
              <option value="generic">{PROVIDER.generic}</option>
              <option value="meta">{PROVIDER.meta}</option>
            </select>
            <button className="btn btn-secondary">Gerar endereço do webhook</button>
          </form>
          {org?.wa_provider === "meta" && url ? (
            <p>
              Verify token da Meta: <code>{org.wa_verify_token}</code>
            </p>
          ) : null}
        </details>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>2. Quem pode mandar despesas</h2>
        {(senders ?? []).length ? (
          <table style={{ marginBottom: 12 }}>
            <tbody>
              {(senders ?? []).map((s) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
                  <td>{s.name}</td>
                  <td>+{s.phone}</td>
                  <td className="num">
                    <form action={toggleSender}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="active" value={String(s.active)} />
                      <button className="btn btn-secondary">{s.active ? "Bloquear" : "Liberar"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Nenhum número ainda. Mensagens de números não cadastrados são recusadas.</p>
        )}
        <form action={saveSender} className="row">
          <input name="name" placeholder="Nome" style={{ width: 200 }} required />
          <input name="phone" placeholder="Celular com DDD" inputMode="tel" style={{ width: 200 }} required />
          <button className="btn btn-primary">Autorizar número</button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>3. Categorias e palavras-chave</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Quando a mensagem tem uma dessas palavras, a despesa já entra na categoria. Ex.: Combustível → gasolina, posto, etanol.
        </p>
        <form action={saveKeywords}>
          {(cats ?? []).map((c) => (
            <div key={c.id} className="row" style={{ flexWrap: "nowrap", marginBottom: 6 }}>
              <input type="hidden" name="cat_id" value={c.id} />
              <span style={{ width: 200, flexShrink: 0 }}>{c.name}</span>
              <input name={`kw_${c.id}`} defaultValue={(c.keywords ?? []).join(", ")} placeholder="palavras separadas por vírgula" aria-label={`Palavras de ${c.name}`} />
            </div>
          ))}
          <button className="btn btn-primary">Salvar palavras-chave</button>
        </form>
        <form action={addCategory} className="row" style={{ marginTop: 12 }}>
          <input name="name" placeholder="Nova categoria de despesa" style={{ width: 220 }} />
          <input name="keywords" placeholder="palavras-chave, separadas por vírgula" style={{ width: 320 }} />
          <button className="btn btn-secondary">Criar categoria</button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Como usar</h2>
        <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{HELP_TEXT}</pre>
        <p style={{ marginBottom: 0 }}>
          Ainda sem a Z-API? <Link href="/cartoes/simulador">Teste o robô no simulador</Link>: as mensagens passam pelo mesmo caminho do WhatsApp.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Últimas mensagens</h2>
        {shown.length === 0 ? (
          <p className="muted">Nenhuma mensagem recebida ainda.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>De</th>
                <th>Mensagem</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {fmtDate(String(m.created_at).slice(0, 10))} {new Date(m.created_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td>+{m.from_phone}</td>
                  <td>{m.text}</td>
                  <td title={m.reply ?? ""}>
                    {RESULT[m.result] ?? m.result}
                    {m.reply_sent === false ? <div style={{ color: "var(--bad)", fontSize: 12 }}>resposta não enviada</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
