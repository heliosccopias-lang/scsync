import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice, PaymentPill, Shell, osStatusLabel } from "@/components/Shell";
import { asaasFor, createChargeForReceivable, syncChargeFromAsaas } from "@/lib/charges";
import { formatBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";

const ERRORS: Record<string, string> = {
  already_launched: "As contas desta OS já foram lançadas.",
  no_installments: "A OS não tem parcelas.",
  installments_sum_mismatch: "A soma das parcelas não bate com o total da OS.",
  cancelled: "OS cancelada.",
};

function back(id: string, key: "error" | "ok", msg: string): never {
  redirect(`/os/${id}?${key}=${encodeURIComponent(msg)}`);
}

async function launch(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  const { sb } = await requireOrg();
  const { error } = await sb.rpc("launch_accounts", { p_service_order: id });
  if (error) back(id, "error", ERRORS[error.message.split(":")[0]] ?? "Não foi possível lançar as contas.");
  back(id, "ok", "Contas lançadas em contas a receber.");
}

async function charge(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  const receivableId = String(form.get("receivable_id"));
  const { sb, orgId } = await requireOrg();
  try {
    await createChargeForReceivable(sb, orgId, receivableId);
  } catch (e) {
    back(id, "error", e instanceof Error ? e.message : "Falha ao gerar a cobrança.");
  }
  back(id, "ok", "Cobrança criada no Asaas.");
}

async function refresh(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  const paymentId = String(form.get("asaas_payment_id"));
  const { sb, orgId } = await requireOrg();
  const { data: own } = await sb.from("charges").select("id").eq("org_id", orgId).eq("asaas_payment_id", paymentId).maybeSingle();
  if (!own) back(id, "error", "Cobrança não encontrada.");
  const asaas = await asaasFor(orgId);
  if (!asaas) back(id, "error", "Asaas não conectado.");
  await syncChargeFromAsaas(orgId, asaas!, paymentId);
  back(id, "ok", "Situação atualizada com o Asaas.");
}

async function setStatus(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  const { sb, orgId } = await requireOrg();
  const { error } = await sb.from("service_orders").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("org_id", orgId);
  if (error) back(id, "error", "Status inválido.");
  back(id, "ok", "Status atualizado.");
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
    .select("*, customers(name, cpf_cnpj, email, phone)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!os) notFound();

  const [{ data: items }, { data: installments }, { data: receivables }, { data: pay }] = await Promise.all([
    sb.from("service_order_items").select("*").eq("service_order_id", id).order("position"),
    sb.from("service_order_installments").select("*").eq("service_order_id", id).order("number"),
    sb
      .from("receivables_view")
      .select("id, name, due_date, amount_cents, paid_cents, open_cents, status, overdue, method")
      .eq("origin_type", "service_order")
      .eq("origin_id", id)
      .order("due_date"),
    sb.from("service_order_payment_view").select("payment_status, billed_cents, paid_cents").eq("service_order_id", id).maybeSingle(),
  ]);
  const recIds = (receivables ?? []).map((r) => r.id);
  const { data: charges } = recIds.length
    ? await sb
        .from("charges")
        .select("receivable_id, asaas_payment_id, status, billing_type, invoice_url, bank_slip_url, pix_payload")
        .in("receivable_id", recIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const chargeBy = new Map<string, NonNullable<typeof charges>[number]>();
  for (const c of charges ?? []) if (!chargeBy.has(c.receivable_id)) chargeBy.set(c.receivable_id, c);

  const customer = os.customers as unknown as { name: string; cpf_cnpj: string | null; email: string | null; phone: string | null };
  const launched = Boolean(os.accounts_launched_at);

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <div>
          <Link href="/os" className="muted">
            ← Ordens de serviço
          </Link>
          <h1 style={{ margin: "6px 0 0" }}>
            {os.kind === "quote" ? "Orçamento" : "OS"} #{os.number}{" "}
            <PaymentPill status={pay?.payment_status ?? "not_billed"} />
          </h1>
        </div>
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
      <Notice error={error} ok={ok} />

      <div className="grid2">
        <div className="card">
          <div className="muted">Cliente</div>
          <strong>{customer?.name}</strong>
          <div className="muted">
            {customer?.cpf_cnpj ?? "sem CPF/CNPJ"} · {customer?.email ?? "sem e-mail"} · {customer?.phone ?? "sem celular"}
          </div>
        </div>
        <div className="card">
          <div className="muted">Equipamento / problema</div>
          <strong>{os.equipment ?? "—"}</strong>
          <div className="muted">{os.problem ?? ""}</div>
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
          <tr>
            <td colSpan={4} className="num muted">
              Desconto
            </td>
            <td className="num">− {formatBRL(os.discount_cents)}</td>
          </tr>
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

      <div className="spread" style={{ marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>Pagamento</h2>
        {!launched && (installments ?? []).length > 0 ? (
          <form action={launch}>
            <input type="hidden" name="id" value={id} />
            <button className="btn btn-primary">Lançar contas</button>
          </form>
        ) : null}
      </div>

      {!launched ? (
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
                <td>{new Date(i.due_date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                <td>{i.method}</td>
                <td className="num">{formatBRL(i.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Título</th>
              <th>Vencimento</th>
              <th>Situação</th>
              <th>Cobrança Asaas</th>
              <th className="num">Valor</th>
              <th className="num">Recebido</th>
            </tr>
          </thead>
          <tbody>
            {(receivables ?? []).map((r) => {
              const c = chargeBy.get(r.id);
              const live = c && !["cancelled", "refunded"].includes(c.status);
              const status = r.overdue ? "overdue" : r.status;
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{new Date(r.due_date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                  <td>
                    <PaymentPill status={status} />
                  </td>
                  <td>
                    {live ? (
                      <div>
                        <span className="muted">{c.status}</span>
                        {c.invoice_url ? (
                          <>
                            {" · "}
                            <a href={c.invoice_url} target="_blank" rel="noreferrer">
                              link de pagamento
                            </a>
                          </>
                        ) : null}
                        {c.bank_slip_url ? (
                          <>
                            {" · "}
                            <a href={c.bank_slip_url} target="_blank" rel="noreferrer">
                              boleto
                            </a>
                          </>
                        ) : null}
                        {c.pix_payload && r.status !== "paid" ? (
                          <details>
                            <summary>Pix copia e cola</summary>
                            <code className="copy">{c.pix_payload}</code>
                          </details>
                        ) : null}
                        <form action={refresh}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="asaas_payment_id" value={c.asaas_payment_id} />
                          <button className="btn btn-secondary" style={{ padding: "3px 8px", fontSize: 12, marginTop: 4 }}>
                            Consultar no Asaas
                          </button>
                        </form>
                      </div>
                    ) : r.status === "paid" || r.method === "cash" ? (
                      <span className="muted">—</span>
                    ) : (
                      <form action={charge}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="receivable_id" value={r.id} />
                        <button className="btn btn-primary" style={{ padding: "5px 10px", fontSize: 13 }}>
                          Gerar cobrança
                        </button>
                      </form>
                    )}
                  </td>
                  <td className="num">{formatBRL(r.amount_cents)}</td>
                  <td className="num">{formatBRL(r.paid_cents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
