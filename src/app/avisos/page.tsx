import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { whatsappLink } from "@/lib/br";
import { DEFAULT_TPL_READY, DEFAULT_TPL_REMINDER, KIND_LABEL, PLACEHOLDERS, type NoticeKind } from "@/lib/notify-text";
import { runReminders } from "@/lib/notify";
import { requireOrg } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { canSend } from "@/lib/whatsapp-send";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/avisos?${key}=${encodeURIComponent(msg)}`);
}

async function saveSettings(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("settings")) back("error", "Seu perfil não altera as configurações.");
  const n = (k: string, min: number, max: number, def: number) => {
    const v = Number(form.get(k));
    return Number.isInteger(v) && v >= min && v <= max ? v : def;
  };
  const tpl = (k: string, def: string) => {
    const t = String(form.get(k) ?? "").trim().slice(0, 1500);
    return t && t !== def.trim() ? t : null; // the default text is stored as "use the default"
  };
  const { error } = await ctx.sb
    .from("orgs")
    .update({
      notify_reminders: form.get("notify_reminders") === "on",
      notify_ready: form.get("notify_ready") === "on",
      reminder_days_before: n("reminder_days_before", 0, 15, 1),
      reminder_days_after: n("reminder_days_after", 1, 30, 3),
      tpl_reminder: tpl("tpl_reminder", DEFAULT_TPL_REMINDER),
      tpl_ready: tpl("tpl_ready", DEFAULT_TPL_READY),
    })
    .eq("id", ctx.orgId);
  if (error) back("error", "Não foi possível salvar.");
  back("ok", "Configurações dos avisos salvas.");
}

/** Runs today's reminders now (the daily job runs at 9h; this is for checking or catching up). */
async function runNow() {
  "use server";
  const ctx = await requireOrg();
  if (!ctx.can("finance.receive") && !ctx.can("settings")) back("error", "Seu perfil não envia cobranças.");
  const c = await runReminders(supabaseAdmin(), ctx.orgId, { force: true });
  const parts = [
    c.sent ? `${c.sent} enviado(s) pelo WhatsApp` : "",
    c.manual ? `${c.manual} aguardando envio manual` : "",
    c.no_phone ? `${c.no_phone} sem celular cadastrado` : "",
    c.failed ? `${c.failed} com erro no envio` : "",
  ].filter(Boolean);
  back("ok", parts.length ? `Lembretes de hoje: ${parts.join(", ")}.` : "Nenhum lembrete novo para hoje (cada parcela recebe cada aviso uma vez só).");
}

async function markDone(form: FormData) {
  "use server";
  const ctx = await requireOrg();
  await ctx.sb
    .from("whatsapp_outbox")
    .update({ status: "manual_done", sent_at: new Date().toISOString() })
    .eq("id", String(form.get("id")))
    .eq("org_id", ctx.orgId)
    .in("status", ["manual", "failed"]);
  back("ok", "Marcado como enviado.");
}

const STATUS: Record<string, [string, string]> = {
  sent: ["Enviado", "pill-paid"],
  manual_done: ["Enviado à mão", "pill-paid"],
  manual: ["Aguardando envio", "pill-open"],
  failed: ["Erro no envio", "pill-overdue"],
  no_phone: ["Sem celular", "pill-neutral"],
};

export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; f?: string }> }) {
  const { error, ok, f } = await searchParams;
  const ctx = await requireOrg();
  const { sb, orgId, orgName, can } = ctx;
  const { data: org } = await sb
    .from("orgs")
    .select("notify_reminders, notify_ready, reminder_days_before, reminder_days_after, tpl_reminder, tpl_ready, wa_provider, wa_api_url, wa_instance, wa_api_token_encrypted, wa_client_token_encrypted")
    .eq("id", orgId)
    .single();
  const connected = canSend(org as never);
  let q = sb
    .from("whatsapp_outbox")
    .select("id, kind, customer_name, phone, text, status, error, created_at, sent_at, service_order_id, service_orders(number)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (f === "manual") q = q.eq("status", "manual");
  const { data: rows } = await q;
  const waiting = (rows ?? []).filter((r) => r.status === "manual").length;
  const canSettings = can("settings");

  return (
    <Shell orgName={orgName}>
      <h1 style={{ marginTop: 0 }}>Avisos por WhatsApp</h1>
      <Notice error={error} ok={ok} />

      <div className={`notice ${connected ? "notice-ok" : "notice-warn"}`}>
        {connected ? (
          <>WhatsApp conectado: os avisos saem sozinhos pelo número da empresa.</>
        ) : (
          <>
            WhatsApp ainda não conectado: os avisos ficam na lista abaixo como <strong>Aguardando envio</strong> e saem com um clique em
            &quot;Abrir no WhatsApp&quot;.{" "}
            {ctx.isOwner ? <Link href="/configuracoes/whatsapp">Conectar o número (Z-API ou Evolution)</Link> : "O dono da conta conecta o número em Configurações."}
          </>
        )}
      </div>

      <form action={saveSettings} className="card" style={{ marginBottom: 16 }}>
        <fieldset disabled={!canSettings} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="grid2">
            <div>
              <label className="ps-chip" style={{ marginBottom: 8 }}>
                <input type="checkbox" name="notify_reminders" defaultChecked={!!org?.notify_reminders} />
                Lembrete automático de cobrança
              </label>
              <div className="row" style={{ gap: 8, alignItems: "center", fontSize: 14 }}>
                Avisar
                <input name="reminder_days_before" type="number" min={0} max={15} defaultValue={org?.reminder_days_before ?? 1} style={{ width: 64 }} />
                dia(s) antes, no dia do vencimento e
                <input name="reminder_days_after" type="number" min={1} max={30} defaultValue={org?.reminder_days_after ?? 3} style={{ width: 64 }} />
                dia(s) depois do atraso.
              </div>
              <p className="muted" style={{ fontSize: 13 }}>Todo dia às 9h. Cada parcela recebe cada aviso uma vez só; quem já pagou não recebe.</p>
              <label htmlFor="tpl_reminder" style={{ fontSize: 13 }}>Mensagem do lembrete</label>
              <textarea id="tpl_reminder" name="tpl_reminder" rows={6} defaultValue={org?.tpl_reminder ?? DEFAULT_TPL_REMINDER} />
            </div>
            <div>
              <label className="ps-chip" style={{ marginBottom: 8 }}>
                <input type="checkbox" name="notify_ready" defaultChecked={!!org?.notify_ready} />
                Avisar o cliente quando a OS ficar pronta
              </label>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Sai quando a OS muda para <strong>Concluída</strong>, com o valor em aberto e o link de pagamento. Também há o botão &quot;Avisar cliente: OS
                pronta&quot; dentro de cada OS.
              </p>
              <label htmlFor="tpl_ready" style={{ fontSize: 13 }}>Mensagem de OS pronta</label>
              <textarea id="tpl_ready" name="tpl_ready" rows={6} defaultValue={org?.tpl_ready ?? DEFAULT_TPL_READY} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Campos que você pode usar nas mensagens: {PLACEHOLDERS.join(" ")}. {"{pagamento}"} vira o link do Pix/boleto (ou o link da OS) e {"{situacao}"}{" "}
            vira &quot;Lembrete de pagamento&quot;, &quot;Seu pagamento vence hoje&quot; ou &quot;Identificamos um pagamento em aberto&quot;.
          </p>
          {canSettings ? <button className="btn btn-primary">Salvar</button> : <p className="muted">Só quem altera as configurações muda estes avisos.</p>}
        </fieldset>
      </form>

      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Avisos enviados e pendentes</h2>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-secondary" href={f === "manual" ? "/avisos" : "/avisos?f=manual"}>
            {f === "manual" ? "Ver todos" : `Aguardando envio (${waiting}${(rows ?? []).length === 100 ? "+" : ""})`}
          </Link>
          <form action={runNow}>
            <button className="btn btn-secondary">Gerar lembretes de hoje agora</button>
          </form>
        </div>
      </div>
      {(rows ?? []).length === 0 ? (
        <div className="card empty">Nenhum aviso ainda. Ligue os avisos acima ou clique em &quot;Gerar lembretes de hoje agora&quot;.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Aviso</th>
              <th>Cliente</th>
              <th>Mensagem</th>
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const wa = r.status === "manual" || r.status === "failed" ? whatsappLink(r.phone, r.text) : null;
              const osNumber = (r.service_orders as unknown as { number: number } | null)?.number;
              const [label, pill] = STATUS[r.status] ?? [r.status, "pill-neutral"];
              return (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</td>
                  <td>
                    {KIND_LABEL[r.kind as NoticeKind] ?? r.kind}
                    {osNumber && r.service_order_id ? (
                      <>
                        {" · "}
                        <Link href={`/os/${r.service_order_id}`}>OS {osNumber}</Link>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {r.customer_name ?? "—"}
                    <div className="muted" style={{ fontSize: 12 }}>{r.phone ?? "sem celular"}</div>
                  </td>
                  <td>
                    <details>
                      <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>{r.text.split("\n")[1]?.slice(0, 70) ?? r.text.slice(0, 70)}…</summary>
                      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: "6px 0 0" }}>{r.text}</pre>
                    </details>
                    {r.error ? <div style={{ color: "var(--bad)", fontSize: 12 }}>{r.error}</div> : null}
                  </td>
                  <td>
                    <span className={`pill ${pill}`}>{label}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {wa ? (
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <a className="btn btn-primary" style={{ padding: "3px 8px", fontSize: 12 }} href={wa} target="_blank" rel="noreferrer">
                          Abrir no WhatsApp
                        </a>
                        <form action={markDone}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                            Já enviei
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
