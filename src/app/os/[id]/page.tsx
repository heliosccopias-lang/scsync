import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PaymentPill, Shell, osStatusLabel } from "@/components/Shell";
import { whatsappLink } from "@/lib/br";
import { ASAAS_MIN_CHARGE_CENTS } from "@/lib/constants";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { EditItemsForm } from "./EditItemsForm";
import { CopyButton } from "@/components/CopyButton";
import { asaasFor } from "@/lib/charges";
import { ATTENDANCE_LABEL, fmtDate as fmtDay } from "@/lib/format";
import { listAttachments, fmtSize } from "@/lib/attachments";
import { Uploader } from "@/components/Uploader";
import { registerOsFiles } from "./files-actions";
import { stockAction, addChecklist, removeAttachment, charge, convertQuote, updateDetails, launch, receiveManual, refresh, reverseSettlement, setStatus, updateCustomer } from "./actions";

const METHOD: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  cash: "Dinheiro",
  transfer: "Transferência",
  other: "Cliente escolhe",
};

const CHARGE_STATUS: Record<string, string> = {
  pending: "Aguardando pagamento",
  overdue: "Vencida",
  confirmed: "Pagamento confirmado",
  received: "Recebida",
  refunded: "Estornada",
  cancelled: "Cancelada",
  chargeback: "Contestada",
};

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR");
}

export default async function ServiceOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();

  const { data: os } = await sb
    .from("service_orders")
    .select(
      "*, customers(id, name, cpf_cnpj, email, phone), technicians!service_orders_technician_id_fkey(name), second:technicians!service_orders_second_technician_id_fkey(name)",
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!os) notFound();

  const [{ data: items }, { data: installments }, { data: receivables }, { data: pay }, { data: technicians }, { data: catalog }, { data: priceLists }] = await Promise.all([
    sb.from("service_order_items").select("*").eq("service_order_id", id).order("position"),
    sb.from("service_order_installments").select("*").eq("service_order_id", id).order("number"),
    sb
      .from("receivables_view")
      .select("id, name, due_date, amount_cents, paid_cents, open_cents, status, overdue, method")
      .eq("origin_type", "service_order")
      .eq("origin_id", id)
      .order("due_date"),
    sb.from("service_order_payment_view").select("payment_status").eq("service_order_id", id).maybeSingle(),
    sb.from("technicians").select("id, name").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("catalog_items").select("id, kind, name, price_cents, track_stock").eq("org_id", orgId).eq("active", true).order("name").limit(2000),
    sb.from("price_lists").select("attendance_type, adjust_pct").eq("org_id", orgId).not("attendance_type", "is", null),
  ]);
  const adjustments = Object.fromEntries((priceLists ?? []).map((p) => [p.attendance_type as string, Number(p.adjust_pct)]));
  const stockNames = new Set((catalog ?? []).filter((c) => c.kind === "product" && c.track_stock).map((c) => c.name.toLowerCase()));
  const hasStockItems = (items ?? []).some((it) => it.kind === "product" && !it.rejected && stockNames.has(String(it.description).toLowerCase()));
  const [{ data: runs }, { data: availableChecklists }] = await Promise.all([
    sb.from("checklist_runs").select("id, status, checklists(name)").eq("service_order_id", id).order("updated_at"),
    sb.from("checklists").select("id, name").eq("org_id", orgId).eq("active", true).order("name"),
  ]);
  const files = await listAttachments(sb, orgId, "service_order", [id]);
  const recIds = (receivables ?? []).map((r) => r.id);
  const [{ data: charges }, { data: settlements }] = recIds.length
    ? await Promise.all([
        sb
          .from("charges")
          .select("receivable_id, asaas_payment_id, status, billing_type, invoice_url, bank_slip_url, pix_payload")
          .in("receivable_id", recIds)
          .order("created_at", { ascending: false }),
        sb
          .from("settlements")
          .select("id, receivable_id, paid_on, amount_cents, interest_cents, method, source, reference, card_installments, reversed_at")
          .in("receivable_id", recIds)
          .order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];
  const chargeBy = new Map<string, NonNullable<typeof charges>[number]>();
  for (const c of charges ?? []) if (!chargeBy.has(c.receivable_id)) chargeBy.set(c.receivable_id, c);

  // QR Code images for open charges, straight from Asaas (not stored).
  const qrBy = new Map<string, string>();
  const openCharges = [...chargeBy.values()].filter((c) => ["pending", "overdue"].includes(c.status) && c.billing_type !== "CREDIT_CARD");
  if (openCharges.length) {
    const asaas = await asaasFor(orgId);
    if (asaas) {
      await Promise.all(
        openCharges.map(async (c) => {
          try {
            const q = await asaas.pixQrCode(c.asaas_payment_id);
            if (q.encodedImage) qrBy.set(c.asaas_payment_id, q.encodedImage);
          } catch {
            // no Pix key on the Asaas account: the page explains it below
          }
        }),
      );
    }
  }

  const customer = os.customers as unknown as { id: string; name: string; cpf_cnpj: string | null; email: string | null; phone: string | null };
  const launched = Boolean(os.accounts_launched_at);
  const total = (receivables ?? []).length;

  const appUrl = process.env.APP_URL ?? "https://scsync.vercel.app";
  const publicUrl = `${appUrl}/p/${os.share_token}`;
  const technicianName = (os.technicians as unknown as { name: string } | null)?.name ?? null;
  const secondName = (os.second as unknown as { name: string } | null)?.name ?? null;
  const shareWa = whatsappLink(
    (os.customers as unknown as { phone: string | null } | null)?.phone,
    [
      `Olá, ${(os.customers as unknown as { name: string } | null)?.name?.split(" ")[0] ?? ""}! Aqui é da ${orgName}.`,
      `Segue ${os.kind === "quote" ? "o orçamento" : "a ordem de serviço"} nº ${os.number}, no valor de ${formatBRL(os.total_cents)}:`,
      publicUrl,
    ].join("\n"),
  );

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <div>
          <Link href="/os" className="muted">
            ← Ordens de serviço
          </Link>
          <h1 style={{ margin: "6px 0 0" }}>
            {os.kind === "quote" ? "Orçamento" : "OS"} #{os.number} <PaymentPill status={pay?.payment_status ?? "not_billed"} />
          </h1>
        </div>
        <div className="row">
          {shareWa ? (
            <a className="btn btn-primary" href={shareWa} target="_blank" rel="noreferrer">
              Enviar {os.kind === "quote" ? "orçamento" : "OS"} por WhatsApp
            </a>
          ) : null}
          <details className="menu-inline">
            <summary className="btn btn-secondary">Imprimir ▾</summary>
            <div className="menu-list">
              <Link href={`/os/${id}/imprimir`}>{os.kind === "quote" ? "Orçamento" : "OS"} (via do cliente)</Link>
              <Link href={`/os/${id}/imprimir?modo=producao`}>Ordem de produção (oficina)</Link>
              <Link href={`/os/${id}/recibo`}>Recibo dos pagamentos</Link>
              <a href={publicUrl} target="_blank" rel="noreferrer">
                Abrir link do cliente
              </a>
            </div>
          </details>
          <form action={setStatus} className="row">
            <input type="hidden" name="id" value={id} />
            <select name="status" defaultValue={os.status} aria-label="Status da OS" style={{ width: 190 }}>
              {["open", "approved", "in_progress", "waiting_parts", "done", "delivered", "cancelled"].map((s) => (
                <option key={s} value={s}>
                  {osStatusLabel(s)}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary">Alterar status</button>
          </form>
        </div>
      </div>
      <Notice error={error} ok={ok} />
      {os.kind === "quote" ? (
        <div className="notice" style={{ background: "var(--orange-soft)", color: "var(--ink)" }}>
          <div className="spread" style={{ marginBottom: 0 }}>
            <span>
              <strong>Orçamento.</strong> Envie ao cliente; quando ele aprovar, converta em ordem de serviço para lançar as contas e cobrar.
            </span>
            <form action={convertQuote}>
              <input type="hidden" name="id" value={id} />
              <button className="btn btn-primary">Aprovar e converter em OS</button>
            </form>
          </div>
        </div>
      ) : null}

      <div className="grid2">
        <div className="card">
          <div className="spread" style={{ marginBottom: 4 }}>
            <span className="muted">Cliente</span>
            {!customer?.cpf_cnpj ? <span className="pill pill-overdue">Sem CPF/CNPJ</span> : null}
          </div>
          <strong>{customer?.name}</strong>
          <div className="muted">
            {customer?.cpf_cnpj ?? "sem CPF/CNPJ"} · {customer?.phone ?? "sem celular"} · {customer?.email ?? "sem e-mail"}
          </div>
          <details style={{ marginTop: 8 }} open={!customer?.cpf_cnpj}>
            <summary>Editar cliente</summary>
            <form action={updateCustomer} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="customer_id" value={customer?.id} />
              <div className="field">
                <label htmlFor="c_name">Nome</label>
                <input id="c_name" name="name" defaultValue={customer?.name} required />
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="c_doc">CPF/CNPJ (o Asaas exige)</label>
                  <input id="c_doc" name="cpf_cnpj" inputMode="numeric" defaultValue={customer?.cpf_cnpj ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="c_phone">Celular com DDD (WhatsApp)</label>
                  <input id="c_phone" name="phone" inputMode="tel" defaultValue={customer?.phone ?? ""} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="c_email">E-mail</label>
                <input id="c_email" name="email" type="email" defaultValue={customer?.email ?? ""} />
              </div>
              <button className="btn btn-secondary">Salvar cliente</button>
            </form>
          </details>
        </div>
        <div className="card">
          <div className="muted">Dados da OS</div>
          <dl className="facts">
            <dt>Técnico</dt>
            <dd>
              {technicianName ?? "—"}
              {secondName ? ` e ${secondName}` : ""}
            </dd>
            <dt>Atendimento</dt>
            <dd>{ATTENDANCE_LABEL[os.attendance_type] ?? os.attendance_type}</dd>
            <dt>Entrega prevista</dt>
            <dd>{fmtDay(os.delivery_date)}</dd>
            <dt>Equipamento</dt>
            <dd>{os.equipment ?? "—"}</dd>
            <dt>Problema</dt>
            <dd>{os.problem ?? "—"}</dd>
            {os.receipt_notes ? (
              <>
                <dt>Recebimento</dt>
                <dd>{os.receipt_notes}</dd>
              </>
            ) : null}
            {os.technical_report ? (
              <>
                <dt>Laudo técnico</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{os.technical_report}</dd>
              </>
            ) : null}
            {os.warranty ? (
              <>
                <dt>Garantia</dt>
                <dd>{os.warranty}</dd>
              </>
            ) : null}
            {os.internal_notes ? (
              <>
                <dt>Obs. internas</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{os.internal_notes}</dd>
              </>
            ) : null}
          </dl>
          <details style={{ marginTop: 8 }}>
            <summary>Editar dados da OS e laudo técnico</summary>
            <form action={updateDetails} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={id} />
              <div className="grid2">
                <div className="field">
                  <label htmlFor="d_tech">Técnico</label>
                  <select id="d_tech" name="technician_id" defaultValue={os.technician_id ?? ""}>
                    <option value="">— Nenhum —</option>
                    {(technicians ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="d_tech2">Segundo técnico</label>
                  <select id="d_tech2" name="second_technician_id" defaultValue={os.second_technician_id ?? ""}>
                    <option value="">— Nenhum —</option>
                    {(technicians ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="d_att">Atendimento</label>
                  <select id="d_att" name="attendance_type" defaultValue={os.attendance_type}>
                    <option value="external">Externo</option>
                    <option value="internal">Interno</option>
                    <option value="warranty">Garantia</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="d_delivery">Entrega prevista</label>
                  <input id="d_delivery" name="delivery_date" type="date" defaultValue={os.delivery_date ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="d_equip">Equipamento</label>
                  <input id="d_equip" name="equipment" defaultValue={os.equipment ?? ""} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="d_problem">Problema relatado</label>
                <input id="d_problem" name="problem" defaultValue={os.problem ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="d_receipt">Observações do recebimento</label>
                <input id="d_receipt" name="receipt_notes" defaultValue={os.receipt_notes ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="d_report">Laudo técnico / diagnóstico</label>
                <textarea id="d_report" name="technical_report" defaultValue={os.technical_report ?? ""} />
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="d_notes">Observações (saem na OS)</label>
                  <textarea id="d_notes" name="notes" defaultValue={os.notes ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="d_internal">Observações internas</label>
                  <textarea id="d_internal" name="internal_notes" defaultValue={os.internal_notes ?? ""} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="d_warranty">Garantia</label>
                <input id="d_warranty" name="warranty" defaultValue={os.warranty ?? ""} />
              </div>
              <button className="btn btn-secondary">Salvar dados</button>
            </form>
          </details>
        </div>
      </div>

      <h2>Itens</h2>
      <table>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Descrição</th>
            <th className="num">Qtd</th>
            <th className="num">Unitário</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((it) => (
            <tr key={it.id}>
              <td>{it.kind === "service" ? "Serviço" : "Produto"}</td>
              <td>{it.description}</td>
              <td className="num">{Number(it.quantity).toLocaleString("pt-BR")}</td>
              <td className="num">{formatBRL(it.unit_price_cents)}</td>
              <td className="num">{formatBRL(it.total_cents)}</td>
            </tr>
          ))}
          {os.discount_cents > 0 ? (
            <tr>
              <td colSpan={4} className="num muted">
                Desconto
              </td>
              <td className="num">− {formatBRL(os.discount_cents)}</td>
            </tr>
          ) : null}
          <tr>
            <td colSpan={4} className="num">
              <strong>Total da OS</strong>
            </td>
            <td className="num">
              <strong>{formatBRL(os.total_cents)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      {launched ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Contas lançadas em {new Date(os.accounts_launched_at).toLocaleDateString("pt-BR")}: os serviços e produtos desta OS não podem mais ser alterados.
        </p>
      ) : os.status !== "cancelled" ? (
        <details style={{ marginTop: 12 }}>
          <summary className="btn btn-secondary" style={{ display: "inline-flex" }}>
            Acrescentar ou editar serviços e produtos
          </summary>
          <EditItemsForm
            catalog={catalog ?? []}
            adjustments={adjustments}
            attendance={os.attendance_type}
            osId={id}
            discountCents={os.discount_cents}
            items={(items ?? []).map((it) => ({ kind: it.kind, description: it.description, quantity: it.quantity, unit_price_cents: it.unit_price_cents }))}
          />
        </details>
      ) : null}


      {hasStockItems && os.kind === "order" ? (
        <div className="row" style={{ marginTop: 12 }}>
          {os.stock_launched_at ? (
            <>
              <span className="muted">Estoque baixado em {fmtDay(os.stock_launched_at)}.</span>
              <form action={stockAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="op" value="reverse" />
                <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 13 }}>
                  Estornar estoque
                </button>
              </form>
            </>
          ) : (
            <form action={stockAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="op" value="launch" />
              <button className="btn btn-secondary">Lançar estoque (baixar peças usadas)</button>
            </form>
          )}
        </div>
      ) : null}

      <div className="grid2" style={{ marginTop: 28 }}>
        <div className="card">
          <div className="spread" style={{ marginBottom: 8 }}>
            <strong>Checklists</strong>
            <Link href="/cadastros/checklists" className="muted" style={{ fontSize: 13 }}>
              Gerenciar
            </Link>
          </div>
          {(runs ?? []).length === 0 ? <p className="muted" style={{ margin: "0 0 8px" }}>Nenhum checklist nesta OS.</p> : null}
          {(runs ?? []).map((r) => {
            const [label, cls] =
              r.status === "done" ? ["Finalizado", "pill-paid"] : r.status === "in_progress" ? ["Com pendências", "pill-partial"] : ["Não iniciado", "pill-neutral"];
            return (
              <div key={r.id} className="spread" style={{ marginBottom: 6 }}>
                <Link href={`/os/${id}/checklist/${r.id}`}>{(r.checklists as unknown as { name: string } | null)?.name}</Link>
                <span className={`pill ${cls}`}>{label}</span>
              </div>
            );
          })}
          {(availableChecklists ?? []).length ? (
            <form action={addChecklist} className="row" style={{ marginTop: 8, flexWrap: "nowrap" }}>
              <input type="hidden" name="id" value={id} />
              <select name="checklist_id" aria-label="Checklist" defaultValue="">
                <option value="" disabled>
                  Incluir checklist…
                </option>
                {(availableChecklists ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary">Incluir</button>
            </form>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Crie modelos em Cadastros → Checklists.
            </p>
          )}
        </div>
        <div className="card">
          <strong>Anexos</strong>
          <p className="muted" style={{ margin: "4px 0 8px", fontSize: 13 }}>
            Fotos do equipamento, contrato, notas. Até 10 por vez, 5 MB cada.
          </p>
          <div className="row" style={{ marginBottom: 8 }}>
            {files.map((f) => (
              <div key={f.id} style={{ textAlign: "center", width: 104 }}>
                <a href={f.url ?? "#"} target="_blank" rel="noreferrer" title={f.file_name}>
                  {f.isImage && f.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt={f.file_name} width={96} height={96} style={{ objectFit: "cover", borderRadius: 6 }} />
                  ) : (
                    <div className="card" style={{ width: 96, height: 96, padding: 6, fontSize: 11, overflow: "hidden" }}>
                      {f.file_name}
                    </div>
                  )}
                </a>
                <div className="muted" style={{ fontSize: 11 }}>{fmtSize(f.size_bytes)}</div>
                <form action={removeAttachment}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="attachment_id" value={f.id} />
                  <button className="btn btn-secondary" style={{ padding: "1px 6px", fontSize: 11 }}>
                    Remover
                  </button>
                </form>
              </div>
            ))}
          </div>
          <Uploader orgId={orgId} folder={`service_order/${id}`} register={registerOsFiles} extra={{ os_id: id }} />
        </div>
      </div>
      <div className="spread" style={{ marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>Pagamento</h2>
        {!launched && os.kind !== "quote" && (installments ?? []).length > 0 ? (
          <form action={launch} className="row">
            <input type="hidden" name="id" value={id} />
            <span className="muted" style={{ fontSize: 13 }}>Depois de lançar, os itens da OS ficam travados.</span>
            <button className="btn btn-primary">Lançar contas</button>
          </form>
        ) : null}
      </div>

      {!launched ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Clique em <strong>Lançar contas</strong> para transformar as parcelas abaixo em contas a receber. Depois você escolhe, em cada parcela, se cobra
            pelo Asaas (Pix, boleto, cartão online) ou se recebe na maquininha ou em dinheiro.
          </p>
          <table>
            <thead>
              <tr>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th>Forma</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {(installments ?? []).map((i) => (
                <tr key={i.id}>
                  <td>{i.number}</td>
                  <td>{fmtDate(i.due_date)}</td>
                  <td>{METHOD[i.method] ?? i.method}</td>
                  <td className="num">{formatBRL(i.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        (receivables ?? []).map((r, idx) => {
          const c = chargeBy.get(r.id);
          const live = c && ["pending", "overdue", "confirmed"].includes(c.status);
          const open = r.status !== "paid" && r.status !== "cancelled";
          const status = r.overdue ? "overdue" : r.status;
          const message = [
            `Olá, ${customer?.name?.split(" ")[0] ?? ""}! Aqui é da ${orgName}.`,
            `Segue a cobrança da OS nº ${os.number}${total > 1 ? ` (parcela ${idx + 1}/${total})` : ""}.`,
            `Valor: ${formatBRL(r.open_cents)}`,
            `Vencimento: ${fmtDate(r.due_date)}`,
            c?.invoice_url ? `\nPague por Pix, boleto ou cartão neste link:\n${c.invoice_url}` : "",
            c?.pix_payload ? `\nOu use o Pix copia e cola:\n${c.pix_payload}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          const wa = live ? whatsappLink(customer?.phone, message) : null;
          const recSettlements = (settlements ?? []).filter((s) => s.receivable_id === r.id);

          return (
            <div key={r.id} className="card" style={{ marginBottom: 12 }}>
              <div className="spread" style={{ marginBottom: 8 }}>
                <div>
                  <strong>{r.name}</strong>{" "}
                  <span className="muted">
                    · vence {fmtDate(r.due_date)} · {formatBRL(r.amount_cents)}
                    {r.paid_cents > 0 ? ` · recebido ${formatBRL(r.paid_cents)}` : ""}
                  </span>
                </div>
                <PaymentPill status={status} />
              </div>

              {live ? (
                <div className="notice" style={{ background: "var(--orange-soft)", color: "var(--ink)", marginBottom: 10 }}>
                  <div className="spread" style={{ marginBottom: 6 }}>
                    <strong>Cobrança Asaas: {CHARGE_STATUS[c.status] ?? c.status}</strong>
                    <form action={refresh}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="asaas_payment_id" value={c.asaas_payment_id} />
                      <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                        Consultar no Asaas
                      </button>
                    </form>
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
                    {c.bank_slip_url ? (
                      <a className="btn btn-secondary" href={c.bank_slip_url} target="_blank" rel="noreferrer">
                        Boleto
                      </a>
                    ) : null}
                  </div>
                  {c.pix_payload ? (
                    <div className="row" style={{ marginTop: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      {qrBy.get(c.asaas_payment_id) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`data:image/png;base64,${qrBy.get(c.asaas_payment_id)}`}
                          alt={`QR Code Pix de ${formatBRL(r.open_cents)}`}
                          width={180}
                          height={180}
                          style={{ background: "#fff", borderRadius: 8, padding: 6 }}
                        />
                      ) : null}
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <strong>Pix de {formatBRL(r.open_cents)}</strong>
                        <p className="muted" style={{ margin: "4px 0 8px" }}>
                          O cliente pode ler o QR Code na tela ou pagar com o código copia e cola.
                        </p>
                        <code className="copy" style={{ marginBottom: 8 }}>{c.pix_payload}</code>
                        <CopyButton text={c.pix_payload} />
                      </div>
                    </div>
                  ) : c.billing_type !== "CREDIT_CARD" ? (
                    <p style={{ marginTop: 10, marginBottom: 0 }}>
                      O Asaas não gerou o código Pix: cadastre uma <strong>chave Pix</strong> na sua conta Asaas (no ambiente de teste também) e clique em
                      &ldquo;Consultar no Asaas&rdquo;. Enquanto isso, o link de pagamento funciona.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {open ? (
                <div className="row" style={{ alignItems: "flex-start" }}>
                  {!live && r.open_cents >= ASAAS_MIN_CHARGE_CENTS ? (
                    <form action={charge}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="receivable_id" value={r.id} />
                      <button className="btn btn-primary">Gerar Pix / cobrança</button>
                    </form>
                  ) : null}
                  {!live && r.open_cents < ASAAS_MIN_CHARGE_CENTS ? (
                    <span className="muted" style={{ alignSelf: "center" }}>
                      Abaixo de {formatBRL(ASAAS_MIN_CHARGE_CENTS)} o Asaas não gera cobrança: receba na maquininha ou em dinheiro.
                    </span>
                  ) : null}
                  <details style={{ flex: 1, minWidth: 280 }}>
                    <summary className="btn btn-secondary" style={{ display: "inline-flex" }}>
                      Receber na maquininha / dinheiro
                    </summary>
                    <form action={receiveManual} className="card" style={{ marginTop: 10 }}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="receivable_id" value={r.id} />
                      {live ? (
                        <p className="muted" style={{ marginTop: 0 }}>
                          Ao registrar, a cobrança Pix aberta no Asaas é cancelada para o cliente não pagar duas vezes.
                        </p>
                      ) : null}
                      <div className="grid2">
                        <div className="field">
                          <label htmlFor={`m_${r.id}`}>Forma</label>
                          <select id={`m_${r.id}`} name="method" defaultValue="debit_card">
                            <option value="debit_card">Cartão de débito (maquininha)</option>
                            <option value="credit_card">Cartão de crédito (maquininha)</option>
                            <option value="cash">Dinheiro</option>
                            <option value="pix">Pix direto na conta</option>
                            <option value="transfer">Transferência</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`a_${r.id}`}>Valor recebido (R$)</label>
                          <input id={`a_${r.id}`} name="amount" inputMode="decimal" defaultValue={(r.open_cents / 100).toFixed(2).replace(".", ",")} />
                        </div>
                        <div className="field">
                          <label htmlFor={`d_${r.id}`}>Data</label>
                          <input id={`d_${r.id}`} name="paid_on" type="date" defaultValue={todayInSaoPaulo()} />
                        </div>
                        <div className="field">
                          <label htmlFor={`i_${r.id}`}>Parcelas no cartão de crédito</label>
                          <input id={`i_${r.id}`} name="card_installments" type="number" min={1} max={24} defaultValue={1} />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor={`ref_${r.id}`}>Código de autorização / NSU (opcional)</label>
                        <input id={`ref_${r.id}`} name="reference" />
                      </div>
                      <button className="btn btn-primary">Registrar recebimento</button>
                    </form>
                  </details>
                </div>
              ) : null}

              {recSettlements.length ? (
                <table style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>Recebido em</th>
                      <th>Forma</th>
                      <th>Origem</th>
                      <th className="num">Valor</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recSettlements.map((s) => (
                      <tr key={s.id} style={s.reversed_at ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                        <td>{fmtDate(s.paid_on)}</td>
                        <td>
                          {METHOD[s.method] ?? s.method}
                          {s.card_installments && s.card_installments > 1 ? ` ${s.card_installments}x` : ""}
                          {s.reference ? <span className="muted"> · NSU {s.reference}</span> : null}
                        </td>
                        <td>{s.source === "asaas_webhook" ? "Asaas (automático)" : "Manual"}</td>
                        <td className="num">
                          {formatBRL(s.amount_cents)}
                          {s.interest_cents > 0 ? <span className="muted"> + juros {formatBRL(s.interest_cents)}</span> : null}
                        </td>
                        <td>
                          {s.source === "manual" && !s.reversed_at ? (
                            <form action={reverseSettlement}>
                              <input type="hidden" name="id" value={id} />
                              <input type="hidden" name="settlement_id" value={s.id} />
                              <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }}>
                                Estornar
                              </button>
                            </form>
                          ) : s.reversed_at ? (
                            <span className="muted">estornado</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          );
        })
      )}
    </Shell>
  );
}
