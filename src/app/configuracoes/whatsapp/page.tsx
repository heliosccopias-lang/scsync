import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { CopyButton } from "@/components/CopyButton";
import { requireOrg } from "@/lib/session";
import { newWebhookToken, sha256 } from "@/lib/crypto";
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
const PROVIDER: Record<string, string> = { generic: "Outro / automação (n8n, Make)", meta: "WhatsApp Cloud API (Meta)", zapi: "Z-API", evolution: "Evolution API" };

export default async function WhatsAppSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; url?: string }> }) {
  const { error, ok, url } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const [{ data: org }, { data: senders }, { data: cats }, { data: inbox }] = await Promise.all([
    sb.from("orgs").select("wa_token_hash, wa_verify_token, wa_provider").eq("id", orgId).single(),
    sb.from("whatsapp_senders").select("*").eq("org_id", orgId).order("name"),
    sb.from("financial_categories").select("id, name, keywords").eq("org_id", orgId).eq("direction", "out").order("name"),
    sb.from("whatsapp_inbox").select("id, from_phone, text, result, reply, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(20),
  ]);

  return (
    <Shell orgName={orgName}>
      <h1>Robô de WhatsApp (despesas do cartão)</h1>
      <Notice error={error} ok={ok} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>1. Ligar o robô ao seu serviço de WhatsApp</h2>
        {url ? (
          <div className="notice notice-ok" style={{ wordBreak: "break-all" }}>
            <strong>Endereço do webhook (copie e cole no serviço de WhatsApp):</strong>
            <div style={{ margin: "6px 0" }}>{url}</div>
            <CopyButton text={url} label="Copiar endereço" />
            {org?.wa_provider === "meta" ? (
              <div style={{ marginTop: 8 }}>
                Na Meta, use também o <strong>Verify token</strong>: <code>{org.wa_verify_token}</code>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            {org?.wa_token_hash
              ? `Robô ligado (${PROVIDER[org.wa_provider ?? "generic"]}). Gerar de novo troca o endereço: o antigo para de funcionar.`
              : "Escolha o serviço e gere o endereço. Ele recebe as mensagens e devolve a resposta do robô."}
          </p>
        )}
        <form action={generateToken} className="row">
          <select name="provider" defaultValue={org?.wa_provider ?? "generic"} style={{ width: 300 }} aria-label="Serviço de WhatsApp">
            {Object.entries(PROVIDER).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn btn-primary">{org?.wa_token_hash ? "Gerar novo endereço" : "Gerar endereço do webhook"}</button>
        </form>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          O sistema entende as mensagens da Meta, Z-API e Evolution API. A resposta para quem mandou volta no corpo da resposta do webhook (
          <code>replies</code>); o envio automático da confirmação pelo WhatsApp é ligado quando o serviço for escolhido.
        </p>
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
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Últimas mensagens</h2>
        {(inbox ?? []).length === 0 ? (
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
              {(inbox ?? []).map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {fmtDate(String(m.created_at).slice(0, 10))} {new Date(m.created_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td>+{m.from_phone}</td>
                  <td>{m.text}</td>
                  <td title={m.reply ?? ""}>{RESULT[m.result] ?? m.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
