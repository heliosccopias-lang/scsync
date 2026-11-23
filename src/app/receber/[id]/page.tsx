import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";
import { Notice, PaymentPill, Shell } from "@/components/Shell";
import { charge, receiveManual, refresh, reverseSettlement } from "@/app/os/[id]/actions";
import { whatsappLink } from "@/lib/br";
import { asaasFor } from "@/lib/charges";
import { ASAAS_MIN_CHARGE_CENTS } from "@/lib/constants";
import { METHOD_LABEL, fmtDate } from "@/lib/format";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { cancelTitle } from "../actions";

export default async function ReceivableDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName, can, module: hasModule } = await requireOrg();
  const canReceive = can("finance.receive");
  const { data: r } = await sb
    .from("receivables_view")
    .select("*, customers(name, phone, cpf_cnpj), financial_categories(name)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!r) notFound();
  const [{ data: charges }, { data: settlements }] = await Promise.all([
    sb.from("charges").select("*").eq("receivable_id", id).order("created_at", { ascending: false }),
    sb.from("settlements").select("*").eq("receivable_id", id).order("created_at"),
  ]);
  const c = (charges ?? [])[0];
  const live = c && ["pending", "overdue", "confirmed"].includes(c.status);
  const open = ["open", "partial"].includes(r.status);
  const self = `/receber/${id}`;
  const customer = r.customers as unknown as { name: string; phone: string | null; cpf_cnpj: string | null } | null;

  let qr: string | null = null;
  if (c && ["pending", "overdue"].includes(c.status) && c.billing_type !== "CREDIT_CARD") {
    const asaas = await asaasFor(orgId);
    try {
      qr = asaas ? (await asaas.pixQrCode(c.asaas_payment_id)).encodedImage : null;
    } catch {
      qr = null;
    }
  }
  const wa =
    live && c
      ? whatsappLink(
          customer?.phone,
          [
            `Olá, ${customer?.name?.split(" ")[0] ?? ""}! Aqui é da ${orgName}.`,
            `Segue a cobrança: ${r.name}.`,
            `Valor: ${formatBRL(r.open_cents)}`,
            `Vencimento: ${fmtDate(r.due_date)}`,
            c.invoice_url ? `\nPague por Pix, boleto ou cartão neste link:\n${c.invoice_url}` : "",
            c.pix_payload ? `\nOu use o Pix copia e cola:\n${c.pix_payload}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
      : null;

  return (
    <Shell orgName={orgName}>
      <Link href="/receber" className="muted">
        ← Contas a receber
      </Link>
      <div className="spread" style={{ marginTop: 6 }}>
        <h1 style={{ margin: 0 }}>
          {r.name} <PaymentPill status={r.overdue ? "overdue" : r.status} />
        </h1>
        {r.origin_type === "service_order" ? (
          <Link href={`/os/${r.origin_id}`} className="btn btn-secondary">
            Ver OS
          </Link>
        ) : open && r.paid_cents === 0 && can("finance.edit") ? (
          <form action={cancelTitle}>
            <input type="hidden" name="kind" value="receivable" />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="return_to" value={self} />
            <button className="btn btn-secondary">Cancelar conta</button>
          </form>
        ) : null}
      </div>
      <Notice error={error} ok={ok} />

      <div className="card" style={{ marginBottom: 12 }}>
        <dl className="facts">
          <dt>Cliente</dt>
          <dd>{customer?.name ?? "—"}</dd>
          <dt>Vencimento</dt>
          <dd>{fmtDate(r.due_date)}</dd>
          <dt>Valor</dt>
          <dd>{formatBRL(r.amount_cents)}</dd>
          <dt>Recebido</dt>
          <dd>{formatBRL(r.paid_cents)}</dd>
          <dt>Em aberto</dt>
          <dd>
            <strong>{formatBRL(open ? r.open_cents : 0)}</strong>
          </dd>
          <dt>Forma prevista</dt>
          <dd>{METHOD_LABEL[r.method] ?? r.method}</dd>
          <dt>Categoria</dt>
          <dd>{(r.financial_categories as unknown as { name: string } | null)?.name ?? "—"}</dd>
          {r.notes ? (
            <>
              <dt>Observações</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{r.notes}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {live && c ? (
        <div className="notice" style={{ background: "var(--orange-soft)", color: "var(--ink)" }}>
          <div className="spread" style={{ marginBottom: 6 }}>
            <strong>Cobrança Asaas: {c.status}</strong>
            {canReceive ? (
            <form action={refresh}>
              <input type="hidden" name="id" value={self} />
              <input type="hidden" name="asaas_payment_id" value={c.asaas_payment_id} />
              <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                Consultar no Asaas
              </button>
            </form>
            ) : null}
          </div>
          <div className="row">
            {wa ? (
              <a className="btn btn-primary" href={wa} target="_blank" rel="noreferrer">
                Enviar por WhatsApp
              </a>
            ) : (
              <span className="muted">Cadastre o celular do cliente para enviar por WhatsApp.</span>
            )}
            {c.invoice_url ? (
              <a className="btn btn-secondary" href={c.invoice_url} target="_blank" rel="noreferrer">
                Abrir link de pagamento
              </a>
            ) : null}
          </div>
          {c.pix_payload ? (
            <div className="row" style={{ marginTop: 12, alignItems: "flex-start" }}>
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:image/png;base64,${qr}`} alt="QR Code Pix" width={170} height={170} style={{ background: "#fff", borderRadius: 8, padding: 6 }} />
              ) : null}
              <div style={{ flex: 1, minWidth: 240 }}>
                <code className="copy" style={{ marginBottom: 8 }}>{c.pix_payload}</code>
                <CopyButton text={c.pix_payload} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {open && canReceive ? (
        <div className="row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
          {!live && hasModule("asaas") && r.open_cents >= ASAAS_MIN_CHARGE_CENTS ? (
            <form action={charge}>
              <input type="hidden" name="id" value={self} />
              <input type="hidden" name="receivable_id" value={id} />
              <button className="btn btn-primary">Gerar Pix / cobrança</button>
            </form>
          ) : null}
          <details style={{ flex: 1, minWidth: 280 }}>
            <summary className="btn btn-secondary" style={{ display: "inline-flex" }}>
              Receber na maquininha / dinheiro
            </summary>
            <form action={receiveManual} className="card" style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={self} />
              <input type="hidden" name="receivable_id" value={id} />
              <div className="grid2">
                <div className="field">
                  <label htmlFor="m">Forma</label>
                  <select id="m" name="method" defaultValue="debit_card">
                    <option value="debit_card">Cartão de débito (maquininha)</option>
                    <option value="credit_card">Cartão de crédito (maquininha)</option>
                    <option value="cash">Dinheiro</option>
                    <option value="pix">Pix direto na conta</option>
                    <option value="transfer">Transferência</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="a">Valor recebido (R$)</label>
                  <input id="a" name="amount" inputMode="decimal" defaultValue={(r.open_cents / 100).toFixed(2).replace(".", ",")} />
                </div>
                <div className="field">
                  <label htmlFor="d">Data</label>
                  <input id="d" name="paid_on" type="date" defaultValue={todayInSaoPaulo()} />
                </div>
                <div className="field">
                  <label htmlFor="i">Parcelas no crédito</label>
                  <input id="i" name="card_installments" type="number" min={1} max={24} defaultValue={1} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ref">Código de autorização / NSU (opcional)</label>
                <input id="ref" name="reference" />
              </div>
              <button className="btn btn-primary">Registrar recebimento</button>
            </form>
          </details>
        </div>
      ) : null}

      {(settlements ?? []).length ? (
        <>
          <h2>Recebimentos</h2>
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Forma</th>
                <th>Origem</th>
                <th className="num">Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(settlements ?? []).map((s) => (
                <tr key={s.id} style={s.reversed_at ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                  <td>{fmtDate(s.paid_on)}</td>
                  <td>
                    {METHOD_LABEL[s.method] ?? s.method}
                    {s.reference ? <span className="muted"> · NSU {s.reference}</span> : null}
                  </td>
                  <td>{{ asaas_webhook: "Asaas (automático)", manual: "Manual", batch: "Baixa em lote", reconciliation: "Conciliação", pos_terminal: "Maquininha (automático)" }[s.source as string] ?? s.source}</td>
                  <td className="num">
                    {formatBRL(s.amount_cents)}
                    {s.interest_cents > 0 ? <span className="muted"> + juros {formatBRL(s.interest_cents)}</span> : null}
                  </td>
                  <td>
                    {["manual", "batch"].includes(s.source) && !s.reversed_at && can("finance.reverse") ? (
                      <form action={reverseSettlement}>
                        <input type="hidden" name="id" value={self} />
                        <input type="hidden" name="settlement_id" value={s.id} />
                        <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                          Estornar
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Shell>
  );
}
