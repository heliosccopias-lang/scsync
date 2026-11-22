import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { platformAsaas } from "@/lib/platform-billing";
import { PLANS, TRIAL_DAYS, YEARLY_DISCOUNT, GRACE_DAYS, planOf, priceCents } from "@/lib/plans";
import { formatBRL } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";
import { cancelSubscription, subscribe } from "./actions";

const STATUS: Record<string, string> = { trial: "Período de teste", active: "Ativa", past_due: "Mensalidade em atraso", suspended: "Suspensa", cancelled: "Cancelada" };
const PAY_STATUS: Record<string, string> = { PENDING: "Aguardando pagamento", OVERDUE: "Vencida", CONFIRMED: "Paga", RECEIVED: "Paga", RECEIVED_IN_CASH: "Paga", REFUNDED: "Estornada" };

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const ctx = await requireOrg();
  const { data: acc } = await supabaseAdmin().from("accounts").select("*").eq("id", ctx.accountId).single();
  const client = platformAsaas();
  let payments: { id: string; dueDate: string; value: number; status: string; invoiceUrl?: string }[] = [];
  if (client && acc?.asaas_subscription_id) {
    try {
      payments = ((await client.subscriptionPayments(acc.asaas_subscription_id)).data ?? []).sort((a, b) => b.dueDate.localeCompare(a.dueDate)).slice(0, 12);
    } catch {
      payments = [];
    }
  }
  const open = payments.find((p) => p.status === "PENDING" || p.status === "OVERDUE");
  const current = planOf(acc?.plan);

  return (
    <Shell>
      <h1>Assinatura do SCsync</h1>
      <Notice error={error} ok={ok} />

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <strong>{STATUS[acc?.status] ?? acc?.status}</strong>
            {acc?.status === "trial" && acc.trial_ends_at ? ` até ${fmtDate(acc.trial_ends_at)}` : ""}
            {current ? ` · plano ${current.name} ${acc.billing_cycle === "yearly" ? "anual" : "mensal"} · ${formatBRL(acc.price_cents)}` : ""}
            {acc?.plan === "founder" ? " · conta fundadora (sem cobrança)" : ""}
            {acc?.paid_until ? ` · pago até ${fmtDate(acc.paid_until)}` : ""}
            {acc?.cancel_at_period_end ? " · cancelada ao fim do período" : ""}
          </div>
          {open?.invoiceUrl ? (
            <a className="btn btn-primary" href={open.invoiceUrl} target="_blank" rel="noopener noreferrer">
              Pagar {formatBRL(Math.round(open.value * 100))} (vence {fmtDate(open.dueDate)})
            </a>
          ) : null}
        </div>
        <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
          O pagamento é feito na página segura do Asaas, por Pix, boleto ou cartão. Em atraso, o acesso continua por {GRACE_DAYS} dias e depois é bloqueado até o
          pagamento; nada é apagado.
        </p>
      </section>

      {!client ? (
        <div className="notice notice-error">A cobrança das assinaturas ainda não está configurada no SCsync.</div>
      ) : null}

      <form action={subscribe}>
        <h2>{acc?.asaas_subscription_id ? "Trocar de plano" : "Escolha o plano"}</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <label style={{ display: "inline-flex", gap: 6, fontWeight: 400 }}>
            <input type="radio" name="cycle" value="monthly" defaultChecked={acc?.billing_cycle !== "yearly"} style={{ width: "auto" }} /> Mensal
          </label>
          <label style={{ display: "inline-flex", gap: 6, fontWeight: 400 }}>
            <input type="radio" name="cycle" value="yearly" defaultChecked={acc?.billing_cycle === "yearly"} style={{ width: "auto" }} /> Anual ({Math.round(YEARLY_DISCOUNT * 100)}% de desconto)
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
          {PLANS.map((p) => (
            <label key={p.key} className="card" style={{ display: "block", cursor: "pointer", fontWeight: 400, borderColor: acc?.plan === p.key ? "var(--orange)" : undefined }}>
              <input type="radio" name="plan" value={p.key} defaultChecked={acc?.plan === p.key || (!current && p.key === "servicos_produtos")} style={{ width: "auto" }} />{" "}
              <strong>{p.name}</strong>
              <div style={{ fontSize: 24, fontWeight: 800, margin: "6px 0 0" }}>
                {formatBRL(p.monthlyCents)}
                <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
                  /mês
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                ou {formatBRL(priceCents(p.key, "yearly"))}/ano ({formatBRL(Math.round(priceCents(p.key, "yearly") / 12))}/mês)
              </div>
              <ul style={{ paddingLeft: 18, fontSize: 14 }}>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </label>
          ))}
        </div>
        <div className="card">
          <strong>Dados para cobrança</strong>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div className="field">
              <label htmlFor="doc">CPF ou CNPJ</label>
              <input id="doc" name="doc" defaultValue={acc?.billing_doc ?? ctx.orgCnpj ?? ""} inputMode="numeric" required />
            </div>
            <div className="field">
              <label htmlFor="email">E-mail que recebe as cobranças</label>
              <input id="email" name="email" type="email" defaultValue={acc?.billing_email ?? ctx.user.email ?? ""} required />
            </div>
            <div className="field">
              <label htmlFor="phone">Celular (opcional)</label>
              <input id="phone" name="phone" inputMode="tel" defaultValue={acc?.billing_phone ?? ""} />
            </div>
          </div>
          <button className="btn btn-primary" disabled={!client}>
            {acc?.asaas_subscription_id ? "Salvar troca de plano" : acc?.status === "trial" ? `Assinar (1ª cobrança no fim dos ${TRIAL_DAYS} dias de teste)` : "Assinar"}
          </button>
        </div>
      </form>

      {payments.length ? (
        <>
          <h2>Mensalidades</h2>
          <table>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Situação</th>
                <th className="num">Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.dueDate)}</td>
                  <td>{PAY_STATUS[p.status] ?? p.status}</td>
                  <td className="num">{formatBRL(Math.round(p.value * 100))}</td>
                  <td className="num">
                    {p.invoiceUrl ? (
                      <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer">
                        {p.status === "PENDING" || p.status === "OVERDUE" ? "Pagar" : "Ver recibo"}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {acc?.asaas_subscription_id ? (
        <form action={cancelSubscription} style={{ marginTop: 24 }}>
          <button className="btn btn-secondary" style={{ color: "var(--bad)" }}>
            Cancelar assinatura
          </button>
          <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
            A conta funciona até o fim do período já pago.
          </span>
        </form>
      ) : null}
    </Shell>
  );
}
