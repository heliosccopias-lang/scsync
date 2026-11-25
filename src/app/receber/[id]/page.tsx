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
import { cancelTitle, ungroup } from "../actions";
import { sendToTerminal } from "@/app/os/[id]/pos-actions";

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
  // A grouped charge lists what is inside it; a grouped item points to its group.
  const isGroup = r.origin_type === "grouping";
  const [{ data: items }, { data: parent }, { data: terminals }] = await Promise.all([
    isGroup
      ? sb.from("receivables").select("id, name, due_date, amount_cents, origin_type, origin_id").eq("grouped_into_id", id).order("due_date")
      : Promise.resolve({ data: [] as { id: string; name: string; due_date: string; amount_cents: number; origin_type: string; origin_id: string | null }[] }),
    r.grouped_into_id ? sb.from("receivables").select("id, name, status").eq("id", r.grouped_into_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("pos_terminals").select("id, name, provider").eq("org_id", orgId).eq("active", true).in("provider", ["stone", "mercadopago"]).order("name"),
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
        {isGroup && open && Number(r.paid_cents) === 0 && canReceive ? (
          <form action={ungroup}>
            <input type="hidden" name="id" value={id} />
            <button className="btn btn-secondary">Desagrupar</button>
          </form>
        ) : r.origin_type === "service_order" ? (
          <Link href={`/os/${r.origin_id}`} className="btn btn-secondary">
            Ver OS
          </Link>
        ) : !isGroup && open && r.paid_cents === 0 && can("finance.edit") ? (
          <form action={cancelTitle}>
            <input type="hidden" name="kind" value="receivable" />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="return_to" value={self} />
            <button className="btn btn-secondary">Cancelar conta</button>
          </form>
        ) : null}
      </div>
      <Notice error={error} ok={ok} />
      {r.grouped_into_id && parent ? (
        <div className={`notice ${r.status === "paid" ? "notice-ok" : "notice-warn"}`}>
          {r.status === "paid" ? "Paga pela cobrança agrupada " : "Esta conta está dentro da cobrança agrupada "}
          <Link href={`/receber/${parent.id}`}>{parent.name}</Link>
          {r.status === "paid" ? "." : ": cobre e receba por lá."}
        </div>
      ) : null}
      {isGroup ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <strong>Itens desta cobrança ({(items ?? []).length})</strong>
          <table style={{ marginTop: 8 }}>
            <tbody>
              {(items ?? []).map((it) => (
                <tr key={it.id}>
                  <td>
                    <Link href={`/receber/${it.id}`}>{it.name}</Link>
                    {it.origin_type === "service_order" && it.origin_id ? (
                      <>
                        {" "}
                        <Link href={`/os/${it.origin_id}`} className="muted" style={{ fontSize: 12 }}>
                          (ver OS)
                        </Link>
                      </>
                    ) : null}
                  </td>
                  <td>{fmtDate(it.due_date)}</td>
                  <td className="num">{formatBRL(it.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Quando esta cobrança for paga, todas as OS acima ficam pagas. Enquanto não houver pagamento nem cobrança gerada, dá para desagrupar.
          </p>
        </div>
      ) : null}

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
          {(terminals ?? []).length ? (
            <details style={{ minWidth: 260 }}>
              <summary className="btn btn-secondary" style={{ display: "inline-flex" }}>
                Cobrar na maquininha
              </summary>
              <form action={sendToTerminal} className="card" style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={self} />
                <input type="hidden" name="receivable_id" value={id} />
                <div className="field">
                  <label>Maquininha</label>
                  <select name="terminal_id">
                    {(terminals ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.provider === "mercadopago" ? "Mercado Pago" : "Stone"})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Forma</label>
                  <select name="payment_type" defaultValue="any">
                    <option value="any">Cliente escolhe na maquininha (débito, crédito, Pix)</option>
                    <option value="debit">Débito</option>
                    <option value="credit">Crédito</option>
                  </select>
                </div>
                <div className="field">
                  <label>Parcelas (crédito)</label>
                  <input name="installments" type="number" min={1} max={18} defaultValue={1} />
                </div>
                <input type="hidden" name="amount" value={(r.open_cents / 100).toFixed(2).replace(".", ",")} />
                <button className="btn btn-primary">Enviar para a maquininha</button>
              </form>
            </details>
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
