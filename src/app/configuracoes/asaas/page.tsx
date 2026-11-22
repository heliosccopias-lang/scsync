import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { AsaasClient, AsaasError, webhookUrl, type AsaasEnvironment } from "@/lib/asaas";
import { encryptSecret, newWebhookToken, sha256 } from "@/lib/crypto";
import { requireOrg } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

async function connect(form: FormData) {
  "use server";
  const { orgId, isOwner, user } = await requireOrg();
  const back = (msg: string, detail?: unknown): never => {
    // Logged without the key, so the reason shows up in Vercel's runtime logs.
    console.warn("[asaas-connect] failed", { orgId, msg, detail });
    redirect(`/configuracoes/asaas?error=${encodeURIComponent(msg)}`);
  };
  if (!isOwner) back("Só o Dono da conta pode conectar o Asaas.");

  const env = (form.get("environment") === "production" ? "production" : "sandbox") as AsaasEnvironment;
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const email = String(form.get("email") ?? user.email ?? "").trim();
  if (!apiKey) back("Cole a chave de API do Asaas.");

  const appUrl = process.env.APP_URL;
  if (!appUrl) back("APP_URL não está configurada no servidor.");

  const client = new AsaasClient(apiKey, env);
  try {
    await client.balance();
  } catch (e) {
    const status = e instanceof AsaasError ? e.status : null;
    const why = e instanceof Error ? e.message : String(e);
    back(
      status === 401
        ? "Chave inválida para o ambiente escolhido. Confira se a chave é do Sandbox e começa com $aact_."
        : `Não foi possível falar com o Asaas${status ? ` (HTTP ${status}: ${why})` : `: ${why}`}.`,
      { step: "balance", status, why, env, keyPrefix: apiKey.slice(0, 6), keyLength: apiKey.length },
    );
  }

  const token = newWebhookToken();
  let webhookId: string | null = null;
  try {
    const wh = await client.createWebhook({
      name: "SCsync",
      url: webhookUrl(appUrl!, orgId, process.env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined),
      email,
      authToken: token,
    });
    webhookId = wh.id;
  } catch (e) {
    back(`O Asaas recusou o webhook: ${e instanceof Error ? e.message : "erro"}`, {
      step: "webhook",
      status: e instanceof AsaasError ? e.status : null,
      details: e instanceof AsaasError ? e.details : String(e),
    });
  }

  const { error } = await supabaseAdmin()
    .from("asaas_connections")
    .upsert({
      org_id: orgId,
      environment: env,
      api_key_encrypted: encryptSecret(apiKey),
      webhook_id: webhookId,
      webhook_token_hash: sha256(token),
      updated_at: new Date().toISOString(),
    });
  if (error) back("Falha ao salvar a conexão.", { step: "save", error: error.message });
  console.info("[asaas-connect] connected", { orgId, env, webhookId });
  redirect(`/configuracoes/asaas?ok=${encodeURIComponent("Asaas conectado. As cobranças já podem ser geradas.")}`);
}

export default async function AsaasPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { orgId, orgName } = await requireOrg();
  const { error, ok } = await searchParams;
  const { data: conn } = await supabaseAdmin()
    .from("asaas_connections")
    .select("environment, connected_at, updated_at, webhook_id")
    .eq("org_id", orgId)
    .maybeSingle();

  return (
    <Shell orgName={orgName}>
      <h1>Conexão com o Asaas</h1>
      <Notice error={error} ok={ok} />
      {conn ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <span className="pill pill-paid">Conectado</span>{" "}
          <span className="muted">
            Ambiente: {conn.environment === "production" ? "Produção" : "Sandbox (teste)"} · webhook {conn.webhook_id ?? "—"}
          </span>
        </div>
      ) : null}
      <form action={connect} className="card" style={{ maxWidth: 560 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          No Asaas: Minha Conta → Integração → Gerar API Key. A chave fica cifrada e nunca volta para o navegador.
        </p>
        <div className="field">
          <label htmlFor="environment">Ambiente</label>
          <select id="environment" name="environment" defaultValue={conn?.environment ?? "sandbox"}>
            <option value="sandbox">Sandbox (teste)</option>
            <option value="production">Produção</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="apiKey">Chave de API</label>
          <input id="apiKey" name="apiKey" type="password" autoComplete="off" required />
        </div>
        <div className="field">
          <label htmlFor="email">E-mail para avisos de falha do webhook</label>
          <input id="email" name="email" type="email" />
        </div>
        <button className="btn btn-primary">{conn ? "Reconectar" : "Conectar"}</button>
      </form>
    </Shell>
  );
}
