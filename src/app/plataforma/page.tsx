import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { isPlatformAdmin, platformAsaas } from "@/lib/platform-billing";
import { AsaasError } from "@/lib/asaas";
import { planOf, addDaysISO } from "@/lib/plans";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { fmtDate } from "@/lib/format";

function back(key: "error" | "ok", msg: string): never {
  redirect(`/plataforma?${key}=${encodeURIComponent(msg)}`);
}

async function admin() {
  const { user } = await requireUser();
  if (!isPlatformAdmin(user.email)) notFound();
  return user;
}

/** Points the SCsync Asaas account's webhook to /api/webhooks/scsync-billing (once per environment). */
async function registerWebhook() {
  "use server";
  const user = await admin();
  const client = platformAsaas();
  const token = process.env.ASAAS_PLATFORM_WEBHOOK_TOKEN;
  if (!client || !token || !process.env.APP_URL) back("error", "Faltam ASAAS_PLATFORM_API_KEY, ASAAS_PLATFORM_WEBHOOK_TOKEN ou APP_URL na Vercel.");
  const url = new URL("/api/webhooks/scsync-billing", process.env.APP_URL);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);
  try {
    await client.createWebhook({ name: "SCsync assinaturas", url: url.toString(), email: user.email ?? "", authToken: token });
  } catch (e) {
    back("error", e instanceof AsaasError ? `O Asaas recusou: ${e.message}` : "Não foi possível falar com o Asaas.");
  }
  back("ok", "Webhook das assinaturas registrado no Asaas da plataforma.");
}

async function setAccount(form: FormData) {
  "use server";
  await admin();
  const id = String(form.get("id"));
  const op = String(form.get("op"));
  const db = supabaseAdmin();
  const today = todayInSaoPaulo();
  const changes: Record<string, unknown> =
    op === "extend"
      ? { status: "trial", trial_ends_at: addDaysISO(today, 7) }
      : op === "founder"
        ? { plan: "founder", status: "active" }
        : op === "activate"
          ? { status: "active" }
          : op === "suspend"
            ? { status: "suspended" }
            : {};
  if (!Object.keys(changes).length) back("error", "Ação inválida.");
  await db.from("accounts").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", id);
  back("ok", "Conta atualizada.");
}

const STATUS: Record<string, string> = { trial: "Teste", active: "Ativa", past_due: "Em atraso", suspended: "Suspensa", cancelled: "Cancelada" };

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await admin();
  const { error, ok } = await searchParams;
  const db = supabaseAdmin();
  const { data: accounts } = await db.from("accounts").select("*").order("created_at", { ascending: false }).limit(500);
  const { data: orgs } = await db.from("orgs").select("account_id");
  const companies = new Map<string, number>();
  for (const o of orgs ?? []) companies.set(o.account_id, (companies.get(o.account_id) ?? 0) + 1);
  const paying = (accounts ?? []).filter((a) => ["active", "past_due"].includes(a.status) && a.price_cents);
  const mrr = paying.reduce((s, a) => s + (a.billing_cycle === "yearly" ? Math.round(a.price_cents / 12) : a.price_cents), 0);
  const count = (st: string) => (accounts ?? []).filter((a) => a.status === st).length;

  return (
    <main>
      <h1>Plataforma SCsync</h1>
      <Notice error={error} ok={ok} />
      <div className="grid2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="muted">Receita mensal recorrente</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{formatBRL(mrr)}</div>
          <div className="muted">
            {paying.length} pagante(s) · {count("trial")} em teste · {count("past_due")} em atraso · {count("suspended")} suspensa(s)
          </div>
        </div>
        <div className="card">
          <div className="muted">Cobrança das assinaturas (Asaas da plataforma)</div>
          <p style={{ margin: "6px 0" }}>
            {platformAsaas() ? `Conectado (${process.env.ASAAS_PLATFORM_ENV === "production" ? "produção" : "sandbox"}).` : "Falta ASAAS_PLATFORM_API_KEY na Vercel."}
          </p>
          <form action={registerWebhook}>
            <button className="btn btn-secondary">Registrar webhook das assinaturas</button>
          </form>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Conta</th>
            <th>Situação</th>
            <th>Plano</th>
            <th>Teste até / pago até</th>
            <th className="num">Empresas</th>
            <th className="num">Valor</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(accounts ?? []).map((a) => (
            <tr key={a.id}>
              <td>
                {a.name}
                <div className="muted" style={{ fontSize: 12 }}>
                  desde {fmtDate(String(a.created_at).slice(0, 10))}
                  {a.billing_email ? ` · ${a.billing_email}` : ""}
                </div>
              </td>
              <td>{STATUS[a.status] ?? a.status}</td>
              <td>{a.plan === "founder" ? "Fundadora" : (planOf(a.plan)?.name ?? "—")}{a.billing_cycle === "yearly" ? " (anual)" : ""}</td>
              <td>{a.status === "trial" ? fmtDate(a.trial_ends_at) : fmtDate(a.paid_until)}</td>
              <td className="num">{companies.get(a.id) ?? 0}</td>
              <td className="num">{a.price_cents ? formatBRL(a.price_cents) : "—"}</td>
              <td className="num" style={{ whiteSpace: "nowrap" }}>
                {(["extend", "activate", "suspend", "founder"] as const).map((op) => (
                  <form key={op} action={setAccount} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="op" value={op} />
                    <button className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: 12, marginLeft: 4 }}>
                      {{ extend: "+7 dias de teste", activate: "Ativar", suspend: "Suspender", founder: "Fundadora" }[op]}
                    </button>
                  </form>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
