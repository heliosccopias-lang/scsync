import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { CopyButton } from "@/components/CopyButton";
import { requireOrg } from "@/lib/session";
import { decryptSecret, encryptSecret, newWebhookToken, sha256 } from "@/lib/crypto";
import { MpClient, MpError, type MpTerminal } from "@/lib/mercadopago";

const PATH = "/configuracoes/maquininhas";
function back(key: "error" | "ok", msg: string, extra = ""): never {
  redirect(`${PATH}?${key}=${encodeURIComponent(msg)}${extra}`);
}

async function owner() {
  const ctx = await requireOrg();
  if (!ctx.isOwner) back("error", "Só o Dono da conta configura as maquininhas.");
  return ctx;
}

async function saveStone(form: FormData) {
  "use server";
  const ctx = await owner();
  const sk = String(form.get("secret_key") ?? "").trim();
  if (!/^sk_(test_|live_)?[A-Za-z0-9]+$/.test(sk)) back("error", "A Secret Key da Stone começa com sk_ (Pagar.me → Desenvolvimento → Chaves).");
  if (!process.env.APP_URL) back("error", "APP_URL não está configurada no servidor.");
  const token = newWebhookToken();
  const { error } = await ctx.sb
    .from("orgs")
    .update({ stone_secret_key_encrypted: encryptSecret(sk), stone_webhook_token_hash: sha256(token) })
    .eq("id", ctx.orgId);
  if (error) back("error", "Não foi possível salvar.");
  const url = new URL(`/api/webhooks/stone/${ctx.orgId}`, process.env.APP_URL);
  url.searchParams.set("token", token);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);
  back("ok", "Stone conectada. Agora cadastre o webhook no painel da Pagar.me com o endereço abaixo.", `&url=${encodeURIComponent(url.toString())}`);
}

function hookUrl(path: string, token: string): string {
  const url = new URL(path, process.env.APP_URL);
  url.searchParams.set("token", token);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);
  return url.toString();
}

async function saveMercadoPago(form: FormData) {
  "use server";
  const ctx = await owner();
  const token = String(form.get("access_token") ?? "").trim();
  if (!/^(APP_USR|TEST)-[\w-]+$/.test(token)) back("error", "O Access Token do Mercado Pago começa com APP_USR- (Suas integrações → sua aplicação → Credenciais).");
  if (!process.env.APP_URL) back("error", "APP_URL não está configurada no servidor.");
  try {
    await new MpClient(token).listTerminals();
  } catch (e) {
    back("error", e instanceof MpError && e.status === 401 ? "O Mercado Pago recusou esse Access Token." : `Não foi possível validar: ${e instanceof Error ? e.message : "erro"}`);
  }
  const hook = newWebhookToken();
  await ctx.sb.from("orgs").update({ mp_access_token_encrypted: encryptSecret(token), mp_webhook_token_hash: sha256(hook) }).eq("id", ctx.orgId);
  back(
    "ok",
    "Mercado Pago conectado. Cadastre o webhook abaixo e adicione as maquininhas Point.",
    `&url=${encodeURIComponent(hookUrl(`/api/webhooks/mercadopago/${ctx.orgId}`, hook))}&p=mp`,
  );
}

/** Adds a Point terminal found on the account and switches it to PDV mode (orders from the system). */
async function addMpTerminal(form: FormData) {
  "use server";
  const ctx = await owner();
  const { data: org } = await ctx.sb.from("orgs").select("mp_access_token_encrypted").eq("id", ctx.orgId).single();
  if (!org?.mp_access_token_encrypted) back("error", "Conecte o Mercado Pago primeiro.");
  const id = String(form.get("terminal_id") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 60) || "Point";
  try {
    await new MpClient(decryptSecret(org.mp_access_token_encrypted)).setPdvMode(id);
  } catch (e) {
    back("error", `O Mercado Pago não mudou a maquininha para o modo PDV: ${e instanceof Error ? e.message : "erro"}`);
  }
  const { error } = await ctx.sb.from("pos_terminals").insert({ org_id: ctx.orgId, provider: "mercadopago", name, serial_number: id });
  if (error) back("error", error.code === "23505" ? "Essa maquininha já está cadastrada." : "Não foi possível salvar.");
  back("ok", "Maquininha Point cadastrada em modo PDV. Reinicie a maquininha para valer.");
}

async function saveTerminal(form: FormData) {
  "use server";
  const ctx = await owner();
  const provider = form.get("provider") === "pagbank" ? "pagbank" : "stone";
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  const serial = String(form.get("serial_number") ?? "").replace(/\s/g, "").slice(0, 40);
  if (!name || serial.length < 3) back("error", "Informe o nome e o número de série (etiqueta atrás da maquininha).");
  const { error } = await ctx.sb.from("pos_terminals").insert({ org_id: ctx.orgId, provider, name, serial_number: serial });
  if (error) back("error", error.code === "23505" ? "Essa maquininha já está cadastrada." : "Não foi possível salvar.");
  back("ok", "Maquininha cadastrada.");
}

async function toggleTerminal(form: FormData) {
  "use server";
  const ctx = await owner();
  const active = form.get("active") === "true";
  await ctx.sb.from("pos_terminals").update({ active: !active }).eq("id", String(form.get("id"))).eq("org_id", ctx.orgId);
  back("ok", active ? "Maquininha desativada." : "Maquininha ativada.");
}

export default async function TerminalsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; url?: string; p?: string }> }) {
  const { error, ok, url, p } = await searchParams;
  const ctx = await requireOrg();
  const [{ data: org }, { data: terminals }] = await Promise.all([
    ctx.sb.from("orgs").select("stone_secret_key_encrypted, mp_access_token_encrypted").eq("id", ctx.orgId).single(),
    ctx.sb.from("pos_terminals").select("*").eq("org_id", ctx.orgId).order("provider").order("name"),
  ]);
  const stoneOn = !!org?.stone_secret_key_encrypted;
  const partnerOn = !!process.env.STONE_SERVICE_REFERER_NAME;
  const mpOn = !!org?.mp_access_token_encrypted;
  let mpTerminals: MpTerminal[] = [];
  let mpError: string | null = null;
  if (mpOn) {
    try {
      mpTerminals = (await new MpClient(decryptSecret(org!.mp_access_token_encrypted!)).listTerminals()).data?.terminals ?? [];
    } catch (e) {
      mpError = e instanceof Error ? e.message : "erro";
    }
  }
  const registered = new Set((terminals ?? []).filter((t) => t.provider === "mercadopago").map((t) => t.serial_number));

  return (
    <Shell>
      <h1>Maquininhas (cobrança na entrega)</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Na OS, o botão <strong>Cobrar na maquininha</strong> manda o valor para a maquininha; o cliente paga e o SCsync dá baixa sozinho, com a forma de
        pagamento, as parcelas e o código de autorização. A OS concluída vira <strong>Paga</strong>.
      </p>
      <Notice error={error} ok={ok} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>
          Stone {stoneOn ? <span className="pill pill-paid">conectada</span> : <span className="pill pill-neutral">não conectada</span>}
        </h2>
        {!partnerOn ? (
          <div className="notice notice-error">
            A integração Stone Connect exige que o SCsync esteja no programa de parceiros da Stone (código de parceiro). Enquanto isso não for ativado, o botão
            de cobrança não envia para a maquininha.
          </div>
        ) : null}
        {url && p !== "mp" ? (
          <div className="notice notice-ok" style={{ wordBreak: "break-all" }}>
            <strong>Endereço do webhook (cole no painel da Pagar.me; só aparece agora):</strong>
            <div style={{ margin: "6px 0" }}>{url}</div>
            <CopyButton text={url} label="Copiar endereço" />
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Pagar.me → Configurações → Webhooks → Criar: cole o endereço e marque os eventos <strong>charge.paid</strong> e <strong>charge.refunded</strong>.
            </div>
          </div>
        ) : null}
        <ol className="muted" style={{ fontSize: 14 }}>
          <li>No Partner Hub da Stone ou no painel da Pagar.me (Desenvolvimento → Chaves), copie a <strong>Secret Key</strong> (sk_...).</li>
          <li>Cole abaixo e salve: o sistema gera o endereço do webhook para colar na Pagar.me.</li>
          <li>Cadastre as maquininhas Stone smart com o número de série da etiqueta.</li>
        </ol>
        <form action={saveStone} className="row">
          <input name="secret_key" type="password" placeholder="sk_..." autoComplete="off" style={{ width: 360 }} />
          <button className="btn btn-primary">{stoneOn ? "Trocar chave e gerar novo webhook" : "Conectar Stone"}</button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>
          Mercado Pago Point {mpOn ? <span className="pill pill-paid">conectado</span> : <span className="pill pill-neutral">não conectado</span>}
        </h2>
        {url && p === "mp" ? (
          <div className="notice notice-ok" style={{ wordBreak: "break-all" }}>
            <strong>Endereço do webhook (só aparece agora):</strong>
            <div style={{ margin: "6px 0" }}>{url}</div>
            <CopyButton text={url} label="Copiar endereço" />
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Mercado Pago Developers → Suas integrações → sua aplicação → Webhooks → Configurar notificações → Modo de produção: cole o endereço e marque o
              evento <strong>Order (Mercado Pago)</strong>.
            </div>
          </div>
        ) : null}
        <ol className="muted" style={{ fontSize: 14 }}>
          <li>Em mercadopago.com.br/developers, crie uma aplicação (Suas integrações) e copie o <strong>Access Token</strong> de produção (APP_USR-...).</li>
          <li>Cole abaixo: o sistema confere a chave e gera o endereço do webhook para colar na aplicação.</li>
          <li>As maquininhas Point Smart da conta aparecem abaixo: clique em Adicionar (ela passa para o modo PDV) e reinicie a maquininha.</li>
        </ol>
        <form action={saveMercadoPago} className="row">
          <input name="access_token" type="password" placeholder="APP_USR-..." autoComplete="off" style={{ width: 360 }} />
          <button className="btn btn-primary">{mpOn ? "Trocar token e gerar novo webhook" : "Conectar Mercado Pago"}</button>
        </form>
        {mpError ? <div className="notice notice-error" style={{ marginTop: 10 }}>Mercado Pago: {mpError}</div> : null}
        {mpOn && mpTerminals.length ? (
          <table style={{ marginTop: 12 }}>
            <tbody>
              {mpTerminals.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>Modo: {t.operating_mode ?? "—"}</td>
                  <td className="num">
                    {registered.has(t.id) ? (
                      <span className="muted">cadastrada</span>
                    ) : (
                      <form action={addMpTerminal} className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <input type="hidden" name="terminal_id" value={t.id} />
                        <input name="name" placeholder="Nome (ex.: Balcão)" style={{ width: 160 }} />
                        <button className="btn btn-secondary">Adicionar</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : mpOn && !mpError ? (
          <p className="muted">Nenhuma maquininha Point encontrada nesta conta do Mercado Pago.</p>
        ) : null}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>PagBank (Moderninha)</h2>
        <p style={{ marginTop: 0 }}>
          A PagBank não oferece envio de cobrança da nuvem direto para a Moderninha: a cobrança integrada exige um aplicativo instalado na própria maquininha
          (biblioteca PlugPag) e homologado pela PagBank. Até lá, use <strong>Receber na maquininha / dinheiro</strong> na OS, escolhendo débito, crédito ou Pix
          e informando o código de autorização (NSU): a baixa e a OS Paga funcionam igual.
        </p>
        <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>Você já pode cadastrar as Moderninhas abaixo; elas ficam prontas para o aplicativo integrado.</p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Maquininhas cadastradas</h2>
        {(terminals ?? []).length ? (
          <table style={{ marginBottom: 12 }}>
            <tbody>
              {(terminals ?? []).map((t) => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.55 }}>
                  <td>{{ stone: "Stone", pagbank: "PagBank", mercadopago: "Mercado Pago" }[t.provider as string] ?? t.provider}</td>
                  <td>{t.name}</td>
                  <td>Série {t.serial_number}</td>
                  <td className="num">
                    <form action={toggleTerminal}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={String(t.active)} />
                      <button className="btn btn-secondary">{t.active ? "Desativar" : "Ativar"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Nenhuma maquininha ainda.</p>
        )}
        <form action={saveTerminal} className="row">
          <select name="provider" defaultValue="stone" aria-label="Empresa" style={{ width: 140 }}>
            <option value="stone">Stone</option>
            <option value="pagbank">PagBank</option>
          </select>
          <input name="name" placeholder="Nome (ex.: Balcão)" style={{ width: 180 }} required />
          <input name="serial_number" placeholder="Número de série" style={{ width: 200 }} required />
          <button className="btn btn-primary">Cadastrar maquininha</button>
        </form>
      </section>
    </Shell>
  );
}
