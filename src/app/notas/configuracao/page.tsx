import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { asaasFor } from "@/lib/charges";
import { AsaasError, type AsaasMunicipalOptions } from "@/lib/asaas";
import { supabaseAdmin } from "@/lib/supabase";
import { ensureInvoiceWebhook } from "@/lib/nfse-db";
import type { NfseSettings } from "@/lib/nfse";

const PATH = "/notas/configuracao";
function back(key: "error" | "ok", msg: string, extra = ""): never {
  redirect(`${PATH}?${key}=${encodeURIComponent(msg)}${extra}`);
}
const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", ".").trim() || "0");
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
};

async function ownerAsaas() {
  const ctx = await requireOrg();
  if (!ctx.isOwner) back("error", "Só o Dono da conta configura a nota fiscal.");
  const asaas = await asaasFor(ctx.orgId);
  if (!asaas) back("error", "Conecte o Asaas desta empresa primeiro.");
  return { ctx, asaas };
}

/** Company fiscal data and city hall access, sent to Asaas (multipart: the certificate is a file). */
async function saveFiscal(form: FormData) {
  "use server";
  const { ctx, asaas } = await ownerAsaas();
  const out = new FormData();
  const put = (k: string, v: FormDataEntryValue | null) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) out.append(k, s);
  };
  put("email", form.get("email"));
  out.append("simplesNacional", form.get("simplesNacional") === "true" ? "true" : "false");
  out.append("culturalProjectsPromoter", "false");
  for (const k of ["municipalInscription", "cnae", "specialTaxRegime", "serviceListItem", "rpsSerie", "rpsNumber", "loteNumber", "nationalPortalTaxCalculationRegime", "username", "password", "accessToken", "certificatePassword", "serviceProvisionCityDefaultType"]) {
    put(k, form.get(k));
  }
  const cert = form.get("certificateFile");
  if (cert instanceof File && cert.size > 0) {
    if (cert.size > 100 * 1024) back("error", "O arquivo do certificado (.pfx) parece grande demais. Confira se é o certificado A1.");
    out.append("certificateFile", cert, cert.name);
  }
  if (!out.get("email")) back("error", "Informe o e-mail que recebe os avisos das notas.");
  try {
    await asaas.saveFiscalInfo(out);
  } catch (e) {
    back("error", e instanceof AsaasError ? `O Asaas recusou: ${e.message}` : "Não foi possível falar com o Asaas.");
  }
  const { data: org } = await supabaseAdmin().from("orgs").select("nfse").eq("id", ctx.orgId).single();
  await supabaseAdmin()
    .from("orgs")
    .update({ nfse: { ...((org?.nfse ?? {}) as NfseSettings), simples: form.get("simplesNacional") === "true" } })
    .eq("id", ctx.orgId);
  try {
    await ensureInvoiceWebhook(ctx.orgId, String(out.get("email")));
  } catch {
    // The daily sync still updates the invoices; the webhook only makes it immediate.
  }
  back("ok", "Dados fiscais enviados ao Asaas.");
}

async function saveDefaults(form: FormData) {
  "use server";
  const { ctx } = await ownerAsaas();
  const { data: org } = await supabaseAdmin().from("orgs").select("nfse").eq("id", ctx.orgId).single();
  const cur = (org?.nfse ?? {}) as NfseSettings;
  const next: NfseSettings = {
    ...cur,
    service_id: String(form.get("service_id") ?? "").trim() || null,
    service_code: String(form.get("service_code") ?? "").trim() || null,
    service_name: String(form.get("service_name") ?? "").trim().slice(0, 250) || null,
    iss: num(form.get("iss")),
    retain_iss: form.get("retain_iss") === "on",
    pis: num(form.get("pis")),
    cofins: num(form.get("cofins")),
    csll: num(form.get("csll")),
    inss: num(form.get("inss")),
    ir: num(form.get("ir")),
    pis_cofins_tax_status: String(form.get("pis_cofins_tax_status") ?? "").trim() || null,
    observations: String(form.get("observations") ?? "").trim().slice(0, 1000) || null,
    auto: form.get("auto") === "on_payment" ? "on_payment" : "off",
  };
  if ([next.iss, next.pis, next.cofins, next.csll, next.inss, next.ir].some((v) => Number.isNaN(v))) back("error", "Alíquotas precisam ser números entre 0 e 100.");
  if (!next.service_id && !next.service_code) back("error", "Escolha o serviço da lista da prefeitura ou informe o código do serviço.");
  if (!next.service_name) back("error", "Informe o nome do serviço como aparece na nota.");
  await supabaseAdmin().from("orgs").update({ nfse: next }).eq("id", ctx.orgId);
  back("ok", "Padrões da nota salvos.");
}

async function pickService(form: FormData) {
  "use server";
  const { ctx } = await ownerAsaas();
  const { data: org } = await supabaseAdmin().from("orgs").select("nfse").eq("id", ctx.orgId).single();
  const cur = (org?.nfse ?? {}) as NfseSettings;
  const iss = Number(form.get("iss_tax"));
  await supabaseAdmin()
    .from("orgs")
    .update({
      nfse: {
        ...cur,
        service_id: String(form.get("id")),
        service_code: null,
        service_name: String(form.get("description")).slice(0, 250),
        ...(Number.isFinite(iss) && iss > 0 ? { iss } : {}),
      },
    })
    .eq("id", ctx.orgId);
  back("ok", "Serviço escolhido. Confira a alíquota de ISS e salve os padrões.");
}

export default async function FiscalSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; busca?: string }> }) {
  const { error, ok, busca } = await searchParams;
  const ctx = await requireOrg();
  const asaas = await asaasFor(ctx.orgId);
  const { data: org } = await ctx.sb.from("orgs").select("nfse, cnpj").eq("id", ctx.orgId).single();
  const s = (org?.nfse ?? {}) as NfseSettings;

  if (!asaas) {
    return (
      <Shell>
        <h1>Configuração da nota fiscal</h1>
        <div className="card">
          A nota fiscal é emitida pela conta Asaas da empresa. <Link href="/configuracoes/asaas">Conecte o Asaas</Link> primeiro.
        </div>
      </Shell>
    );
  }

  let opts: AsaasMunicipalOptions | null = null;
  let fiscal: Record<string, unknown> | null = null;
  let loadError: string | null = null;
  let services: { id: string; description: string; issTax?: number }[] = [];
  try {
    [opts, fiscal] = await Promise.all([asaas.municipalOptions(), asaas.getFiscalInfo()]);
    if (busca) services = (await asaas.municipalServices(busca)).data ?? [];
  } catch (e) {
    loadError = e instanceof AsaasError ? e.message : "Não foi possível falar com o Asaas.";
  }
  const f = (k: string) => (fiscal?.[k] ?? "") as string;
  const auth = opts?.authenticationType;

  return (
    <Shell>
      <h1>Configuração da nota fiscal (NFS-e)</h1>
      <Notice error={error ?? loadError ?? undefined} ok={ok} />
      {!org?.cnpj ? <div className="notice notice-error">A NFS-e só é emitida por empresa com CNPJ. Informe o CNPJ em Conta → Empresas.</div> : null}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>1. Dados fiscais e acesso à prefeitura</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {fiscal ? "Já configurado no Asaas. Para mudar, altere e envie de novo." : "Ainda não configurado."} A prefeitura da empresa pede acesso por{" "}
          <strong>{auth === "CERTIFICATE" ? "certificado digital A1" : auth === "TOKEN" ? "token" : auth === "USER_AND_PASSWORD" ? "usuário e senha" : "—"}</strong>
          {opts && !opts.supportsCancellation ? " e não aceita cancelamento automático (cancele no site da prefeitura)" : ""}.
        </p>
        <form action={saveFiscal}>
          <div className="grid2">
            <div className="field">
              <label>E-mail para avisos das notas</label>
              <input name="email" type="email" defaultValue={f("email") || (ctx.user.email ?? "")} required />
            </div>
            <div className="field">
              <label>Regime</label>
              <select name="simplesNacional" defaultValue={fiscal ? String(fiscal.simplesNacional) : String(s.simples ?? true)}>
                <option value="true">Simples Nacional (ME/EPP/MEI)</option>
                <option value="false">Lucro Presumido ou Real</option>
              </select>
            </div>
            <div className="field">
              <label>Inscrição municipal</label>
              <input name="municipalInscription" defaultValue={f("municipalInscription")} />
              {opts?.municipalInscriptionHelp ? <span className="muted" style={{ fontSize: 12 }}>{opts.municipalInscriptionHelp}</span> : null}
            </div>
            <div className="field">
              <label>CNAE</label>
              <input name="cnae" defaultValue={f("cnae")} placeholder="Ex.: 1813001" />
            </div>
            {opts?.usesSpecialTaxRegimes ? (
              <div className="field">
                <label>Regime especial de tributação</label>
                <select name="specialTaxRegime" defaultValue={f("specialTaxRegime")}>
                  <option value="">—</option>
                  {(opts.specialTaxRegimesList ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {opts?.usesServiceListItem ? (
              <div className="field">
                <label>Item da lista de serviço (LC 116)</label>
                <input name="serviceListItem" defaultValue={f("serviceListItem")} placeholder="Ex.: 13.05" />
                {opts.serviceListItemHelp ? <span className="muted" style={{ fontSize: 12 }}>{opts.serviceListItemHelp}</span> : null}
              </div>
            ) : null}
            {(opts?.nationalPortalTaxCalculationRegimeList ?? []).length ? (
              <div className="field">
                <label>Apuração no Simples (Portal Nacional)</label>
                <select name="nationalPortalTaxCalculationRegime" defaultValue={f("nationalPortalTaxCalculationRegime")}>
                  <option value="">—</option>
                  {(opts?.nationalPortalTaxCalculationRegimeList ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Série do RPS</label>
                <input name="rpsSerie" defaultValue={f("rpsSerie")} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Próximo nº do RPS</label>
                <input name="rpsNumber" defaultValue={f("rpsNumber")} inputMode="numeric" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Próximo lote</label>
                <input name="loteNumber" defaultValue={f("loteNumber")} inputMode="numeric" />
              </div>
            </div>
            {auth === "USER_AND_PASSWORD" ? (
              <>
                <div className="field">
                  <label>Usuário do site da prefeitura</label>
                  <input name="username" defaultValue={f("username")} autoComplete="off" />
                </div>
                <div className="field">
                  <label>Senha do site da prefeitura {fiscal?.passwordSent ? "(já enviada; preencha só para trocar)" : ""}</label>
                  <input name="password" type="password" autoComplete="new-password" />
                </div>
              </>
            ) : null}
            {auth === "TOKEN" ? (
              <div className="field">
                <label>Token da prefeitura {fiscal?.accessTokenSent ? "(já enviado; preencha só para trocar)" : ""}</label>
                <input name="accessToken" type="password" autoComplete="off" />
                {opts?.accessTokenHelp ? <span className="muted" style={{ fontSize: 12 }}>{opts.accessTokenHelp}</span> : null}
              </div>
            ) : null}
            {auth === "CERTIFICATE" ? (
              <>
                <div className="field">
                  <label>Certificado digital A1 (.pfx) {fiscal?.certificateSent ? "(já enviado; envie só para trocar)" : ""}</label>
                  <input name="certificateFile" type="file" accept=".pfx,.p12" />
                  {opts?.digitalCertificatedHelp ? <span className="muted" style={{ fontSize: 12 }}>{opts.digitalCertificatedHelp}</span> : null}
                </div>
                <div className="field">
                  <label>Senha do certificado</label>
                  <input name="certificatePassword" type="password" autoComplete="new-password" />
                </div>
              </>
            ) : null}
          </div>
          <button className="btn btn-primary">Enviar dados fiscais ao Asaas</button>
          <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
            Senhas e certificado vão direto para o Asaas; o SCsync não guarda.
          </span>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>2. Serviço da nota e impostos</h2>
        <form className="row" style={{ marginBottom: 10 }}>
          <input name="busca" defaultValue={busca} placeholder="Buscar serviço na lista da prefeitura (ex.: gráfica, impressão, composição)" style={{ flex: 1 }} />
          <button className="btn btn-secondary">Buscar</button>
        </form>
        {busca ? (
          services.length ? (
            <table style={{ marginBottom: 12 }}>
              <tbody>
                {services.map((sv) => (
                  <tr key={sv.id}>
                    <td>{sv.description}</td>
                    <td className="num">{sv.issTax ? `ISS ${sv.issTax}%` : ""}</td>
                    <td className="num">
                      <form action={pickService}>
                        <input type="hidden" name="id" value={sv.id} />
                        <input type="hidden" name="description" value={sv.description} />
                        <input type="hidden" name="iss_tax" value={sv.issTax ?? ""} />
                        <button className="btn btn-secondary" style={{ padding: "2px 8px" }}>
                          Usar este
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              A prefeitura não disponibiliza a lista pelo Asaas ou nada foi encontrado. Informe o código do serviço abaixo (peça à contabilidade).
              {opts?.municipalServiceCodeHelp ? ` ${opts.municipalServiceCodeHelp}` : ""}
            </p>
          )
        ) : null}
        <form action={saveDefaults}>
          <div className="grid2">
            <div className="field">
              <label>Nome do serviço na nota</label>
              <input name="service_name" defaultValue={s.service_name ?? ""} placeholder="Ex.: Serviços gráficos e de impressão" required />
            </div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Id do serviço (da lista)</label>
                <input name="service_id" defaultValue={s.service_id ?? ""} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>ou código do serviço</label>
                <input name="service_code" defaultValue={s.service_code ?? ""} placeholder="Ex.: 13.05" />
              </div>
            </div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>ISS %</label>
                <input name="iss" defaultValue={s.iss ?? ""} inputMode="decimal" required />
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, flex: 1 }}>
                <input type="checkbox" name="retain_iss" defaultChecked={!!s.retain_iss} style={{ width: "auto" }} /> ISS retido pelo tomador
              </label>
            </div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>IR %</label>
                <input name="ir" defaultValue={s.ir ?? 0} inputMode="decimal" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>INSS %</label>
                <input name="inss" defaultValue={s.inss ?? 0} inputMode="decimal" />
              </div>
            </div>
            {s.simples === false ? (
              <>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>PIS %</label>
                    <input name="pis" defaultValue={s.pis ?? 0} inputMode="decimal" />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>COFINS %</label>
                    <input name="cofins" defaultValue={s.cofins ?? 0} inputMode="decimal" />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>CSLL %</label>
                    <input name="csll" defaultValue={s.csll ?? 0} inputMode="decimal" />
                  </div>
                </div>
                <div className="field">
                  <label>Situação tributária PIS/COFINS</label>
                  <input name="pis_cofins_tax_status" defaultValue={s.pis_cofins_tax_status ?? "STANDARD_TAXABLE_OPERATION"} />
                </div>
              </>
            ) : null}
            <div className="field">
              <label>Observação padrão da nota</label>
              <input name="observations" defaultValue={s.observations ?? ""} placeholder="Ex.: Documento emitido por ME ou EPP optante pelo Simples Nacional" />
            </div>
            <div className="field">
              <label>Emissão automática</label>
              <select name="auto" defaultValue={s.auto ?? "off"}>
                <option value="off">Não: emito pela OS ou pela aba Notas fiscais</option>
                <option value="on_payment">Sim: emitir quando o cliente pagar uma cobrança do Asaas</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary">Salvar padrões da nota</button>
          <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
            Confirme código do serviço e alíquotas com a contabilidade.
          </span>
        </form>
      </section>
    </Shell>
  );
}
